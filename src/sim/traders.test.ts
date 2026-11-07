import { describe, expect, it } from 'vitest'

import { createMarket } from './market.ts'
import { assertTraderDefinitions, createTraderBook } from './traders.ts'
import { TRADER_TYPES, type MarketDefinitions, type TraderDefinitions } from './types.ts'

// Small inline definitions: src/sim may not import content.

const TRADERS: TraderDefinitions = {
  types: {
    value: { base: 2, mixMin: 0.5, mixMax: 1.5, rate: 0.5 },
    noise: { base: 1, mixMin: 0.5, mixMax: 1.5, rate: 1 },
    informed: { base: 1, mixMin: 0.5, mixMax: 1.5, rate: 0.7 },
    news: { base: 1, mixMin: 0.5, mixMax: 1.5, rate: 1 },
    consensus: { base: 1, mixMin: 0.5, mixMax: 1.5, rate: 0.7 },
    crowd: { base: 1, mixMin: 0.3, mixMax: 2.5, rate: 0.6 },
    trend: { base: 1, mixMin: 0.5, mixMax: 1.5, rate: 0.5 },
    contrarian: { base: 1, mixMin: 0.5, mixMax: 1.5, rate: 0.5 },
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

const DEFS: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022 },
    { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
  traders: TRADERS,
}

const baseSum = TRADER_TYPES.reduce((sum, type) => sum + TRADERS.types[type].base, 0)

function book(seed: string) {
  return createTraderBook(DEFS, seed, createMarket(DEFS, seed))
}

describe('createTraderBook', () => {
  it('gives the same mix for the same seed and a different one for another seed', () => {
    expect(book('abc')).toEqual(book('abc'))
    expect(book('abd').mix).not.toEqual(book('abc').mix)
    expect(book('abd').efficiency).not.toBe(book('abc').efficiency)
  })

  it('keeps every mix in range with a constant weighted sum', () => {
    for (let i = 0; i < 100; i += 1) {
      const made = book(`s${i}`)
      let sum = 0
      for (const type of TRADER_TYPES) {
        const row = TRADERS.types[type]
        expect(made.mix[type]).toBeGreaterThanOrEqual(row.mixMin)
        expect(made.mix[type]).toBeLessThanOrEqual(row.mixMax)
        sum += row.base * made.mix[type]
      }
      expect(sum).toBeCloseTo(baseSum, 9)
      expect(made.efficiency).toBeGreaterThanOrEqual(0.5)
      expect(made.efficiency).toBeLessThanOrEqual(1.3)
    }
  })

  it('starts stocks only, with carry 1 and empty positions', () => {
    const made = book('abc')
    expect(Object.keys(made.pos)).toEqual(['NOVA', 'HRBU'])
    expect(made.carry).toEqual({ NOVA: 1, HRBU: 1 })
    expect(made.eventPos).toEqual({})
    expect(made.vol).toEqual({ NOVA: 0, HRBU: 0 })
  })

  it('throws without traders or with unreachable mix ranges', () => {
    expect(() => createTraderBook({ ...DEFS, traders: undefined }, 'abc', createMarket(DEFS, 'abc'))).toThrow('[DEBUG traders]')
    const high = {
      ...TRADERS,
      types: Object.fromEntries(TRADER_TYPES.map((type) => [type, { ...TRADERS.types[type], mixMin: 1.2, mixMax: 1.5 }])) as TraderDefinitions['types'],
    }
    expect(() => assertTraderDefinitions(high)).toThrow('[DEBUG traders]')
  })
})
