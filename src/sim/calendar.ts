// Macro calendar. Dates are known. Outcomes are one events-stream float, rolled with the
// same 3-day lookahead as ordinary events, and applied on the calendar day.
// The draw is after that day's ordinary event rolls. It never touches the market stream.
// Rolls live on `calendarRolls`, not on `scheduled`, so a later distortion step cannot filter them.

import { nextFloat } from './rng.ts'
import type {
  ActiveEffect,
  AssetDefinition,
  CalendarBand,
  CalendarDefinitions,
  CalendarEffectCell,
  CalendarItemEvent,
  CalendarItemKind,
  CalendarOutcome,
  CalendarRoll,
  CalendarRules,
  CalendarScheduleEntry,
  EnvironmentEntryDefinition,
  EnvironmentEntryState,
  EnvironmentView,
  MarketDefinitions,
  MarketState,
  PolicyChanceCell,
  PolicyOutcome,
  ReleaseChanceCell,
  ReleaseOutcome,
  UpcomingCalendarItem,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/
const CHANCE_SUM_TOLERANCE = 1e-9
const BANDS: readonly CalendarBand[] = ['low', 'mid', 'high']
const POLICY_OUTCOMES: readonly PolicyOutcome[] = ['hold', 'up', 'down']
const RELEASE_OUTCOMES: readonly ReleaseOutcome[] = ['above', 'inline', 'below']
const KINDS: readonly CalendarItemKind[] = ['growthRelease', 'inflationRelease', 'policyDecision']

function assertFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number, received ${describeValue(value)}`)
  }
}

function isKind(value: unknown): value is CalendarItemKind {
  return value === 'growthRelease' || value === 'inflationRelease' || value === 'policyDecision'
}

function isBand(value: unknown): value is CalendarBand {
  return value === 'low' || value === 'mid' || value === 'high'
}

function assertChances(hold: number, up: number, down: number, label: string): void {
  for (const [name, chance] of [
    ['hold', hold],
    ['up', up],
    ['down', down],
  ] as const) {
    assertFinite(chance, `${label} ${name}`)
    if (chance < 0 || chance > 1) {
      throw new Error(`${label} ${name} must be from 0 to 1, received ${chance}`)
    }
  }
  const sum = hold + up + down
  if (Math.abs(sum - 1) > CHANCE_SUM_TOLERANCE) {
    throw new Error(`${label} chances must sum to 1, received ${sum}`)
  }
}

function assertReleaseChances(cell: ReleaseChanceCell, label: string): void {
  assertFinite(cell.above, `${label} above`)
  assertFinite(cell.inline, `${label} inline`)
  assertFinite(cell.below, `${label} below`)
  for (const [name, chance] of [
    ['above', cell.above],
    ['inline', cell.inline],
    ['below', cell.below],
  ] as const) {
    if (chance < 0 || chance > 1) {
      throw new Error(`${label} ${name} must be from 0 to 1, received ${chance}`)
    }
  }
  const sum = cell.above + cell.inline + cell.below
  if (Math.abs(sum - 1) > CHANCE_SUM_TOLERANCE) {
    throw new Error(`${label} chances must sum to 1, received ${sum}`)
  }
}

function entryId(value: unknown, label: string, environmentIds: ReadonlySet<string>): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || !environmentIds.has(value)) {
    throw new Error(`${label} must name an environment entry, received ${describeValue(value)}`)
  }
  return value
}

/**
 * Reject a calendar that would roll or apply an unknown chance or effect.
 * Called before any events-stream draw.
 */
export function assertCalendarDefinitions(
  calendar: CalendarDefinitions,
  environment: readonly EnvironmentEntryDefinition[],
  assets: readonly AssetDefinition[],
): void {
  if (typeof calendar !== 'object' || calendar === null || Array.isArray(calendar)) {
    throw new Error(`calendar definitions must be an object, received ${describeValue(calendar)}`)
  }
  if (!Number.isSafeInteger(calendar.daysPerMonth) || calendar.daysPerMonth < 1) {
    throw new Error(
      `calendar daysPerMonth must be a safe integer >= 1, received ${describeValue(calendar.daysPerMonth)}`,
    )
  }
  const environmentIds = new Set(environment.map((entry) => entry.id))
  const growthId = entryId(calendar.growthEntryId, 'calendar growthEntryId', environmentIds)
  const inflationId = entryId(calendar.inflationEntryId, 'calendar inflationEntryId', environmentIds)
  const policyId = entryId(calendar.policyEntryId, 'calendar policyEntryId', environmentIds)
  assertFinite(calendar.inflationLowBelow, 'calendar inflationLowBelow')
  assertFinite(calendar.inflationHighAt, 'calendar inflationHighAt')
  if (!(calendar.inflationLowBelow < calendar.inflationHighAt)) {
    throw new Error(
      `calendar inflationLowBelow must be < inflationHighAt, received ${calendar.inflationLowBelow} and ${calendar.inflationHighAt}`,
    )
  }
  assertFinite(calendar.growthLowBelow, 'calendar growthLowBelow')
  assertFinite(calendar.growthHighAt, 'calendar growthHighAt')
  if (!(calendar.growthLowBelow < calendar.growthHighAt)) {
    throw new Error(
      `calendar growthLowBelow must be < growthHighAt, received ${calendar.growthLowBelow} and ${calendar.growthHighAt}`,
    )
  }
  assertFinite(calendar.rateStep, 'calendar rateStep')
  if (calendar.rateStep < 0) {
    throw new Error(`calendar rateStep must be >= 0, received ${calendar.rateStep}`)
  }
  assertSchedule(calendar, growthId, inflationId, policyId, environmentIds)
  assertPolicyTable(calendar.policy)
  assertReleaseTable(calendar.growthRelease, 'calendar growthRelease')
  assertReleaseTable(calendar.inflationRelease, 'calendar inflationRelease')
  assertEffects(calendar.effects)
  const sectors = new Set(assets.filter((asset) => asset.kind === 'stock').map((asset) => asset.sector))
  if (!sectors.has('A') || !sectors.has('B')) {
    throw new Error('calendar effects need at least one stock in sector A and sector B')
  }
}

function assertSchedule(
  calendar: CalendarDefinitions,
  growthId: string,
  inflationId: string,
  policyId: string,
  environmentIds: ReadonlySet<string>,
): void {
  if (!Array.isArray(calendar.schedule)) {
    throw new Error(`calendar schedule must be an array, received ${describeValue(calendar.schedule)}`)
  }
  const kinds = new Set<string>()
  const days = new Set<number>()
  for (let i = 0; i < calendar.schedule.length; i += 1) {
    const entry = calendar.schedule[i]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`calendar schedule[${i}] must be an object, received ${describeValue(entry)}`)
    }
    if (!isKind(entry.kind)) {
      throw new Error(
        `calendar schedule[${i}].kind must be growthRelease, inflationRelease, or policyDecision, received ${describeValue(entry.kind)}`,
      )
    }
    if (kinds.has(entry.kind)) throw new Error(`calendar kind ${entry.kind} is duplicated`)
    kinds.add(entry.kind)
    if (!Number.isSafeInteger(entry.dayOfMonth) || entry.dayOfMonth < 1 || entry.dayOfMonth > calendar.daysPerMonth) {
      throw new Error(
        `calendar ${entry.kind} dayOfMonth must be from 1 to ${calendar.daysPerMonth}, received ${describeValue(entry.dayOfMonth)}`,
      )
    }
    if (days.has(entry.dayOfMonth)) throw new Error(`calendar day ${entry.dayOfMonth} is used more than once`)
    days.add(entry.dayOfMonth)
    const id = entryId(entry.entryId, `calendar ${entry.kind} entryId`, environmentIds)
    const expected = entry.kind === 'growthRelease' ? growthId : entry.kind === 'inflationRelease' ? inflationId : policyId
    if (id !== expected) {
      throw new Error(`calendar ${entry.kind} entryId must be ${expected}, received ${id}`)
    }
  }
  for (const kind of KINDS) {
    if (!kinds.has(kind)) throw new Error(`calendar schedule is missing ${kind}`)
  }
}

function assertPolicyTable(cells: readonly PolicyChanceCell[]): void {
  if (!Array.isArray(cells)) {
    throw new Error(`calendar policy chances must be an array, received ${describeValue(cells)}`)
  }
  const seen = new Set<string>()
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]
    if (typeof cell !== 'object' || cell === null || Array.isArray(cell)) {
      throw new Error(`calendar policy[${i}] must be an object, received ${describeValue(cell)}`)
    }
    if (!isBand(cell.inflationBand) || !isBand(cell.growthBand)) {
      throw new Error(
        `calendar policy[${i}] bands must be low, mid, or high, received inflation=${describeValue(cell.inflationBand)} growth=${describeValue(cell.growthBand)}`,
      )
    }
    const key = `${cell.inflationBand}:${cell.growthBand}`
    if (seen.has(key)) throw new Error(`calendar policy cell ${key} is duplicated`)
    seen.add(key)
    assertChances(cell.hold, cell.up, cell.down, `calendar policy ${key}`)
  }
  for (const inflationBand of BANDS) {
    for (const growthBand of BANDS) {
      if (!seen.has(`${inflationBand}:${growthBand}`)) {
        throw new Error(`calendar policy cell ${inflationBand}:${growthBand} is missing`)
      }
    }
  }
}

function assertReleaseTable(cells: readonly ReleaseChanceCell[], label: string): void {
  if (!Array.isArray(cells)) {
    throw new Error(`${label} chances must be an array, received ${describeValue(cells)}`)
  }
  const seen = new Set<string>()
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]
    if (typeof cell !== 'object' || cell === null || Array.isArray(cell)) {
      throw new Error(`${label}[${i}] must be an object, received ${describeValue(cell)}`)
    }
    if (!isBand(cell.band)) {
      throw new Error(`${label}[${i}].band must be low, mid, or high, received ${describeValue(cell.band)}`)
    }
    if (seen.has(cell.band)) throw new Error(`${label} band ${cell.band} is duplicated`)
    seen.add(cell.band)
    assertReleaseChances(cell, `${label} ${cell.band}`)
  }
  for (const band of BANDS) {
    if (!seen.has(band)) throw new Error(`${label} band ${band} is missing`)
  }
}

function assertEffects(effects: readonly CalendarEffectCell[]): void {
  if (!Array.isArray(effects)) {
    throw new Error(`calendar effects must be an array, received ${describeValue(effects)}`)
  }
  const seen = new Set<string>()
  for (let i = 0; i < effects.length; i += 1) {
    const cell = effects[i]
    if (typeof cell !== 'object' || cell === null || Array.isArray(cell)) {
      throw new Error(`calendar effects[${i}] must be an object, received ${describeValue(cell)}`)
    }
    if (!isKind(cell.kind)) {
      throw new Error(`calendar effects[${i}].kind must be a calendar item, received ${describeValue(cell.kind)}`)
    }
    const outcomes: readonly string[] = cell.kind === 'policyDecision' ? POLICY_OUTCOMES : RELEASE_OUTCOMES
    if (typeof cell.outcome !== 'string' || !outcomes.includes(cell.outcome)) {
      throw new Error(
        `calendar effects[${i}] outcome must be one of ${outcomes.join(', ')}, received ${describeValue(cell.outcome)}`,
      )
    }
    if (cell.sector !== 'A' && cell.sector !== 'B') {
      throw new Error(`calendar effects[${i}].sector must be A or B, received ${describeValue(cell.sector)}`)
    }
    assertFinite(cell.percent, `calendar effects[${i}].percent`)
    const key = `${cell.kind}:${cell.outcome}:${cell.sector}`
    if (seen.has(key)) throw new Error(`calendar effect ${key} is duplicated`)
    seen.add(key)
  }
  for (const outcome of POLICY_OUTCOMES) {
    for (const sector of ['A', 'B'] as const) {
      if (!seen.has(`policyDecision:${outcome}:${sector}`)) {
        throw new Error(`calendar effect policyDecision:${outcome}:${sector} is missing`)
      }
    }
  }
  for (const kind of ['growthRelease', 'inflationRelease'] as const) {
    for (const outcome of RELEASE_OUTCOMES) {
      for (const sector of ['A', 'B'] as const) {
        if (!seen.has(`${kind}:${outcome}:${sector}`)) {
          throw new Error(`calendar effect ${kind}:${outcome}:${sector} is missing`)
        }
      }
    }
  }
}

/** Empty when the definitions omit the calendar, so older markets draw no extra floats. */
export function calendarRulesFrom(defs: MarketDefinitions): CalendarRules {
  const calendar = defs.calendar
  if (calendar === undefined) return { daysPerMonth: 30, schedule: [] }
  return {
    daysPerMonth: calendar.daysPerMonth,
    schedule: calendar.schedule.map((entry) => ({
      kind: entry.kind,
      dayOfMonth: entry.dayOfMonth,
      entryId: entry.entryId,
    })),
  }
}

function dayOfMonth(day: number, daysPerMonth: number): number {
  if (!Number.isSafeInteger(day) || day < 1) {
    throw new Error(`calendar day must be a safe integer >= 1, received ${describeValue(day)}`)
  }
  if (!Number.isSafeInteger(daysPerMonth) || daysPerMonth < 1) {
    throw new Error(`calendar month length must be a safe integer >= 1, received ${describeValue(daysPerMonth)}`)
  }
  return ((day - 1) % daysPerMonth) + 1
}

function ruleOnDay(rules: CalendarRules, day: number): CalendarScheduleEntry | undefined {
  const dom = dayOfMonth(day, rules.daysPerMonth)
  return rules.schedule.find((entry) => entry.dayOfMonth === dom)
}

function bandOf(value: number, lowBelow: number, highAt: number): CalendarBand {
  if (value < lowBelow) return 'low'
  if (value >= highAt) return 'high'
  return 'mid'
}

function environmentValue(environment: readonly EnvironmentEntryState[], id: string): number {
  const entry = environment.find((item) => item.id === id)
  if (entry === undefined) throw new Error(`calendar references missing environment entry ${id}`)
  if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
    throw new Error(`environment ${id} value must be a finite number, received ${describeValue(entry.value)}`)
  }
  return entry.value
}

function assertRoll(roll: number): void {
  if (typeof roll !== 'number' || !Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new Error(`calendar roll must be a number in [0, 1), received ${describeValue(roll)}`)
  }
}

/**
 * The policy branch the day roll uses. `up` is checked first, then `down`, and the rest is `hold`.
 */
export function policyOutcomeForRoll(
  roll: number,
  chances: { up: number; down: number; hold: number },
): PolicyOutcome {
  assertRoll(roll)
  assertFinite(chances.up, 'policy up chance')
  assertFinite(chances.down, 'policy down chance')
  assertFinite(chances.hold, 'policy hold chance')
  if (roll < chances.up) return 'up'
  if (roll < chances.up + chances.down) return 'down'
  return 'hold'
}

/** Release branch. `above` is checked first, then `below`, and the rest is `inline`. */
export function releaseOutcomeForRoll(
  roll: number,
  chances: { above: number; below: number; inline: number },
): ReleaseOutcome {
  assertRoll(roll)
  assertFinite(chances.above, 'release above chance')
  assertFinite(chances.below, 'release below chance')
  assertFinite(chances.inline, 'release inline chance')
  if (roll < chances.above) return 'above'
  if (roll < chances.above + chances.below) return 'below'
  return 'inline'
}

/**
 * Policy chances for the current inflation and growth. This is the table the roll uses.
 */
export function lookupPolicyChances(
  calendar: CalendarDefinitions,
  inflation: number,
  growth: number,
): { hold: number; up: number; down: number } {
  assertFinite(inflation, 'inflation')
  assertFinite(growth, 'growth')
  const inflationBand = bandOf(inflation, calendar.inflationLowBelow, calendar.inflationHighAt)
  const growthBand = bandOf(growth, calendar.growthLowBelow, calendar.growthHighAt)
  const cell = calendar.policy.find((row) => row.inflationBand === inflationBand && row.growthBand === growthBand)
  if (cell === undefined) {
    throw new Error(`no policy chances for inflation ${inflationBand} and growth ${growthBand}`)
  }
  return { hold: cell.hold, up: cell.up, down: cell.down }
}

function releaseCell(cells: readonly ReleaseChanceCell[], band: CalendarBand, label: string): ReleaseChanceCell {
  const cell = cells.find((row) => row.band === band)
  if (cell === undefined) throw new Error(`no ${label} chances for band ${band}`)
  return cell
}

function outcomeFor(
  calendar: CalendarDefinitions,
  environment: readonly EnvironmentEntryState[],
  kind: CalendarItemKind,
  roll: number,
): CalendarOutcome {
  if (kind === 'policyDecision') {
    const chances = lookupPolicyChances(
      calendar,
      environmentValue(environment, calendar.inflationEntryId),
      environmentValue(environment, calendar.growthEntryId),
    )
    return policyOutcomeForRoll(roll, chances)
  }
  if (kind === 'growthRelease') {
    const growth = environmentValue(environment, calendar.growthEntryId)
    const band = bandOf(growth, calendar.growthLowBelow, calendar.growthHighAt)
    return releaseOutcomeForRoll(roll, releaseCell(calendar.growthRelease, band, 'growth release'))
  }
  const inflation = environmentValue(environment, calendar.inflationEntryId)
  const band = bandOf(inflation, calendar.inflationLowBelow, calendar.inflationHighAt)
  return releaseOutcomeForRoll(roll, releaseCell(calendar.inflationRelease, band, 'inflation release'))
}

/**
 * Dates from the current day forward, through `state.day + days`.
 * Day 0 lists days 1 through `days`. An unrolled date has no `roll` and no `outcome`.
 */
export function upcomingCalendar(state: MarketState, days: number): UpcomingCalendarItem[] {
  if (typeof state !== 'object' || state === null) {
    throw new Error(`calendar state must be an object, received ${describeValue(state)}`)
  }
  if (!Number.isSafeInteger(state.day) || state.day < 0) {
    throw new Error(`calendar day must be a safe integer >= 0, received ${describeValue(state.day)}`)
  }
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new Error(`upcoming days must be a safe integer >= 0, received ${describeValue(days)}`)
  }
  if (state.day > Number.MAX_SAFE_INTEGER - days) {
    throw new Error(`upcoming range exceeds the largest safe day, received day=${state.day} days=${days}`)
  }
  const rules = state.calendarRules
  if (typeof rules !== 'object' || rules === null || !Array.isArray(rules.schedule)) {
    throw new Error(`calendar rules must be an object with a schedule, received ${describeValue(rules)}`)
  }
  if (!Array.isArray(state.calendarRolls)) {
    throw new Error(`calendar rolls must be an array, received ${describeValue(state.calendarRolls)}`)
  }
  const start = state.day < 1 ? 1 : state.day
  const end = state.day + days
  const items: UpcomingCalendarItem[] = []
  for (let day = start; day <= end; day += 1) {
    const rule = ruleOnDay(rules, day)
    if (rule === undefined) continue
    const rolled = state.calendarRolls.find((item) => item.day === day && item.kind === rule.kind)
    if (rolled === undefined) {
      items.push({ kind: rule.kind, day })
      continue
    }
    items.push({ kind: rule.kind, day, roll: rolled.roll, outcome: rolled.outcome })
  }
  return items
}

/**
 * If `eventDay` is a calendar date, draw one events-stream float and store the outcome.
 * Call this after the ordinary rolls for the same day. No log line yet: the line is written
 * on the calendar day, with the environment before and after the outcome is applied.
 */
export function rollCalendarForDay(state: MarketState, defs: MarketDefinitions, eventDay: number): void {
  const rule = ruleOnDay(state.calendarRules, eventDay)
  if (rule === undefined) return
  if (defs.calendar === undefined) {
    throw new Error(`calendar ${rule.kind} on day ${eventDay} has no calendar definitions`)
  }
  if (state.calendarRolls.some((item) => item.day === eventDay)) {
    throw new Error(`calendar day ${eventDay} was already rolled`)
  }
  const roll = nextFloat(state.streams.events)
  const outcome = outcomeFor(defs.calendar, state.environment, rule.kind, roll)
  state.calendarRolls.push({
    kind: rule.kind,
    day: eventDay,
    roll,
    outcome,
    applied: false,
  })
}

function requireEntry(state: MarketState, id: string): EnvironmentEntryState {
  const entry = state.environment.find((item) => item.id === id)
  if (entry === undefined) throw new Error(`calendar references missing environment entry ${id}`)
  return entry
}

function viewEnvironment(state: MarketState): EnvironmentView[] {
  return state.environment.map((entry) => ({
    id: entry.id,
    value: entry.value,
    lastReleased: entry.lastReleased === undefined ? null : entry.lastReleased,
  }))
}

function applyOutcome(state: MarketState, calendar: CalendarDefinitions, item: CalendarRoll): void {
  if (item.kind === 'policyDecision') {
    if (item.outcome !== 'hold' && item.outcome !== 'up' && item.outcome !== 'down') {
      throw new Error(`policy outcome must be hold, up, or down, received ${describeValue(item.outcome)}`)
    }
    const entry = requireEntry(state, calendar.policyEntryId)
    if (item.outcome === 'up') entry.value += calendar.rateStep
    else if (item.outcome === 'down') entry.value = Math.max(0, entry.value - calendar.rateStep)
    if (!Number.isFinite(entry.value)) {
      throw new Error(`policy rate became non-finite from outcome ${item.outcome}`)
    }
    return
  }
  if (item.outcome !== 'above' && item.outcome !== 'inline' && item.outcome !== 'below') {
    throw new Error(`release outcome must be above, inline, or below, received ${describeValue(item.outcome)}`)
  }
  const rule = state.calendarRules.schedule.find((entry) => entry.kind === item.kind)
  if (rule === undefined) throw new Error(`calendar ${item.kind} is not on the schedule`)
  const entry = requireEntry(state, rule.entryId)
  entry.lastReleased = entry.value
}

function effectPercent(effects: readonly CalendarEffectCell[], item: CalendarRoll, sector: 'A' | 'B'): number {
  const cell = effects.find((row) => row.kind === item.kind && row.outcome === item.outcome && row.sector === sector)
  if (cell === undefined) {
    throw new Error(`calendar effect ${item.kind}:${item.outcome}:${sector} is missing`)
  }
  return cell.percent
}

function pushCalendarEffect(state: MarketState, defs: MarketDefinitions, item: CalendarRoll): void {
  const calendar = defs.calendar
  if (calendar === undefined) throw new Error(`calendar ${item.kind} on day ${item.day} has no calendar definitions`)
  const parts: ActiveEffect['parts'] = []
  for (const asset of defs.assets) {
    if (asset.kind !== 'stock' || (asset.sector !== 'A' && asset.sector !== 'B')) continue
    const fair = state.assets[asset.id]?.fairValue
    if (typeof fair !== 'number' || !Number.isFinite(fair)) {
      throw new Error(`calendar effect needs a finite fair value for ${asset.id}, received ${describeValue(fair)}`)
    }
    parts.push({
      asset: asset.id,
      totalDelta: (effectPercent(calendar.effects, item, asset.sector) / 100) * fair,
    })
  }
  if (parts.length === 0) throw new Error(`calendar ${item.kind} on day ${item.day} matched no stocks`)
  state.active.push({
    id: `calendar:${item.kind}:${item.day}`,
    typeId: 'calendar',
    target: item.kind,
    eventDay: item.day,
    decay: 'linear',
    duration: 1,
    dayIndex: 0,
    parts,
  })
}

/**
 * Drop rolls from earlier days, apply today's outcome to the environment, and queue its
 * fair-value effect. The effect is clipped later with ordinary effects. Does not draw.
 */
export function beginCalendarDay(state: MarketState, defs: MarketDefinitions): CalendarItemEvent[] {
  for (const item of state.calendarRolls) {
    if (item.day < state.day && !item.applied) {
      throw new Error(`calendar ${item.kind} on day ${item.day} was not applied before day ${state.day}`)
    }
  }
  state.calendarRolls = state.calendarRolls.filter((item) => item.day >= state.day)

  const rule = ruleOnDay(state.calendarRules, state.day)
  if (rule === undefined) return []
  const due = state.calendarRolls.filter((item) => item.day === state.day && item.kind === rule.kind && !item.applied)
  if (due.length !== 1) {
    throw new Error(
      `calendar ${rule.kind} on day ${state.day} expected one unapplied roll, received ${due.length}`,
    )
  }
  const item = due[0]
  if (item === undefined) throw new Error(`calendar ${rule.kind} on day ${state.day} lost its roll`)
  if (defs.calendar === undefined) {
    throw new Error(`calendar ${item.kind} on day ${item.day} has no calendar definitions`)
  }
  const before = viewEnvironment(state)
  applyOutcome(state, defs.calendar, item)
  const after = viewEnvironment(state)
  item.applied = true
  pushCalendarEffect(state, defs, item)
  return [
    {
      kind: 'calendarItem',
      day: state.day,
      item: item.kind,
      roll: item.roll,
      outcome: item.outcome,
      before,
      after,
    },
  ]
}
