// Jobs. The menu is passed in; this file does not import content.
// A starting job applies immediately. A later switch or quit waits JOB_NOTICE_DAYS.
// Pay is monthly pay × days worked that month ÷ 30, rounded half away from zero.
// Energy and stress costs stay on the definition and are not applied here.
// Perks change the bill or the visible feed. They do not draw and do not change the stored feed.

import {
  BASE_MONTHLY_EXPENSES_CENTS,
  JOB_NOTICE_DAYS,
  SAVINGS_PAY_INTERVAL_DAYS,
  SLEEP_HOURS,
  STAFF_DISCOUNT_DENOMINATOR,
  STAFF_DISCOUNT_NUMERATOR,
} from './constants.ts'
import { visibleFeed } from './feed.ts'
import {
  COURSE_IDS,
  JOB_PERKS,
  type CommandRejectedEvent,
  type CourseId,
  type DayFeed,
  type DaySection,
  type GameState,
  type JobChangeRequestedEvent,
  type JobChangedEvent,
  type JobDefinition,
  type JobPerk,
  type JobRequirement,
  type PendingJobChange,
  type PerkAppliedEvent,
  type PlayerJob,
  type SalaryPaidEvent,
  type VisibilityRequirement,
} from './types.ts'

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/

const DEFAULT_JOBLESS: JobDefinition = {
  id: 'jobless',
  name: 'Jobless',
  slots: 0,
  payCents: 0,
  requirement: 'none',
  perk: 'none',
  energyCost: 0,
  stressCost: 0,
  sleepHours: SLEEP_HOURS,
}

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

function roundHalfAwayFromZero(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`job amount must be a finite number, received ${describeValue(value)}`)
  }
  const rounded = Math.round(Math.abs(value))
  const delta = value < 0 ? -rounded : rounded
  if (!Number.isSafeInteger(delta)) {
    throw new Error(`job amount is not a safe integer, received ${describeValue(value)}`)
  }
  return delta
}

function isRequirement(value: unknown): value is JobRequirement {
  return value === 'none' || value === 'basic' || value === 'finance'
}

function isPerk(value: unknown): value is JobPerk {
  return typeof value === 'string' && (JOB_PERKS as readonly string[]).includes(value)
}

function isCourse(value: unknown): value is CourseId {
  return typeof value === 'string' && (COURSE_IDS as readonly string[]).includes(value)
}

function copyJob(job: JobDefinition): JobDefinition {
  return {
    id: job.id,
    name: job.name,
    slots: job.slots,
    payCents: job.payCents,
    requirement: job.requirement,
    perk: job.perk,
    energyCost: job.energyCost,
    stressCost: job.stressCost,
    sleepHours: job.sleepHours,
  }
}

function assertJobDefinition(job: unknown, index: number): JobDefinition {
  if (typeof job !== 'object' || job === null || Array.isArray(job)) {
    throw new Error(`job[${index}] must be an object, received ${describeValue(job)}`)
  }
  const item = job as JobDefinition
  if (typeof item.id !== 'string' || !ID_PATTERN.test(item.id)) {
    throw new Error(`job[${index}] id must be an id token, received ${describeValue(item.id)}`)
  }
  if (typeof item.name !== 'string' || item.name.length === 0 || /[\r\n]/.test(item.name)) {
    throw new Error(`job ${item.id} name must be one non-empty line, received ${describeValue(item.name)}`)
  }
  if (item.slots !== 0 && item.slots !== 1 && item.slots !== 2) {
    throw new Error(`job ${item.id} slots must be 0, 1, or 2, received ${describeValue(item.slots)}`)
  }
  if (item.id === 'jobless' && item.slots !== 0) {
    throw new Error(`jobless slots must be 0, received ${describeValue(item.slots)}`)
  }
  if (item.slots === 0 && item.id !== 'jobless') {
    throw new Error(`only jobless may occupy 0 slots, received ${item.id}`)
  }
  if (!Number.isSafeInteger(item.payCents) || item.payCents < 0) {
    throw new Error(`job ${item.id} pay must be a safe integer >= 0, received ${describeValue(item.payCents)}`)
  }
  if (item.id === 'jobless' && item.payCents !== 0) {
    throw new Error(`jobless pay must be 0, received ${describeValue(item.payCents)}`)
  }
  if (!isRequirement(item.requirement)) {
    throw new Error(
      `job ${item.id} requirement must be none, basic, or finance, received ${describeValue(item.requirement)}`,
    )
  }
  if (!isPerk(item.perk)) {
    throw new Error(`job ${item.id} perk is unknown, received ${describeValue(item.perk)}`)
  }
  if (item.id === 'jobless' && (item.perk !== 'none' || item.requirement !== 'none')) {
    throw new Error(`jobless must have no perk and no course, received perk ${item.perk} requirement ${item.requirement}`)
  }
  if (!Number.isSafeInteger(item.energyCost) || item.energyCost < 0) {
    throw new Error(`job ${item.id} energy cost must be a safe integer >= 0, received ${describeValue(item.energyCost)}`)
  }
  if (!Number.isSafeInteger(item.stressCost) || item.stressCost < 0) {
    throw new Error(`job ${item.id} stress cost must be a safe integer >= 0, received ${describeValue(item.stressCost)}`)
  }
  if (!Number.isSafeInteger(item.sleepHours) || item.sleepHours < 0 || item.sleepHours > 24) {
    throw new Error(
      `job ${item.id} sleep hours must be a safe integer from 0 to 24, received ${describeValue(item.sleepHours)}`,
    )
  }
  return copyJob(item)
}

