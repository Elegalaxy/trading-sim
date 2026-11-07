import { describe, expect, it } from 'vitest'

import { stateHash } from './hash.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { eventTypeMap } from './traders.ts'
import type {
  EventTypeDefinition,
  MarketDefinitions,
  MarketState,
  ParticipantDefinitions,
  ParticipantFlowEvent,
  ScheduledEvent,
  TraderDefinitions,
} from './types.ts'

// Information traders (price-model plan, Step P3). Inline definitions: src/sim may not import content.
// Events are put on the schedule by hand, so each test controls the true size, the leak and the day.
// A control market with the same seed and no event shares every noise draw, so the difference between
// the two prices is the event's effect alone.

const PARTICIPANTS: ParticipantDefinitions = {
  depthDays: 10,
  informed: { capitalCents: 15_000_000, regimeMin: 1, regimeMax: 1, magnitudeRefPercent: 5 },
  news: { efficiencyMin: 0.5, efficiencyMax: 0.5 },
  consensus: { capitalCents: 1, magnitudeRefPercent: 3 },
  crowd: { capitalCents: 1, heatMin: 1, heatMax: 1, tierWeight: { low: 0.3, medium: 0.6, high: 1 }, headlineWeight: 0.5, chaseDecay: 0.5 },
  momentum: { capitalCents: 1, lookbackDays: 3, thresholdPercent: 3 },
}

const row = (base: number, rate: number) => ({ base, mixMin: 0.5, mixMax: 1.5, rate })

const TRADERS: TraderDefinitions = {
  types: {
    value: row(0.1, 0.5),
    noise: row(0.03, 1),
    informed: row(0.03, 0.7),
    news: row(0.03, 1),
    consensus: row(0.03, 0.7),
    crowd: row(0.03, 0.6),
    trend: row(0.015, 0.5),
    contrarian: row(0.015, 0.5),
  },
  efficiencyMin: 0.5,
  efficiencyMax: 1.3,
  premiumPerDay: 0.0002,
  anchorHalfLifeDays: 3,
  valueDeadBand: 0.01,
  valueFullGap: 0.1,
  valueDeepGap: 0.2,
  valueDeepSlope: 3,
  valueMaxMultiple: 3,
  noiseAr: 0.7,
  noiseShare: 0.5,
  informedMagnitudeRefPercent: 5,
  informedHoldDays: 1,
  informedDecayDays: 3,
  newsHoldDays: 3,
  newsDecayDays: 3,
  consensusRampDays: 2,
  consensusDecayDays: 4,
  crowdReturnDays: 5,
  crowdDrawdownDays: 10,
  crowdReturnScale: 0.05,
  crowdCapitulation: -0.08,
  crowdMoodClamp: 1.5,
  trendDays: 5,
  trendScale: 0.04,
  contrarianThreshold: 0.04,
  contrarianScale: 0.04,
  contrarianMoodWeight: 0.3,
  contrarianFlowWeight: 0.5,
  contrarianFlowScale: 0.02,
  volEwma: 0.1,
  volSens: 1,
  depthScaleMin: 0.4,
}

// A stock event that never rolls on its own (chance 0); its average size is 5%.
const NEWS_TYPE: EventTypeDefinition = {
  id: 'bigNews',
  scope: 'stock',
  targets: ['NOVA'],
  chance: 0,
  direction: { up: 0.5, down: 0.5, none: 0 },
  magnitudeMin: 4,
  magnitudeMax: 6,
  duration: 1,
  decay: 'linear',
  headline: '{target} news {direction} {magnitude}',
  leak: 0.5,
  modifiers: [],
}

const DEFS: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300, liquidityNotionalCents: 100_000_000 },
    { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100, liquidityNotionalCents: 100_000_000 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [NEWS_TYPE],
  participants: PARTICIPANTS,
  traders: TRADERS,
}

function event(day: number, direction: 'up' | 'down', magnitudePercent: number): ScheduledEvent {
  return {
    id: `bigNews:NOVA:${day}`,
    typeId: 'bigNews',
    target: 'NOVA',
    eventDay: day,
    direction,
    magnitudePercent,
    duration: 1,
    decay: 'linear',
    headline: 'x',
  }
}

/** A market at day 0 with the event on the schedule (and known to informed money when `leaked`), and a control without it. */
function pair(seed: string, scheduled: ScheduledEvent, leaked = false): { test: MarketState; control: MarketState } {
  const test = createMarket(DEFS, seed)
  const control = createMarket(DEFS, seed)
  test.scheduled.push(scheduled)
  if (leaked) test.participants!.leaked.push(scheduled.id)
  return { test, control }
}

/** The event's price effect, in fraction of the control price, after each day up to `days`. */
function effectByDay(seed: string, scheduled: ScheduledEvent, days: number, leaked = false): number[] {
  const { test, control } = pair(seed, scheduled, leaked)
  const out: number[] = []
  for (let day = 1; day <= days; day += 1) {
    stepMarketDay(test, DEFS)
    stepMarketDay(control, DEFS)
    out.push(test.assets.NOVA.priceCents / control.assets.NOVA.priceCents - 1)
  }
  return out
}

function flows(state: MarketState, party: ParticipantFlowEvent['party'], asset: string): ParticipantFlowEvent[] {
  return state.log.filter((item): item is ParticipantFlowEvent => item.kind === 'participantFlow' && item.party === party && item.asset === asset)
}

const SEEDS = ['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7']
const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length

