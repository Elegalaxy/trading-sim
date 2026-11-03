// Order-flow parties. Pure rules over `MarketState` and the definitions: this module
// never sees the player's side of the game, so nothing the player does can move the market.
//
// Price moves by net demand over depth: move = price × demand / depth, with
// depth = the stock's daily traded value × `depthDays`. Institutions and noise traders are
// the existing pull toward fair value and the normal noise term in `market.ts`, whose demand
// form is algebraically the same, so they keep their formulas. This module adds the parties
// that were not there before: informed money, news traders, the retail crowd and trend
// followers.
//
// Informed money: when an event is rolled onto the schedule, one draw on the participants
// stream decides whether informed money hears of it (the type's `leak` times the run's
// regime). While a leaked event is still waiting, the fund trades the stocks it will hit, in
// the direction of its effect. An event is rolled three days ahead at the end of a step, so
// the first price step that sees it is two days before it fires: the fund trades 2/3 of full
// size then and full size the day before, scaled by the event's magnitude up to a reference.
// Calendar items are not events and never leak.
//
// News traders: on every day a stock has an event effect applied (its news is in play), they
// close a share (the run's news efficiency, `news.efficiency*`) of the gap between the price and
// the news-adjusted fair value: fair value plus what the stock's active effects still have to
// apply. That is on top of the pull. A share above 1 overshoots, and the pull then brings the
// price back. Their reaction lands on the day the effect first moves fair value, before the
// headline is readable, so a reader of the headline finds less left to trade. They stop when
// the last effect day has been applied. Depth does not scale them: they act on public news.
//
// Consensus traders: a calendar release is rolled three days ahead and its consensus (the most
// likely outcome at the last released values, public from the roll) is known. For the two days
// before the release they trade each stock toward the effect that consensus outcome would have,
// at 2/3 then full size, so it is already in the price. On the day fair value takes the actual
// effect: a release that matches the consensus barely moves the price, and a surprise moves it
// by roughly the actual effect minus the expected one.
//
// Retail crowd: each stock has a mood. Every rumour in the feed the player reads (any source,
// true or false) adds a share to the crowd's belief in that event, signed by its claimed
// direction and sized by the source tier. Headlines add a smaller mood after the fact, which
// fades. The crowd trades the change in mood, so it buys a rumour, and its share leaves when
// the event's day comes: a true rumour is sold into the news, a false one unwinds when the day
// passes with no event. Its money is fixed in dollars, so a thin stock moves more than a deep
// one. The crowd draws nothing: it reads the feed that is already in the market state.
//
// Trend followers: they trade the direction of the move over the last few closes, full size at
// a clear trend, and flip when it reverses.
//
// Participants stream draw order (`createRng(seed + '#participants')`, `market` member):
// the informed, news and crowd regime draws at creation, then one draw per newly
// scheduled event in schedule order
// (days 1 to 3 at creation, then the day+3 roll of each step). Nothing else draws.

import { createRng, nextFloat } from './rng.ts'
import { EVENT_LOOKAHEAD_DAYS, SESSION_BASE_NOTIONAL_CENTS } from './constants.ts'
import { affectedAssets, decayShare } from './events.ts'
import type {
  AssetDefinition,
  FeedItem,
  MarketDefinitions,
  MarketState,
  ParticipantDefinitions,
  ParticipantFlowEvent,
  ParticipantState,
  ScheduledEvent,
} from './types.ts'

function describeValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