function copyCatalog(jobs: readonly JobDefinition[]): JobDefinition[] {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error(`job catalog must be a non-empty list, received ${describeValue(jobs)}`)
  }
  const catalog: JobDefinition[] = []
  const seen = new Set<string>()
  for (let index = 0; index < jobs.length; index += 1) {
    const job = assertJobDefinition(jobs[index], index)
    if (seen.has(job.id)) throw new Error(`job catalog repeats ${job.id}`)
    seen.add(job.id)
    catalog.push(job)
  }
  if (!seen.has('jobless')) throw new Error('job catalog must include jobless')
  return catalog
}

/** True when the job names a course the player does not own. */
export function jobIsLocked(job: JobDefinition, courses: readonly CourseId[]): boolean {
  if (!isRequirement(job.requirement)) {
    throw new Error(`job ${job.id} requirement must be none, basic, or finance, received ${describeValue(job.requirement)}`)
  }
  if (job.requirement === 'none') return false
  return !courses.includes(job.requirement)
}

/**
 * Employment at the start of a run.
 * Omitted jobs use jobless only. Omitted job id uses jobless. A locked starting job throws.
 */
export function initialPlayerJob(jobs: readonly JobDefinition[] | undefined, jobId: string | undefined): PlayerJob {
  const catalog = jobs === undefined ? [copyJob(DEFAULT_JOBLESS)] : copyCatalog(jobs)
  if (jobId !== undefined && typeof jobId !== 'string') {
    throw new Error(`starting job must be an id, received ${describeValue(jobId)}`)
  }
  const id = jobId === undefined ? 'jobless' : jobId
  const job = catalog.find((item) => item.id === id)
  if (job === undefined) {
    throw new Error(`starting job is not on the menu, received ${describeValue(id)}`)
  }
  if (jobIsLocked(job, [])) {
    throw new Error(`starting job ${id} is locked until its course is owned`)
  }
  return { catalog, jobId: job.id, pending: null, worked: [], courses: [] }
}

/** The job that is active today. */
export function activeJob(player: PlayerJob): JobDefinition {
  if (typeof player !== 'object' || player === null) {
    throw new Error(`player job must be an object, received ${describeValue(player)}`)
  }
  const job = player.catalog.find((item) => item.id === player.jobId)
  if (job === undefined) {
    throw new Error(`active job is not on the menu, received ${describeValue(player.jobId)}`)
  }
  return job
}

/** Slots 0 leaves the work section empty and lets skip run from the end of sleep. */
export function playerIsJobless(player: PlayerJob): boolean {
  return activeJob(player).slots === 0
}

/** Jobless starts at the end of sleep. A job starts at work, which that job occupies. */
export function sectionForJob(job: JobDefinition): DaySection {
  return job.slots === 0 ? 'sleep' : 'work'
}

