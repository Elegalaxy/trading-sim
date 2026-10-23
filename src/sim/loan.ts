// One bank loan. This file does not import content and does not draw a stream.
// The limit uses the job that is active now, not a job on notice.
// Interest is one month of (policy + 4 points) on the principal, due with the
// bill on each 30th day. Cash pays it when cash covers it. Otherwise it stays
// pending until the end of that day. The end-of-day sale closes whole positions
// from the worst unrealized money loss, then savings. It never changes lifestyle
// and it never pays the expense bill.

import { readPolicyRatePercent } from './accounts.ts'
import {
  LOAN_BASE_CENTS,
  LOAN_MONTHS_PER_YEAR,
  LOAN_RATE_SPREAD_PERCENT,
  LOAN_TIER_CENTS,
} from './constants.ts'
import { netWorthCents } from './fi.ts'
import { activeJob } from './jobs.ts'
import { assertLifestyle } from './lifestyle.ts'
import { closeWholePosition } from './trading.ts'
import type {
  AccountLogEvent,
  BankLoan,
  CommandRejectedEvent,
  ForcedSaleEvent,
  GameState,
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
  if (loan.interestDueCents === 0) {
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

/** Monthly interest on `balanceCents`. A zero balance is 0. */
export function loanInterestCents(balanceCents: number, policyPercent: number): number {
  if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) {
    throw new Error(`loan balance must be a safe integer >= 0, received ${describeValue(balanceCents)}`)
  }
  if (!Number.isSafeInteger(LOAN_MONTHS_PER_YEAR) || LOAN_MONTHS_PER_YEAR <= 0) {
    throw new Error(`loan months per year must be a positive safe integer, received ${describeValue(LOAN_MONTHS_PER_YEAR)}`)
  }
  const annual = loanAnnualRate(policyPercent)
  return roundHalfAwayFromZero((balanceCents * annual) / LOAN_MONTHS_PER_YEAR)
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
  const cash = addCash(state, cents, 'take loan')
  const event: LoanTakenEvent = {
    kind: 'loanTaken',
    day,
    amountCents: cents,
    balanceCents: balance,
    cashCents: cash,
    limitCents: limit,
  }
  return { accepted: true, event }
}

/**
 * Repay principal from cash. Any amount up to the balance is free.
 * Pending interest is a separate charge and is not reduced here.
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

function payPendingInterest(state: GameState): LoanInterestPaidEvent {
  const amount = state.loan.interestDueCents
  if (amount <= 0) throw new Error('loan interest payment called with nothing due')
  if (state.accounts.cashCents < amount) {
    throw new Error(`cash ${state.accounts.cashCents} does not cover loan interest ${amount}`)
  }
  const cash = addCash(state, -amount, 'loan interest')
  const balance = state.loan.balanceCents
  state.loan.interestDueCents = 0
  state.loan.interestDay = null
  return {
    kind: 'loanInterestPaid',
    day: state.market.day,
    amountCents: amount,
    cashCents: cash,
    balanceCents: balance,
  }
}

/**
 * Charge this morning's interest. Call this from the monthly cycle, after salary
 * and before the expense bill. A zero balance charges nothing. Cash that covers
 * the charge pays it. Otherwise the charge stays pending for the end of the day.
 */
export function assessLoanInterest(state: GameState, defs: MarketDefinitions): AccountLogEvent[] {
  assertLoan(state.loan)
  const balance = state.loan.balanceCents
  if (balance === 0) return []
  if (state.loan.interestDueCents !== 0) {
    throw new Error(`loan interest is already pending from day ${describeValue(state.loan.interestDay)}`)
  }
  const day = state.market.day
  const policyRate = readPolicyRatePercent(state.market, defs)
  const annualRate = loanAnnualRate(policyRate)
  const amount = loanInterestCents(balance, policyRate)
  const cashCents = state.accounts.cashCents
  const due: LoanInterestDueEvent = {
    kind: 'loanInterestDue',
    day,
    amountCents: amount,
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
      cashCents,
      balanceCents: balance,
    }
    return [due, paid]
  }
  if (cashCents >= amount) {
    state.loan.interestDueCents = amount
    state.loan.interestDay = day
    const paid = payPendingInterest(state)
    return [due, paid]
  }
  state.loan.interestDueCents = amount
  state.loan.interestDay = day
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
  closeWholePosition(state, defs, assetId)
  const after = state.accounts.tradingCents
  const beforePositive = before > 0 ? before : 0
  const afterPositive = after > 0 ? after : 0
  const raised = afterPositive - beforePositive
  if (!Number.isSafeInteger(raised)) {
    throw new Error(`loan sale proceeds are not a safe integer, received ${describeValue(raised)}`)
  }
  const need = state.loan.interestDueCents - state.accounts.cashCents
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
  const need = state.loan.interestDueCents - state.accounts.cashCents
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
  if (state.loan.interestDueCents === 0) return []
  const day = state.market.day
  if (state.loan.interestDay !== day) {
    throw new Error(
      `unpaid loan interest from day ${describeValue(state.loan.interestDay)} cannot be settled on day ${describeValue(day)}`,
    )
  }
  const home = state.lifestyle.home
  const infoFeed = state.lifestyle.infoFeed
  if (state.accounts.cashCents >= state.loan.interestDueCents) {
    return [payPendingInterest(state)]
  }
  const events: AccountLogEvent[] = []
  const limit = defs.assets.length
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('loan forced sale needs an asset list')
  let closed = 0
  while (state.accounts.cashCents < state.loan.interestDueCents && hasOpenPosition(state, defs)) {
    if (closed >= limit) throw new Error('loan forced sale did not finish within the asset count')
    const asset = worstAsset(state, defs)
    const amountCents = sellPositionForInterest(state, defs, asset)
    const sale: ForcedSaleEvent = { kind: 'forcedSale', day, source: asset, amountCents }
    events.push(sale)
    closed += 1
  }
  if (state.accounts.cashCents < state.loan.interestDueCents) {
    const amountCents = takeSavingsForInterest(state)
    if (amountCents > 0) {
      const sale: ForcedSaleEvent = { kind: 'forcedSale', day, source: 'savings', amountCents }
      events.push(sale)
    }
  }
  if (state.lifestyle.home !== home || state.lifestyle.infoFeed !== infoFeed) {
    throw new Error('loan forced sale changed lifestyle')
  }
  if (state.accounts.cashCents >= state.loan.interestDueCents) {
    events.push(payPendingInterest(state))
    return events
  }
  const worth = netWorthCents(state, defs)
  state.runEnd = { outcome: 'lost', day, reason: RUN_LOST_LOAN_REASON, netWorthCents: worth, score: 0 }
  events.push({ kind: 'runEnded', day, reason: RUN_LOST_LOAN_REASON })
  return events
}
