// Tests for the `[sim] mix` report lines (price-model plan, Step P5).

import { describe, expect, it } from 'vitest'
import { dominantTraderType, mixLines, type RunRecord } from './report.ts'

const ranges = {
  value: { mixMin: 0.5, mixMax: 1.5 },
  crowd: { mixMin: 0.3, mixMax: 2.5 },
}

function record(run: number, equity: number, dominant: string | undefined, liq: number, capped: number): RunRecord {
  return {
    run,
    seed: `s-${run}`,
    finalEquityCents: equity,
    liquidations: liq,
    wipeOuts: 0,
    backstopWriteOffCents: 0,
    ...(dominant === undefined ? {} : { dominant, cappedDays: capped }),
  }
}

describe('mix report', () => {
  it('ranks by position inside the range, not by raw weight', () => {
    expect(dominantTraderType({ value: 1.4, crowd: 1.5 }, ranges)).toBe('value')
    expect(dominantTraderType({ value: 0.6, crowd: 1.5 }, ranges)).toBe('crowd')
  })

  it('groups by dominant type with n, median, liquidations and capped days', () => {
    const lines = mixLines(
      [
        record(1, 300_000, 'crowd', 1, 2),
        record(2, 100_000, 'crowd', 0, 4),
        record(3, 200_000, 'crowd', 2, 0),
        record(4, 250_000, 'value', 0, 1),
      ],
      10,
    )
    expect(lines).toEqual([
      '[sim] mix dominant=crowd n=3 medianFinalEquityCents=200000 liquidations=3 cappedDays=6 cappedDayShare=0.200000',
      '[sim] mix dominant=value n=1 medianFinalEquityCents=250000 liquidations=0 cappedDays=1 cappedDayShare=0.100000',
    ])
  })

  it('prints nothing for records without a mix (current model)', () => {
    expect(mixLines([record(1, 300_000, undefined, 0, 0)], 10)).toEqual([])
  })
})
