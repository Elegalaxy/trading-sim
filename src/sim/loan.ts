// One bank loan. This file does not import content and does not draw a stream.
// The limit uses the job that is active now, not a job on notice.
// Interest accrues daily at (policy + 4 points) / 365 on the principal. On each
// payday (every 30th day) the accrued interest plus an instalment of principal is
// due: the loan is repaid over at most 3 paydays, the first at least 7 days after
// the draw. Early repayment is free and lowers later instalments. Cash pays the
// payment when cash covers it. Otherwise it stays pending until the end of that
// day. The end-of-day sale closes whole positions from the worst unrealized money
// loss, then savings. It never changes lifestyle and it never pays the expense bill.
// `previewLoanSale` runs the same sale on a copy so the UI can show it first.

import { readPolicyRatePercent } from './accounts.ts'
import {
  LOAN_BASE_CENTS,
  LOAN_DAYS_PER_YEAR,
  LOAN_FIRST_PAYMENT_MIN_DAYS,
  LOAN_MAX_PAYMENTS,
  LOAN_RATE_SPREAD_PERCENT,
  LOAN_TIER_CENTS,
  RUN_LENGTH_DAYS,
  SAVINGS_PAY_INTERVAL_DAYS,
} from './constants.ts'
import { netWorthCents } from './fi.ts'
import { previewCopy } from './past.ts'
import { activeJob } from './jobs.ts'
import { assertLifestyle } from './lifestyle.ts'
import { closeTime, recordFill } from './fills.ts'
import { closeWholePosition } from './trading.ts'
import type {
  AccountLogEvent,
  BankLoan,
  CommandRejectedEvent,
  ForcedSaleEvent,
  GameState,
  LoanAccrualEvent,
  LoanInterestDueEvent,
  LoanInterestPaidEvent,
  LoanRepaidEvent,
  LoanTakenEvent,
  MarketDefinitions,
  OpenPosition,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

/** Logged on `runEnded` when a forced sale still cannot pay the interest. */
export const RUN_LOST_LOAN_REASON = 'cannotPayLoanInterest'

export type LoanCommandOutcome =
  | { accepted: true; event: LoanTakenEvent | LoanRepaidEvent }
  | { accepted: false; event: CommandRejectedEvent }

/** No principal and no pending interest. */
export function initialLoan(): BankLoan {
  return { balanceCents: 0, interestDueCents: 0, interestDay: null }
}

/** Reject a loan block that could not have come from `initialLoan` plus commands. */
export function assertLoan(loan: BankLoan): void {
  if (typeof loan !== 'object' || loan === null || Array.isArray(loan)) {
    throw new Error(`loan must be an object, received ${describeValue(loan)}`)
  }
  if (!Number.isSafeInteger(loan.balanceCents) || loan.balanceCents < 0) {
    throw new Error(`loan balance must be a safe integer >= 0, received ${describeValue(loan.balanceCents)}`)
  }
  if (!Number.isSafeInteger(loan.interestDueCents) || loan.interestDueCents < 0) {
    throw new Error(`loan interest due must be a safe integer >= 0, received ${describeValue(loan.interestDueCents)}`)
  }
  for (const key of ['accruedInterestCents', 'principalDueCents', 'paymentsLeft', 'firstPaymentDay'] as const) {
    const value = loan[key]
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`loan ${key} must be a safe integer >= 0, received ${describeValue(value)}`)
    }
  }
  if (principalDue(loan) > loan.balanceCents) {
    throw new Error(`loan principal due ${principalDue(loan)} is above the balance ${loan.balanceCents}`)
  }
  if (pendingPaymentCents(loan) === 0) {
    if (loan.interestDay !== null) {
      throw new Error(`loan interest day must be null when nothing is due, received ${describeValue(loan.interestDay)}`)
    }
    return
  }
  const interestDay = loan.interestDay
  if (interestDay === null || !Number.isSafeInteger(interestDay) || interestDay < 0) {
    throw new Error(`loan interest day must be a safe integer >= 0, received ${describeValue(interestDay)}`)
  }
}

function principalDue(loan: BankLoan): number {
  return loan.principalDueCents ?? 0
}

