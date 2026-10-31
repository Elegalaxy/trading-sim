// Display candles. The market prints a 15-minute bar for every step of the session
// (src/sim/session.ts), so 15m, 1H and 1D candles are real aggregates of those bars.
// A day's session runs from the previous close to the close the next End day prints.
// 1W groups 7 sessions and 1M groups 30. The session being played is shown only up
// to the clock. A day without bars (a loaded save has no history) gets one candle
// from its two closes and no volume. Volume is the sum of the bars' display volume.

import { SESSION_STEPS } from '../sim/constants.ts'
import { clockTime } from '../sim/session.ts'
import type { SessionBar } from '../sim/types.ts'

export type TimeframeId = '15m' | '1H' | '1D' | '1W' | '1M'

export type Candle = {
  startDay: number
  endDay: number
  /** `HH:MM` the candle starts at. Set for 15m and 1H only. */
  time: string | null
  open: number
  high: number
  low: number
  close: number
  /** Whole shares. Null when the source had no bars. */
  volume: number | null
}

/** One played session. `bars` is cut at the clock for the live day and null when unknown. */
export type DaySource = {
  day: number
  open: number
  close: number
  bars: readonly SessionBar[] | null
}

const GROUP_DAYS: Partial<Record<TimeframeId, number>> = {
  '1W': 7,
  '1M': 30,
}

const BARS_PER_HOUR = 4

function assertPrice(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer, received ${String(value)}`)
  }
}

function merge(bars: readonly SessionBar[], startDay: number, endDay: number, time: string | null): Candle {
  const first = bars[0]
  const last = bars[bars.length - 1]
  if (first === undefined || last === undefined) throw new Error('candle group is empty')
  let high = first.high
  let low = first.low
  let volume = 0
  for (const bar of bars) {
    if (bar.high > high) high = bar.high
    if (bar.low < low) low = bar.low
    volume += bar.volume
  }
  return { startDay, endDay, time, open: first.open, high, low, close: last.close, volume }
}

function dayCandle(source: DaySource): Candle {
  assertPrice(`day ${source.day} open`, source.open)
  assertPrice(`day ${source.day} close`, source.close)
  if (source.bars !== null && source.bars.length > 0) return merge(source.bars, source.day, source.day, null)
  return {
    startDay: source.day,
    endDay: source.day,
    time: null,
    open: source.open,
    high: Math.max(source.open, source.close),
    low: Math.min(source.open, source.close),
    close: source.close,
    volume: null,
  }
}

function groupCandles(daily: readonly Candle[], size: number): Candle[] {
  const grouped: Candle[] = []
  for (let i = 0; i < daily.length; i += size) {
    const slice = daily.slice(i, i + size)
    const first = slice[0]
    const last = slice[slice.length - 1]
    if (first === undefined || last === undefined) throw new Error('candle group is empty')
    let high = first.high
    let low = first.low
    let volume: number | null = null
    for (const bar of slice) {
      if (bar.high > high) high = bar.high
      if (bar.low < low) low = bar.low
      if (bar.volume !== null) volume = (volume ?? 0) + bar.volume
    }
    grouped.push({
      startDay: first.startDay,
      endDay: last.endDay,
      time: null,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    })
  }
  return grouped
}

/** Candles for the selected timeframe, oldest first. */
export function buildCandles(days: readonly DaySource[], timeframe: TimeframeId): Candle[] {
  if (timeframe === '15m' || timeframe === '1H') {
    const per = timeframe === '15m' ? 1 : BARS_PER_HOUR
    const out: Candle[] = []
    for (const source of days) {
      const bars = source.bars
      if (bars === null) continue
      for (let i = 0; i < bars.length; i += per) {
        const slice = bars.slice(i, i + per)
        if (slice.length === 0) continue
        out.push(merge(slice, source.day, source.day, clockTime(Math.min(i, SESSION_STEPS))))
      }
    }
    return out
  }
  const daily = days.map(dayCandle)
  const size = GROUP_DAYS[timeframe]
  return size === undefined ? daily : groupCandles(daily, size)
}

export function candleRangeLabel(candle: Candle): string {
  const days = candle.startDay === candle.endDay ? `Day ${candle.startDay}` : `Day ${candle.startDay}–${candle.endDay}`
  return candle.time === null ? days : `${days} ${candle.time}`
}

/** Volume with thousands separators, or a dash when there is none. */
export function formatVolume(volume: number | null): string {
  if (volume === null) return '—'
  if (!Number.isSafeInteger(volume) || volume < 0) {
    throw new Error(`volume must be a safe integer >= 0, received ${String(volume)}`)
  }
  return String(volume).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
