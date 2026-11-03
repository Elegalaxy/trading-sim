// Order-flow parties. Pure rules over `MarketState` and the definitions: this module
// never sees the player's side of the game, so nothing the player does can move the market.
//
// Price moves by net demand over depth: move = price × demand / depth, with
// depth = the stock's daily traded value × `depthDays`. Institutions and noise traders are
// the existing pull toward fair value and the normal noise term in `market.ts`, whose demand
// form is algebraically the same, so they keep their formulas. This module adds the parties
// that were not there before. Today that is informed money.
//
// Informed money: when an event is rolled onto the schedule, one draw on the participants
// stream decides whether informed money hears of it (the type's `leak` times the run's
// regime). While a leaked event is still waiting, the fund trades the stocks it will hit, in
// the direction of its effect. An event is rolled three days ahead at the end of a step, so
// the first price step that sees it is two days before it fires: the fund trades 2/3 of full
// size then and full size the day before, scaled by the event's magnitude up to a reference.
// Calendar items are not events and never leak.
//
// Participants stream draw order (`createRng(seed + '#participants')`, `market` member):
// the regime draw at creation, then one draw per newly scheduled event in schedule order
// (days 1 to 3 at creation, then the day+3 roll of each step). Nothing else draws.

import { createRng, nextFloat } from './rng.ts'
import { EVENT_LOOKAHEAD_DAYS, SESSION_BASE_NOTIONAL_CENTS } from './constants.ts'
import { affectedAssets } from './events.ts'
import type {
  AssetDefinition,
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
  return { stream, informed, leaked: [] }
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