/** True when a payday on `day` takes principal: no earlier than the first payment day. */
function takesPrincipal(loan: BankLoan, day: number): boolean {
  return day >= (loan.firstPaymentDay ?? 0)
}

/** The payment that cash did not cover on its payday: pending interest plus pending principal. */
export function pendingPaymentCents(loan: BankLoan): number {
  return loan.interestDueCents + principalDue(loan)
}

function rejected(day: number, command: string, reason: string): CommandRejectedEvent {
  return { kind: 'commandRejected', day, command, reason }
}

/** Non-finite and non-integer amounts are rejected before the sign check. */
function amountReason(amount: unknown): string | null {
  if (typeof amount !== 'number') return 'amountNotInteger'
  if (Number.isNaN(amount)) return 'amountNaN'
  if (!Number.isFinite(amount)) return 'amountNotFinite'
  if (!Number.isInteger(amount)) return 'amountNotInteger'
  if (!Number.isSafeInteger(amount)) return 'amountNotSafeInteger'
  if (amount < 0) return 'amountNegative'
  if (amount === 0) return 'amountZero'
  return null
}

/** Half away from zero. `Math.round` alone sends -1.5 to -1. */
function roundHalfAwayFromZero(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`loan amount must be a finite number, received ${describeValue(value)}`)
  }
  const rounded = Math.round(Math.abs(value))
  const delta = value < 0 ? -rounded : rounded
  if (!Number.isSafeInteger(delta)) {
    throw new Error(`loan amount is not a safe integer, received ${describeValue(value)}`)
  }
  return delta
}

/**
 * Decimal annual rate. Negative results are floored at 0, the same way margin
 * interest floors a negative policy-plus-spread rate.
 */
export function loanAnnualRate(policyPercent: number): number {
  if (typeof policyPercent !== 'number' || !Number.isFinite(policyPercent)) {
    throw new Error(`policy rate must be a finite number, received ${describeValue(policyPercent)}`)
  }
  return Math.max(0, policyPercent + LOAN_RATE_SPREAD_PERCENT) / 100
}

/** One day of interest on `balanceCents`. A zero balance is 0. */
export function loanDailyInterestCents(balanceCents: number, policyPercent: number): number {
  if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) {
    throw new Error(`loan balance must be a safe integer >= 0, received ${describeValue(balanceCents)}`)
  }
  const annual = loanAnnualRate(policyPercent)
  return roundHalfAwayFromZero((balanceCents * annual) / LOAN_DAYS_PER_YEAR)
}

/** The first payday (multiple of the pay interval) strictly after `day`. */
export function nextPaydayAfter(day: number): number {
  return (Math.floor(day / SAVINGS_PAY_INTERVAL_DAYS) + 1) * SAVINGS_PAY_INTERVAL_DAYS
}

/** The first payday that takes principal for a loan drawn on `drawDay` (at least the minimum days away). */
export function firstPaymentDay(drawDay: number): number {
  let payday = nextPaydayAfter(drawDay)
  while (payday - drawDay < LOAN_FIRST_PAYMENT_MIN_DAYS) payday += SAVINGS_PAY_INTERVAL_DAYS
  return payday
}

/**
 * Paydays that take principal for a loan drawn on `drawDay`: paydays up to the end of
 * the run that are at least LOAN_FIRST_PAYMENT_MIN_DAYS away, at most LOAN_MAX_PAYMENTS.
 */
export function loanPaymentsFor(drawDay: number): number {
  let count = 0
  let payday = firstPaymentDay(drawDay)
  while (payday <= RUN_LENGTH_DAYS && count < LOAN_MAX_PAYMENTS) {
    count += 1
    payday += SAVINGS_PAY_INTERVAL_DAYS
  }
  return count
}