describe('event type map', () => {
  it('is built once per definitions and finds the type by id', () => {
    expect(eventTypeMap(DEFS)).toBe(eventTypeMap(DEFS))
    expect(eventTypeMap(DEFS).get('bigNews')).toBe(NEWS_TYPE)
    expect(eventTypeMap({ ...DEFS })).not.toBe(eventTypeMap(DEFS))
  })
})

describe('news traders', () => {
  it('react to an unrumoured event by about the efficiency times the public impact on its day', () => {
    for (const seed of SEEDS) {
      const efficiency = createMarket(DEFS, seed).participants!.book!.efficiency
      const effect = effectByDay(seed, event(5, 'up', 5), 5)
      // Nothing happens before the day; the news traders buy e x 5% on it (value traders add little).
      for (const before of effect.slice(0, 4)) expect(before).toBe(0)
      expect(effect[4]).toBeGreaterThan(efficiency * 0.05 - 0.008)
      expect(effect[4]).toBeLessThan(efficiency * 0.05 + 0.012)
    }
  })

  it('book a position per (event, stock, type) and clear it when it has unwound', () => {
    const { test } = pair('keys', event(3, 'up', 5))
    for (let day = 1; day <= 3; day += 1) stepMarketDay(test, DEFS)
    const keys = Object.keys(test.participants!.book!.eventPos).sort()
    expect(keys).toEqual(['bigNews:NOVA:3|NOVA|news', 'bigNews:NOVA:3|NOVA|news|target'])
    expect(flows(test, 'news', 'NOVA')).toHaveLength(1)
    for (let day = 4; day <= 25; day += 1) stepMarketDay(test, DEFS)
    expect(Object.keys(test.participants!.book!.eventPos)).toEqual([])
  })

  it('keep a move when the true size is above the average and give part of it back when it is below', () => {
    const small: number[] = []
    const average: number[] = []
    const large: number[] = []
    for (const seed of SEEDS) {
      const a = effectByDay(seed, event(5, 'up', 1), 10)
      const b = effectByDay(seed, event(5, 'up', 5), 10)
      const c = effectByDay(seed, event(5, 'up', 11), 10)
      small.push(a[9] - a[4])
      average.push(b[9] - b[4])
      large.push(c[9] - c[4])
    }
    // Day 5 is the event day, day 10 five days later: the change from the first to the second.
    expect(mean(small)).toBeLessThan(-0.01)
    expect(mean(large)).toBeGreaterThan(0.01)
    expect(mean(small)).toBeLessThan(mean(average))
    expect(mean(average)).toBeLessThan(mean(large))
  })

  it('do not simply revert to zero: an average-size event still holds most of its move five days on', () => {
    const day0: number[] = []
    const day5: number[] = []
    for (const seed of SEEDS) {
      const effect = effectByDay(seed, event(5, 'up', 5), 10)
      day0.push(effect[4])
      day5.push(effect[9])
    }
    expect(mean(day5)).toBeGreaterThan(0.5 * mean(day0))
  })
})

describe('informed traders', () => {
  it('buy ahead of a leaked up event, hold, then wind down', () => {
    const effect = effectByDay('leak', event(6, 'up', 5), 20, true)
    // Day 3 is three days before the event (the first step after the leak is known).
    expect(effect[3]).toBeGreaterThan(0.01)
    expect(effect[4]).toBeGreaterThan(effect[3] - 0.002)
    const { test } = pair('leak', event(6, 'up', 5), true)
    for (let day = 1; day <= 5; day += 1) stepMarketDay(test, DEFS)
    const informed = flows(test, 'informed', 'NOVA')
    expect(informed).toHaveLength(1)
    expect(informed[0].events).toEqual(['bigNews:NOVA:6'])
    expect(informed[0].demandCents).toBeGreaterThan(0)
  })

  it('take the price down ahead of a leaked down event and leave no position behind', () => {
    const effect = effectByDay('leak-down', event(6, 'down', 5), 5, true)
    expect(effect[4]).toBeLessThan(-0.01)
    const { test } = pair('leak-down', event(6, 'down', 5), true)
    for (let day = 1; day <= 30; day += 1) stepMarketDay(test, DEFS)
    expect(Object.keys(test.participants!.book!.eventPos)).toEqual([])
  })

  it('leave less for the news traders to buy on the day', () => {
    const quiet = pair('priced', event(6, 'up', 5), false).test
    const leaked = pair('priced', event(6, 'up', 5), true).test
    for (let day = 1; day <= 6; day += 1) {
      stepMarketDay(quiet, DEFS)
      stepMarketDay(leaked, DEFS)
    }
    const quietNews = flows(quiet, 'news', 'NOVA')[0].demandCents
    const leakedNews = flows(leaked, 'news', 'NOVA')[0].demandCents
    expect(leakedNews).toBeLessThan(quietNews)
  })
})

describe('information traders are deterministic', () => {
  it('give the same hash for the same seed and events, and another for a different event', () => {
    const run = (size: number): string => {
      const { test } = pair('det', event(5, 'up', size), true)
      for (let day = 1; day <= 30; day += 1) stepMarketDay(test, DEFS)
      return stateHash(test)
    }
    expect(run(5)).toBe(run(5))
    expect(run(5)).not.toBe(run(8))
  })

  it('give the same result from a cloned market (the session preview path)', () => {
    const { test } = pair('clone', event(5, 'up', 5), true)
    for (let day = 1; day <= 3; day += 1) stepMarketDay(test, DEFS)
    const copy = structuredClone(test)
    stepMarketDay(test, DEFS)
    stepMarketDay(copy, DEFS)
    expect(stateHash(copy)).toBe(stateHash(test))
  })
})