export function assertParticipantDefinitions(p: ParticipantDefinitions): void {
  const positive = (value: unknown, label: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`participants ${label} must be a positive finite number, received ${describeValue(value)}`)
    }
  }
  positive(p.depthDays, 'depthDays')
  positive(p.informed.capitalCents, 'informed.capitalCents')
  positive(p.informed.magnitudeRefPercent, 'informed.magnitudeRefPercent')
  positive(p.informed.regimeMin, 'informed.regimeMin')
  positive(p.consensus.capitalCents, 'consensus.capitalCents')
  positive(p.consensus.magnitudeRefPercent, 'consensus.magnitudeRefPercent')
  positive(p.crowd.capitalCents, 'crowd.capitalCents')
  positive(p.crowd.heatMin, 'crowd.heatMin')
  if (typeof p.crowd.heatMax !== 'number' || !(p.crowd.heatMax >= p.crowd.heatMin)) {
    throw new Error(`participants crowd.heatMax must be at least heatMin, received ${describeValue(p.crowd.heatMax)}`)
  }
  positive(p.momentum.capitalCents, 'momentum.capitalCents')
  positive(p.momentum.thresholdPercent, 'momentum.thresholdPercent')
  if (!Number.isSafeInteger(p.momentum.lookbackDays) || p.momentum.lookbackDays < 1) {
    throw new Error(`participants momentum.lookbackDays must be a positive integer, received ${describeValue(p.momentum.lookbackDays)}`)
  }
  positive(p.news.efficiencyMin, 'news.efficiencyMin')
  if (typeof p.news.efficiencyMax !== 'number' || !(p.news.efficiencyMax >= p.news.efficiencyMin)) {
    throw new Error(`participants news.efficiencyMax must be at least efficiencyMin, received ${describeValue(p.news.efficiencyMax)}`)
  }
  if (typeof p.informed.regimeMax !== 'number' || !(p.informed.regimeMax >= p.informed.regimeMin)) {
    throw new Error(`participants informed.regimeMax must be at least regimeMin, received ${describeValue(p.informed.regimeMax)}`)
  }
}

/** Cents of net demand that would move a stock's price by 100%. */
export function depthCents(def: AssetDefinition, p: ParticipantDefinitions): number {
  return (def.liquidityNotionalCents ?? SESSION_BASE_NOTIONAL_CENTS) * p.depthDays
}

/** The parties' own stream and the run's regime. Draws once, for the regime. */
export function createParticipants(defs: MarketDefinitions, seed: string): ParticipantState | undefined {
  const p = defs.participants
  if (p === undefined) return undefined
  assertParticipantDefinitions(p)
  const stream = createRng(`${seed}#participants`).market
  const informed = p.informed.regimeMin + nextFloat(stream) * (p.informed.regimeMax - p.informed.regimeMin)
  const news = p.news.efficiencyMin + nextFloat(stream) * (p.news.efficiencyMax - p.news.efficiencyMin)
  const heat = p.crowd.heatMin + nextFloat(stream) * (p.crowd.heatMax - p.crowd.heatMin)
  return { stream, informed, news, heat, shares: {}, chase: {}, mood: {}, closes: {}, leaked: [] }
}

/** One leak draw per newly scheduled event, in order, then drop ids that are no longer scheduled. */
export function assignLeaks(state: MarketState, defs: MarketDefinitions, fresh: readonly ScheduledEvent[]): void {
  const participants = state.participants
  if (participants === undefined) return
  for (const event of fresh) {
    const roll = nextFloat(participants.stream)
    const type = defs.events.find((item) => item.id === event.typeId)
    const chance = Math.min(1, (type?.leak ?? 0) * participants.informed)
    if (roll < chance) participants.leaked.push(event.id)
  }
  const waiting = new Set(state.scheduled.map((event) => event.id))
  participants.leaked = participants.leaked.filter((id) => waiting.has(id))
}

/** Informed money's net demand in one stock today, in cents. Positive buys. */
export function informedFlow(state: MarketState, defs: MarketDefinitions, def: AssetDefinition): ParticipantFlowEvent | null {
  const p = defs.participants
  const participants = state.participants
  if (p === undefined || participants === undefined || participants.leaked.length === 0) return null
  let demand = 0
  const events: string[] = []
  for (const event of state.scheduled) {
    if (!participants.leaked.includes(event.id)) continue
    const daysUntil = event.eventDay - state.day
    if (daysUntil < 1 || daysUntil > EVENT_LOOKAHEAD_DAYS) continue
    const type = defs.events.find((item) => item.id === event.typeId)
    if (type === undefined) throw new Error(`scheduled event ${event.id} has unknown type ${event.typeId}`)
    if (!affectedAssets(type.scope, event.target, defs.assets).includes(def.id)) continue
    const ramp = (EVENT_LOOKAHEAD_DAYS + 1 - daysUntil) / EVENT_LOOKAHEAD_DAYS
    const size = Math.min(1, event.magnitudePercent / p.informed.magnitudeRefPercent)
    demand += (event.direction === 'down' ? -1 : 1) * p.informed.capitalCents * size * ramp
    events.push(event.id)
  }
  if (events.length === 0) return null
  const depth = depthCents(def, p)
  return {
    kind: 'participantFlow',
    day: state.day,
    asset: def.id,
    party: 'informed',
    demandCents: demand,
    depthCents: depth,
    moveCents: (state.assets[def.id].priceCents * demand) / depth,
    events,
  }
}

