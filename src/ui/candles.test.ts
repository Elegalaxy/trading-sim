import { describe, expect, it } from 'vitest'
import type { SessionBar } from '../sim/types.ts'
import { buildCandles, candleRangeLabel, formatVolume, type DaySource } from './candles.ts'

function bars(first: number, closes: number[]): SessionBar[] {
  const out: SessionBar[] = []
  let open = first
  for (const close of closes) {
    out.push({ open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 100 })
    open = close
  }
  return out
}

describe('display candles', () => {
  const day1: DaySource = { day: 1, open: 100, close: 108, bars: bars(100, [101, 102, 103, 104, 105, 106, 107, 108]) }
  const day2: DaySource = { day: 2, open: 108, close: 104, bars: bars(108, [107, 106, 105, 104, 105, 106, 105, 104]) }

  it('builds one 15m candle per bar', () => {
    const out = buildCandles([day1], '15m')
    expect(out).toHaveLength(8)
    expect(out[0]).toMatchObject({ open: 100, close: 101, time: '17:00', volume: 100 })
    expect(out[7]).toMatchObject({ close: 108, time: '18:45' })
    expect(candleRangeLabel(out[1]!)).toBe('Day 1 17:15')
  })

  it('groups four bars into an hour', () => {
    const out = buildCandles([day1], '1H')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ open: 100, close: 104, high: 105, low: 99, volume: 400, time: '17:00' })
    expect(out[1]).toMatchObject({ open: 104, close: 108, time: '18:00' })
  })

  it('builds a daily candle from its bars, with a wick and volume', () => {
    const [candle] = buildCandles([day1], '1D')
    expect(candle).toEqual({ startDay: 1, endDay: 1, time: null, open: 100, high: 109, low: 99, close: 108, volume: 800 })
  })

  it('falls back to the two closes when a day has no bars', () => {
    const [candle] = buildCandles([{ day: 3, open: 100, close: 110, bars: null }], '1D')
    expect(candle).toEqual({ startDay: 3, endDay: 3, time: null, open: 100, high: 110, low: 100, close: 110, volume: null })
    expect(buildCandles([{ day: 3, open: 100, close: 110, bars: null }], '15m')).toEqual([])
  })

  it('groups days into a week with a wick and summed volume', () => {
    const [week] = buildCandles([day1, day2], '1W')
    expect(week).toMatchObject({ startDay: 1, endDay: 2, open: 100, close: 104, high: 109, low: 99, volume: 1600 })
    expect(candleRangeLabel(week!)).toBe('Day 1–2')
  })

  it('shows a live day only up to the clock', () => {
    const live: DaySource = { day: 5, open: 100, close: 103, bars: day1.bars!.slice(0, 3) }
    const out = buildCandles([live], '15m')
    expect(out).toHaveLength(3)
    expect(buildCandles([live], '1D')[0]).toMatchObject({ open: 100, close: 103, volume: 300 })
  })

  it('formats volume', () => {
    expect(formatVolume(1234567)).toBe('1,234,567')
    expect(formatVolume(null)).toBe('—')
  })
})
