import { describe, expect, it } from 'vitest'
import { liquidationPrice, sharesForAmount } from './sizing.ts'

describe('order sizing', () => {
  it('turns a value into whole shares', () => {
    expect(sharesForAmount('value', 100_000, 1, 4_800)).toBe(20)
  })

  it('multiplies cost by leverage first', () => {
    expect(sharesForAmount('cost', 100_000, 5, 4_800)).toBe(104)
    expect(sharesForAmount('cost', 100_000, 1, 4_800)).toBe(20)
  })

  it('gives zero shares when the amount is under one share', () => {
    expect(sharesForAmount('value', 1_000, 1, 4_800)).toBe(0)
  })

  it('rejects bad input', () => {
    expect(() => sharesForAmount('value', 0, 1, 100)).toThrow()
    expect(() => sharesForAmount('cost', 100, 0, 100)).toThrow()
    expect(() => sharesForAmount('value', 100, 1, 0)).toThrow()
  })

  it('finds a long liquidation price below the quote', () => {
    // equity $1,000, one long of 100 shares at $50 (gross $5,000): 5x.
    const liq = liquidationPrice(100_000, 500_000, 100, 5_000)
    // equity(P) = 100_000 + 100*(P-5000); liquidated at 10% of gross 100*P.
    expect(liq).toBe(4_444)
    expect(liq!).toBeLessThan(5_000)
  })

  it('finds a short liquidation price above the quote', () => {
    const liq = liquidationPrice(100_000, 500_000, -100, 5_000)
    expect(liq!).toBeGreaterThan(5_000)
  })

  it('has none when flat', () => {
    expect(liquidationPrice(100_000, 0, 0, 5_000)).toBeNull()
  })
})