/** What a stock's active event effects have still to apply to fair value, in cents. */
function pendingEffect(state: MarketState, assetId: string): number {
  let pending = 0
  for (const effect of state.active) {
    for (const part of effect.parts) {
      if (part.asset !== assetId) continue
      for (let i = effect.dayIndex; i < effect.duration; i += 1) {
        pending += part.totalDelta * decayShare(effect.decay, effect.duration, i)
      }
    }
  }
  return pending
}

/**
 * News traders' move in one stock today. `inPlay` is the set of stocks that had an effect applied
 * today. The price is read before the step, so `previous` is the open of the step.
 */
export function newsFlow(
  state: MarketState,
  defs: MarketDefinitions,
  def: AssetDefinition,
  inPlay: ReadonlySet<string>,
): ParticipantFlowEvent | null {
  const p = defs.participants
  const participants = state.participants
  if (p === undefined || participants === undefined || !inPlay.has(def.id)) return null
  const asset = state.assets[def.id]
  const target = asset.fairValue + pendingEffect(state, def.id)
  const move = participants.news * (target - asset.priceCents)
  if (move === 0) return null
  const depth = depthCents(def, p)
  return {
    kind: 'participantFlow',
    day: state.day,
    asset: def.id,
    party: 'news',
    demandCents: (move * depth) / asset.priceCents,
    depthCents: depth,
    moveCents: move,
    events: state.active.filter((effect) => effect.parts.some((part) => part.asset === def.id)).map((effect) => effect.id),
  }
}

/** The stocks a rumoured or headlined event id (`type:target:day`) reaches, or [] for a calendar id or an unknown one. */
function assetsOfEvent(defs: MarketDefinitions, eventId: string): string[] {
  const [typeId, target] = eventId.split(':')
  const type = defs.events.find((item) => item.id === typeId)
  if (type === undefined || target === undefined) return []
  return affectedAssets(type.scope, target, defs.assets)
}

function eventDayOf(eventId: string): number {
  return Number(eventId.split(':')[2])
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
}

function sign(direction: 'up' | 'down' | undefined): number {
  return direction === 'up' ? 1 : direction === 'down' ? -1 : 0
}

/** Cents the price moves for this much demand. */
function moveFor(state: MarketState, def: AssetDefinition, p: ParticipantDefinitions, demand: number): number {
  return (state.assets[def.id].priceCents * demand) / depthCents(def, p)
}

/** What the crowd and the trend followers need worked out once a day, before any stock is priced. */
export type PartyDay = { crowdDemand: Record<string, number> }

/**
 * Update the crowd from today's feed and note yesterday's close. Mutates `state.participants`.
 * Call once per step, after effects are applied and before the stocks are priced.
 */
export function startPartyDay(state: MarketState, defs: MarketDefinitions): PartyDay {
  const p = defs.participants
  const participants = state.participants
  const day: PartyDay = { crowdDemand: {} }
  if (p === undefined || participants === undefined) return day
  const stocks = defs.assets.filter((def) => def.kind === 'stock')
  for (const def of stocks) {
    const list = participants.closes[def.id] ?? []
    list.push(state.assets[def.id].priceCents)
    while (list.length > p.momentum.lookbackDays + 1) list.shift()
    participants.closes[def.id] = list
    participants.chase[def.id] = (participants.chase[def.id] ?? 0) * (1 - p.crowd.chaseDecay)
  }
  if (state.feed.day === state.day) {
    for (const item of state.feed.items as readonly FeedItem[]) {
      if (item.kind === 'rumour') {
        const direction = sign(item.direction)
        if (direction === 0 || assetsOfEvent(defs, item.targetEventId).length === 0) continue
        const share = (participants.shares[item.targetEventId] ?? 0) + direction * p.crowd.tierWeight[item.tier]
        participants.shares[item.targetEventId] = clamp(share, 1)
      } else {
        const direction = sign(item.direction)
        if (direction === 0) continue
        for (const asset of assetsOfEvent(defs, item.eventId)) {
          participants.chase[asset] = clamp((participants.chase[asset] ?? 0) + direction * p.crowd.headlineWeight, 1)
        }
      }
    }
  }
  for (const id of Object.keys(participants.shares)) {
    if (eventDayOf(id) <= state.day) delete participants.shares[id]
  }
  for (const def of stocks) {
    let mood = participants.chase[def.id] ?? 0
    for (const [id, share] of Object.entries(participants.shares)) {
      if (assetsOfEvent(defs, id).includes(def.id)) mood += share
    }
    day.crowdDemand[def.id] = p.crowd.capitalCents * participants.heat * (mood - (participants.mood[def.id] ?? 0))
    participants.mood[def.id] = mood
  }
  return day
}

