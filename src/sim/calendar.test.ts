import { describe, expect, it } from 'vitest'

import {
  lookupPolicyChances,
  policyOutcomeForRoll,
  releaseOutcomeForRoll,
  upcomingCalendar,
} from './calendar.ts'
import { formatEvent } from './log.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { createRng, nextFloat, nextNormal } from './rng.ts'
import type {
  CalendarDefinitions,
  CalendarEffectCell,
  CalendarItemEvent,
  CalendarItemKind,
  CalendarOutcome,
  EnvironmentView,
  LogEvent,
  MarketDefinitions,
  PolicyChanceCell,
  ReleaseChanceCell,
} from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugCalendar(message: string): void {
  io.writeSync(1, `[DEBUG calendar] ${message}\n`)
}

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0 },
  { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0 },
  { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0 },
  { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0 },
]

const BANDS = ['low', 'mid', 'high'] as const

function policyTable(hold: number, up: number, down: number): PolicyChanceCell[] {
  const rows: PolicyChanceCell[] = []
  for (const inflationBand of BANDS) {
    for (const growthBand of BANDS) rows.push({ inflationBand, growthBand, hold, up, down })
  }
  return rows
}

function releaseTable(above: number, inline: number, below: number): ReleaseChanceCell[] {
  return BANDS.map((band) => ({ band, above, inline, below }))
}

function effectRows(policyUpA: number, policyUpB: number): CalendarEffectCell[] {
  const rows: CalendarEffectCell[] = []
  const add = (kind: CalendarItemKind, outcome: CalendarOutcome, sectorA: number, sectorB: number): void => {
    rows.push({ kind, outcome, sector: 'A', percent: sectorA })
    rows.push({ kind, outcome, sector: 'B', percent: sectorB })
  }
  add('policyDecision', 'up', policyUpA, policyUpB)
  add('policyDecision', 'down', 1, 3)
  add('policyDecision', 'hold', 0.25, -0.25)
  for (const kind of ['growthRelease', 'inflationRelease'] as const) {
    add(kind, 'above', 1, 0.4)
    add(kind, 'inline', 0.2, 0.1)
    add(kind, 'below', -1, -0.4)
  }
  return rows
}

function baseCalendar(options?: {
  policyDay?: number
  growthDay?: number
  inflationDay?: number
  policy?: PolicyChanceCell[]
  growthRelease?: ReleaseChanceCell[]
  effects?: CalendarEffectCell[]
  rateStep?: number
}): CalendarDefinitions {
  return {
    daysPerMonth: 30,
    schedule: [
      { kind: 'growthRelease', dayOfMonth: options?.growthDay ?? 10, entryId: 'growth' },
      { kind: 'inflationRelease', dayOfMonth: options?.inflationDay ?? 20, entryId: 'inflation' },
      { kind: 'policyDecision', dayOfMonth: options?.policyDay ?? 25, entryId: 'policyRate' },
    ],
    growthEntryId: 'growth',
    inflationEntryId: 'inflation',
    policyEntryId: 'policyRate',
    inflationLowBelow: 2,
    inflationHighAt: 4,
    growthLowBelow: 1,
    growthHighAt: 3,
    rateStep: options?.rateStep ?? 0.25,
    policy: options?.policy ?? policyTable(0.5, 0.25, 0.25),
    growthRelease: options?.growthRelease ?? releaseTable(0.25, 0.5, 0.25),
    inflationRelease: releaseTable(0.25, 0.5, 0.25),
    effects: options?.effects ?? effectRows(-1.5, -4),
  }
}

function buildMarket(
  calendar: CalendarDefinitions,
  levels?: { growth?: number; inflation?: number; policy?: number; growthDrift?: number },
): MarketDefinitions {
  return {
    assets: ASSETS,
    environment: [
      { id: 'growth', start: levels?.growth ?? 2, driftSpeed: levels?.growthDrift ?? 0 },
      { id: 'inflation', start: levels?.inflation ?? 3, driftSpeed: 0 },
      { id: 'policyRate', start: levels?.policy ?? 4, driftSpeed: 0 },
    ],
    events: [],
    calendar,
  }
}

