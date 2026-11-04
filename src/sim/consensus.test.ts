import { describe, expect, it } from 'vitest'

import { calendarHeadlineText, consensusOutcome, outcomeWord, upcomingCalendar } from './calendar.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { consensusFlow } from './participants.ts'
import type {
  AssetDefinition,
  CalendarDefinitions,
  CalendarEffectCell,
  CalendarOutcome,
  EnvironmentEntryState,
  MarketDefinitions,
  PolicyChanceCell,
  ReleaseChanceCell,
} from './types.ts'

const BANDS = ['low', 'mid', 'high'] as const

// Released growth in the low band expects `below`, in the high band `above`, and mid expects `inline`.
const RELEASE: ReleaseChanceCell[] = [
  { band: 'low', above: 0.1, inline: 0.25, below: 0.65 },
  { band: 'mid', above: 0.25, inline: 0.5, below: 0.25 },
  { band: 'high', above: 0.65, inline: 0.25, below: 0.1 },
]

const POLICY: PolicyChanceCell[] = BANDS.flatMap((inflationBand) =>
  BANDS.map((growthBand): PolicyChanceCell => {
    if (inflationBand === 'high') return { inflationBand, growthBand, hold: 0.2, up: 0.7, down: 0.1 }
    if (inflationBand === 'low') return { inflationBand, growthBand, hold: 0.3, up: 0.05, down: 0.65 }
    return { inflationBand, growthBand, hold: 0.5, up: 0.25, down: 0.25 }
  }),
)

function effects(): CalendarEffectCell[] {
  const rows: CalendarEffectCell[] = []
  for (const sector of ['A', 'B'] as const) {
    for (const outcome of ['hold', 'up', 'down'] as const) {
      rows.push({ kind: 'policyDecision', outcome, sector, percent: outcome === 'up' ? -3 : outcome === 'down' ? 3 : 0 })
    }
    for (const kind of ['growthRelease', 'inflationRelease'] as const) {
      for (const outcome of ['above', 'inline', 'below'] as const) {
        rows.push({ kind, outcome, sector, percent: outcome === 'above' ? 2 : outcome === 'below' ? -2 : 0 })
      }
    }
  }
  return rows
}

const CALENDAR: CalendarDefinitions = {
  daysPerMonth: 30,
  schedule: [
    { kind: 'growthRelease', dayOfMonth: 10, entryId: 'growth' },
    { kind: 'inflationRelease', dayOfMonth: 20, entryId: 'inflation' },
    { kind: 'policyDecision', dayOfMonth: 25, entryId: 'policyRate' },
  ],
  growthEntryId: 'growth',
  inflationEntryId: 'inflation',
  policyEntryId: 'policyRate',
  inflationLowBelow: 2,
  inflationHighAt: 4,
  growthLowBelow: 1,
  growthHighAt: 3,
  rateStep: 0.25,
  policy: POLICY,
  growthRelease: RELEASE,
  inflationRelease: RELEASE,
  effects: effects(),
}

function env(growth: number, inflation: number, released?: { growth?: number; inflation?: number }): EnvironmentEntryState[] {
  return [
    { id: 'growth', value: growth, ...(released?.growth === undefined ? {} : { lastReleased: released.growth }) },
    { id: 'inflation', value: inflation, ...(released?.inflation === undefined ? {} : { lastReleased: released.inflation }) },
    { id: 'policyRate', value: 4 },
  ]
}

describe('calendar consensus', () => {
  it('is the most likely outcome at the band of the last released value, not the hidden one', () => {
    // The hidden growth is high, but the last release printed 0.5 (low band): the crowd expects weak.
    expect(consensusOutcome(CALENDAR, env(3.5, 3, { growth: 0.5 }), 'growthRelease')).toBe('below')
    expect(consensusOutcome(CALENDAR, env(0.5, 3, { growth: 3.5 }), 'growthRelease')).toBe('above')
    expect(consensusOutcome(CALENDAR, env(2, 3), 'growthRelease')).toBe('inline')
    // Before any release the current value is used.
    expect(consensusOutcome(CALENDAR, env(3.5, 3), 'growthRelease')).toBe('above')
  })

  it('expects a hike when released inflation is high and a cut when it is low', () => {
    expect(consensusOutcome(CALENDAR, env(2, 3, { inflation: 4.5 }), 'policyDecision')).toBe('up')
    expect(consensusOutcome(CALENDAR, env(2, 3, { inflation: 1 }), 'policyDecision')).toBe('down')
    expect(consensusOutcome(CALENDAR, env(2, 3, { inflation: 3 }), 'policyDecision')).toBe('hold')
  })

  it('judges a release against the consensus in words', () => {
    expect(calendarHeadlineText('growthRelease', 'inline', 'inline')).toBe('Growth data as expected')
    expect(calendarHeadlineText('growthRelease', 'above', 'inline')).toBe('Growth data stronger than expected')
    expect(calendarHeadlineText('growthRelease', 'inline', 'above')).toBe('Growth data weaker than expected')
    expect(calendarHeadlineText('inflationRelease', 'above', 'inline')).toBe('Inflation data hotter than expected')
    expect(calendarHeadlineText('inflationRelease', 'below', 'above')).toBe('Inflation data cooler than expected')
    expect(calendarHeadlineText('policyDecision', 'up', 'up')).toBe('Policy rate hike, as expected')
    expect(calendarHeadlineText('policyDecision', 'hold', 'up')).toBe('Policy rate hold, not expected')
    expect(outcomeWord('policyDecision', 'down')).toBe('cut')
    expect(outcomeWord('growthRelease', 'inline')).toBe('in line')
  })
})

