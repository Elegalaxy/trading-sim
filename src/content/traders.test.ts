import { describe, expect, it } from 'vitest'

import { MARKET_DEFINITIONS } from './index.ts'
import { TRADER_DEFINITIONS } from './traders.ts'
import { createMarket } from '../sim/market.ts'
import { assertTraderDefinitions, createTraderBook } from '../sim/traders.ts'
import { TRADER_TYPES } from '../sim/types.ts'
import type { MarketDefinitions } from '../sim/types.ts'

// The placeholder trader numbers, checked against the real assets. Not wired into the market yet.

const defs: MarketDefinitions = { ...MARKET_DEFINITIONS, traders: TRADER_DEFINITIONS }
const baseSum = TRADER_TYPES.reduce((sum, type) => sum + TRADER_DEFINITIONS.types[type].base, 0)

function weightSum(seed: string): number {
  const book = createTraderBook(defs, seed, createMarket(defs, seed))
  return TRADER_TYPES.reduce((sum, type) => sum + TRADER_DEFINITIONS.types[type].base * book.mix[type], 0)
}

describe('trader content', () => {
  it('passes the definitions check and is wired into the market', () => {
    expect(() => assertTraderDefinitions(TRADER_DEFINITIONS)).not.toThrow()
    expect(MARKET_DEFINITIONS.traders).toBe(TRADER_DEFINITIONS)
    expect(TRADER_DEFINITIONS.types.crowd.mixMin).toBe(0.3)
    expect(TRADER_DEFINITIONS.types.crowd.mixMax).toBe(2.5)
  })

  it('draws the same book for the same seed and a different one for another', () => {
    const a = createTraderBook(defs, 'abc', createMarket(defs, 'abc'))
    const b = createTraderBook(defs, 'abc', createMarket(defs, 'abc'))
    const c = createTraderBook(defs, 'abd', createMarket(defs, 'abd'))
    expect(b).toEqual(a)
    expect(c.mix).not.toEqual(a.mix)
    expect(c.efficiency).not.toBe(a.efficiency)
  })

  it('keeps every mix in range and the weighted sum constant across seeds', () => {
    for (let i = 0; i < 200; i += 1) {
      const seed = `mix-${i}`
      const book = createTraderBook(defs, seed, createMarket(defs, seed))
      for (const type of TRADER_TYPES) {
        const row = TRADER_DEFINITIONS.types[type]
        expect(book.mix[type]).toBeGreaterThanOrEqual(row.mixMin)
        expect(book.mix[type]).toBeLessThanOrEqual(row.mixMax)
      }
      expect(book.efficiency).toBeGreaterThanOrEqual(TRADER_DEFINITIONS.efficiencyMin)
      expect(book.efficiency).toBeLessThanOrEqual(TRADER_DEFINITIONS.efficiencyMax)
      expect(weightSum(seed)).toBeCloseTo(baseSum, 9)
    }
  })

  it('starts stocks with carry 1, the anchor at fair value, and empty positions', () => {
    const market = createMarket(defs, 'abc')
    const book = createTraderBook(defs, 'abc', market)
    const stocks = defs.assets.filter((asset) => asset.kind === 'stock')
    expect(Object.keys(book.carry)).toEqual(stocks.map((asset) => asset.id))
    expect(book.carry.NOVA).toBe(1)
    expect(book.seenAnchor.NOVA).toBe(market.assets.NOVA!.fairValue)
    expect(Object.values(book.pos.NOVA!)).toEqual(TRADER_TYPES.map(() => 0))
    expect(book.eventPos).toEqual({})
    expect(book.activeFromDay).toBe(market.day)
    expect(book.pos).not.toHaveProperty('M4X')
  })

  it('does not touch the market streams or its hash', () => {
    const market = createMarket(defs, 'abc')
    const before = JSON.stringify(market)
    createTraderBook(defs, 'abc', market)
    expect(JSON.stringify(market)).toBe(before)
  })

  it('rejects definitions whose mix ranges cannot reach the constant weight', () => {
    const bad = { ...TRADER_DEFINITIONS, types: { ...TRADER_DEFINITIONS.types, value: { ...TRADER_DEFINITIONS.types.value, mixMin: 1.2, mixMax: 1.5 } } }
    // Value is 3 of 8 base weight, so raising its floor alone is still reachable; push every floor up.
    const worse = {
      ...TRADER_DEFINITIONS,
      types: Object.fromEntries(TRADER_TYPES.map((type) => [type, { ...TRADER_DEFINITIONS.types[type], mixMin: 1.1, mixMax: 1.5 }])) as typeof TRADER_DEFINITIONS.types,
    }
    expect(() => assertTraderDefinitions(bad)).not.toThrow()
    expect(() => assertTraderDefinitions(worse)).toThrow('[DEBUG traders]')
  })
})
