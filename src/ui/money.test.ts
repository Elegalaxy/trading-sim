import { describe, expect, it } from 'vitest'
import { formatSignedUsd, formatUsd, parseUsdToCents } from './money.ts'

describe('dollars', () => {
  it('formats stored cents as US dollars', () => {
    expect(formatUsd(0, 'zero')).toBe('$0.00')
    expect(formatUsd(1, 'one cent')).toBe('$0.01')
    expect(formatUsd(100, 'one dollar')).toBe('$1.00')
    expect(formatUsd(300_000, 'starting cash')).toBe('$3,000.00')
    expect(formatUsd(-250, 'loss')).toBe('-$2.50')
    expect(formatSignedUsd(250, 'gain')).toBe('+$2.50')
    expect(formatSignedUsd(-250, 'loss')).toBe('-$2.50')
    expect(formatSignedUsd(0, 'flat')).toBe('$0.00')
  })

  it('reads a dollar amount into cents and rejects cents-style extras', () => {
    expect(parseUsdToCents('10', 'Amount')).toEqual({ ok: true, cents: 1_000 })
    expect(parseUsdToCents('10.5', 'Amount')).toEqual({ ok: true, cents: 1_050 })
    expect(parseUsdToCents('$1,000.00', 'Amount')).toEqual({ ok: true, cents: 100_000 })
    expect(parseUsdToCents('0', 'Amount').ok).toBe(false)
    expect(parseUsdToCents('10.505', 'Amount').ok).toBe(false)
    expect(parseUsdToCents('-1', 'Amount').ok).toBe(false)
    const parsed = parseUsdToCents('3.00', 'Amount')
    if (!parsed.ok) throw new Error('3.00 should be 300 cents')
    expect(parsed.cents).toBe(300)
  })
})
