// Energy and stress. Both run from 0 to 100.
// A job's stored costs and a short sleep are applied at the end of the day.
// Consumables are the recovery. Each item can be used once that day, paid from cash,
// and it does not take a day section. Home recovery is not applied.
// Reading the news spends energy. Quiet breaks makes the first read that day free.
// This module does not draw a random stream and does not write on the market.

import { activeJob } from './jobs.ts'
import type {
  CommandRejectedEvent,
  ConsumableDefinition,
  ConsumeEvent,
  GameState,
  JobDefinition,
  NewsReadEvent,
  PlayerStats,
  StatChangeEvent,
  StatName,
} from './types.ts'

/** Section 9. Both stats start here and stay inside 0 to 100. */
export const STAT_MIN = 0
export const STAT_MAX = 100
export const STARTING_ENERGY = 80
export const STARTING_STRESS = 20

/** Section 9. Warning when energy is below this, or stress is above the stress line. */
export const ENERGY_WARNING_BELOW = 40
export const STRESS_WARNING_ABOVE = 60

/** Section 4 and 9. Sleep of this length has no penalty. Each missing hour is charged below. */
export const SLEEP_NEED_HOURS = 7
export const SHORT_SLEEP_ENERGY_PER_HOUR = 8
export const SHORT_SLEEP_STRESS_PER_HOUR = 4

/**
 * Section 9. A large drawdown is provisional: trading equity fell by this
 * percent or more from the start of that day. There is no drawdown log flag.
 * Wipe-out is the separate flag for ending below 10% of the start.
 * Integer test: drop × DENOMINATOR >= start × NUMERATOR, and start > 0.
 */
export const LARGE_DRAWDOWN_NUMERATOR = 10
export const LARGE_DRAWDOWN_DENOMINATOR = 100
export const DRAWDOWN_STRESS = 10
export const MARGIN_WARNING_STRESS = 8
export const WIPE_OUT_STRESS = 25

/** Section 4 and 9. Energy spent to read the news. Quiet breaks waives the first read. */
export const NEWS_READ_ENERGY_COST = 2

/**
 * Section 6. Steady routine multiplies stress restored by a consumable by 1.1.
 * 11/10, rounded half away from zero. Energy is unchanged.
 */
export const STEADY_ROUTINE_STRESS_NUMERATOR = 11
export const STEADY_ROUTINE_STRESS_DENOMINATOR = 10

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`${label} must be an id token, received ${describeValue(value)}`)
  }
  return value
}

function assertSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer, received ${describeValue(value)}`)
  }
  return value
}

/** Half away from zero on a positive magnitude. `product` and `denominator` are positive. */
function roundPositiveHalfAway(product: number, denominator: number): number {
  const quotient = Math.floor(product / denominator)
  const remainder = product % denominator
  return remainder * 2 >= denominator ? quotient + 1 : quotient
}

/**
 * Stress restored by one item. Negative means stress falls.
 * Steady routine scales only a negative delta. Energy is not scaled.
 */
function stressDeltaForPerk(delta: number, steadyRoutine: boolean): number {
  if (!steadyRoutine || delta >= 0) return delta
  const magnitude = -delta
  const product = magnitude * STEADY_ROUTINE_STRESS_NUMERATOR
  if (!Number.isSafeInteger(product)) {
    throw new Error(`stress restore overflowed, received ${describeValue(delta)}`)
  }
  const rounded = roundPositiveHalfAway(product, STEADY_ROUTINE_STRESS_DENOMINATOR)
  const scaled = -rounded
  if (!Number.isSafeInteger(scaled)) {
    throw new Error(`scaled stress restore is not a safe integer, received ${describeValue(delta)}`)
  }
  return scaled
}

function copyItem(item: ConsumableDefinition, index: number): ConsumableDefinition {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    throw new Error(`consumable[${index}] must be an object, received ${describeValue(item)}`)
  }
  const id = assertId(item.id, `consumable[${index}] id`)
  if (typeof item.name !== 'string' || item.name.length === 0 || /[\r\n]/.test(item.name)) {
    throw new Error(`consumable ${id} name must be one non-empty line, received ${describeValue(item.name)}`)
  }
  const costCents = assertSafeInteger(item.costCents, `consumable ${id} cost`)
  if (costCents < 0) {
    throw new Error(`consumable ${id} cost must be >= 0, received ${describeValue(item.costCents)}`)
  }
  const energy = assertSafeInteger(item.energy, `consumable ${id} energy`)
  const stress = assertSafeInteger(item.stress, `consumable ${id} stress`)
  return { id, name: item.name, costCents, energy, stress }
}

/** Copy the menu. Omitted means nothing is for sale. */
export function copyConsumables(items: readonly ConsumableDefinition[] | undefined): ConsumableDefinition[] {
  if (items === undefined) return []
  if (!Array.isArray(items)) {
    throw new Error(`consumable catalog must be a list, received ${describeValue(items)}`)
  }
  const catalog: ConsumableDefinition[] = []
  const seen = new Set<string>()
  for (let index = 0; index < items.length; index += 1) {
    const item = copyItem(items[index] as ConsumableDefinition, index)
    if (seen.has(item.id)) throw new Error(`consumable catalog repeats ${item.id}`)
    seen.add(item.id)
    catalog.push(item)
  }
  return catalog
}

export function initialStats(): PlayerStats {
  return {
    energy: STARTING_ENERGY,
    stress: STARTING_STRESS,
    consumed: [],
    newsReads: 0,
  }
}

/** Reject a stats block that could not have come from `initialStats` plus commands. */
export function assertPlayerStats(stats: PlayerStats, catalog: readonly ConsumableDefinition[]): void {
  if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) {
    throw new Error(`player stats must be an object, received ${describeValue(stats)}`)
  }
  if (!Number.isSafeInteger(stats.energy) || stats.energy < STAT_MIN || stats.energy > STAT_MAX) {
    throw new Error(`energy must be an integer from ${STAT_MIN} to ${STAT_MAX}, received ${describeValue(stats.energy)}`)
  }
  if (!Number.isSafeInteger(stats.stress) || stats.stress < STAT_MIN || stats.stress > STAT_MAX) {
    throw new Error(`stress must be an integer from ${STAT_MIN} to ${STAT_MAX}, received ${describeValue(stats.stress)}`)
  }
  if (!Number.isSafeInteger(stats.newsReads) || stats.newsReads < 0) {
    throw new Error(`news reads must be a safe integer >= 0, received ${describeValue(stats.newsReads)}`)
  }
  if (!Array.isArray(stats.consumed)) {
    throw new Error(`consumed items must be a list, received ${describeValue(stats.consumed)}`)
  }
  if (!Array.isArray(catalog)) {
    throw new Error(`consumable catalog must be a list, received ${describeValue(catalog)}`)
  }
  const ids = new Set<string>()
  for (let index = 0; index < catalog.length; index += 1) {
    const item = catalog[index]
    if (item === undefined) throw new Error(`consumable catalog is missing index ${index}`)
    copyItem(item, index)
    if (ids.has(item.id)) throw new Error(`consumable catalog repeats ${item.id}`)
    ids.add(item.id)
  }
  const used = new Set<string>()
  for (const id of stats.consumed) {
    const token = assertId(id, 'consumed item')
    if (!ids.has(token)) throw new Error(`consumed item is not on the menu, received ${token}`)
    if (used.has(token)) throw new Error(`consumed item is repeated, received ${token}`)
    used.add(token)
  }
}

function isStatName(value: unknown): value is StatName {
  return value === 'energy' || value === 'stress'
}

/** Pending consume, news, and stat lines. A bad line is a broken state and throws. */
export function assertStatsCommand(event: unknown): void {
  if (typeof event !== 'object' || event === null) {
    throw new Error(`stats event must be an object, received ${describeValue(event)}`)
  }
  const kind = (event as { kind?: unknown }).kind
  if (kind === 'statChange') {
    const row = event as StatChangeEvent
    assertSafeInteger(row.day, 'stat change day')
    if (row.day < 0) throw new Error(`stat change day must be >= 0, received ${describeValue(row.day)}`)
    if (!isStatName(row.stat)) {
      throw new Error(`stat change stat must be energy or stress, received ${describeValue(row.stat)}`)
    }
    assertId(row.cause, 'stat change cause')
    const before = assertSafeInteger(row.before, 'stat change before')
    const after = assertSafeInteger(row.after, 'stat change after')
    const delta = assertSafeInteger(row.delta, 'stat change delta')
    if (before < STAT_MIN || before > STAT_MAX || after < STAT_MIN || after > STAT_MAX) {
      throw new Error(`stat change before and after must stay inside ${STAT_MIN} to ${STAT_MAX}`)
    }
    if (delta === 0 || before + delta !== after) {
      throw new Error(`stat change delta ${delta} does not move ${before} to ${after}`)
    }
    return
  }
  if (kind === 'consume') {
    const row = event as ConsumeEvent
    assertSafeInteger(row.day, 'consume day')
    if (row.day < 0) throw new Error(`consume day must be >= 0, received ${describeValue(row.day)}`)
    assertId(row.item, 'consume item')
    const cost = assertSafeInteger(row.cost, 'consume cost')
    if (cost < 0) throw new Error(`consume cost must be >= 0, received ${describeValue(row.cost)}`)
    assertSafeInteger(row.energyDelta, 'consume energy')
    assertSafeInteger(row.stressDelta, 'consume stress')
    return
  }
  if (kind === 'newsRead') {
    const row = event as NewsReadEvent
    assertSafeInteger(row.day, 'news read day')
    if (row.day < 0) throw new Error(`news read day must be >= 0, received ${describeValue(row.day)}`)
    const cost = assertSafeInteger(row.cost, 'news read cost')
    if (cost < 0) throw new Error(`news read cost must be >= 0, received ${describeValue(row.cost)}`)
    return
  }
  throw new Error(`stats event kind is unknown, received ${describeValue(kind)}`)
}

function clampStat(value: number): number {
  if (value < STAT_MIN) return STAT_MIN
  if (value > STAT_MAX) return STAT_MAX
  return value
}

function readStat(stats: PlayerStats, stat: StatName): number {
  return stat === 'energy' ? stats.energy : stats.stress
}

function writeStat(stats: PlayerStats, stat: StatName, value: number): void {
  if (stat === 'energy') stats.energy = value
  else stats.stress = value
}

/**
 * Apply one change and clamp. Returns nothing when the stat does not move.
 * `delta` on the event is the applied change, so before + delta = after.
 */
function applyDelta(
  state: GameState,
  day: number,
  stat: StatName,
  cause: string,
  delta: number,
): StatChangeEvent | null {
  if (!Number.isSafeInteger(delta)) {
    throw new Error(`stat delta must be a safe integer, received ${describeValue(delta)}`)
  }
  if (delta === 0) return null
  const before = readStat(state.stats, stat)
  const sum = before + delta
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`stat ${stat} left the safe integer range, received ${describeValue(sum)}`)
  }
  const after = clampStat(sum)
  const applied = after - before
  if (applied === 0) return null
  writeStat(state.stats, stat, after)
  return { kind: 'statChange', day, stat, before, cause, delta: applied, after }
}

/**
 * True when trading equity fell by 10% or more from the start of the day.
 * Start equity at or below 0 is not a percentage drop. Exactly 10% counts.
 */
export function isLargeDrawdown(startEquity: number, endEquity: number): boolean {
  if (!Number.isSafeInteger(startEquity) || !Number.isSafeInteger(endEquity)) {
    throw new Error(
      `drawdown equity must be safe integers, received start=${describeValue(startEquity)} end=${describeValue(endEquity)}`,
    )
  }
  if (startEquity <= 0) return false
  const drop = startEquity - endEquity
  if (!Number.isSafeInteger(drop) || drop <= 0) return false
  const left = drop * LARGE_DRAWDOWN_DENOMINATOR
  const right = startEquity * LARGE_DRAWDOWN_NUMERATOR
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw new Error('drawdown comparison overflowed a safe integer')
  }
  return left >= right
}

function rejected(day: number, command: string, reason: string): CommandRejectedEvent {
  return { kind: 'commandRejected', day, command, reason }
}

export type ConsumeOutcome =
  | { accepted: true; events: Array<ConsumeEvent | StatChangeEvent> }
  | { accepted: false; event: CommandRejectedEvent }

/**
 * Buy one item from cash. Once per item per day. Does not change the section.
 * Unknown item, a second use, or too little cash is logged and does not throw.
 */
export function interpretConsume(state: GameState, cmd: unknown): ConsumeOutcome {
  const day = state.market.day
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) {
    return { accepted: false, event: rejected(day, 'consume', 'unknownItem') }
  }
  const itemId = (cmd as { item?: unknown }).item
  if (typeof itemId !== 'string') {
    return { accepted: false, event: rejected(day, 'consume', 'unknownItem') }
  }
  const item = state.consumables.find((row) => row.id === itemId)
  if (item === undefined) {
    return { accepted: false, event: rejected(day, 'consume', 'unknownItem') }
  }
  if (state.stats.consumed.includes(item.id)) {
    return { accepted: false, event: rejected(day, 'consume', 'alreadyConsumed') }
  }
  if (state.accounts.cashCents < item.costCents) {
    return { accepted: false, event: rejected(day, 'consume', 'insufficientFunds') }
  }
  const nextCash = state.accounts.cashCents - item.costCents
  if (!Number.isSafeInteger(nextCash) || nextCash < 0) {
    throw new Error(`consume left cash at ${describeValue(nextCash)}`)
  }
  state.accounts.cashCents = nextCash
  state.stats.consumed.push(item.id)
  const steady = activeJob(state.job).perk === 'steadyRoutine'
  const energyDelta = item.energy
  const stressDelta = stressDeltaForPerk(item.stress, steady)
  const energyEvent = applyDelta(state, day, 'energy', 'consume', energyDelta)
  const stressEvent = applyDelta(state, day, 'stress', 'consume', stressDelta)
  const consume: ConsumeEvent = {
    kind: 'consume',
    day,
    item: item.id,
    cost: item.costCents,
    energyDelta: energyEvent?.delta ?? 0,
    stressDelta: stressEvent?.delta ?? 0,
  }
  const events: Array<ConsumeEvent | StatChangeEvent> = [consume]
  if (energyEvent !== null) events.push(energyEvent)
  if (stressEvent !== null) events.push(stressEvent)
  return { accepted: true, events }
}

/**
 * Read the news. The feed itself is not changed. Cost is 2 energy, or 0 for
 * the first read on a quiet-breaks job. The logged cost is that price.
 * The stat line, when energy actually moves, uses the clamped delta.
 */
export function interpretReadNews(state: GameState): Array<NewsReadEvent | StatChangeEvent> {
  const day = state.market.day
  const free = activeJob(state.job).perk === 'quietBreaks' && state.stats.newsReads === 0
  const cost = free ? 0 : NEWS_READ_ENERGY_COST
  const nextReads = state.stats.newsReads + 1
  if (!Number.isSafeInteger(nextReads)) throw new Error('news reads overflowed')
  state.stats.newsReads = nextReads
  const events: Array<NewsReadEvent | StatChangeEvent> = []
  const spent = applyDelta(state, day, 'energy', 'newsRead', -cost)
  if (spent !== null) events.push(spent)
  events.push({ kind: 'newsRead', day, cost })
  return events
}

/**
 * End-of-day energy and stress for the job and sleep that just finished.
 * Call this after the margin settlement and before the FI check.
 * `marginEvents` is that settlement. A margin warning day and a wipe-out are
 * read from those events. A large drawdown is computed from the two equities.
 * Home recovery is not applied. Used items and news reads then reset.
 */
export function applyEndOfDayStats(
  state: GameState,
  job: JobDefinition,
  sleepHours: number,
  startEquity: number,
  endEquity: number,
  marginEvents: readonly { kind: string }[],
): StatChangeEvent[] {
  if (!Number.isSafeInteger(sleepHours) || sleepHours < 0 || sleepHours > 24) {
    throw new Error(`sleep hours must be an integer from 0 to 24, received ${describeValue(sleepHours)}`)
  }
  if (!Number.isSafeInteger(job.energyCost) || job.energyCost < 0) {
    throw new Error(`job energy cost must be a safe integer >= 0, received ${describeValue(job.energyCost)}`)
  }
  if (!Number.isSafeInteger(job.stressCost) || job.stressCost < 0) {
    throw new Error(`job stress cost must be a safe integer >= 0, received ${describeValue(job.stressCost)}`)
  }
  if (!Array.isArray(marginEvents)) {
    throw new Error(`margin events must be a list, received ${describeValue(marginEvents)}`)
  }
  const day = state.market.day
  const events: StatChangeEvent[] = []
  const push = (event: StatChangeEvent | null): void => {
    if (event !== null) events.push(event)
  }
  push(applyDelta(state, day, 'energy', 'job', -job.energyCost))
  push(applyDelta(state, day, 'stress', 'job', job.stressCost))
  const missingSleep = SLEEP_NEED_HOURS - sleepHours
  if (missingSleep > 0) {
    push(applyDelta(state, day, 'energy', 'shortSleep', -(missingSleep * SHORT_SLEEP_ENERGY_PER_HOUR)))
    push(applyDelta(state, day, 'stress', 'shortSleep', missingSleep * SHORT_SLEEP_STRESS_PER_HOUR))
  }
  if (isLargeDrawdown(startEquity, endEquity)) {
    push(applyDelta(state, day, 'stress', 'drawdown', DRAWDOWN_STRESS))
  }
  let warned = false
  let wiped = false
  for (const event of marginEvents) {
    if (event.kind === 'marginWarning') warned = true
    if (event.kind === 'wipeOut') wiped = true
  }
  if (warned) push(applyDelta(state, day, 'stress', 'marginWarning', MARGIN_WARNING_STRESS))
  if (wiped) push(applyDelta(state, day, 'stress', 'wipeOut', WIPE_OUT_STRESS))
  state.stats.consumed = []
  state.stats.newsReads = 0
  return events
}
