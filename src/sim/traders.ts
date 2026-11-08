// Trader definitions check, per-run trader book (price-model plan, Step P1) and the core engine
// (Step P2, at the end of this file). The mix is drawn once from the market stream of
// `${seed}#traders` (one float per type in fixed order, then one for news efficiency), so the
// four main streams keep their draw order. Mix is clamped to each type's range and scaled so
// the sum of base x mix equals the sum of base (the same every run), found by bisection.

import { expectedDrift } from './drift.ts'
import { affectedAssets } from './events.ts'
import { depthCents } from './participants.ts'
import { createRng, nextFloat } from './rng.ts'
import {
  TRADER_TYPES,
  type AssetDefinition,
  type CalendarItemEvent,
  type EventTypeDefinition,
  type MarketDefinitions,
  type MarketState,
  type ScheduledEvent,
  type TraderBook,
  type TraderDefinitions,
  type TraderType,
} from './types.ts'

function fail(message: string): never {
  throw new Error(`[DEBUG traders] ${message}`)
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) fail(`${name} must be a finite number above 0, received ${value}`)
}

/** Throws a `[DEBUG traders]` error when the numbers cannot give a valid book. */
export function assertTraderDefinitions(defs: TraderDefinitions): void {
  let baseSum = 0
  let minSum = 0
  let maxSum = 0
  for (const type of TRADER_TYPES) {
    const row = defs.types[type]
    if (row === undefined) fail(`missing type ${type}`)
    positive(row.base, `${type}.base`)
    positive(row.mixMin, `${type}.mixMin`)
    positive(row.mixMax, `${type}.mixMax`)
    if (row.mixMin > row.mixMax) fail(`${type} mixMin ${row.mixMin} is above mixMax ${row.mixMax}`)
    if (!Number.isFinite(row.rate) || row.rate <= 0 || row.rate > 1) fail(`${type}.rate must be in (0, 1], received ${row.rate}`)
    baseSum += row.base
    minSum += row.base * row.mixMin
    maxSum += row.base * row.mixMax
  }
  if (minSum > baseSum || maxSum < baseSum) {
    fail(`mix ranges cannot reach the constant weight ${baseSum} (reachable ${minSum} to ${maxSum})`)
  }
  positive(defs.efficiencyMin, 'efficiencyMin')
  if (!Number.isFinite(defs.efficiencyMax) || defs.efficiencyMax < defs.efficiencyMin) fail('efficiencyMax must be at least efficiencyMin')
  if (!Number.isFinite(defs.premiumPerDay)) fail('premiumPerDay must be finite')
  positive(defs.anchorHalfLifeDays, 'anchorHalfLifeDays')
  positive(defs.volSens, 'volSens')
  if (!Number.isFinite(defs.depthScaleMin) || defs.depthScaleMin <= 0 || defs.depthScaleMin > 1) fail('depthScaleMin must be in (0, 1]')
  if (!Number.isFinite(defs.volEwma) || defs.volEwma <= 0 || defs.volEwma > 1) fail('volEwma must be in (0, 1]')
}

/** Mix per type, each inside its range, with sum(base x mix) equal to sum(base). */
export function normalisedMix(defs: TraderDefinitions, draws: readonly number[]): Record<TraderType, number> {
  const raw = TRADER_TYPES.map((type, index) => {
    const row = defs.types[type]
    return row.mixMin + draws[index] * (row.mixMax - row.mixMin)
  })
  const target = TRADER_TYPES.reduce((sum, type) => sum + defs.types[type].base, 0)
  const clamped = (type: TraderType, index: number, scale: number): number => {
    const row = defs.types[type]
    return Math.min(row.mixMax, Math.max(row.mixMin, raw[index] * scale))
  }
  const total = (scale: number): number =>
    TRADER_TYPES.reduce((sum, type, index) => sum + defs.types[type].base * clamped(type, index, scale), 0)
  let low = 0
  let high = 1
  while (total(high) < target) high *= 2
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2
    if (total(mid) < target) low = mid
    else high = mid
  }
  const scale = (low + high) / 2
  const mix = {} as Record<TraderType, number>
  TRADER_TYPES.forEach((type, index) => {
    mix[type] = clamped(type, index, scale)
  })
  return mix
}