/** Reject a catalog or employment block that could not have come from `initialPlayerJob`. */
export function assertPlayerJob(player: PlayerJob): void {
  if (typeof player !== 'object' || player === null || Array.isArray(player)) {
    throw new Error(`player job must be an object, received ${describeValue(player)}`)
  }
  if (!Array.isArray(player.catalog) || player.catalog.length === 0) {
    throw new Error(`job catalog must be a non-empty list, received ${describeValue(player.catalog)}`)
  }
  const seen = new Set<string>()
  for (let index = 0; index < player.catalog.length; index += 1) {
    const job = assertJobDefinition(player.catalog[index], index)
    if (seen.has(job.id)) throw new Error(`job catalog repeats ${job.id}`)
    seen.add(job.id)
    const stored = player.catalog[index]
    if (stored === undefined || JSON.stringify(stored) !== JSON.stringify(job)) {
      throw new Error(`job ${job.id} does not match its checked copy`)
    }
  }
  if (!seen.has('jobless')) throw new Error('job catalog must include jobless')
  if (typeof player.jobId !== 'string' || !seen.has(player.jobId)) {
    throw new Error(`active job is not on the menu, received ${describeValue(player.jobId)}`)
  }
  if (!Array.isArray(player.courses)) {
    throw new Error(`courses must be a list, received ${describeValue(player.courses)}`)
  }
  const courses = new Set<string>()
  for (let index = 0; index < player.courses.length; index += 1) {
    const course = player.courses[index]
    if (!isCourse(course)) {
      throw new Error(`courses[${index}] must be basic or finance, received ${describeValue(course)}`)
    }
    if (courses.has(course)) throw new Error(`courses repeat ${course}`)
    courses.add(course)
  }
  if (player.pending !== null) {
    if (typeof player.pending !== 'object' || Array.isArray(player.pending)) {
      throw new Error(`pending job must be an object, received ${describeValue(player.pending)}`)
    }
    if (typeof player.pending.jobId !== 'string' || !seen.has(player.pending.jobId)) {
      throw new Error(`pending job is not on the menu, received ${describeValue(player.pending.jobId)}`)
    }
    if (!Number.isSafeInteger(player.pending.effectiveDay) || player.pending.effectiveDay < 0) {
      throw new Error(
        `pending job day must be a safe integer >= 0, received ${describeValue(player.pending.effectiveDay)}`,
      )
    }
  }
  if (!Array.isArray(player.worked)) {
    throw new Error(`days worked must be a list, received ${describeValue(player.worked)}`)
  }
  for (let index = 0; index < player.worked.length; index += 1) {
    const row = player.worked[index]
    if (typeof row !== 'object' || row === null) {
      throw new Error(`days worked[${index}] must be an object, received ${describeValue(row)}`)
    }
    if (typeof row.jobId !== 'string' || !seen.has(row.jobId)) {
      throw new Error(`days worked[${index}] job is not on the menu, received ${describeValue(row.jobId)}`)
    }
    if (!Number.isSafeInteger(row.days) || row.days <= 0) {
      throw new Error(`days worked[${index}] must be a positive safe integer, received ${describeValue(row.days)}`)
    }
    const previous = player.worked[index - 1]
    if (previous !== undefined && previous.jobId === row.jobId) {
      throw new Error(`days worked repeats ${row.jobId} in adjacent rows`)
    }
  }
}

function findJob(player: PlayerJob, jobId: string): JobDefinition {
  const job = player.catalog.find((item) => item.id === jobId)
  if (job === undefined) throw new Error(`job is not on the menu, received ${describeValue(jobId)}`)
  return job
}

/** Count today under the active job. Call this for the day that is ending, before the clock advances. */
export function recordJobDay(state: GameState): void {
  const id = activeJob(state.job).id
  const worked = state.job.worked
  const last = worked[worked.length - 1]
  if (last !== undefined && last.jobId === id) {
    const next = last.days + 1
    if (!Number.isSafeInteger(next)) throw new Error(`days worked for ${id} overflowed`)
    last.days = next
    return
  }
  worked.push({ jobId: id, days: 1 })
}

function proratedSalaryCents(payCents: number, days: number): number {
  if (days === 0 || payCents === 0) return 0
  const product = payCents * days
  if (!Number.isSafeInteger(product)) {
    throw new Error(`salary days overflowed, pay ${payCents} days ${days}`)
  }
  return roundHalfAwayFromZero(product / SAVINGS_PAY_INTERVAL_DAYS)
}

function salaryLines(state: GameState, day: number): SalaryPaidEvent[] {
  if (state.job.worked.length === 0) {
    return [{ kind: 'salaryPaid', day, job: activeJob(state.job).id, days: 0, amountCents: 0 }]
  }
  const events: SalaryPaidEvent[] = []
  for (const row of state.job.worked) {
    const job = findJob(state.job, row.jobId)
    const amountCents = proratedSalaryCents(job.payCents, row.days)
    events.push({ kind: 'salaryPaid', day, job: job.id, days: row.days, amountCents })
  }
  return events
}

/**
 * Pay each job worked since the previous salary, then clear those days.
 * The next day is not included. Call this on the payday, after that previous day was recorded.
 */
export function paySalary(state: GameState, day: number): SalaryPaidEvent[] {
  const events = salaryLines(state, day)
  let extra = 0
  for (const event of events) {
    extra += event.amountCents
    if (!Number.isSafeInteger(extra)) {
      throw new Error(`salary total is not a safe integer, received ${describeValue(extra)}`)
    }
  }
  const nextCash = state.accounts.cashCents + extra
  if (!Number.isSafeInteger(nextCash)) {
    throw new Error(`salary left cash outside a safe integer, received ${describeValue(nextCash)}`)
  }
  state.accounts.cashCents = nextCash
  state.job.worked = []
  return events
}

/**
 * Bill for the job that is active when the bill comes due.
 * Staff discount is 5% off that bill. A pending bill is left alone by the caller.
 */
