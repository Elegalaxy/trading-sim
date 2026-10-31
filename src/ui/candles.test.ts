import { describe, expect, it } from 'vitest'
import { buildCandles, candleRangeLabel } from './candles.ts'

describe('display candles', () => {
  it('uses the previous close as the open and keeps a day inside its body', () => {
    const bars = buildCandles(
      [
        { day: 1, priceCents: 100 },
        { day: 2, priceCents: 110 },
      ],
      '1D',
    )
    expect(bars[0]).toEqual({ startDay: 1, endDay: 1, open: 100, high: 100, low: 100, close: 100 })
    expect(bars[1]).toEqual({ startDay: 2, endDay: 2, open: 100, high: 110, low: 100, close: 110 })
  })

  it('gives a grouped candle a wick when a day inside it passed the open and close', () => {
    const bars = buildCandles(
      [
        { day: 1, priceCents: 100 },
        { day: 2, priceCents: 80 },
        { day: 3, priceCents: 120 },
      ],
      '1W',
    )
    expect(bars).toHaveLength(1)
    expect(bars[0]).toEqual({ startDay: 1, endDay: 3, open: 100, high: 120, low: 80, close: 120 })
    expect(candleRangeLabel(bars[0]!)).toBe('Day 1–3')
  })
})