function zeroPositions(): Record<TraderType, number> {
  const pos = {} as Record<TraderType, number>
  for (const type of TRADER_TYPES) pos[type] = 0
  return pos
}

/**
 * A fresh book for a run. Stocks only, in definition order. Carry starts at 1, the lagged
 * anchor at the stock's current fair value, positions at 0. Active from the market's current day.
 */
export function createTraderBook(defs: MarketDefinitions, seed: string, market: MarketState): TraderBook {
  const traders = defs.traders
  if (traders === undefined) fail('definitions have no traders')
  assertTraderDefinitions(traders)
  const stream = createRng(`${seed}#traders`).market
  const draws = TRADER_TYPES.map(() => nextFloat(stream))
  const efficiency = traders.efficiencyMin + nextFloat(stream) * (traders.efficiencyMax - traders.efficiencyMin)
  const book: TraderBook = {
    activeFromDay: market.day,
    mix: normalisedMix(traders, draws),
    efficiency,
    carry: {},
    seenAnchor: {},
    pos: {},
    eventPos: {},
    vol: {},
    lastFlow: {},
    history: {},
  }
  for (const asset of defs.assets) {
    if (asset.kind !== 'stock') continue
    const state = market.assets[asset.id]
    if (state === undefined) fail(`market has no asset ${asset.id}`)
    book.carry[asset.id] = 1
    book.seenAnchor[asset.id] = state.fairValue
    book.pos[asset.id] = zeroPositions()
    book.vol[asset.id] = 0
    book.lastFlow[asset.id] = 0
    book.history![asset.id] = []
  }
  return book
}

// ---------------------------------------------------------------------------------------------
// Core engine (price-model plan, Step P2), information traders (Step P3) and crowd, trend and
// contrarians (Step P4). All eight types trade here. `planTraderStock` works out one
// stock's wanted trades and the raw move, `market.ts` applies the cap, and `commitTraderStock`
// books what filled. Positions are dimensionless, in depth units: a trade of dq moves the price by
// about dq x price. Nothing here draws: the one normal per stock comes from the market stream.

/** True when the traders model prices today's step. `state.day` is the day being computed. */
export function traderModelOn(state: MarketState, defs: MarketDefinitions): boolean {
  const book = state.participants?.book
  return defs.traders !== undefined && defs.participants !== undefined && book !== undefined && state.day >= book.activeFromDay
}

/** One stock's day before the cap: the wanted trade per type and the raw move in cents. */
export type TraderPlan = {
  anchor: number
  depthScale: number
  depthCents: number
  previous: number
  /** Wanted trade per type, in depth units. Types that are not active yet are 0. */
  dq: Record<TraderType, number>
  /** The player's order flow in depth units (not a position). */
  playerDq: number
  /** Today's per-event trades of the information types (already included in `dq`). Booked by `commitTraderStock`. */
  trades: readonly TraderEventTrade[]
  /** The crowd's mood after the return chase and capitulation (clamped). */
  crowdMood: number
  /** The rumoured events the crowd holds a leg of today and each leg's wanted trade (the legs are part of `dq.crowd`). */
  crowdEvents: readonly string[]
  crowdLegs: Readonly<Record<string, number>>
  rawMove: number
}

const CROWD_RETURN_WEIGHT = 0.5
const CROWD_CAPITULATED_MOOD = -0.5

/** Return over `days` closes back from the last one (0 when there is not enough history). */
function returnOver(closes: readonly number[], days: number): number {
  if (closes.length <= days) return 0
  return closes[closes.length - 1] / closes[closes.length - 1 - days] - 1
}

/** Fall from the highest close of the last `days` closes (0 or negative). */
function drawdownOver(closes: readonly number[], days: number): number {
  const recent = closes.slice(-(days + 1))
  if (recent.length === 0) return 0
  return recent[recent.length - 1] / Math.max(...recent) - 1
}