/** The crowd's move in one stock today: its capital times the change in its mood. */
export function crowdFlow(
  state: MarketState,
  defs: MarketDefinitions,
  def: AssetDefinition,
  day: PartyDay,
): ParticipantFlowEvent | null {
  const p = defs.participants
  const participants = state.participants
  const demand = day.crowdDemand[def.id]
  if (p === undefined || participants === undefined || demand === undefined || demand === 0) return null
  const events = Object.keys(participants.shares).filter((id) => assetsOfEvent(defs, id).includes(def.id))
  return {
    kind: 'participantFlow',
    day: state.day,
    asset: def.id,
    party: 'crowd',
    demandCents: demand,
    depthCents: depthCents(def, p),
    moveCents: moveFor(state, def, p, demand),
    events,
  }
}

/** Trend followers' move in one stock: full size at a clear trend over the look-back, either way. */
export function momentumFlow(state: MarketState, defs: MarketDefinitions, def: AssetDefinition): ParticipantFlowEvent | null {
  const p = defs.participants
  const participants = state.participants
  if (p === undefined || participants === undefined) return null
  const closes = participants.closes[def.id] ?? []
  if (closes.length < p.momentum.lookbackDays + 1) return null
  const trend = ((closes[closes.length - 1] / closes[0] - 1) * 100) / p.momentum.thresholdPercent
  const demand = p.momentum.capitalCents * clamp(trend, 1)
  if (demand === 0) return null
  return {
    kind: 'participantFlow',
    day: state.day,
    asset: def.id,
    party: 'momentum',
    demandCents: demand,
    depthCents: depthCents(def, p),
    moveCents: moveFor(state, def, p, demand),
    events: [],
  }
}

/** Consensus traders' move in one stock: the expected effect of each coming release, ramped up toward its day. */
export function consensusFlow(state: MarketState, defs: MarketDefinitions, def: AssetDefinition): ParticipantFlowEvent | null {
  const p = defs.participants
  const calendar = defs.calendar
  if (p === undefined || calendar === undefined || state.participants === undefined) return null
  if (def.sector !== 'A' && def.sector !== 'B') return null
  let demand = 0
  const events: string[] = []
  for (const roll of state.calendarRolls) {
    if (roll.applied) continue
    const daysUntil = roll.day - state.day
    if (daysUntil < 1 || daysUntil > EVENT_LOOKAHEAD_DAYS) continue
    const cell = calendar.effects.find(
      (row) => row.kind === roll.kind && row.outcome === roll.expected && row.sector === def.sector,
    )
    if (cell === undefined) continue
    const ramp = (EVENT_LOOKAHEAD_DAYS + 1 - daysUntil) / EVENT_LOOKAHEAD_DAYS
    demand += p.consensus.capitalCents * clamp(cell.percent / p.consensus.magnitudeRefPercent, 1) * ramp
    events.push(`calendar:${roll.kind}:${roll.day}`)
  }
  if (events.length === 0 || demand === 0) return null
  return {
    kind: 'participantFlow',
    day: state.day,
    asset: def.id,
    party: 'consensus',
    demandCents: demand,
    depthCents: depthCents(def, p),
    moveCents: moveFor(state, def, p, demand),
    events,
  }
}