export function billDueForJob(player: PlayerJob, day: number): { amountCents: number; perk: PerkAppliedEvent | null } {
  const job = activeJob(player)
  const base = BASE_MONTHLY_EXPENSES_CENTS
  if (!Number.isSafeInteger(base) || base <= 0) {
    throw new Error(`base expenses must be a positive safe integer, received ${describeValue(base)}`)
  }
  if (job.perk !== 'staffDiscount') return { amountCents: base, perk: null }
  const discount = roundHalfAwayFromZero((base * STAFF_DISCOUNT_NUMERATOR) / STAFF_DISCOUNT_DENOMINATOR)
  if (discount <= 0) return { amountCents: base, perk: null }
  const amountCents = base - discount
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`discounted bill must be a positive safe integer, received ${describeValue(amountCents)}`)
  }
  return {
    amountCents,
    perk: { kind: 'perkApplied', day, job: job.id, perk: job.perk },
  }
}

/**
 * Apply a notice that has come due. Visibility perks log `perkApplied` here.
 * Staff discount logs when the bill is cut. Steady routine and quiet breaks stay stored.
 */
export function applyDueJobChange(state: GameState): Array<JobChangedEvent | PerkAppliedEvent> {
  const pending = state.job.pending
  if (pending === null) return []
  if (pending.effectiveDay > state.market.day) return []
  const from = activeJob(state.job)
  const next = findJob(state.job, pending.jobId)
  if (jobIsLocked(next, state.job.courses)) {
    throw new Error(`pending job ${next.id} is locked`)
  }
  state.job.jobId = next.id
  state.job.pending = null
  state.sleepHours = next.sleepHours
  const events: Array<JobChangedEvent | PerkAppliedEvent> = [
    {
      kind: 'jobChanged',
      day: state.market.day,
      from: from.id,
      to: next.id,
      slots: next.slots,
      sleepHours: next.sleepHours,
    },
  ]
  if (next.perk === 'industryContacts' || next.perk === 'analystTools') {
    events.push({ kind: 'perkApplied', day: state.market.day, job: next.id, perk: next.perk })
  }
  return events
}

export type SetJobOutcome =
  | { accepted: true; event: JobChangeRequestedEvent; pending: PendingJobChange }
  | { accepted: false; event: CommandRejectedEvent }

function rejected(day: number, reason: string): CommandRejectedEvent {
  return { kind: 'commandRejected', day, command: 'setJob', reason }
}

/**
 * Ask to switch or quit. The job does not change yet.
 * An unknown or locked choice is logged and does not throw.
 */
export function interpretSetJob(state: GameState, cmd: unknown): SetJobOutcome {
  const day = state.market.day
  if (state.runEnd !== null) return { accepted: false, event: rejected(day, 'runEnded') }
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) {
    return { accepted: false, event: rejected(day, 'unknownJob') }
  }
  const jobId = (cmd as { jobId?: unknown }).jobId
  if (typeof jobId !== 'string') return { accepted: false, event: rejected(day, 'unknownJob') }
  const next = state.job.catalog.find((job) => job.id === jobId)
  if (next === undefined) return { accepted: false, event: rejected(day, 'unknownJob') }
  if (jobIsLocked(next, state.job.courses)) return { accepted: false, event: rejected(day, 'jobLocked') }
  if (jobId === state.job.jobId) return { accepted: false, event: rejected(day, 'alreadyEmployed') }
  if (state.job.pending !== null && state.job.pending.jobId === jobId) {
    return { accepted: false, event: rejected(day, 'alreadyRequested') }
  }
  const effectiveDay = day + JOB_NOTICE_DAYS
  if (!Number.isSafeInteger(effectiveDay)) {
    throw new Error(`job notice day overflowed from day ${describeValue(day)}`)
  }
  return {
    accepted: true,
    pending: { jobId, effectiveDay },
    event: { kind: 'jobChangeRequested', day, from: state.job.jobId, to: jobId, effectiveDay },
  }
}

/**
 * What this job lets the player see. Headlines stay. Industry contacts adds `jobContacts`.
 * Analyst tools drops `noise` rumours. The stored feed and every RNG stream stay as they were.
 */
export function jobVisibleFeed(feed: DayFeed, job: JobDefinition): DayFeed {
  if (!isPerk(job.perk)) {
    throw new Error(`job ${describeValue(job.id)} perk is unknown, received ${describeValue(job.perk)}`)
  }
  const visibility: VisibilityRequirement[] = ['base']
  if (job.perk === 'industryContacts') visibility.push('jobContacts')
  const visible = visibleFeed(feed, visibility)
  if (job.perk !== 'analystTools') return visible
  return {
    day: visible.day,
    items: visible.items.filter((item) => item.kind !== 'rumour' || !item.noise),
  }
}