/**
 * Self-reinforcing gain of the trend and crowd types per unit of 5-day return, at one mix and heat,
 * and the value traders' pull per unit of gap, both per day (rate x weight x slope). The loop is
 * stable while the first stays below 1 + the second (price-model plan, section 2 "Stability").
 */
export function loopGains(t: TraderDefinitions, mix: Record<TraderType, number>, heat: number): { selfGain: number; valuePull: number } {
  const weight = (type: TraderType): number => t.types[type].base * mix[type]
  const trend = t.types.trend.rate * (weight('trend') / t.trendScale)
  const crowd = t.types.crowd.rate * weight('crowd') * heat * ((t.crowdReturnWeight ?? CROWD_RETURN_WEIGHT) / t.crowdReturnScale)
  const valuePull = (t.types.value.rate * weight('value')) / t.valueFullGap
  return { selfGain: trend + crowd, valuePull }
}

function clampNumber(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** Value traders' full-rate demand for a gap (in depth units per day): dead band, linear to full weight, steeper beyond the deep gap, capped. */
export function valueTarget(t: TraderDefinitions, weight: number, price: number, seenAnchor: number): number {
  const gap = seenAnchor / price - 1
  const size = Math.abs(gap)
  if (size <= t.valueDeadBand) return 0
  let multiple = Math.min(1, (size - t.valueDeadBand) / t.valueFullGap)
  if (size > t.valueDeepGap) multiple += (t.valueDeepSlope * (size - t.valueDeepGap)) / t.valueFullGap
  multiple = Math.min(multiple, t.valueMaxMultiple)
  return weight * Math.sign(gap) * multiple
}

/** Market makers' depth scale from the volatility EWMA: thinner when a stock has been moving more than usual. */
export function depthScaleFor(t: TraderDefinitions, vol: number, dailyVolatility: number): number {
  if (!(dailyVolatility > 0)) return 1
  const excess = Math.max(0, vol / dailyVolatility - 1)
  return clampNumber(1 / (1 + t.volSens * excess), t.depthScaleMin, 1)
}

/**
 * Advance the anchor (carry, lagged anchor) and work out the wanted trades. Mutates the book's
 * `carry` and `seenAnchor`. `z` is the stock's single market-stream normal. Call once per stock
 * per step; the caller must be inside `traderModelOn`.
 */
export function planTraderStock(
  state: MarketState,
  defs: MarketDefinitions,
  def: AssetDefinition,
  z: number,
  playerCents: number,
  traderDay?: TraderDay,
): TraderPlan {
  const t = defs.traders
  const p = defs.participants
  const book = state.participants?.book
  if (t === undefined || p === undefined || book === undefined) fail('traders model is not on')
  const asset = state.assets[def.id]
  const previous = asset.priceCents
  const carry = (book.carry[def.id] ?? 1) * (1 - expectedDrift(defs, def, state.environment) + t.premiumPerDay + (t.carryCorrectionPerDay ?? 0))
  book.carry[def.id] = carry
  const anchor = asset.fairValue * carry
  const lag = 1 - 0.5 ** (1 / t.anchorHalfLifeDays)
  const seen = (book.seenAnchor[def.id] ?? asset.fairValue) + lag * (anchor - (book.seenAnchor[def.id] ?? asset.fairValue))
  book.seenAnchor[def.id] = seen
  const pos = book.pos[def.id]
  if (pos === undefined) fail(`book has no positions for ${def.id}`)

  const dq = zeroPositions()
  const weight = (type: TraderType): number => t.types[type].base * book.mix[type]
  // Value traders trade the gap, not a target position: demand each day is rate x the gap response, so a
  // move by another type is corrected over the following days instead of only partly offset. `pos.value`
  // only books the running total (what the value traders have bought less sold).
  dq.value = t.types.value.rate * valueTarget(t, weight('value'), previous, seen)
  // The noise size is the stock's volatility share times the run's noise mix, not a weight in depth units.
  const sigma = def.dailyVolatility * t.noiseShare * book.mix.noise
  dq.noise = t.types.noise.rate * (t.noiseAr * pos.noise + sigma * z - pos.noise)

  // Crowd, trend and contrarians read the stock's own closes (kept by `startPartyDay`, newest last, the
  // last one is the open of this step) and the crowd's mood from the feed (`participants.mood`: the
  // rumour shares and headline chase, written by `startPartyDay`).
  const participants = state.participants
  // The book keeps its own closes (the old trend followers' list is short and shared with the hash): this
  // step's open is pushed first, so the last entry is yesterday's close.
  const history = (book.history ??= {})
  const closes = (history[def.id] ??= [])
  closes.push(previous)
  while (closes.length > Math.max(t.trendDays, t.crowdReturnDays, t.crowdDrawdownDays) + 1) closes.shift()
  const feedMood = participants?.mood[def.id] ?? 0
  const heat = participants?.heat ?? 1
  const ret5 = returnOver(closes, t.crowdReturnDays)
  let mood = feedMood + (t.crowdReturnWeight ?? CROWD_RETURN_WEIGHT) * clampNumber(ret5 / t.crowdReturnScale, -1, 1)
  if (drawdownOver(closes, t.crowdDrawdownDays) < t.crowdCapitulation && mood > 0) mood = t.crowdCapitulatedMood ?? CROWD_CAPITULATED_MOOD
  mood = clampNumber(mood, -t.crowdMoodClamp, t.crowdMoodClamp)
  const crowdSize = weight('crowd') * heat
  dq.crowd = t.types.crowd.rate * (crowdSize * mood - pos.crowd)
  // Trend: the last trendDays closes. Contrarians fade a stretched 5-day move, the crowd's mood and yesterday's
  // net non-noise flow (`book.lastFlow`). Crowd and trend are the self-reinforcing terms checked by `loopGains`.
  const trendTarget = weight('trend') * clampNumber(returnOver(closes, t.trendDays) / t.trendScale, -1, 1)
  dq.trend = t.types.trend.rate * (trendTarget - pos.trend)
  const flowSignal = clampNumber((book.lastFlow[def.id] ?? 0) / t.contrarianFlowScale, -1, 1)
  const stretch = clampNumber((Math.abs(ret5) - t.contrarianThreshold) / t.contrarianScale, 0, 1) * Math.sign(ret5)
  const contrarianTarget = -weight('contrarian') * (stretch + t.contrarianMoodWeight * mood + t.contrarianFlowWeight * flowSignal)
  dq.contrarian = t.types.contrarian.rate * (contrarianTarget - pos.contrarian)
  // The crowd's holding is split into one leg per rumoured event (`${event}|${stock}|crowd` in `eventPos`,
  // read by the news traders as priced in) and the rest (return chase, headline chase, capitulation). A
  // leg builds toward its share of the crowd's money at the crowd's rate; the legs are part of `dq.crowd`.
  const crowdEvents = participants === undefined ? [] : Object.keys(participants.shares).filter((id) => crowdAssets(defs, id).includes(def.id))
  const crowdLegs: Record<string, number> = {}
  for (const id of crowdEvents) {
    crowdLegs[id] = t.types.crowd.rate * (crowdSize * (participants?.shares[id] ?? 0) - (book.eventPos[positionKey(id, def.id, 'crowd')] ?? 0))
  }

  const trades = traderDay?.trades[def.id] ?? []
  // A position that is only being wound back (after its hold) is handed to the market without a price
  // impact: the anchor, not the unwinding, decides where the price settles. See `TraderEventTrade.absorbed`.
  for (const trade of trades) if (!trade.absorbed) dq[trade.type] += trade.dq

  const depth = depthCents(def, p)
  const playerDq = playerCents / depth
  let demand = playerDq
  for (const type of TRADER_TYPES) demand += dq[type]
  const depthScale = depthScaleFor(t, book.vol[def.id] ?? 0, def.dailyVolatility)
  return {
    anchor,
    depthScale,
    depthCents: depth,
    previous,
    dq,
    playerDq,
    trades,
    crowdMood: mood,
    crowdEvents,
    crowdLegs,
    rawMove: (previous * demand) / depthScale,
  }
}

/** The stocks a rumoured event id (`type:target:day`) reaches; [] for an unknown type. */
function crowdAssets(defs: MarketDefinitions, eventId: string): string[] {
  const [typeId, target] = eventId.split(':')
  const type = eventTypeMap(defs).get(typeId)
  if (type === undefined || target === undefined) return []
  return affectedAssets(type.scope, target, defs.assets)
}

/**
 * Book what filled. `fillScale` is the share of the wanted move that the cap let through (1 when
 * the cap did not bind); the unfilled part stays wanted because the position only moves by what
 * filled. Also updates the volatility EWMA and yesterday's net non-noise flow.
 */
export function commitTraderStock(
  state: MarketState,
  defs: MarketDefinitions,
  def: AssetDefinition,
  plan: TraderPlan,
  fillScale: number,
  newPrice: number,
): void {
  const t = defs.traders
  const book = state.participants?.book
  if (t === undefined || book === undefined) fail('traders model is not on')
  const pos = book.pos[def.id]
  for (const trade of plan.trades) {
    if (trade.dq === 0) continue
    const share = trade.absorbed ? 1 : fillScale
    book.eventPos[trade.key] = (book.eventPos[trade.key] ?? 0) + share * trade.dq
    if (trade.absorbed) pos[trade.type] += trade.dq
  }
  let others = 0
  for (const type of TRADER_TYPES) {
    pos[type] += fillScale * plan.dq[type]
    if (type !== 'noise') others += plan.dq[type]
  }
  book.lastFlow[def.id] = fillScale * others
  // The crowd's legs (what it holds on each rumoured event) book what filled; legs of events that are no
  // longer rumoured (the claimed day passed) are dropped, so that part of the position is sold with the rest.
  const live = new Set(plan.crowdEvents)
  for (const key of Object.keys(book.eventPos)) {
    const [eventId, asset, type] = key.split('|')
    if (asset === def.id && type === 'crowd' && !live.has(eventId)) delete book.eventPos[key]
  }
  for (const eventId of plan.crowdEvents) {
    const key = positionKey(eventId, def.id, 'crowd')
    book.eventPos[key] = (book.eventPos[key] ?? 0) + fillScale * plan.crowdLegs[eventId]
  }
  const move = Math.abs(newPrice / plan.previous - 1)
  const vol = book.vol[def.id] ?? 0
  book.vol[def.id] = vol + t.volEwma * (move - vol)
}

// ---------------------------------------------------------------------------------------------
// Information traders (price-model plan, Step P3). Each (event, stock, type) has a fixed full-size
// target, written once to `book.eventPos` under `${eventId}|${asset}|${type}|target`, and a position
// under `${eventId}|${asset}|${type}`. Sizes are fractions of the price (a position of 0.02 holds the
// price 2% above where it would be). A day's target is the full size times a schedule factor of the
// event's age (days since its event day, negative before it); the trade is rate x (target - position).
//   informed   leaked events only: sign x W x min(1, magnitude / ref); ramps 1/3, 2/3, 1 over the
//              three days before, holds through the event day and `informedHoldDays` more, then decays.
//   consensus  every calendar release: the expected outcome's effect; ramps over `consensusRampDays`,
//              holds through the release day, then decays over `consensusDecayDays`.
//   news       on the event day only: efficiency x (public impact - priced in), where the public impact
//              is the event type's average size (the true size is hidden) or the release's actual
//              effect, and priced in is what informed, crowd and consensus traders already hold on it.
//              Holds `newsHoldDays` days from the event day, then decays over `newsDecayDays`.
// Fair value still moves exactly as the events say, so the anchor value traders aim at carries the
// true size: a true size above the public impact keeps drifting up, one below it is pulled back.
// Nothing draws. Keys are walked sorted so the order never depends on insertion.

/**
 * One information trader's wanted trade in one (event, stock), in depth units. `key` is the position key.
 * `absorbed` marks a position being wound back to zero after its hold: it books in full and adds no
 * demand, so the price is not pushed back by the unwinding (value traders and the anchor decide where
 * it settles). Without it every event would give its whole move back as its news traders left.
 */
export type TraderEventTrade = { key: string; type: 'informed' | 'news' | 'consensus'; dq: number; absorbed: boolean }

/** What the information traders do today, per stock. Built once per step by `startTraderDay`. */
export type TraderDay = { trades: Record<string, TraderEventTrade[]> }

const EVENT_TYPE_CACHE = new WeakMap<MarketDefinitions, ReadonlyMap<string, EventTypeDefinition>>()

/** Event types by id, built once per definitions. */
export function eventTypeMap(defs: MarketDefinitions): ReadonlyMap<string, EventTypeDefinition> {
  let map = EVENT_TYPE_CACHE.get(defs)
  if (map === undefined) {
    map = new Map(defs.events.map((type) => [type.id, type]))
    EVENT_TYPE_CACHE.set(defs, map)
  }
  return map
}

const TARGET_SUFFIX = '|target'
// Informed money hears of an event at most this many days before it (the market rolls three days ahead).
const INFORMED_RAMP_DAYS = 3

function isInformationType(type: string): type is 'informed' | 'news' | 'consensus' {
  return type === 'informed' || type === 'news' || type === 'consensus'
}

function positionKey(eventId: string, asset: string, type: TraderType): string {
  return `${eventId}|${asset}|${type}`
}

/** Last age (days after the event day) at which a type still holds its full target. */
function holdEnd(t: TraderDefinitions, type: 'informed' | 'news' | 'consensus'): number {
  if (type === 'informed') return t.informedHoldDays
  if (type === 'news') return t.newsHoldDays - 1
  return 0
}

/** Full up to `holdEnd` days after the event day, then falls linearly to 0 over `decay` days. */
function holdThenDecay(age: number, holdEnd: number, decay: number): number {
  if (age <= holdEnd) return 1
  return Math.max(0, 1 - (age - holdEnd) / decay)
}

/** The last age (days after the event day) with a non-zero target; after that a type only unwinds. */
function lastTargetAge(t: TraderDefinitions, type: 'informed' | 'news' | 'consensus'): number {
  return holdEnd(t, type) + (type === 'informed' ? t.informedDecayDays : type === 'news' ? t.newsDecayDays : t.consensusDecayDays)
}

/** Share of the full target wanted at this age. Before the event only informed and consensus build up. */
function scheduleFactor(t: TraderDefinitions, type: 'informed' | 'news' | 'consensus', age: number): number {
  if (type === 'informed') {
    if (age < 0) return Math.max(0, Math.min(1, (INFORMED_RAMP_DAYS + 1 + age) / INFORMED_RAMP_DAYS))
    return holdThenDecay(age, holdEnd(t, type), t.informedDecayDays)
  }
  if (type === 'consensus') {
    if (age < 0) return Math.max(0, Math.min(1, (t.consensusRampDays + 1 + age) / t.consensusRampDays))
    return holdThenDecay(age, holdEnd(t, type), t.consensusDecayDays)
  }
  return age < 0 ? 0 : holdThenDecay(age, holdEnd(t, type), t.newsDecayDays)
}

function eventAge(eventId: string, day: number): number {
  return day - Number(eventId.split(':')[2])
}

function setTarget(book: TraderBook, eventId: string, asset: string, type: TraderType, size: number): void {
  const key = positionKey(eventId, asset, type) + TARGET_SUFFIX
  if (!Object.hasOwn(book.eventPos, key)) book.eventPos[key] = size
}

/**
 * Register today's new targets and work out every information trader's wanted trade. `dueToday` is
 * the ordinary events that fire today (read before they leave `state.scheduled`) and `calendarToday`
 * today's calendar items. Mutates `book.eventPos` (new targets, finished keys removed). Call once per
 * step before the stocks are priced, inside `traderModelOn`.
 */
export function startTraderDay(
  state: MarketState,
  defs: MarketDefinitions,
  dueToday: readonly ScheduledEvent[],
  calendarToday: readonly CalendarItemEvent[],
): TraderDay {
  const t = defs.traders
  const participants = state.participants
  const book = participants?.book
  if (t === undefined || participants === undefined || book === undefined) fail('traders model is not on')
  const types = eventTypeMap(defs)
  const day = state.day
  const stocks = defs.assets.filter((asset) => asset.kind === 'stock')
  const effects = defs.calendar?.effects ?? []
  const weight = (type: TraderType): number => t.types[type].base * book.mix[type]
  const sectorEffect = (kind: string, outcome: string, sector: string | null): number | undefined =>
    effects.find((row) => row.kind === kind && row.outcome === outcome && row.sector === sector)?.percent

  // Informed money: events it has heard of, still waiting or firing today. The id list is filtered at the
  // end of each step, so an event that fires today is still in it.
  const leaked = new Set(participants.leaked)
  for (const event of [...state.scheduled, ...dueToday]) {
    if (!leaked.has(event.id)) continue
    const type = types.get(event.typeId)
    if (type === undefined) fail(`scheduled event ${event.id} has unknown type ${event.typeId}`)
    const size = (event.direction === 'down' ? -1 : 1) * weight('informed') * Math.min(1, event.magnitudePercent / t.informedMagnitudeRefPercent)
    for (const asset of affectedAssets(type.scope, event.target, defs.assets)) setTarget(book, event.id, asset, 'informed', size)
  }

  // Consensus: the expected outcome of every release already rolled, from the day it is first seen.
  for (const roll of state.calendarRolls) {
    if (roll.day < day) continue
    const id = `calendar:${roll.kind}:${roll.day}`
    for (const stock of stocks) {
      const percent = sectorEffect(roll.kind, roll.expected, stock.sector)
      if (percent !== undefined) setTarget(book, id, stock.id, 'consensus', percent / 100)
    }
  }

  // News: on the event day, the surprise against what informed, crowd and consensus already hold.
  const surprise = (eventId: string, asset: string, publicImpact: number): void => {
    let pricedIn = 0
    for (const type of ['informed', 'crowd', 'consensus'] as const) pricedIn += book.eventPos[positionKey(eventId, asset, type)] ?? 0
    setTarget(book, eventId, asset, 'news', book.efficiency * (publicImpact - pricedIn))
  }
  for (const event of dueToday) {
    const type = types.get(event.typeId)
    if (type === undefined) fail(`scheduled event ${event.id} has unknown type ${event.typeId}`)
    const impact = ((event.direction === 'down' ? -1 : 1) * (type.magnitudeMin + type.magnitudeMax)) / 2 / 100
    for (const asset of affectedAssets(type.scope, event.target, defs.assets)) surprise(event.id, asset, impact)
  }
  for (const item of calendarToday) {
    const id = `calendar:${item.item}:${item.day}`
    for (const stock of stocks) {
      const percent = sectorEffect(item.item, item.outcome, stock.sector)
      if (percent !== undefined) surprise(id, stock.id, percent / 100)
    }
  }

  const trades: Record<string, TraderEventTrade[]> = {}
  for (const stock of stocks) trades[stock.id] = []
  const keys = Object.keys(book.eventPos)
    .filter((key) => key.endsWith(TARGET_SUFFIX))
    .sort()
  for (const targetKey of keys) {
    const posKey = targetKey.slice(0, -TARGET_SUFFIX.length)
    const [eventId, asset, type] = posKey.split('|')
    if (eventId === undefined || asset === undefined || type === undefined || !isInformationType(type)) fail(`bad event key ${targetKey}`)
    const age = eventAge(eventId, day)
    const position = book.eventPos[posKey] ?? 0
    if (age > lastTargetAge(t, type) && Math.abs(position) < 1e-9) {
      delete book.eventPos[targetKey]
      delete book.eventPos[posKey]
      continue
    }
    const list = trades[asset]
    if (list === undefined) continue
    const target = book.eventPos[targetKey] * scheduleFactor(t, type, age)
    const dq = t.types[type].rate * (target - position)
    list.push({ key: posKey, type, dq, absorbed: age > holdEnd(t, type) && dq * position < 0 })
  }
  return { trades }
}
