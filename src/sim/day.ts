// Played day. Three sections: sleep, work, market. The clock minutes in
// constants.ts are display only. This module stores the section and the
// sleep hours. A new day starts at the end of sleep. skip, from the end of
// work or from the end of sleep when jobless, moves to market open.
// The caller passes jobless in. Orders outside market are rejected by the game.

import {
  MARKET_CLOSE_MINUTE,
  MARKET_OPEN_MINUTE,
  SLEEP_END_MINUTE,
  WORK_FULL_TIME_END_MINUTE,
  WORK_PART_TIME_END_MINUTE,
  WORK_START_MINUTE,
} from './constants.ts'
import {
  DAY_SECTIONS,
  type CommandRejectedEvent,
  type DaySection,
  type SectionChangeEvent,
  type SkipEvent,
} from './types.ts'

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

/** A new day is the end of sleep, before work and before the market opens. */
export const DAY_START_SECTION = 'sleep' satisfies DaySection

export function isDaySection(value: unknown): value is DaySection {
  return typeof value === 'string' && (DAY_SECTIONS as readonly string[]).includes(value)
}

/** `sleepHours` is a whole number of hours from 0 through 24. */
export function assertDayState(section: unknown, sleepHours: unknown): void {
  if (!isDaySection(section)) {
    throw new Error(`day section must be sleep, work, or market, received ${describeValue(section)}`)
  }
  if (typeof sleepHours !== 'number' || !Number.isSafeInteger(sleepHours) || sleepHours < 0 || sleepHours > 24) {
    throw new Error(`sleep hours must be a safe integer from 0 to 24, received ${describeValue(sleepHours)}`)
  }
}

/** `HH:MM` for a minute of the day, from 0 through 23:59. */
export function formatMinute(minute: number): string {
  if (!Number.isSafeInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) {
    throw new Error(
      `clock minute must be a safe integer from 0 to ${MINUTES_PER_DAY - 1}, received ${describeValue(minute)}`,
    )
  }
  const hour = Math.floor(minute / MINUTES_PER_HOUR)
  const rest = minute % MINUTES_PER_HOUR
  const hourText = hour < 10 ? `0${hour}` : String(hour)
  const restText = rest < 10 ? `0${rest}` : String(rest)
  return `${hourText}:${restText}`
}

/**
 * Display time for where that section sits.
 * Sleep shows its end. Work shows its start. Market shows when it opens.
 */
export function sectionClock(section: DaySection): string {
  if (!isDaySection(section)) {
    throw new Error(`day section must be sleep, work, or market, received ${describeValue(section)}`)
  }
  if (section === 'sleep') return formatMinute(SLEEP_END_MINUTE)
  if (section === 'work') return formatMinute(WORK_START_MINUTE)
  return formatMinute(MARKET_OPEN_MINUTE)
}

export type DayBlock = {
  section: DaySection
  title: string
  clock: string
  /** Jobless work is shown and empty. Sleep and market are not empty. */
  empty: boolean
}

/** Sleep range ends at 07:00 and runs back `sleepHours`. Work lists both shifts. */
export function dayBlocks(sleepHours: number, jobless: boolean): DayBlock[] {
  assertDayState(DAY_START_SECTION, sleepHours)
  if (typeof jobless !== 'boolean') {
    throw new Error(`jobless must be boolean, received ${describeValue(jobless)}`)
  }
  const sleepStart = (SLEEP_END_MINUTE - sleepHours * MINUTES_PER_HOUR + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const workPart = `${formatMinute(WORK_START_MINUTE)}-${formatMinute(WORK_PART_TIME_END_MINUTE)}`
  const workFull = `${formatMinute(WORK_START_MINUTE)}-${formatMinute(WORK_FULL_TIME_END_MINUTE)}`
  return [
    {
      section: 'sleep',
      title: 'Sleep',
      clock: `${formatMinute(sleepStart)}-${formatMinute(SLEEP_END_MINUTE)} (${sleepHours}h)`,
      empty: false,
    },
    {
      section: 'work',
      title: 'Work',
      clock: `${workPart} part-time, ${workFull} full-time`,
      empty: jobless,
    },
    {
      section: 'market',
      title: 'Market',
      clock: `${formatMinute(MARKET_OPEN_MINUTE)}-${formatMinute(MARKET_CLOSE_MINUTE)}`,
      empty: false,
    },
  ]
}

export type SkipOutcome =
  | { accepted: true; section: 'market'; events: [SkipEvent, SectionChangeEvent] }
  | { accepted: false; event: CommandRejectedEvent }

function rejected(day: number, reason: string): CommandRejectedEvent {
  return { kind: 'commandRejected', day, command: 'skip', reason }
}

/**
 * From the end of work, or from the end of sleep when jobless, jump to market open.
 * Any other section rejects with `cannotSkip` and does not change the section.
 */
export function interpretSkip(section: DaySection, day: number, jobless: boolean): SkipOutcome {
  if (!isDaySection(section)) {
    throw new Error(`day section must be sleep, work, or market, received ${describeValue(section)}`)
  }
  if (!Number.isSafeInteger(day) || day < 0) {
    throw new Error(`day must be a safe integer >= 0, received ${describeValue(day)}`)
  }
  if (typeof jobless !== 'boolean') {
    throw new Error(`jobless must be boolean, received ${describeValue(jobless)}`)
  }
  const fromSleep = jobless && section === 'sleep'
  const fromWork = section === 'work'
  if (!fromSleep && !fromWork) {
    return { accepted: false, event: rejected(day, 'cannotSkip') }
  }
  const to = 'market' as const
  const clock = sectionClock(to)
  return {
    accepted: true,
    section: to,
    events: [
      { kind: 'skip', day, from: section, to },
      { kind: 'sectionChange', day, from: section, to, clock },
    ],
  }
}
