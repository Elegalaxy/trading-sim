// Per-target event rolls and fair-value effects. Draws only the events stream.
// Roll order: event types in definition order, then each type's targets in listed order.
// A fired event draws one direction float and one magnitude float. A miss draws only the fire float.
// Days 1–3 are rolled by createMarket. Later days are rolled at the end of day N for day N+3.

import {
  FAIR_VALUE_CHANGE_LIMIT_DENOMINATOR,
  FAIR_VALUE_CHANGE_LIMIT_NUMERATOR,
} from './constants.ts'
import { adjustForEnvironment } from './environment.ts'
import { nextFloat } from './rng.ts'
import type {
  ActiveEffect,
  AssetDefinition,
  DecayShape,
  EffectAppliedEvent,
  EnvironmentEntryDefinition,
  EnvironmentEntryState,
  EventDirection,
  EventDirectionEvent,
  EventMagnitudeEvent,
  EventRollEvent,
  EventScope,
  EventTypeDefinition,
  FairValueChangeEvent,
  MarketDefinitions,
  MarketState,
  RngStream,
  ScheduledEvent,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/
const DIRECTION_SUM_TOLERANCE = 1e-9

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number, received ${describeValue(value)}`)
  }
}

export function assertEventDefinitions(
  events: readonly EventTypeDefinition[],
  assets: readonly AssetDefinition[],
  environment: readonly EnvironmentEntryDefinition[],
): void {
  if (!Array.isArray(events)) {
    throw new Error(`event definitions must be an array, received ${describeValue(events)}`)
  }
  const environmentIds = new Set(environment.map((entry) => entry.id))
  const stockIds = new Set(assets.filter((asset) => asset.kind === 'stock').map((asset) => asset.id))
  const seen = new Set<string>()
  for (let i = 0; i < events.length; i += 1) {
    const eventType = events[i]
    if (typeof eventType !== 'object' || eventType === null || Array.isArray(eventType)) {
      throw new Error(`event definitions[${i}] must be an object, received ${describeValue(eventType)}`)
    }
    if (typeof eventType.id !== 'string' || !ID_PATTERN.test(eventType.id)) {
      throw new Error(
        `event definitions[${i}].id must be a letter followed by letters or digits, received ${describeValue(eventType.id)}`,
      )
    }
    if (seen.has(eventType.id)) throw new Error(`event type ${eventType.id} is duplicated`)
    seen.add(eventType.id)
    if (eventType.scope !== 'stock' && eventType.scope !== 'sector' && eventType.scope !== 'market') {
      throw new Error(`event ${eventType.id} scope must be stock, sector, or market, received ${describeValue(eventType.scope)}`)
    }
    assertTargets(eventType, stockIds, assets)
    assertFiniteNumber(eventType.chance, `event ${eventType.id} chance`)
    if (eventType.chance < 0 || eventType.chance > 1) {
      throw new Error(`event ${eventType.id} chance must be from 0 to 1, received ${eventType.chance}`)
    }
    assertDirections(eventType)
    assertFiniteNumber(eventType.magnitudeMin, `event ${eventType.id} magnitudeMin`)
    assertFiniteNumber(eventType.magnitudeMax, `event ${eventType.id} magnitudeMax`)
    if (eventType.magnitudeMin <= 0 || eventType.magnitudeMax <= 0) {
      throw new Error(
        `event ${eventType.id} magnitudes must be positive, received min=${eventType.magnitudeMin} max=${eventType.magnitudeMax}`,
      )
    }
    if (eventType.magnitudeMax < eventType.magnitudeMin) {
      throw new Error(
        `event ${eventType.id} magnitudeMax must be >= magnitudeMin, received min=${eventType.magnitudeMin} max=${eventType.magnitudeMax}`,
      )
    }
    if (!Number.isSafeInteger(eventType.duration) || eventType.duration < 1) {
      throw new Error(
        `event ${eventType.id} duration must be a positive safe integer, received ${describeValue(eventType.duration)}`,
      )
    }
    if (eventType.decay !== 'frontLoaded' && eventType.decay !== 'linear') {
      throw new Error(
        `event ${eventType.id} decay must be frontLoaded or linear, received ${describeValue(eventType.decay)}`,
      )
    }
    if (typeof eventType.headline !== 'string' || eventType.headline.length === 0) {
      throw new Error(`event ${eventType.id} headline must be a non-empty string, received ${describeValue(eventType.headline)}`)
    }
    if (!Array.isArray(eventType.modifiers)) {
      throw new Error(`event ${eventType.id} modifiers must be an array, received ${describeValue(eventType.modifiers)}`)
    }
    for (let m = 0; m < eventType.modifiers.length; m += 1) {
      const modifier = eventType.modifiers[m]
      if (typeof modifier !== 'object' || modifier === null || Array.isArray(modifier)) {
        throw new Error(`event ${eventType.id} modifiers[${m}] must be an object, received ${describeValue(modifier)}`)
      }
      if (typeof modifier.entryId !== 'string' || !environmentIds.has(modifier.entryId)) {
        throw new Error(
          `event ${eventType.id} modifiers[${m}].entryId must name an environment entry, received ${describeValue(modifier.entryId)}`,
        )
      }
      assertFiniteNumber(modifier.center, `event ${eventType.id} modifiers[${m}].center`)
      assertFiniteNumber(modifier.chancePerUnit, `event ${eventType.id} modifiers[${m}].chancePerUnit`)
      assertFiniteNumber(modifier.upPerUnit, `event ${eventType.id} modifiers[${m}].upPerUnit`)
      assertFiniteNumber(modifier.downPerUnit, `event ${eventType.id} modifiers[${m}].downPerUnit`)
      assertFiniteNumber(modifier.nonePerUnit, `event ${eventType.id} modifiers[${m}].nonePerUnit`)
    }
  }
}

function assertDirections(eventType: EventTypeDefinition): void {
  const { up, down, none } = eventType.direction ?? ({} as EventTypeDefinition['direction'])
  assertFiniteNumber(up, `event ${eventType.id} direction.up`)
  assertFiniteNumber(down, `event ${eventType.id} direction.down`)
  assertFiniteNumber(none, `event ${eventType.id} direction.none`)
  if (up < 0 || down < 0 || none < 0 || up > 1 || down > 1 || none > 1) {
    throw new Error(
      `event ${eventType.id} direction chances must be from 0 to 1, received up=${up} down=${down} none=${none}`,
    )
  }
  const sum = up + down + none
  if (Math.abs(sum - 1) > DIRECTION_SUM_TOLERANCE) {
    throw new Error(`event ${eventType.id} direction chances must sum to 1, received ${sum}`)
  }
}

function assertTargets(
  eventType: EventTypeDefinition,
  stockIds: ReadonlySet<string>,
  assets: readonly AssetDefinition[],
): void {
  if (!Array.isArray(eventType.targets) || eventType.targets.length === 0) {
    throw new Error(`event ${eventType.id} targets must be a non-empty array, received ${describeValue(eventType.targets)}`)
  }
  const seen = new Set<string>()
  for (let i = 0; i < eventType.targets.length; i += 1) {
    const target = eventType.targets[i]
    if (typeof target !== 'string' || !ID_PATTERN.test(target)) {
      throw new Error(`event ${eventType.id} targets[${i}] must be an id token, received ${describeValue(target)}`)
    }
    if (seen.has(target)) throw new Error(`event ${eventType.id} target ${target} is duplicated`)
    seen.add(target)
    if (eventType.scope === 'stock' && !stockIds.has(target)) {
      throw new Error(`event ${eventType.id} stock target ${target} is not a stock in the asset list`)
    }
    if (eventType.scope === 'sector' && target !== 'A' && target !== 'B') {
      throw new Error(`event ${eventType.id} sector target must be A or B, received ${target}`)
    }
    if (eventType.scope === 'sector') {
      const stocks = assets.filter((asset) => asset.kind === 'stock' && asset.sector === target)
      if (stocks.length === 0) throw new Error(`event ${eventType.id} sector ${target} has no stocks`)
    }
    if (eventType.scope === 'market' && target !== 'market') {
      throw new Error(`event ${eventType.id} market target must be market, received ${target}`)
    }
  }
  if (eventType.scope === 'market' && eventType.targets.length !== 1) {
    throw new Error(`event ${eventType.id} market scope must have one target, received ${eventType.targets.length}`)
  }
}

/**
 * Share of the effect's total delta applied on `dayIndex` (0 on the event day).
 * Linear: equal shares. Front-loaded: weights duration, duration−1, …, 1.
 */
export function decayShare(shape: DecayShape, duration: number, dayIndex: number): number {
  if (!Number.isSafeInteger(duration) || duration < 1) {
    throw new Error(`decay duration must be a positive safe integer, received ${describeValue(duration)}`)
  }
  if (!Number.isSafeInteger(dayIndex) || dayIndex < 0 || dayIndex >= duration) {
    throw new Error(`decay dayIndex must be from 0 through ${duration - 1}, received ${describeValue(dayIndex)}`)
  }
  if (shape === 'linear') return 1 / duration
  if (shape === 'frontLoaded') {
    const weight = duration - dayIndex
    const sum = (duration * (duration + 1)) / 2
    return weight / sum
  }
  throw new Error(`decay shape must be frontLoaded or linear, received ${describeValue(shape)}`)
}

/** Daily fair-value delta after the ±12% limit. Excess is not part of the result. */
export function clipFairValueDelta(before: number, total: number): number {
  assertFiniteNumber(before, 'fair value before')
  assertFiniteNumber(total, 'fair value total')
  const limit =
    (Math.abs(before) * FAIR_VALUE_CHANGE_LIMIT_NUMERATOR) / FAIR_VALUE_CHANGE_LIMIT_DENOMINATOR
  if (total > limit) return limit
  if (total < -limit) return -limit
  return total
}

export type EventRollResult = {
  scheduled: ScheduledEvent[]
  log: Array<EventRollEvent | EventDirectionEvent | EventMagnitudeEvent>
}

function directionOf(roll: number, up: number, down: number): EventDirection {
  if (roll < up) return 'up'
  if (roll < up + down) return 'down'
  return 'none'
}

function renderHeadline(template: string, target: string, direction: EventDirection, magnitude: number): string {
  return template
    .replaceAll('{target}', target)
    .replaceAll('{direction}', direction)
    .replaceAll('{magnitude}', String(magnitude))
}

/**
 * Roll every type and target for `eventDay`. `rolledOnDay` is the day the roll is logged.
 * Does not draw when there are no event types.
 */
export function rollEventsForDay(
  defs: MarketDefinitions,
  environment: readonly EnvironmentEntryState[],
  stream: RngStream,
  rolledOnDay: number,
  eventDay: number,
): EventRollResult {
  if (!Number.isSafeInteger(rolledOnDay) || rolledOnDay < 0) {
    throw new Error(`roll day must be a safe integer >= 0, received ${describeValue(rolledOnDay)}`)
  }
  if (!Number.isSafeInteger(eventDay) || eventDay < 1) {
    throw new Error(`event day must be a safe integer >= 1, received ${describeValue(eventDay)}`)
  }
  const scheduled: ScheduledEvent[] = []
  const log: EventRollResult['log'] = []
  for (const eventType of defs.events) {
    const adjusted = adjustForEnvironment(eventType, environment)
    for (const target of eventType.targets) {
      const roll = nextFloat(stream)
      const fired = roll < adjusted.chance
      log.push({
        kind: 'eventRoll',
        day: rolledOnDay,
        eventDay,
        type: eventType.id,
        target,
        roll,
        chance: adjusted.chance,
        fired,
      })
      if (!fired) continue
      const directionRoll = nextFloat(stream)
      const result = directionOf(directionRoll, adjusted.up, adjusted.down)
      log.push({
        kind: 'eventDirection',
        day: rolledOnDay,
        eventDay,
        type: eventType.id,
        target,
        roll: directionRoll,
        up: adjusted.up,
        down: adjusted.down,
        none: adjusted.none,
        shiftUp: adjusted.shiftUp,
        shiftDown: adjusted.shiftDown,
        shiftNone: adjusted.shiftNone,
        result,
      })
      const magnitudeRoll = nextFloat(stream)
      const magnitude = eventType.magnitudeMin + magnitudeRoll * (eventType.magnitudeMax - eventType.magnitudeMin)
      log.push({
        kind: 'eventMagnitude',
        day: rolledOnDay,
        eventDay,
        type: eventType.id,
        target,
        roll: magnitudeRoll,
        min: eventType.magnitudeMin,
        max: eventType.magnitudeMax,
        magnitude,
      })
      if (result === 'none') continue
      scheduled.push({
        id: `${eventType.id}:${target}:${eventDay}`,
        typeId: eventType.id,
        target,
        eventDay,
        direction: result,
        magnitudePercent: magnitude,
        duration: eventType.duration,
        decay: eventType.decay,
        headline: renderHeadline(eventType.headline, target, result, magnitude),
      })
    }
  }
  return { scheduled, log }
}

function affectedAssets(scope: EventScope, target: string, assets: readonly AssetDefinition[]): string[] {
  if (scope === 'stock') {
    const stock = assets.find((asset) => asset.id === target && asset.kind === 'stock')
    if (stock === undefined) throw new Error(`event target ${target} is not a stock`)
    return [stock.id]
  }
  if (scope === 'sector') {
    const ids = assets.filter((asset) => asset.kind === 'stock' && asset.sector === target).map((asset) => asset.id)
    if (ids.length === 0) throw new Error(`sector ${target} has no stocks`)
    return ids
  }
  const ids = assets.filter((asset) => asset.kind === 'stock').map((asset) => asset.id)
  if (ids.length === 0) throw new Error('market event needs a stock')
  return ids
}

/**
 * Move today's scheduled events onto the active list, apply every active effect's
 * share for today, then clip each stock's summed delta to ±12% of its fair value.
 * Mutates fair value, `scheduled`, and `active`. Does not draw.
 */
export function applyDueEffects(state: MarketState, defs: MarketDefinitions): Array<EffectAppliedEvent | FairValueChangeEvent> {
  const day = state.day
  const before = new Map<string, number>()
  for (const asset of defs.assets) {
    if (asset.kind !== 'stock') continue
    before.set(asset.id, state.assets[asset.id].fairValue)
  }

  const later: ScheduledEvent[] = []
  const due: ScheduledEvent[] = []
  for (const event of state.scheduled) {
    if (!Number.isSafeInteger(event.eventDay)) {
      throw new Error(`scheduled event ${describeValue(event.id)} eventDay must be an integer, received ${describeValue(event.eventDay)}`)
    }
    if (event.eventDay < day) {
      throw new Error(`scheduled event ${event.id} for day ${event.eventDay} was not applied before day ${day}`)
    }
    if (event.eventDay === day) due.push(event)
    else later.push(event)
  }
  state.scheduled = later

  for (const event of due) {
    const eventType = defs.events.find((item) => item.id === event.typeId)
    if (eventType === undefined) {
      throw new Error(`scheduled event ${event.id} has unknown type ${event.typeId}`)
    }
    const sign = event.direction === 'down' ? -1 : 1
    const ids = affectedAssets(eventType.scope, event.target, defs.assets)
    state.active.push({
      id: event.id,
      typeId: event.typeId,
      target: event.target,
      eventDay: event.eventDay,
      decay: event.decay,
      duration: event.duration,
      dayIndex: 0,
      parts: ids.map((asset) => {
        const base = before.get(asset)
        if (base === undefined) throw new Error(`event ${event.id} names missing stock ${asset}`)
        return { asset, totalDelta: sign * (event.magnitudePercent / 100) * base }
      }),
    })
  }

  const totals = new Map<string, number>()
  const touched = new Set<string>()
  const log: Array<EffectAppliedEvent | FairValueChangeEvent> = []
  const kept: ActiveEffect[] = []
  for (const effect of state.active) {
    const share = decayShare(effect.decay, effect.duration, effect.dayIndex)
    for (const part of effect.parts) {
      const delta = part.totalDelta * share
      if (!Number.isFinite(delta)) {
        throw new Error(`effect ${effect.id} produced a non-finite delta for ${part.asset}`)
      }
      log.push({
        kind: 'effectApplied',
        day,
        asset: part.asset,
        effect: effect.id,
        dayIndex: effect.dayIndex,
        delta,
      })
      totals.set(part.asset, (totals.get(part.asset) ?? 0) + delta)
      touched.add(part.asset)
    }
    effect.dayIndex += 1
    if (effect.dayIndex < effect.duration) kept.push(effect)
  }
  state.active = kept

  for (const asset of defs.assets) {
    if (asset.kind !== 'stock' || !touched.has(asset.id)) continue
    const start = before.get(asset.id)
    if (start === undefined) throw new Error(`missing fair value for ${asset.id}`)
    const total = totals.get(asset.id) ?? 0
    const clipped = clipFairValueDelta(start, total)
    const after = start + clipped
    if (!Number.isFinite(after)) {
      throw new Error(`fair value for ${asset.id} became non-finite, received ${describeValue(after)}`)
    }
    state.assets[asset.id].fairValue = after
    log.push({
      kind: 'fairValueChange',
      day,
      asset: asset.id,
      before: start,
      total,
      clipped,
      after,
    })
  }
  return log
}