function requireCalendarItem(log: readonly LogEvent[]): CalendarItemEvent {
  const event = log.find((item) => item.kind === 'calendarItem')
  if (event?.kind !== 'calendarItem') throw new Error('[DEBUG calendar] missing calendarItem')
  return event
}

function envValue(views: readonly EnvironmentView[], id: string): number {
  const entry = views.find((item) => item.id === id)
  if (entry === undefined) throw new Error(`[DEBUG calendar] missing environment ${id}`)
  return entry.value
}

function appliedPercent(log: readonly LogEvent[], asset: string): number {
  const applied = log.find((event) => event.kind === 'effectApplied' && event.asset === asset)
  const fair = log.find((event) => event.kind === 'fairValueChange' && event.asset === asset)
  if (applied?.kind !== 'effectApplied' || fair?.kind !== 'fairValueChange') {
    throw new Error(`[DEBUG calendar] missing fair-value effect for ${asset}`)
  }
  if (fair.before === 0) throw new Error(`[DEBUG calendar] fair value for ${asset} is 0`)
  return applied.delta / fair.before
}

describe('macro calendar', () => {
  it('lists each monthly item on its day and hides outcomes that are not rolled yet', () => {
    const defs = buildMarket(baseCalendar())
    const state = createMarket(defs, 'dates')
    expect(state.calendarRolls).toEqual([])
    expect(state.streams).toEqual(createRng('dates'))
    expect(() => upcomingCalendar(state, -1)).toThrow('upcoming days must be a safe integer >= 0')

    const month = upcomingCalendar(state, 120).map((item) => `${item.kind}:${item.day}`)
    expect(month).toEqual([
      'growthRelease:10',
      'inflationRelease:20',
      'policyDecision:25',
      'growthRelease:40',
      'inflationRelease:50',
      'policyDecision:55',
      'growthRelease:70',
      'inflationRelease:80',
      'policyDecision:85',
      'growthRelease:100',
      'inflationRelease:110',
      'policyDecision:115',
    ])
    for (const item of upcomingCalendar(state, 120)) {
      expect(item).not.toHaveProperty('roll')
      expect(item).not.toHaveProperty('outcome')
    }
    expect(upcomingCalendar(state, 9).some((item) => item.day === 10)).toBe(false)
    expect(upcomingCalendar(state, 10).some((item) => item.day === 10)).toBe(true)
    debugCalendar(`upcoming=${month.join(',')}`)

    const parallel = createRng('dates')
    const seen: CalendarItemEvent[] = []
    for (let day = 1; day <= 120; day += 1) {
      stepMarketDay(state, defs)
      for (const event of state.log) {
        if (event.kind === 'noiseRoll') expect(event.z).toBe(nextNormal(parallel.market))
        if (event.kind === 'calendarItem') {
          seen.push(event)
          debugCalendar(formatEvent(event))
        }
      }
      if (day === 7) {
        const rolled = state.calendarRolls.find((item) => item.day === 10)
        if (rolled === undefined) throw new Error('[DEBUG calendar] day 10 was not rolled on day 7')
        expect(rolled.roll).toBe(nextFloat(parallel.events))
        expect(rolled.applied).toBe(false)
        expect(state.streams.events).toEqual(parallel.events)
        expect(state.log.some((event) => event.kind === 'calendarItem')).toBe(false)
        const soon = upcomingCalendar(state, 120)
        const day10 = soon.find((item) => item.day === 10)
        const day20 = soon.find((item) => item.day === 20)
        expect(day10?.outcome).toBe(rolled.outcome)
        expect(day10?.roll).toBe(rolled.roll)
        expect(day20).not.toHaveProperty('outcome')
        debugCalendar(`day7 rolled day10 outcome=${rolled.outcome} roll=${rolled.roll}`)
      }
    }

    expect(seen.map((item) => `${item.item}:${item.day}`)).toEqual(month)
    expect(state.streams.market).toEqual(parallel.market)
    expect(state.streams.info).toEqual(parallel.info)
    expect(state.streams.distortion).toEqual(parallel.distortion)

    let rate = 4
    for (const item of seen) {
      const beforeRate = envValue(item.before, 'policyRate')
      const afterRate = envValue(item.after, 'policyRate')
      expect(beforeRate).toBe(rate)
      expect(afterRate).toBeGreaterThanOrEqual(0)
      if (item.item === 'policyDecision') {
        if (item.outcome === 'up') rate += 0.25
        else if (item.outcome === 'down') rate = Math.max(0, rate - 0.25)
        else expect(item.outcome).toBe('hold')
        expect(afterRate).toBe(rate)
        expect(item.before.find((entry) => entry.id === 'policyRate')?.lastReleased).toBeNull()
        expect(item.after.find((entry) => entry.id === 'policyRate')?.lastReleased).toBeNull()
        continue
      }
      expect(afterRate).toBe(rate)
      const entryId = item.item === 'growthRelease' ? 'growth' : 'inflation'
      const before = item.before.find((entry) => entry.id === entryId)
      const after = item.after.find((entry) => entry.id === entryId)
      if (before === undefined || after === undefined) throw new Error(`[DEBUG calendar] missing ${entryId}`)
      expect(after.value).toBe(before.value)
      expect(after.lastReleased).toBe(before.value)
    }
    debugCalendar(`calendarItems=${seen.length} policyRate=${rate}`)
  })

  it('uses the policy lookup, so high inflation hikes more often than low inflation', () => {
    const calendar = baseCalendar({
      policy: policyTable(0, 0, 1).map((cell) => {
        const up = cell.inflationBand === 'high' ? 0.7 : cell.inflationBand === 'mid' ? 0.35 : 0.05
        return { ...cell, hold: 1 - up, up, down: 0 }
      }),
    })
    const low = lookupPolicyChances(calendar, 1.9, 2)
    const mid = lookupPolicyChances(calendar, 2, 2)
    const high = lookupPolicyChances(calendar, 4, 2)
    expect(low.up).toBe(0.05)
    expect(mid.up).toBe(0.35)
    expect(high.up).toBe(0.7)
    expect(high.up).toBeGreaterThan(low.up)
    expect(policyOutcomeForRoll(0, { up: 0.2, down: 0.3, hold: 0.5 })).toBe('up')
    expect(policyOutcomeForRoll(0.2, { up: 0.2, down: 0.3, hold: 0.5 })).toBe('down')
    expect(policyOutcomeForRoll(0.5, { up: 0.2, down: 0.3, hold: 0.5 })).toBe('hold')
    expect(releaseOutcomeForRoll(0.3, { above: 0.2, below: 0.3, inline: 0.5 })).toBe('below')
    expect(releaseOutcomeForRoll(0.5, { above: 0.2, below: 0.3, inline: 0.5 })).toBe('inline')
    debugCalendar(`lookup up low=${low.up} mid=${mid.up} high=${high.up}`)

    const hike = buildMarket(baseCalendar({ policyDay: 1, policy: policyTable(0, 1, 0) }), {})
    const rolledUp = createMarket(hike, 'hike')
    expect(rolledUp.calendarRolls.map((item) => item.outcome)).toEqual(['up'])
    const held = buildMarket(baseCalendar({ policyDay: 1, policy: policyTable(1, 0, 0) }))
    expect(createMarket(held, 'hold').calendarRolls.map((item) => item.outcome)).toEqual(['hold'])
    debugCalendar('roll uses lookup up=1 -> up, hold=1 -> hold')
  })

  it('gives a hike a larger negative fair-value effect on sector B than on sector A', () => {
    const defs = buildMarket(baseCalendar({ policyDay: 1, policy: policyTable(0, 1, 0) }))
    const state = createMarket(defs, 'hike')
    stepMarketDay(state, defs)
    const item = requireCalendarItem(state.log)
    expect(item.outcome).toBe('up')
    expect(envValue(item.before, 'policyRate')).toBe(4)
    expect(envValue(item.after, 'policyRate')).toBe(4.25)
    const nova = appliedPercent(state.log, 'NOVA')
    const blsw = appliedPercent(state.log, 'BLSW')
    const hrbu = appliedPercent(state.log, 'HRBU')
    const ksr = appliedPercent(state.log, 'KSR')
    expect(nova).toBeCloseTo(-0.015)
    expect(blsw).toBeCloseTo(-0.015)
    expect(hrbu).toBeCloseTo(-0.04)
    expect(ksr).toBeCloseTo(-0.04)
    expect(hrbu).toBeLessThan(nova)
    expect(ksr).toBeLessThan(blsw)
    const line = formatEvent(item)
    expect(line).toContain('item=policyDecision')
    expect(line).toContain('outcome=up')
    expect(line).toContain('policyRate=4->4.25')
    for (const event of state.log) {
      if (event.kind !== 'effectApplied' && event.kind !== 'fairValueChange') continue
      expect(event.calendar).toBe('policyDecision')
      if (event.kind === 'effectApplied') expect(event.effect).toBe('calendar:policyDecision:1')
      debugCalendar(formatEvent(event))
    }
    debugCalendar(line)
    debugCalendar(`hike percent A=${nova} B=${hrbu}`)
  })

  it('clips a calendar effect at 12 percent and logs the dropped excess', () => {
    const defs = buildMarket(
      baseCalendar({
        policyDay: 1,
        policy: policyTable(0, 1, 0),
        effects: effectRows(-50, -50),
      }),
    )
    const state = createMarket(defs, 'clip')
    stepMarketDay(state, defs)
    const fair = state.log.find((event) => event.kind === 'fairValueChange' && event.asset === 'NOVA')
    if (fair?.kind !== 'fairValueChange') throw new Error('[DEBUG calendar] missing clipped fair value')
    expect(fair.before).toBe(4800)
    expect(fair.total).toBe(-2400)
    expect(fair.clipped).toBe(-576)
    expect(fair.clipped).not.toBe(fair.total)
    expect(fair.after).toBe(4800 - 576)
    expect(fair.calendar).toBe('policyDecision')
    debugCalendar(formatEvent(fair))
  })

  it('floors a rate cut at 0 and leaves a hold unchanged', () => {
    const cutDefs = buildMarket(baseCalendar({ policyDay: 1, policy: policyTable(0, 0, 1) }), { policy: 0.1 })
    const cut = createMarket(cutDefs, 'cut')
    stepMarketDay(cut, cutDefs)
    const cutItem = requireCalendarItem(cut.log)
    expect(cutItem.outcome).toBe('down')
    expect(envValue(cutItem.before, 'policyRate')).toBe(0.1)
    expect(envValue(cutItem.after, 'policyRate')).toBe(0)
    expect(formatEvent(cutItem)).toContain('policyRate=0.1->0')
    debugCalendar(formatEvent(cutItem))

    const holdDefs = buildMarket(baseCalendar({ policyDay: 1, policy: policyTable(1, 0, 0) }))
    const hold = createMarket(holdDefs, 'hold')
    stepMarketDay(hold, holdDefs)
    const holdItem = requireCalendarItem(hold.log)
    expect(holdItem.outcome).toBe('hold')
    expect(envValue(holdItem.after, 'policyRate')).toBe(4)
    debugCalendar(formatEvent(holdItem))
  })

  it('publishes the morning growth value and then lets drift move the hidden value', () => {
    const defs = buildMarket(
      baseCalendar({ growthDay: 1, growthRelease: releaseTable(0, 0, 1) }),
      { growthDrift: 0.01 },
    )
    const parallel = createRng('release').events
    const roll = nextFloat(parallel)
    const state = createMarket(defs, 'release')
    expect(state.calendarRolls.map((item) => item.roll)).toEqual([roll])
    expect(state.calendarRolls[0]?.outcome).toBe('below')
    const shock = nextNormal(parallel)
    stepMarketDay(state, defs)
    expect(state.streams.events).toEqual(parallel)
    const item = requireCalendarItem(state.log)
    const before = item.before.find((entry) => entry.id === 'growth')
    const after = item.after.find((entry) => entry.id === 'growth')
    if (before === undefined || after === undefined) throw new Error('[DEBUG calendar] missing growth')
    expect(before).toEqual({ id: 'growth', value: 2, lastReleased: null })
    expect(after).toEqual({ id: 'growth', value: 2, lastReleased: 2 })
    const growth = state.environment.find((entry) => entry.id === 'growth')
    expect(growth?.lastReleased).toBe(2)
    expect(growth?.value).toBeCloseTo(2 + 0.01 * shock)
    const policy = state.environment.find((entry) => entry.id === 'policyRate')
    expect(policy?.value).toBe(4)
    expect(policy?.lastReleased).toBeUndefined()
    debugCalendar(formatEvent(item))
    debugCalendar(`published=2 hidden=${growth?.value} shock=${shock}`)
  })
})
