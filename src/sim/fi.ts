// Financial independence, run end, and score. Section 8.
// Passive income for a day is that day's realized ledger (already net of fees,
// spread, borrow fees, and margin interest) plus savings interest received.
// Unrealized profit and salary are not read. The job is not required to be quit.
// The window is the last FI_WINDOW_DAYS day-numbers, starting at day 1.
// Trades on day 0 are included in day 1, because the first check runs when the
// day becomes 1. The hold counts only from FI_STREAK_FROM_DAY.
// Day 120 is sealed by `finishAtDayLimit` without another price step. The bill
// still has to be paid, or the existing cover check ends the run, before that.

import { tradingEquity } from './trading.ts'
import {
  BASE_MONTHLY_EXPENSES_CENTS,
  CENTS_PER_E,
  FI_HOLD_DAYS,
  FI_STREAK_FROM_DAY,
  FI_WINDOW_DAYS,
  RUN_LENGTH_DAYS,
  SCORE_PER_DAY_LEFT,
  SCORE_PER_E,
} from './constants.ts'
import type {
  AccountLogEvent,
  FiCheckEvent,
  FiTracker,
  GameState,
  MarketDefinitions,
  RunEndedEvent,
  RunOutcome,
} from './types.ts'

/** Logged on `runEnded` when the hold completes. */
export const RUN_WON_REASON = 'financialIndependence'

/** Logged on `runEnded` when day 120 ends without a win or a loss. */
export const RUN_FINISHED_REASON = 'day120'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

/** Empty tracker. A new object, so callers do not share the interest array. */
export function initialFi(): FiTracker {
  return { streak: 0, interest: [], status: null }
}