/** 2E plus the active job's monthly pay plus 0.25E for each lifestyle tier above the base. */
export function loanLimitCents(state: GameState): number {
  assertLifestyle(state.lifestyle)
  if (!Number.isSafeInteger(LOAN_BASE_CENTS) || LOAN_BASE_CENTS < 0) {
    throw new Error(`loan base must be a safe integer >= 0, received ${describeValue(LOAN_BASE_CENTS)}`)
  }
  if (!Number.isSafeInteger(LOAN_TIER_CENTS) || LOAN_TIER_CENTS < 0) {
    throw new Error(`loan tier cents must be a safe integer >= 0, received ${describeValue(LOAN_TIER_CENTS)}`)
  }
  const pay = activeJob(state.job).payCents
  if (!Number.isSafeInteger(pay) || pay < 0) {
    throw new Error(`active job pay must be a safe integer >= 0, received ${describeValue(pay)}`)
  }
  const tiers = state.lifestyle.home + state.lifestyle.infoFeed
  const fromTiers = LOAN_TIER_CENTS * tiers
  const limit = LOAN_BASE_CENTS + pay + fromTiers
  if (!Number.isSafeInteger(tiers) || !Number.isSafeInteger(fromTiers) || !Number.isSafeInteger(limit) || limit < 0) {
    throw new Error(`loan limit is not a safe integer >= 0, received ${describeValue(limit)}`)
  }
  return limit
}

/** Room left under the limit. A balance above the limit leaves 0. */
export function unusedLoanLimitCents(state: GameState): number {
  assertLoan(state.loan)
  const unused = loanLimitCents(state) - state.loan.balanceCents
  if (!Number.isSafeInteger(unused)) {
    throw new Error(`unused loan limit is not a safe integer, received ${describeValue(unused)}`)
  }
  return unused > 0 ? unused : 0
}

function addCash(state: GameState, amount: number, label: string): number {
  const next = state.accounts.cashCents + amount
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new Error(`${label} left cash at ${describeValue(next)}`)
  }
  state.accounts.cashCents = next
  return next
}

/**
 * Draw on the loan and put the cents in cash.
 * A balance already above 0 is a second loan and is rejected.
 * The amount cannot exceed the unused limit.
 */
export function interpretTakeLoan(state: GameState, cmd: unknown): LoanCommandOutcome {
  const day = state.market.day
  assertLoan(state.loan)
  const amount = typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) ? (cmd as { amountCents?: unknown }).amountCents : undefined
  const issue = amountReason(amount)
  if (issue !== null) return { accepted: false, event: rejected(day, 'takeLoan', issue) }
  const cents = amount as number
  if (state.loan.balanceCents > 0) {
    return { accepted: false, event: rejected(day, 'takeLoan', 'loanOutstanding') }
  }
  const limit = loanLimitCents(state)
  const unused = unusedLoanLimitCents(state)
  if (cents > unused) {
    return { accepted: false, event: rejected(day, 'takeLoan', 'aboveLoanLimit') }
  }
  const balance = state.loan.balanceCents + cents
  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw new Error(`loan balance after a draw is not a safe integer, received ${describeValue(balance)}`)
  }
  state.loan.balanceCents = balance
  const paymentsLeft = loanPaymentsFor(day)
  state.loan.paymentsLeft = paymentsLeft
  state.loan.firstPaymentDay = firstPaymentDay(day)
  const cash = addCash(state, cents, 'take loan')
  const event: LoanTakenEvent = {
    kind: 'loanTaken',
    day,
    amountCents: cents,
    balanceCents: balance,
    cashCents: cash,
    limitCents: limit,
    paymentsLeft,
  }
  return { accepted: true, event }
}

/**
 * Repay principal from cash. Any amount up to the balance is free and lowers the
 * later instalments. Pending interest is a separate charge and is not reduced here.
 */
export function interpretRepayLoan(state: GameState, cmd: unknown): LoanCommandOutcome {
  const day = state.market.day
  assertLoan(state.loan)
  const amount = typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) ? (cmd as { amountCents?: unknown }).amountCents : undefined
  const issue = amountReason(amount)
  if (issue !== null) return { accepted: false, event: rejected(day, 'repayLoan', issue) }
  const cents = amount as number
  if (state.loan.balanceCents === 0) {
    return { accepted: false, event: rejected(day, 'repayLoan', 'noLoan') }
  }
  if (cents > state.loan.balanceCents) {
    return { accepted: false, event: rejected(day, 'repayLoan', 'aboveBalance') }
  }
  if (cents > state.accounts.cashCents) {
    return { accepted: false, event: rejected(day, 'repayLoan', 'insufficientFunds') }
  }
  const balance = state.loan.balanceCents - cents
  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw new Error(`loan balance after a repayment is not a safe integer, received ${describeValue(balance)}`)
  }
  state.loan.balanceCents = balance
  // Pending principal cannot exceed what is left. A cleared loan has no schedule.
  if (principalDue(state.loan) > balance) state.loan.principalDueCents = balance
  if (balance === 0) state.loan.paymentsLeft = 0
  if (pendingPaymentCents(state.loan) === 0) state.loan.interestDay = null
  const cash = addCash(state, -cents, 'repay loan')
  const event: LoanRepaidEvent = {
    kind: 'loanRepaid',
    day,
    amountCents: cents,
    balanceCents: balance,
    cashCents: cash,
  }
  return { accepted: true, event }
}

