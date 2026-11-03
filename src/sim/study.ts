// Free time: research and courses. Section 6 (jobless and free time).
// A day has two slots a player can spend on study instead of something else:
// - daytime, the 08:00–16:00 work section, free only when jobless;
// - evening, the 17:00–21:00 market session, given up before the market opens.
// Each slot is used once a day. Research adds points (capped) that verify spends.
// Course study adds units to the enrolled course (`buyCourse` enrols); enough units
// finish it, which unlocks its jobs. Studying spends a little energy at once.
// After an evening of study the market stays closed today: `skip` is rejected.
// This module does not draw a random stream and does not touch the market.

import {
  COURSE_STUDY_UNITS,
  COURSE_UNITS_DAYTIME,
  COURSE_UNITS_EVENING,
  RESEARCH_POINTS_DAYTIME,
  RESEARCH_POINTS_EVENING,
  RESEARCH_POINTS_MAX,
  STARTING_RESEARCH_POINTS,
  STUDY_ENERGY_DAYTIME,
  STUDY_ENERGY_EVENING,
} from './constants.ts'
import { playerIsJobless } from './jobs.ts'
import { applyDelta } from './stats.ts'
import {
  COURSE_IDS,
  STUDY_ACTIVITIES,
  STUDY_SLOTS,
  type CommandRejectedEvent,
  type CourseCompletedEvent,
  type GameState,
  type StatChangeEvent,
  type StudiedEvent,
  type StudyActivity,
  type StudySlot,
  type StudyState,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

export function initialStudy(): StudyState {
  return { points: STARTING_RESEARCH_POINTS, course: null, used: [] }
}

function isSlot(value: unknown): value is StudySlot {
  return typeof value === 'string' && (STUDY_SLOTS as readonly string[]).includes(value)
}

function isActivity(value: unknown): value is StudyActivity {
  return typeof value === 'string' && (STUDY_ACTIVITIES as readonly string[]).includes(value)
}

export function assertStudy(study: StudyState): void {
  if (typeof study !== 'object' || study === null || Array.isArray(study)) {
    throw new Error(`study must be an object, received ${describeValue(study)}`)
  }
  if (!Number.isSafeInteger(study.points) || study.points < 0 || study.points > RESEARCH_POINTS_MAX) {
    throw new Error(`research points must be a whole number from 0 to ${RESEARCH_POINTS_MAX}, received ${describeValue(study.points)}`)
  }
  if (study.course !== null) {
    if (typeof study.course !== 'object' || !(COURSE_IDS as readonly string[]).includes(study.course.id)) {
      throw new Error(`enrolled course must be basic or finance, received ${describeValue(study.course?.id)}`)
    }
    const units = study.course.units
    if (!Number.isSafeInteger(units) || units < 0 || units >= COURSE_STUDY_UNITS) {
      throw new Error(`course units must be a whole number below ${COURSE_STUDY_UNITS}, received ${describeValue(units)}`)
    }
  }
  if (!Array.isArray(study.used) || study.used.some((slot) => !isSlot(slot)) || new Set(study.used).size !== study.used.length) {
    throw new Error(`study slots used today must be distinct slots, received ${describeValue(study.used)}`)
  }
}

/** Slots this player could still spend today, in day order. */
export function freeSlots(state: GameState): StudySlot[] {
  const slots: StudySlot[] = []
  if (state.runEnd !== null || state.section === 'market') return slots
  if (playerIsJobless(state.job) && !state.study.used.includes('daytime')) slots.push('daytime')
  if (!state.study.used.includes('evening')) slots.push('evening')
  return slots
}

function rejected(day: number, reason: string): CommandRejectedEvent {
  return { kind: 'commandRejected', day, command: 'study', reason }
}

/**
 * Spend one slot on research or the enrolled course. Rejections are logged:
 * `marketOpen` once the session has started, `notFree` for daytime with a job,
 * `slotUsed`, `notEnrolled` for course study without a course.
 */
export function interpretStudy(
  state: GameState,
  cmd: unknown,
): Array<StudiedEvent | CourseCompletedEvent | StatChangeEvent | CommandRejectedEvent> {
  const day = state.market.day
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return [rejected(day, 'invalidStudy')]
  const slot = (cmd as { slot?: unknown }).slot
  const activity = (cmd as { activity?: unknown }).activity
  if (!isSlot(slot) || !isActivity(activity)) return [rejected(day, 'invalidStudy')]
  if (state.section === 'market') return [rejected(day, 'marketOpen')]
  if (slot === 'daytime' && !playerIsJobless(state.job)) return [rejected(day, 'notFree')]
  if (state.study.used.includes(slot)) return [rejected(day, 'slotUsed')]
  const course = state.study.course
  if (activity === 'course' && course === null) return [rejected(day, 'notEnrolled')]

  const daytime = slot === 'daytime'
  const energyCost = daytime ? STUDY_ENERGY_DAYTIME : STUDY_ENERGY_EVENING
  const events: Array<StudiedEvent | CourseCompletedEvent | StatChangeEvent | CommandRejectedEvent> = []
  const spent = applyDelta(state, day, 'energy', 'study', -energyCost)
  if (spent !== null) events.push(spent)
  state.study.used.push(slot)
  if (activity === 'research') {
    const gained = daytime ? RESEARCH_POINTS_DAYTIME : RESEARCH_POINTS_EVENING
    state.study.points = Math.min(RESEARCH_POINTS_MAX, state.study.points + gained)
    events.push({ kind: 'studied', day, slot, activity, points: state.study.points, course: null, units: 0, energyCost })
    return events
  }
  if (course === null) throw new Error('course study passed the enrolment check without a course')
  const units = course.units + (daytime ? COURSE_UNITS_DAYTIME : COURSE_UNITS_EVENING)
  events.push({
    kind: 'studied',
    day,
    slot,
    activity,
    points: state.study.points,
    course: course.id,
    units: Math.min(units, COURSE_STUDY_UNITS),
    energyCost,
  })
  if (units >= COURSE_STUDY_UNITS) {
    state.study.course = null
    if (!state.job.courses.includes(course.id)) state.job.courses.push(course.id)
    events.push({ kind: 'courseCompleted', day, course: course.id })
  } else {
    course.units = units
  }
  return events
}

/** End of day: today's slots are free again tomorrow. */
export function resetStudyDay(state: GameState): void {
  state.study.used = []
}
