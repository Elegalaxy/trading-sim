// Environment levels are data. Drift walks the list in order and draws the events
// stream only when driftSpeed is not 0. The policy rate uses speed 0. A calendar
// decision changes it on its day and does not draw a drift sample for it.

import { nextNormal } from './rng.ts'
import type {
  EnvDriftEvent,
  EnvironmentEntryDefinition,
  EnvironmentEntryState,
  EnvironmentModifier,
  EventTypeDefinition,
  MarketState,
  RngStream,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/

export function assertEnvironmentDefinitions(entries: readonly EnvironmentEntryDefinition[]): void {
  if (!Array.isArray(entries)) {
    throw new Error(`environment definitions must be an array, received ${describeValue(entries)}`)
  }
  const seen = new Set<string>()
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`environment definitions[${i}] must be an object, received ${describeValue(entry)}`)
    }
    if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) {
      throw new Error(
        `environment definitions[${i}].id must be a letter followed by letters or digits, received ${describeValue(entry.id)}`,
      )
    }
    if (seen.has(entry.id)) throw new Error(`environment id ${entry.id} is duplicated`)
    seen.add(entry.id)
    if (typeof entry.start !== 'number' || !Number.isFinite(entry.start)) {
      throw new Error(
        `environment ${entry.id} start must be a finite number, received ${describeValue(entry.start)}`,
      )
    }
    if (typeof entry.driftSpeed !== 'number' || !Number.isFinite(entry.driftSpeed) || entry.driftSpeed < 0) {
      throw new Error(
        `environment ${entry.id} driftSpeed must be a finite number >= 0, received ${describeValue(entry.driftSpeed)}`,
      )
    }
  }
}

export function initialEnvironment(entries: readonly EnvironmentEntryDefinition[]): EnvironmentEntryState[] {
  return entries.map((entry) => ({ id: entry.id, value: entry.start }))
}

function clampUnit(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export type AdjustedChances = {
  chance: number
  up: number
  down: number
  none: number
  shiftChance: number
  shiftUp: number
  shiftDown: number
  shiftNone: number
}

/**
 * Shift the type's chance and direction chances by each modifier, then clamp
 * the chance to [0, 1] and renormalize directions so they stay non-negative and sum to 1.
 */
export function adjustForEnvironment(
  eventType: EventTypeDefinition,
  environment: readonly EnvironmentEntryState[],
): AdjustedChances {
  let shiftChance = 0
  let shiftUp = 0
  let shiftDown = 0
  let shiftNone = 0
  for (let i = 0; i < eventType.modifiers.length; i += 1) {
    const modifier: EnvironmentModifier = eventType.modifiers[i]
    const entry = environment.find((item) => item.id === modifier.entryId)
    if (entry === undefined) {
      throw new Error(`event ${eventType.id} modifier references missing environment entry ${modifier.entryId}`)
    }
    const unit = entry.value - modifier.center
    shiftChance += modifier.chancePerUnit * unit
    shiftUp += modifier.upPerUnit * unit
    shiftDown += modifier.downPerUnit * unit
    shiftNone += modifier.nonePerUnit * unit
  }
  const chance = clampUnit(eventType.chance + shiftChance, 0, 1)
  let up = Math.max(0, eventType.direction.up + shiftUp)
  let down = Math.max(0, eventType.direction.down + shiftDown)
  let none = Math.max(0, eventType.direction.none + shiftNone)
  const sum = up + down + none
  if (!(sum > 0) || !Number.isFinite(sum)) {
    throw new Error(
      `event ${eventType.id} direction chances collapsed after environment, received up=${describeValue(up)} down=${describeValue(down)} none=${describeValue(none)}`,
    )
  }
  up /= sum
  down /= sum
  none /= sum
  return { chance, up, down, none, shiftChance, shiftUp, shiftDown, shiftNone }
}

/**
 * Drift every entry in definition order. A zero driftSpeed logs a flat line and does not draw.
 * Mutates `state.environment`. Reads only `state.streams.events`.
 */
export function driftEnvironment(state: MarketState, entries: readonly EnvironmentEntryDefinition[]): EnvDriftEvent[] {
  if (state.environment.length !== entries.length) {
    throw new Error(
      `environment state length must match definitions, received ${state.environment.length} for ${entries.length} definitions`,
    )
  }
  const log: EnvDriftEvent[] = []
  for (let i = 0; i < entries.length; i += 1) {
    const def = entries[i]
    const entry = state.environment[i]
    if (entry === undefined || entry.id !== def.id) {
      throw new Error(
        `environment state[${i}] must be ${def.id}, received ${describeValue(entry?.id)}`,
      )
    }
    const before = entry.value
    let shock = 0
    let delta = 0
    if (def.driftSpeed !== 0) {
      shock = nextNormal(eventsStream(state))
      delta = def.driftSpeed * shock
      entry.value = before + delta
    }
    if (!Number.isFinite(entry.value)) {
      throw new Error(`environment ${def.id} drifted to a non-finite value from before=${before} delta=${delta}`)
    }
    log.push({
      kind: 'envDrift',
      day: state.day,
      entry: def.id,
      before,
      shock,
      delta,
      after: entry.value,
    })
  }
  return log
}

function eventsStream(state: MarketState): RngStream {
  return state.streams.events
}
