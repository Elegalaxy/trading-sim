// Monthly cycle. `endDay` increments the market day, settles trading, and accrues
// savings. When that new day is 30, 60, 90, 120, or a later 30th day, this cycle
// runs before the player acts: salary for the days worked that month, the
// savings interest payout, then the expenses bill. The amount is fixed then.
// Staff discount cuts the bill that comes due while that job is active.
// Cash that covers the bill pays it. Otherwise the bill stays pending and the
// next endDay is blocked. The check never sells a position or moves savings.
// The amount is base expenses plus lifestyle tiers, then the staff discount.
// A later downgrade does not change a bill that is already pending.

import { assertPlayerAccounts, payAccruedSavings } from './accounts.ts'
import { initialFi, netWorthCents } from './fi.ts'
import {
  SAVINGS_PAY_INTERVAL_DAYS,
  UNUSED_LOAN_LIMIT_CENTS,
} from './constants.ts'
import { billDueForJob, paySalary } from './jobs.ts'
import { lifestyleExpensesCents } from './lifestyle.ts'
import { closeWholePosition } from './trading.ts'
import type {
  AccountLogEvent,
  BillDueEvent,
  BillPaidEvent,
  BillPendingEvent,
  CommandRejectedEvent,
  CoverableCheckEvent,
  GameState,
  MarketDefinitions,
  RunEndedEvent,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

/** Logged on `runEnded` when usable money is below the bill. */
export const RUN_LOST_BILL_REASON = 'cannotCoverBill'

export type PayBillOutcome =
  | { accepted: true; event: BillPaidEvent }
  | { accepted: false; event: CommandRejectedEvent }

type CoverableParts = {
  cashCents: number
  savingsCents: number
  tradingEquityCents: number
  loanLimitCents: number
  totalCents: number
  billCents: number
}

/** True when `day` is 30, 60, 90, 120, or a later multiple of the pay interval. */
export function isMonthlyCycleDay(day: number): boolean {
  return Number.isSafeInteger(day) && day >= SAVINGS_PAY_INTERVAL_DAYS && day % SAVINGS_PAY_INTERVAL_DAYS === 0
}

function requireNonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe integer >= 0, received ${describeValue(value)}`)
  }
  return value
}

function requirePositive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer, received ${describeValue(value)}`)
  }
  return value
}

/**
 * Trading cash after closing every position at the current fill.
 * Fees and the half spread are included. The live book is not changed.
 */
function closedTradingEquityCents(state: GameState, defs: MarketDefinitions): number {
  const ids = Object.keys(state.positions)
  if (ids.length === 0) return state.accounts.tradingCents
  const scratch: GameState = {
    market: state.market,
    accounts: { ...state.accounts },
    section: state.section,
    sleepHours: state.sleepHours,
    job: state.job,
    positions: {},
    realized: [],
    pending: [],
    log: [],
    bill: null,
    runEnd: null,
    fi: initialFi(),
    stats: state.stats,
    consumables: state.consumables,
    lifestyle: state.lifestyle,
  }
  for (const id of ids) {
    const position = state.positions[id]
    if (position === undefined) throw new Error(`position ${id} disappeared during the cover check`)
    scratch.positions[id] = {
      asset: position.asset,
      signedShares: position.signedShares,
      costCents: position.costCents,
    }
  }
  for (const id of ids) closeWholePosition(scratch, defs, id)
  if (Object.keys(scratch.positions).length !== 0) {
    throw new Error('coverable close left a position open')
  }
  if (!Number.isSafeInteger(scratch.accounts.tradingCents)) {
    throw new Error(
      `trading equity after closing is not a safe integer, received ${describeValue(scratch.accounts.tradingCents)}`,
    )
  }
  return scratch.accounts.tradingCents
}

function measureCoverable(state: GameState, defs: MarketDefinitions, billCents: number): CoverableParts {
  const bill = requirePositive(billCents, 'bill')
  const positionsBefore = JSON.stringify(state.positions)
  const realizedBefore = JSON.stringify(state.realized)
  const cashBefore = state.accounts.cashCents
  const tradingBefore = state.accounts.tradingCents
  const savingsBefore = state.accounts.savingsCents
  const accruedBefore = state.accounts.accruedSavingsCents
  const tradingEquityCents = closedTradingEquityCents(state, defs)
  if (JSON.stringify(state.positions) !== positionsBefore) {
    throw new Error('coverable check changed a position')
  }
  if (JSON.stringify(state.realized) !== realizedBefore) {
    throw new Error('coverable check changed realized results')
  }
  if (
    state.accounts.cashCents !== cashBefore ||
    state.accounts.tradingCents !== tradingBefore ||
    state.accounts.savingsCents !== savingsBefore ||
    state.accounts.accruedSavingsCents !== accruedBefore
  ) {
    throw new Error('coverable check changed a balance')
  }
  const cashCents = requireNonNegative(state.accounts.cashCents, 'coverable cash')
  const savingsCents = requireNonNegative(state.accounts.savingsCents, 'coverable savings')
  const loanLimitCents = requireNonNegative(UNUSED_LOAN_LIMIT_CENTS, 'unused loan limit')
  if (!Number.isSafeInteger(tradingEquityCents)) {
    throw new Error(`coverable trading equity is not a safe integer, received ${describeValue(tradingEquityCents)}`)
  }
  const totalCents = cashCents + savingsCents + tradingEquityCents + loanLimitCents
  if (!Number.isSafeInteger(totalCents)) {
    throw new Error(`coverable total is not a safe integer, received ${describeValue(totalCents)}`)
  }
  return { cashCents, savingsCents, tradingEquityCents, loanLimitCents, totalCents, billCents: bill }
}