function payPendingPayment(state: GameState): LoanInterestPaidEvent {
  const interest = state.loan.interestDueCents
  const principal = principalDue(state.loan)
  const amount = interest + principal
  if (amount <= 0) throw new Error('loan payment called with nothing due')
  if (state.accounts.cashCents < amount) {
    throw new Error(`cash ${state.accounts.cashCents} does not cover loan payment ${amount}`)
  }
  const cash = addCash(state, -amount, 'loan payment')
  const balance = state.loan.balanceCents - principal
  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw new Error(`loan balance after a payment is not a safe integer >= 0, received ${describeValue(balance)}`)
  }
  state.loan.balanceCents = balance
  state.loan.interestDueCents = 0
  state.loan.principalDueCents = 0
  state.loan.interestDay = null
  if (balance === 0) state.loan.paymentsLeft = 0
  return {
    kind: 'loanInterestPaid',
    day: state.market.day,
    amountCents: interest,
    principalCents: principal,
    cashCents: cash,
    balanceCents: balance,
  }
}

/**
 * Add one day of interest to the accrued total. Call this each day after the market
 * step, next to savings accrual. A zero balance accrues nothing and logs nothing.
 */
export function accrueLoanInterest(state: GameState, defs: MarketDefinitions): AccountLogEvent[] {
  assertLoan(state.loan)
  const balance = state.loan.balanceCents
  if (balance === 0) return []
  const policyRate = readPolicyRatePercent(state.market, defs)
  const accrualCents = loanDailyInterestCents(balance, policyRate)
  const accrued = (state.loan.accruedInterestCents ?? 0) + accrualCents
  if (!Number.isSafeInteger(accrued)) {
    throw new Error(`accrued loan interest is not a safe integer, received ${describeValue(accrued)}`)
  }
  state.loan.accruedInterestCents = accrued
  const event: LoanAccrualEvent = {
    kind: 'loanAccrual',
    day: state.market.day,
    balanceCents: balance,
    policyRate,
    annualRate: loanAnnualRate(policyRate),
    accrualCents,
    accruedCents: accrued,
  }
  return [event]
}

/**
 * Charge this morning's payment: the accrued interest plus an instalment of principal
 * (balance / paymentsLeft, rounded up, so the last payment is the whole balance).
 * Call this from the monthly cycle, after salary and before the expense bill. Nothing
 * owed charges nothing. Cash that covers the payment pays it. Otherwise it stays
 * pending for the end of the day.
 */
export function assessLoanInterest(state: GameState, defs: MarketDefinitions): AccountLogEvent[] {
  assertLoan(state.loan)
  const balance = state.loan.balanceCents
  const interest = state.loan.accruedInterestCents ?? 0
  if (balance === 0 && interest === 0) return []
  if (pendingPaymentCents(state.loan) !== 0) {
    throw new Error(`loan payment is already pending from day ${describeValue(state.loan.interestDay)}`)
  }
  const day = state.market.day
  const policyRate = readPolicyRatePercent(state.market, defs)
  const annualRate = loanAnnualRate(policyRate)
  const left = takesPrincipal(state.loan, day) ? (state.loan.paymentsLeft ?? 0) : 0
  const principal = balance > 0 && left > 0 ? Math.ceil(balance / left) : 0
  state.loan.accruedInterestCents = 0
  if (left > 0) state.loan.paymentsLeft = left - 1
  const amount = interest + principal
  const cashCents = state.accounts.cashCents
  const due: LoanInterestDueEvent = {
    kind: 'loanInterestDue',
    day,
    amountCents: interest,
    principalCents: principal,
    balanceCents: balance,
    cashCents,
    policyRate,
    annualRate,
  }
  if (amount === 0) {
    const paid: LoanInterestPaidEvent = {
      kind: 'loanInterestPaid',
      day,
      amountCents: 0,
      principalCents: 0,
      cashCents,
      balanceCents: balance,
    }
    return [due, paid]
  }
  state.loan.interestDueCents = interest
  state.loan.principalDueCents = principal
  state.loan.interestDay = day
  if (cashCents >= amount) return [due, payPendingPayment(state)]
  return [due]
}