const NOVA: AssetDefinition = { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.02, spreadPpm: 4000, borrowFeePpm: 300, liquidityNotionalCents: 100_000_000 }
const HRBU: AssetDefinition = { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100, liquidityNotionalCents: 300_000_000 }
const INDEX: AssetDefinition = { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 }

const WITH_CALENDAR: MarketDefinitions = {
  assets: [NOVA, HRBU, INDEX],
  environment: [
    { id: 'growth', start: 2, driftSpeed: 0 },
    { id: 'inflation', start: 3, driftSpeed: 0 },
    { id: 'policyRate', start: 4, driftSpeed: 0 },
  ],
  events: [],
  calendar: CALENDAR,
  participants: {
    depthDays: 10,
    informed: { capitalCents: 1, regimeMin: 1, regimeMax: 1, magnitudeRefPercent: 5 },
    news: { efficiencyMin: 1, efficiencyMax: 1 },
    consensus: { capitalCents: 10_000_000, magnitudeRefPercent: 3 },
    crowd: { capitalCents: 1, heatMin: 1, heatMax: 1, tierWeight: { low: 0.3, medium: 0.6, high: 1 }, headlineWeight: 0.3, chaseDecay: 0.5 },
    momentum: { capitalCents: 1, lookbackDays: 3, thresholdPercent: 3 },
  },
}

describe('consensus in the order flow', () => {
  it('stores the consensus when a release is rolled and shows it from then on', () => {
    const state = createMarket(WITH_CALENDAR, 'expect')
    for (let day = 0; day < 7; day += 1) stepMarketDay(state, WITH_CALENDAR)
    const item = upcomingCalendar(state, 30).find((row) => row.kind === 'growthRelease' && row.day === 10)
    expect(item?.expected).toBeDefined()
    expect(state.calendarRolls.find((row) => row.day === 10)?.expected).toBe(item?.expected)
  })

  it('trades toward the expected effect for the two days before a release, more on the second', () => {
    const state = createMarket(WITH_CALENDAR, 'ramp')
    const expected: CalendarOutcome = 'above'
    state.calendarRolls = [{ kind: 'growthRelease', day: 5, roll: 0.5, outcome: 'inline', expected, applied: false }]
    state.day = 3
    const first = consensusFlow(state, WITH_CALENDAR, NOVA)
    state.day = 4
    const second = consensusFlow(state, WITH_CALENDAR, NOVA)
    if (first === null || second === null) throw new Error('consensus traders should trade ahead of the release')
    expect(first.demandCents).toBeGreaterThan(0)
    expect(second.demandCents / first.demandCents).toBeCloseTo(1.5)
    state.day = 5
    expect(consensusFlow(state, WITH_CALENDAR, NOVA)).toBeNull()
    state.day = 1
    expect(consensusFlow(state, WITH_CALENDAR, NOVA)).toBeNull()
  })

  it('does not trade an expected outcome with no effect, and sells a coming hike', () => {
    const state = createMarket(WITH_CALENDAR, 'flat')
    state.calendarRolls = [{ kind: 'policyDecision', day: 5, roll: 0.5, outcome: 'hold', expected: 'hold', applied: false }]
    state.day = 4
    expect(consensusFlow(state, WITH_CALENDAR, HRBU)).toBeNull()
    state.calendarRolls = [{ kind: 'policyDecision', day: 5, roll: 0.5, outcome: 'hold', expected: 'up', applied: false }]
    expect(consensusFlow(state, WITH_CALENDAR, HRBU)?.demandCents).toBeLessThan(0)
  })
})
