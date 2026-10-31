// Display candles built from the daily closes the simulation already stores.
// A day has one printed price. Its open is the previous close. Its high and low
// are the ends of that move, so a single day has no wick beyond the body.
// A week is 7 printed days and a month is 30. Those groups can show a wick
// when a day inside the group traded beyond the group's open and close.
// The market does not print volume.

export type TimeframeId = '1D' | '1W' | '1M'

export type Candle = {
  startDay: number
  endDay: number
  open: number
  high: number
  low: number
  close: number
}

const GROUP_DAYS: Record<TimeframeId, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
}

function assertPrice(day: number, priceCents: number, index: number): void {
  if (!Number.isSafeInteger(day) || day < 0) {
    throw new Error(`candle source ${index} day must be a safe integer >= 0, received ${String(day)}`)
  }
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
    throw new Error(`candle source ${index} price must be a positive safe integer, received ${String(priceCents)}`)
  }
}

/** One candle per printed day, then grouped for the selected timeframe. */
export function buildCandles(
  points: readonly { day: number; priceCents: number }[],
  timeframe: TimeframeId,
): Candle[] {
  const daily: Candle[] = []
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]
    if (point === undefined) throw new Error(`candle source ${i} is missing`)
    assertPrice(point.day, point.priceCents, i)
    const previous = i === 0 ? point.priceCents : points[i - 1]?.priceCents
    if (previous === undefined) throw new Error(`candle source ${i - 1} is missing`)
    const open = previous
    const close = point.priceCents
    daily.push({
      startDay: point.day,
      endDay: point.day,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
    })
  }

  const size = GROUP_DAYS[timeframe]
  if (size === 1) return daily

  const grouped: Candle[] = []
  for (let i = 0; i < daily.length; i += size) {
    const slice = daily.slice(i, i + size)
    const first = slice[0]
    const last = slice[slice.length - 1]
    if (first === undefined || last === undefined) throw new Error('candle group is empty')
    let high = first.high
    let low = first.low
    for (const bar of slice) {
      if (bar.high > high) high = bar.high
      if (bar.low < low) low = bar.low
    }
    grouped.push({
      startDay: first.startDay,
      endDay: last.endDay,
      open: first.open,
      high,
      low,
      close: last.close,
    })
  }
  return grouped
}

export function candleRangeLabel(candle: Candle): string {
  if (candle.startDay === candle.endDay) return `Day ${candle.startDay}`
  return `Day ${candle.startDay}–${candle.endDay}`
}