function coverableEvent(day: number, parts: CoverableParts): CoverableCheckEvent {
  return {
    kind: 'coverableCheck',
    day,
    cashCents: parts.cashCents,
    savingsCents: parts.savingsCents,
    tradingEquityCents: parts.tradingEquityCents,
    loanLimitCents: parts.loanLimitCents,
    totalCents: parts.totalCents,
    billCents: parts.billCents,
  }
}

function payPendingBill(state: GameState): BillPaidEvent {
  const bill = state.bill
  if (bill === null) throw new Error('pay bill called with no pending bill')
  if (state.accounts.cashCents < bill.amountCents) {
    throw new Error(`cash ${state.accounts.cashCents} does not cover bill ${bill.amountCents}`)
  }
  const next = state.accounts.cashCents - bill.amountCents
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new Error(`cash after the bill is not a safe integer, received ${describeValue(next)}`)
  }
  state.accounts.cashCents = next
  state.bill = null
  return {
    kind: 'billPaid',
    day: state.market.day,
    amountCents: bill.amountCents,
    cashCents: next,
  }
}

function loseRun(state: GameState, defs: MarketDefinitions, day: number): RunEndedEvent {
  state.bill = null
  const worth = netWorthCents(state, defs)
  state.runEnd = { outcome: 'lost', day, reason: RUN_LOST_BILL_REASON, netWorthCents: worth, score: 0 }
  return { kind: 'runEnded', day, reason: RUN_LOST_BILL_REASON }
}

/**
 * Salary, savings interest, and the bill for a 30th day.
 * Call this after that day's accrual and before the player acts.
 * A coverable total below the bill ends the run and does not take the cash.
 */
export function applyMonthlyCycle(state: GameState, defs: MarketDefinitions): AccountLogEvent[] {
  const day = state.market.day
  if (!isMonthlyCycleDay(day)) {
    throw new Error(
      `monthly cycle day must be a positive multiple of ${SAVINGS_PAY_INTERVAL_DAYS}, received ${describeValue(day)}`,
    )
  }
  if (state.bill !== null) throw new Error(`a bill is already pending on day ${state.bill.day}`)
  if (state.runEnd !== null) throw new Error(`the run already ended on day ${state.runEnd.day}`)
  const events: AccountLogEvent[] = []
  for (const salaryPaid of paySalary(state, day)) events.push(salaryPaid)
  events.push(payAccruedSavings(state.accounts, day))
  const priced = billDueForJob(state.job, day, lifestyleExpensesCents(state.lifestyle))
  if (priced.perk !== null) events.push(priced.perk)
  const amount = requirePositive(priced.amountCents, 'bill')
  const cashCents = state.accounts.cashCents
  const due: BillDueEvent = { kind: 'billDue', day, amountCents: amount, cashCents }
  events.push(due)
  state.bill = { day, amountCents: amount }
  const parts = measureCoverable(state, defs, amount)
  events.push(coverableEvent(day, parts))
  if (parts.totalCents < amount) {
    events.push(loseRun(state, defs, day))
    assertPlayerAccounts(state.accounts)
    return events
  }
  if (cashCents >= amount) {
    events.push(payPendingBill(state))
    assertPlayerAccounts(state.accounts)
    return events
  }
  const shortfall = amount - cashCents
  if (!Number.isSafeInteger(shortfall) || shortfall <= 0) {
    throw new Error(`bill shortfall must be a positive safe integer, received ${describeValue(shortfall)}`)
  }
  const pending: BillPendingEvent = {
    kind: 'billPending',
    day,
    amountCents: amount,
    cashCents,
    shortfallCents: shortfall,
  }
  events.push(pending)
  assertPlayerAccounts(state.accounts)
  return events
}

/**
 * Cover check while a bill is pending. Ends the run when the total is below the bill.
 * Does not sell, transfer, or take cash.
 */
export function reviewCoverable(state: GameState, defs: MarketDefinitions): Array<CoverableCheckEvent | RunEndedEvent> {
  if (state.bill === null || state.runEnd !== null) return []
  const day = state.market.day
  const parts = measureCoverable(state, defs, state.bill.amountCents)
  const events: Array<CoverableCheckEvent | RunEndedEvent> = [coverableEvent(day, parts)]
  if (parts.totalCents < state.bill.amountCents) events.push(loseRun(state, defs, day))
  return events
}

/** Pay the pending bill from cash, or reject and leave every balance as it was. */
export function interpretPayBill(state: GameState): PayBillOutcome {
  const day = state.market.day
  if (state.runEnd !== null) {
    return { accepted: false, event: { kind: 'commandRejected', day, command: 'payBill', reason: 'runEnded' } }
  }
  if (state.bill === null) {
    return { accepted: false, event: { kind: 'commandRejected', day, command: 'payBill', reason: 'noPendingBill' } }
  }
  if (state.accounts.cashCents < state.bill.amountCents) {
    return { accepted: false, event: { kind: 'commandRejected', day, command: 'payBill', reason: 'insufficientFunds' } }
  }
  return { accepted: true, event: payPendingBill(state) }
}