function requireSafe(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer, received ${describeValue(value)}`)
  }
  return value
}

/**
 * Integer division toward zero.
 * `numerator` and `denominator` are safe integers. `denominator` is positive.
 */
function truncTowardZero(numerator: number, denominator: number): number {
  const num = requireSafe(numerator, 'division numerator')
  const den = requireSafe(denominator, 'division denominator')
  if (den <= 0) {
    throw new Error(`division denominator must be > 0, received ${describeValue(denominator)}`)
  }
  const negative = num < 0
  const abs = negative ? -num : num
  if (!Number.isSafeInteger(abs)) {
    throw new Error(`division absolute value is not a safe integer, received ${describeValue(num)}`)
  }
  const magnitude = Math.floor(abs / den)
  if (!Number.isSafeInteger(magnitude)) {
    throw new Error(`division result is not a safe integer, received ${describeValue(num)} / ${describeValue(den)}`)
  }
  return negative ? -magnitude : magnitude
}

/** Cash + savings + trading equity. Equity is trading cash plus signed shares at the quoted price. */
export function netWorthCents(state: GameState, defs: MarketDefinitions): number {
  const equity = tradingEquity(state, defs).equity
  const total = state.accounts.cashCents + state.accounts.savingsCents + equity
  return requireSafe(total, 'net worth')
}

/**
 * Lost is 0. Otherwise net worth in E times SCORE_PER_E, toward zero.
 * A win adds SCORE_PER_DAY_LEFT for each day before RUN_LENGTH_DAYS.
 */
export function scoreFor(outcome: RunOutcome, worthCents: number, day: number): number {
  if (outcome === 'lost') return 0
  const worth = requireSafe(worthCents, 'score net worth')
  const endDay = requireSafe(day, 'score day')
  if (endDay < 1) {
    throw new Error(`score day must be >= 1, received ${describeValue(endDay)}`)
  }
  const product = worth * SCORE_PER_E
  if (!Number.isSafeInteger(product)) {
    throw new Error(`score product is not a safe integer, received ${describeValue(worth)} × ${SCORE_PER_E}`)
  }
  const fromWorth = truncTowardZero(product, CENTS_PER_E)
  if (outcome === 'finished') return fromWorth
  if (outcome !== 'won') {
    throw new Error(`score outcome must be won, lost, or finished, received ${describeValue(outcome)}`)
  }
  const daysLeft = endDay >= RUN_LENGTH_DAYS ? 0 : RUN_LENGTH_DAYS - endDay
  const bonus = daysLeft * SCORE_PER_DAY_LEFT
  if (!Number.isSafeInteger(bonus)) {
    throw new Error(`score day bonus is not a safe integer, received ${describeValue(daysLeft)} × ${SCORE_PER_DAY_LEFT}`)
  }
  const total = fromWorth + bonus
  return requireSafe(total, 'score')
}

/** Monthly expenses the window must cover. Base 1E until lifestyle exists. */
export function monthlyExpensesCents(): number {
  return requireSafe(BASE_MONTHLY_EXPENSES_CENTS, 'monthly expenses')
}

function realizedOn(state: GameState, day: number): number {
  for (const row of state.realized) {
    if (row.day === day) return row.cents
  }
  return 0
}

function interestOn(state: GameState, day: number): number {
  for (const row of state.fi.interest) {
    if (row.day === day) return row.cents
  }
  return 0
}

/**
 * Realized result for `day`, plus savings interest received that day.
 * Day 1 also includes day 0 trades. Salary and unrealized profit are not added.
 */
function passiveOn(state: GameState, day: number): number {
  let cents = realizedOn(state, day) + interestOn(state, day)
  if (day === 1) cents += realizedOn(state, 0)
  return requireSafe(cents, `passive income on day ${day}`)
}

function windowSum(state: GameState, day: number): { windowDays: number; passiveCents: number } {
  const start = day >= FI_WINDOW_DAYS ? day - FI_WINDOW_DAYS + 1 : 1
  if (!Number.isSafeInteger(start) || start < 1 || start > day) {
    throw new Error(`FI span start is invalid for day ${describeValue(day)}`)
  }
  let passiveCents = 0
  for (let cursor = start; cursor <= day; cursor += 1) {
    passiveCents += passiveOn(state, cursor)
    if (!Number.isSafeInteger(passiveCents)) {
      throw new Error(`FI span sum is not a safe integer on day ${day}`)
    }
  }
  const windowDays = day - start + 1
  if (!Number.isSafeInteger(windowDays) || windowDays < 1 || windowDays > FI_WINDOW_DAYS) {
    throw new Error(`FI span length is invalid, received ${describeValue(windowDays)}`)
  }
  return { windowDays, passiveCents }
}

function rememberInterest(state: GameState, day: number, cents: number): void {
  if (cents === 0) return
  const rows = state.fi.interest
  const last = rows[rows.length - 1]
  if (last !== undefined && last.day === day) {
    throw new Error(`savings interest was already recorded for day ${day}`)
  }
  if (last !== undefined && day < last.day) {
    throw new Error(`savings interest day ${day} is before the last recorded day ${last.day}`)
  }
  rows.push({ day, cents })
}

/**
 * One end-of-day check for the day the market just stepped to.
 * `savingsInterestCents` is interest paid on this day (0 when it is not a pay day).
 * A loss already on the run is left as it is. The 5th covered day from day 30 wins.
 */
export function applyFiCheck(
  state: GameState,
  defs: MarketDefinitions,
  savingsInterestCents: number,
): AccountLogEvent[] {
  const day = state.market.day
  if (!Number.isSafeInteger(day) || day < 1) {
    throw new Error(`FI check day must be a safe integer >= 1, received ${describeValue(day)}`)
  }
  const interest = requireSafe(savingsInterestCents, 'savings interest')
  if (interest < 0) {
    throw new Error(`savings interest must be >= 0, received ${describeValue(interest)}`)
  }
  rememberInterest(state, day, interest)
  const expensesCents = monthlyExpensesCents()
  if (expensesCents <= 0) {
    throw new Error(`monthly expenses must be > 0, received ${describeValue(expensesCents)}`)
  }
  const { windowDays, passiveCents } = windowSum(state, day)
  const covered = passiveCents >= expensesCents
  let streak = 0
  if (day >= FI_STREAK_FROM_DAY) {
    const previous = state.fi.streak
    if (!Number.isSafeInteger(previous) || previous < 0) {
      throw new Error(`FI streak must be a safe integer >= 0, received ${describeValue(previous)}`)
    }
    streak = covered ? previous + 1 : 0
  }
  streak = requireSafe(streak, 'FI streak')
  state.fi.streak = streak
  state.fi.status = { day, windowDays, passiveCents, expensesCents, streak }
  const check: FiCheckEvent = { kind: 'fiCheck', day, windowDays, passiveCents, expensesCents, streak }
  const events: AccountLogEvent[] = [check]
  if (streak >= FI_HOLD_DAYS && state.runEnd === null) {
    const netWorth = netWorthCents(state, defs)
    const score = scoreFor('won', netWorth, day)
    state.runEnd = {
      outcome: 'won',
      day,
      reason: RUN_WON_REASON,
      netWorthCents: netWorth,
      score,
    }
    const ended: RunEndedEvent = { kind: 'runEnded', day, reason: RUN_WON_REASON }
    events.push(ended)
  }
  return events
}

/**
 * Seal a run that has reached day 120. Does not step prices and does not
 * check FI again. The caller must already have refused a pending bill.
 */
export function finishAtDayLimit(state: GameState, defs: MarketDefinitions): RunEndedEvent {
  const day = state.market.day
  if (!Number.isSafeInteger(day) || day < RUN_LENGTH_DAYS) {
    throw new Error(`day limit seal expected day >= ${RUN_LENGTH_DAYS}, received ${describeValue(day)}`)
  }
  if (state.runEnd !== null) {
    throw new Error(`day limit seal found a run that already ended on day ${state.runEnd.day}`)
  }
  if (state.bill !== null) {
    throw new Error(`day limit seal found a bill still pending from day ${state.bill.day}`)
  }
  const netWorth = netWorthCents(state, defs)
  const score = scoreFor('finished', netWorth, day)
  state.runEnd = {
    outcome: 'finished',
    day,
    reason: RUN_FINISHED_REASON,
    netWorthCents: netWorth,
    score,
  }
  return { kind: 'runEnded', day, reason: RUN_FINISHED_REASON }
}