/**
 * Unrealized money result in cents. The worst position is the most negative.
 * Long: price × shares − cost. Short: cost − price × abs(shares).
 * This is the same comparison the margin liquidation uses.
 */
function unrealizedCents(position: OpenPosition, price: number): number {
  if (position.signedShares > 0) {
    const marked = price * position.signedShares
    if (!Number.isSafeInteger(marked)) {
      throw new Error(`long mark for ${position.asset} is not a safe integer, received ${describeValue(marked)}`)
    }
    const pnl = marked - position.costCents
    if (!Number.isSafeInteger(pnl)) {
      throw new Error(`long unrealized for ${position.asset} is not a safe integer, received ${describeValue(pnl)}`)
    }
    return pnl
  }
  const shares = -position.signedShares
  const marked = price * shares
  if (!Number.isSafeInteger(marked)) {
    throw new Error(`short mark for ${position.asset} is not a safe integer, received ${describeValue(marked)}`)
  }
  const pnl = position.costCents - marked
  if (!Number.isSafeInteger(pnl)) {
    throw new Error(`short unrealized for ${position.asset} is not a safe integer, received ${describeValue(pnl)}`)
  }
  return pnl
}

/** Most negative unrealized result. Equal results keep the earlier definition. */
function worstAsset(state: GameState, defs: MarketDefinitions): string {
  let worstId = ''
  let worstPnl = 0
  let found = false
  for (const def of defs.assets) {
    const position = state.positions[def.id]
    if (position === undefined) continue
    const price = state.market.assets[def.id]?.priceCents
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new Error(`asset ${def.id} price must be a positive safe integer, received ${describeValue(price)}`)
    }
    const pnl = unrealizedCents(position, price)
    if (!found || pnl < worstPnl) {
      found = true
      worstId = def.id
      worstPnl = pnl
    }
  }
  if (!found) throw new Error('loan forced sale found no open position')
  return worstId
}

function hasOpenPosition(state: GameState, defs: MarketDefinitions): boolean {
  for (const def of defs.assets) {
    if (state.positions[def.id] !== undefined) return true
  }
  return false
}

/**
 * Close one whole position and move as much of the new trading cash as the
 * interest still needs into cash. Returns the cents moved. Prices are not written.
 */
function sellPositionForInterest(state: GameState, defs: MarketDefinitions, assetId: string): number {
  const before = state.accounts.tradingCents
  const close = closeWholePosition(state, defs, assetId)
  recordFill(state, {
    asset: close.asset,
    side: close.side,
    quantity: close.quantity,
    fillCents: close.fillPrice,
    feeCents: close.fee,
    realizedCents: close.realizedCents,
    slippageCents: close.slippage,
    via: 'forcedSale',
    time: closeTime(),
  })
  const after = state.accounts.tradingCents
  const beforePositive = before > 0 ? before : 0
  const afterPositive = after > 0 ? after : 0
  const raised = afterPositive - beforePositive
  if (!Number.isSafeInteger(raised)) {
    throw new Error(`loan sale proceeds are not a safe integer, received ${describeValue(raised)}`)
  }
  const need = pendingPaymentCents(state.loan) - state.accounts.cashCents
  if (!Number.isSafeInteger(need) || need <= 0) return 0
  const moved = Math.min(Math.max(0, raised), need)
  if (!Number.isSafeInteger(moved) || moved < 0) {
    throw new Error(`loan sale transfer is not a safe integer, received ${describeValue(moved)}`)
  }
  if (moved === 0) return 0
  const nextTrading = after - moved
  if (!Number.isSafeInteger(nextTrading)) {
    throw new Error(`trading cash after a loan sale is not a safe integer, received ${describeValue(nextTrading)}`)
  }
  state.accounts.tradingCents = nextTrading
  addCash(state, moved, 'loan sale')
  return moved
}

