// End-of-day summary. Pure: it reads the day log and does not draw.
// It lists events and calendar items that fired, and each asset's percent price move.
// Fair value, the gap, and hidden rolls are left out.

import type { CalendarItemKind, CalendarOutcome, LogEvent } from './types.ts'

export type DaySummary = {
  day: number
  /** Effect ids for ordinary events that started today. */
  events: string[]
  calendar: { item: CalendarItemKind; outcome: CalendarOutcome }[]
  moves: { asset: string; percent: number }[]
}

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

function assertDay(day: number): void {
  if (!Number.isSafeInteger(day) || day < 0) {
    throw new Error(`day summary day must be a safe integer >= 0, received ${describeValue(day)}`)
  }
}

function percentMove(previous: number, next: number, asset: string): number {
  if (typeof previous !== 'number' || !Number.isFinite(previous) || previous <= 0) {
    throw new Error(`day summary ${asset} previous price must be a finite number > 0, received ${describeValue(previous)}`)
  }
  if (typeof next !== 'number' || !Number.isFinite(next)) {
    throw new Error(`day summary ${asset} new price must be a finite number, received ${describeValue(next)}`)
  }
  return ((next - previous) / previous) * 100
}

function formatSigned(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`day summary percent must be a finite number, received ${describeValue(value)}`)
  }
  if (value === 0) return '0'
  const negative = value < 0
  const abs = Math.abs(value)
  const body = Number.isSafeInteger(abs)
    ? String(abs)
    : abs.toFixed(8).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return negative ? `-${body}` : `+${body}`
}

/**
 * One day's public summary. Ordinary events are effect ids that started today.
 * Continuing effect slices and calendar effect ids are not listed again.
 * Price percents come from the published prices only.
 */
export function daySummary(dayLog: readonly LogEvent[]): DaySummary {
  if (!Array.isArray(dayLog)) {
    throw new Error(`day summary log must be an array, received ${describeValue(dayLog)}`)
  }
  // Array.isArray's type guard is `any[]`, which would erase LogEvent. Put the type back.
  const log: readonly LogEvent[] = dayLog
  let day = 0
  let sawDay = false
  const events: string[] = []
  const seen = new Set<string>()
  const calendar: DaySummary['calendar'] = []
  const moves: DaySummary['moves'] = []

  for (const event of log) {
    if (!sawDay) {
      assertDay(event.day)
      day = event.day
      sawDay = true
    } else if (event.day !== day) {
      throw new Error(`day summary log mixes day ${day} and day ${event.day}`)
    }
    switch (event.kind) {
      case 'effectApplied':
        if (event.dayIndex !== 0 || event.effect.startsWith('calendar:')) break
        if (!seen.has(event.effect)) {
          seen.add(event.effect)
          events.push(event.effect)
        }
        break
      case 'calendarItem':
        calendar.push({ item: event.item, outcome: event.outcome })
        break
      case 'priceStep':
      case 'indexStep':
        moves.push({
          asset: event.asset,
          percent: percentMove(event.previous, event.newPrice, event.asset),
        })
        break
      case 'headline':
      case 'rumourGenerated':
      case 'noiseRoll':
      case 'fairValueChange':
      case 'envDrift':
      case 'eventRoll':
      case 'eventDirection':
      case 'eventMagnitude':
        break
      default: {
        const leftover: never = event
        throw new Error(`day summary cannot read ${describeValue(leftover)}`)
      }
    }
  }

  return { day, events, calendar, moves }
}

/** One line for the harness. Percents are signed. Hidden fields are not printed. */
export function formatSummary(summary: DaySummary): string {
  if (typeof summary !== 'object' || summary === null) {
    throw new Error(`formatSummary expected an object, received ${describeValue(summary)}`)
  }
  assertDay(summary.day)
  const events = summary.events.length === 0 ? 'none' : summary.events.join(',')
  const calendar =
    summary.calendar.length === 0
      ? 'none'
      : summary.calendar.map((item) => `${item.item}:${item.outcome}`).join(',')
  const moves =
    summary.moves.length === 0 ? 'none' : summary.moves.map((move) => `${move.asset}=${formatSigned(move.percent)}`).join(',')
  return `day=${summary.day} events=${events} calendar=${calendar} moves=${moves}`
}
