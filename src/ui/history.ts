// Backfilled price history shown before day 0, so a new run opens on a chart that has a
// past. It is display only: made from the run seed and the asset's own start price and
// volatility, walked backwards so the last close is exactly the start price. It never
// enters the game state, the market streams or any hash.

import { SESSION_STEPS } from '../sim/constants.ts'
import { createRng, nextFloat, nextNormal } from '../sim/rng.ts'
import type { SessionBar } from '../sim/types.ts'
import type { DaySource } from './candles.ts'

export const HISTORY_DAYS = 60

/** Share of the daily volatility used as the size of the made-up intraday moves. */
const INTRADAY_SHARE = 0.5

function whole(value: number): number {
  return Math.max(1, Math.round(value))
}

/** Sessions for days -HISTORY_DAYS .. -1, oldest first. The last one closes at `startCents`. */
export function buildHistory(seed: string, asset: string, startCents: number, dailyVolatility: number): DaySource[] {
  if (!Number.isSafeInteger(startCents) || startCents <= 0) {
    throw new Error(`history start price must be a positive safe integer, received ${String(startCents)}`)
  }
  if (!Number.isFinite(dailyVolatility) || dailyVolatility < 0) {
    throw new Error(`history volatility must be finite and >= 0, received ${String(dailyVolatility)}`)
  }
  const stream = createRng(`${seed}:history:${asset}`).market
  const closes: number[] = new Array<number>(HISTORY_DAYS + 1)
  closes[HISTORY_DAYS] = startCents
  for (let i = HISTORY_DAYS; i > 0; i -= 1) {
    const ret = Math.max(-0.5, Math.min(0.5, dailyVolatility * nextNormal(stream)))
    closes[i - 1] = whole((closes[i] ?? startCents) / (1 + ret))
  }
  const stepSd = (dailyVolatility * INTRADAY_SHARE) / Math.sqrt(SESSION_STEPS)
  const days: DaySource[] = []
  for (let i = 0; i < HISTORY_DAYS; i += 1) {
    const open = closes[i] ?? startCents
    const close = closes[i + 1] ?? startCents
    const bars: SessionBar[] = []
    let last = open
    for (let step = 1; step <= SESSION_STEPS; step += 1) {
      // A bridge from the open to the close, with noise that fades out toward the close.
      const left = SESSION_STEPS - step
      const target = left === 0 ? close : whole(last + (close - last) / (left + 1) + last * stepSd * nextNormal(stream) * (left / SESSION_STEPS))
      const wick = Math.abs(nextNormal(stream)) * stepSd * last * 0.5
      bars.push({
        open: last,
        high: whole(Math.max(last, target) + wick),
        low: whole(Math.max(1, Math.min(last, target) - wick)),
        close: target,
        volume: Math.round(800 + nextFloat(stream) * 1200),
      })
      last = target
    }
    days.push({ day: i - HISTORY_DAYS, open, close, bars })
  }
  return days
}