function takeSavingsForInterest(state: GameState): number {
  const need = pendingPaymentCents(state.loan) - state.accounts.cashCents
  if (!Number.isSafeInteger(need) || need <= 0) return 0
  if (state.accounts.savingsCents <= 0) return 0
  const moved = Math.min(state.accounts.savingsCents, need)
  if (!Number.isSafeInteger(moved) || moved <= 0) {
    throw new Error(`savings used for loan interest is not a positive safe integer, received ${describeValue(moved)}`)
  }
  const savings = state.accounts.savingsCents - moved
  if (!Number.isSafeInteger(savings) || savings < 0) {
    throw new Error(`savings after a loan sale is not a safe integer, received ${describeValue(savings)}`)
  }
  state.accounts.savingsCents = savings
  addCash(state, moved, 'loan savings')
  return moved
}

/**
 * Collect interest that was left unpaid this morning.
 * Call this at the end of that day, before the market steps.
 * Positions go first, worst unrealized loss first, then savings.
 * Lifestyle is left as it was. A remaining shortfall ends the run.
 * Nothing is due when this returns an empty list.
 */
export function settleMissedLoanInterest(state: GameState, defs: MarketDefinitions): AccountLogEvent[] {
  assertLoan(state.loan)
  if (pendingPaymentCents(state.loan) === 0) return []
  const day = state.market.day
  if (state.loan.interestDay !== day) {
    throw new Error(
      `unpaid loan payment from day ${describeValue(state.loan.interestDay)} cannot be settled on day ${describeValue(day)}`,
    )
  }
  const home = state.lifestyle.home
  const infoFeed = state.lifestyle.infoFeed
  if (state.accounts.cashCents >= pendingPaymentCents(state.loan)) {
    return [payPendingPayment(state)]
  }
  const events: AccountLogEvent[] = []
  const limit = defs.assets.length
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('loan forced sale needs an asset list')
  let closed = 0
  while (state.accounts.cashCents < pendingPaymentCents(state.loan) && hasOpenPosition(state, defs)) {
    if (closed >= limit) throw new Error('loan forced sale did not finish within the asset count')
    const asset = worstAsset(state, defs)
    const amountCents = sellPositionForInterest(state, defs, asset)
    const sale: ForcedSaleEvent = { kind: 'forcedSale', day, source: asset, amountCents }
    events.push(sale)
    closed += 1
  }
  if (state.accounts.cashCents < pendingPaymentCents(state.loan)) {
    const amountCents = takeSavingsForInterest(state)
    if (amountCents > 0) {
      const sale: ForcedSaleEvent = { kind: 'forcedSale', day, source: 'savings', amountCents }
      events.push(sale)
    }
  }
  if (state.lifestyle.home !== home || state.lifestyle.infoFeed !== infoFeed) {
    throw new Error('loan forced sale changed lifestyle')
  }
  if (state.accounts.cashCents >= pendingPaymentCents(state.loan)) {
    events.push(payPendingPayment(state))
    return events
  }
  const worth = netWorthCents(state, defs)
  state.runEnd = { outcome: 'lost', day, reason: RUN_LOST_LOAN_REASON, netWorthCents: worth, score: 0 }
  events.push({ kind: 'runEnded', day, reason: RUN_LOST_LOAN_REASON })
  return events
}

/** The payment the next payday takes (or, once assessed, the one that is pending). */
export type LoanPaymentEstimate = {
  /** Payday of the payment. */
  day: number
  interestCents: number
  principalCents: number
  totalCents: number
  /** True when the payment was already assessed and cash did not cover it. */
  pending: boolean
  /** Days from the current day to `day`. 0 when pending. */
  daysAway: number
}

/**
 * The next loan payment: the pending one, or an estimate for the next payday made of
 * the interest accrued so far plus the days left at today's balance and policy rate,
 * and the next instalment of principal. Null when nothing is owed or no payday is
 * left in the run. The estimate can move if the policy rate moves.
 */
