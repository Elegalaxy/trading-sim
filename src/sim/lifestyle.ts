// Lifestyle tiers and courses. This file does not import content.
// An upgrade pays 2 × the monthly cost it adds. A downgrade pays nothing back.
// The pending bill is copied earlier and is not rewritten here.
// Home tiers do not change energy or stress. Information feed tiers change
// only which rumours `playerVisibleFeed` returns. The stored feed is not written.

import {
  BASE_MONTHLY_EXPENSES_CENTS,
  COURSE_COST_CENTS,
  HOME_MAX_TIER,
  HOME_TIER_COST_CENTS,
  INFO_FEED_MAX_TIER,
  INFO_FEED_TIER_COST_CENTS,
  LIFESTYLE_UPFRONT_MULTIPLIER,
} from './constants.ts'
import { visibleFeed } from './feed.ts'
import { billDueForJob } from './jobs.ts'
import {
  COURSE_IDS,
  JOB_PERKS,
  LIFESTYLE_CATEGORIES,
  type CommandRejectedEvent,
  type CourseId,
  type CoursePurchasedEvent,
  type DayFeed,
  type GameState,
  type JobDefinition,
  type LifestyleCategory,
  type LifestyleChangeEvent,
  type LifestyleState,
  type VisibilityRequirement,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

function isCategory(value: unknown): value is LifestyleCategory {
  return typeof value === 'string' && (LIFESTYLE_CATEGORIES as readonly string[]).includes(value)
}

function isCourse(value: unknown): value is CourseId {
  return typeof value === 'string' && (COURSE_IDS as readonly string[]).includes(value)
}

function maxTier(category: LifestyleCategory): number {
  return category === 'home' ? HOME_MAX_TIER : INFO_FEED_MAX_TIER
}

function tierCostCents(category: LifestyleCategory): number {
  return category === 'home' ? HOME_TIER_COST_CENTS : INFO_FEED_TIER_COST_CENTS
}

function requireTier(value: number, category: LifestyleCategory): number {
  const max = maxTier(category)
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${category} tier must be a safe integer from 0 to ${max}, received ${describeValue(value)}`)
  }
  return value
}

/** Both tiers start at the base. No course is owned. */
export function initialLifestyle(): LifestyleState {
  return { home: 0, infoFeed: 0 }
}

/** Reject a lifestyle block that could not have come from `initialLifestyle` plus commands. */
export function assertLifestyle(lifestyle: LifestyleState): void {
  if (typeof lifestyle !== 'object' || lifestyle === null || Array.isArray(lifestyle)) {
    throw new Error(`lifestyle must be an object, received ${describeValue(lifestyle)}`)
  }
  requireTier(lifestyle.home, 'home')
  requireTier(lifestyle.infoFeed, 'infoFeed')
}

/**
 * Base 1E plus each Home tier and each information-feed tier.
 * The staff discount is not applied here. Courses are not included.
 */
export function lifestyleExpensesCents(lifestyle: LifestyleState): number {
  assertLifestyle(lifestyle)
  const home = lifestyle.home * HOME_TIER_COST_CENTS
  const info = lifestyle.infoFeed * INFO_FEED_TIER_COST_CENTS
  const total = BASE_MONTHLY_EXPENSES_CENTS + home + info
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error(`monthly expenses are not a positive safe integer, received ${describeValue(total)}`)
  }
  return total
}

/**
 * Cents paid to move one category from `from` to `to`.
 * An upgrade is 2 × the added monthly cost. A downgrade or a sideways move is 0.
 */
export function upfrontCents(category: LifestyleCategory, from: number, to: number): number {
  if (!isCategory(category)) {
    throw new Error(`lifestyle category must be home or infoFeed, received ${describeValue(category)}`)
  }
  const start = requireTier(from, category)
  const end = requireTier(to, category)
  if (end <= start) return 0
  const added = (end - start) * tierCostCents(category)
  const upfront = added * LIFESTYLE_UPFRONT_MULTIPLIER
  if (!Number.isSafeInteger(added) || !Number.isSafeInteger(upfront) || upfront <= 0) {
    throw new Error(`upfront cost is not a positive safe integer, received ${describeValue(upfront)}`)
  }
  return upfront
}

/** The bill the next cycle would copy, including the staff discount when that job is active. */
export function projectedBillCents(state: GameState): number {
  assertLifestyle(state.lifestyle)
  return billDueForJob(state.job, state.market.day, lifestyleExpensesCents(state.lifestyle)).amountCents
}

function tierFitsExpenses(category: LifestyleCategory, tier: number, expensesCents: number): boolean {
  const rest = expensesCents - BASE_MONTHLY_EXPENSES_CENTS - tier * tierCostCents(category)
  if (!Number.isSafeInteger(rest) || rest < 0) return false
  if (category === 'home') return rest % INFO_FEED_TIER_COST_CENTS === 0 && rest / INFO_FEED_TIER_COST_CENTS <= INFO_FEED_MAX_TIER
  return rest % HOME_TIER_COST_CENTS === 0 && rest / HOME_TIER_COST_CENTS <= HOME_MAX_TIER
}

/** Pending lifestyle and course lines. A bad line is a broken state and throws. */
export function assertLifestyleCommand(event: unknown): void {
  if (typeof event !== 'object' || event === null) {
    throw new Error(`lifestyle event must be an object, received ${describeValue(event)}`)
  }
  const kind = (event as { kind?: unknown }).kind
  if (kind === 'lifestyleChange') {
    const row = event as LifestyleChangeEvent
    if (!Number.isSafeInteger(row.day) || row.day < 0) {
      throw new Error(`lifestyle change day must be a safe integer >= 0, received ${describeValue(row.day)}`)
    }
    if (!isCategory(row.category)) {
      throw new Error(`lifestyle change category must be home or infoFeed, received ${describeValue(row.category)}`)
    }
    const from = requireTier(row.from, row.category)
    const to = requireTier(row.to, row.category)
    if (from === to) throw new Error(`lifestyle change ${row.category} did not move, received tier ${to}`)
    const upfront = upfrontCents(row.category, from, to)
    if (row.upfront !== upfront) {
      throw new Error(`lifestyle change upfront must be ${upfront}, received ${describeValue(row.upfront)}`)
    }
    if (!Number.isSafeInteger(row.expensesCents) || !tierFitsExpenses(row.category, to, row.expensesCents)) {
      throw new Error(
        `lifestyle change expenses do not match ${row.category} tier ${to}, received ${describeValue(row.expensesCents)}`,
      )
    }
    return
  }
  if (kind === 'coursePurchased') {
    const row = event as CoursePurchasedEvent
    if (!Number.isSafeInteger(row.day) || row.day < 0) {
      throw new Error(`course day must be a safe integer >= 0, received ${describeValue(row.day)}`)
    }
    if (!isCourse(row.course)) {
      throw new Error(`course must be basic or finance, received ${describeValue(row.course)}`)
    }
    if (row.cost !== COURSE_COST_CENTS) {
      throw new Error(`course cost must be ${COURSE_COST_CENTS}, received ${describeValue(row.cost)}`)
    }
    return
  }
  throw new Error(`lifestyle event kind is unknown, received ${describeValue(kind)}`)
}

function rejected(day: number, command: string, reason: string): CommandRejectedEvent {
  return { kind: 'commandRejected', day, command, reason }
}

function keepPendingBill(state: GameState, before: number | null): void {
  const after = state.bill === null ? null : state.bill.amountCents
  if (after !== before) {
    throw new Error(`lifestyle command rewrote a pending bill from ${describeValue(before)} to ${describeValue(after)}`)
  }
}

export type SetLifestyleOutcome =
  | { accepted: true; event: LifestyleChangeEvent }
  | { accepted: false; event: CommandRejectedEvent }

/**
 * Move Home or the information feed to a tier. Too little cash is logged and does not throw.
 * A downgrade does not refund. A pending bill keeps its amount.
 */
export function interpretSetLifestyle(state: GameState, cmd: unknown): SetLifestyleOutcome {
  const day = state.market.day
  if (state.runEnd !== null) return { accepted: false, event: rejected(day, 'setLifestyle', 'runEnded') }
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) {
    return { accepted: false, event: rejected(day, 'setLifestyle', 'unknownCategory') }
  }
  const category = (cmd as { category?: unknown }).category
  if (!isCategory(category)) return { accepted: false, event: rejected(day, 'setLifestyle', 'unknownCategory') }
  const tier = (cmd as { tier?: unknown }).tier
  const max = maxTier(category)
  if (typeof tier !== 'number' || !Number.isSafeInteger(tier) || tier < 0 || tier > max) {
    return { accepted: false, event: rejected(day, 'setLifestyle', 'invalidTier') }
  }
  assertLifestyle(state.lifestyle)
  const from = state.lifestyle[category]
  if (from === tier) return { accepted: false, event: rejected(day, 'setLifestyle', 'alreadyAtTier') }
  const upfront = upfrontCents(category, from, tier)
  if (state.accounts.cashCents < upfront) {
    return { accepted: false, event: rejected(day, 'setLifestyle', 'insufficientFunds') }
  }
  const nextCash = state.accounts.cashCents - upfront
  if (!Number.isSafeInteger(nextCash) || nextCash < 0) {
    throw new Error(`lifestyle left cash at ${describeValue(nextCash)}`)
  }
  const pendingAmount = state.bill === null ? null : state.bill.amountCents
  state.accounts.cashCents = nextCash
  state.lifestyle[category] = tier
  const expensesCents = lifestyleExpensesCents(state.lifestyle)
  keepPendingBill(state, pendingAmount)
  return {
    accepted: true,
    event: { kind: 'lifestyleChange', day, category, from, to: tier, upfront, expensesCents },
  }
}

export type BuyCourseOutcome =
  | { accepted: true; event: CoursePurchasedEvent }
  | { accepted: false; event: CommandRejectedEvent }

/**
 * Buy Basic or Finance once, from cash. The monthly bill does not change.
 * Too little cash, or a second copy, is logged and does not throw.
 */
export function interpretBuyCourse(state: GameState, cmd: unknown): BuyCourseOutcome {
  const day = state.market.day
  if (state.runEnd !== null) return { accepted: false, event: rejected(day, 'buyCourse', 'runEnded') }
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) {
    return { accepted: false, event: rejected(day, 'buyCourse', 'unknownCourse') }
  }
  const course = (cmd as { course?: unknown }).course
  if (!isCourse(course)) return { accepted: false, event: rejected(day, 'buyCourse', 'unknownCourse') }
  if (!Array.isArray(state.job.courses)) {
    throw new Error(`courses must be a list, received ${describeValue(state.job.courses)}`)
  }
  if (state.job.courses.includes(course)) return { accepted: false, event: rejected(day, 'buyCourse', 'alreadyOwned') }
  if (state.accounts.cashCents < COURSE_COST_CENTS) {
    return { accepted: false, event: rejected(day, 'buyCourse', 'insufficientFunds') }
  }
  const nextCash = state.accounts.cashCents - COURSE_COST_CENTS
  if (!Number.isSafeInteger(nextCash) || nextCash < 0) {
    throw new Error(`course left cash at ${describeValue(nextCash)}`)
  }
  const pendingAmount = state.bill === null ? null : state.bill.amountCents
  const expensesBefore = lifestyleExpensesCents(state.lifestyle)
  state.accounts.cashCents = nextCash
  state.job.courses.push(course)
  if (lifestyleExpensesCents(state.lifestyle) !== expensesBefore) {
    throw new Error('buying a course changed monthly expenses')
  }
  keepPendingBill(state, pendingAmount)
  return { accepted: true, event: { kind: 'coursePurchased', day, course, cost: COURSE_COST_CENTS } }
}

function isPerk(value: unknown): boolean {
  return typeof value === 'string' && (JOB_PERKS as readonly string[]).includes(value)
}

/**
 * Headlines stay. Information feed tier 1 adds `infoFeed1` (the medium source
 * that is not on the base feed). Tier 2 adds `infoFeed2` (the high source) and
 * hides noise. Job perks still add `jobContacts` or hide noise. This does not
 * draw and does not write the stored feed.
 */
export function playerVisibleFeed(feed: DayFeed, job: JobDefinition | null, lifestyle: LifestyleState): DayFeed {
  assertLifestyle(lifestyle)
  if (job !== null && !isPerk(job.perk)) {
    throw new Error(`job ${describeValue(job.id)} perk is unknown, received ${describeValue(job.perk)}`)
  }
  const visibility: VisibilityRequirement[] = ['base']
  if (lifestyle.infoFeed >= 1) visibility.push('infoFeed1')
  if (lifestyle.infoFeed >= 2) visibility.push('infoFeed2')
  if (job?.perk === 'industryContacts') visibility.push('jobContacts')
  const visible = visibleFeed(feed, visibility)
  const hideNoise = lifestyle.infoFeed >= 2 || job?.perk === 'analystTools'
  if (!hideNoise) return visible
  return {
    day: visible.day,
    items: visible.items.filter((item) => item.kind !== 'rumour' || !item.noise),
  }
}