export function nextLoanPayment(state: GameState, defs: MarketDefinitions): LoanPaymentEstimate | null {
  assertLoan(state.loan)
  const loan = state.loan
  const day = state.market.day
  if (pendingPaymentCents(loan) > 0) {
    const interestCents = loan.interestDueCents
    const principalCents = principalDue(loan)
    return { day: loan.interestDay ?? day, interestCents, principalCents, totalCents: interestCents + principalCents, pending: true, daysAway: 0 }
  }
  const accrued = loan.accruedInterestCents ?? 0
  if (loan.balanceCents === 0 && accrued === 0) return null
  const payday = nextPaydayAfter(day)
  if (payday > RUN_LENGTH_DAYS) return null
  const daysAway = payday - day
  const daily = loanDailyInterestCents(loan.balanceCents, readPolicyRatePercent(state.market, defs))
  const interestCents = accrued + daily * daysAway
  const left = takesPrincipal(loan, payday) ? (loan.paymentsLeft ?? 0) : 0
  const principalCents = loan.balanceCents > 0 && left > 0 ? Math.ceil(loan.balanceCents / left) : 0
  return { day: payday, interestCents, principalCents, totalCents: interestCents + principalCents, pending: false, daysAway }
}

/** The total of `nextLoanPayment`, or 0 when there is none. */
export function estimatedPaymentCents(state: GameState, defs: MarketDefinitions): number {
  return nextLoanPayment(state, defs)?.totalCents ?? 0
}

/** What End day sells for a pending loan payment. `source` is an asset id or `savings`. */
export type LoanSalePreview = {
  /** The pending payment. 0 means nothing is pending and nothing sells. */
  dueCents: number
  cashCents: number
  /** Positions in sale order, then savings. `amountCents` is what each step moves to cash. */
  steps: Array<{ source: string; amountCents: number }>
  /** True when the sale still cannot pay the payment, so the run is lost. */
  endsRun: boolean
}

/**
 * Run the real forced sale on a copy of the state and report it. The state passed in is
 * not changed. The copy leaves out `past` and `fills`, which the sale never reads.
 */
export function previewLoanSale(state: GameState, defs: MarketDefinitions): LoanSalePreview {
  assertLoan(state.loan)
  const dueCents = pendingPaymentCents(state.loan)
  const cashCents = state.accounts.cashCents
  if (dueCents === 0 || state.runEnd !== null) return { dueCents, cashCents, steps: [], endsRun: false }
  const copy = previewCopy(state)
  const events = settleMissedLoanInterest(copy, defs)
  const steps: LoanSalePreview['steps'] = []
  for (const event of events) {
    if (event.kind === 'forcedSale') steps.push({ source: event.source, amountCents: event.amountCents })
  }
  return { dueCents, cashCents, steps, endsRun: copy.runEnd !== null }
}

/** One payday of a loan schedule: the instalment of principal and the interest accrued since the last payday. */
export type LoanScheduleRow = { day: number; principalCents: number; interestCents: number }

/**
 * The payments a loan of `amountCents` drawn on `drawDay` would take if it is left alone
 * and the policy rate stays at `policyPercent`. The same rules as the real paydays:
 * interest only before the first payment day, then equal-ish instalments (rounded up,
 * the last one the whole balance). Used for the schedule shown before the draw.
 */
export function projectLoanSchedule(amountCents: number, drawDay: number, policyPercent: number): LoanScheduleRow[] {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return []
  const rows: LoanScheduleRow[] = []
  const first = firstPaymentDay(drawDay)
  let left = loanPaymentsFor(drawDay)
  let balance = amountCents
  let previous = drawDay
  for (let day = nextPaydayAfter(drawDay); day <= RUN_LENGTH_DAYS; day += SAVINGS_PAY_INTERVAL_DAYS) {
    const interestCents = loanDailyInterestCents(balance, policyPercent) * (day - previous)
    const principalCents = day >= first && left > 0 ? Math.ceil(balance / left) : 0
    if (principalCents > 0) left -= 1
    balance -= principalCents
    rows.push({ day, principalCents, interestCents })
    previous = day
    if (balance === 0) break
  }
  return rows
}
