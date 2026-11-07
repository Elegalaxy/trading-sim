// Fixed deposits (plan layoffs, loans and deposits, Steps D1 and D2). Cash or savings can be locked
// for 30, 60 or 90 days. The annual rate is fixed on the opening day: max(0, policy - 1.5 + bonus) / 100
// with a bonus of 1, 2 or 3 points for the three terms. Interest is simple, round(principal x rate x
// term / 365), and is paid with the principal into savings in `endDay` after savings accrual, on
// the day the deposit matures. The interest counts as passive income (the FI check). There is no
// rollover.
//
// Breaking a deposit takes the whole deposit: the player gets the principal less 2% and the
// interest is lost. A deposit cannot be opened while a bill or a loan payment is pending. The break
// value counts toward covering a bill, and a missed loan payment sells deposits last, after
// positions and savings, the one that matures last first. Net worth counts principal plus interest
// earned so far. No randomness, no market access.

import { readPolicyRatePercent } from './accounts.ts'
import {
  DEPOSIT_BREAK_PENALTY_PPM,
  DEPOSIT_DAYS_PER_YEAR,
  DEPOSIT_MAX_OPEN,
  DEPOSIT_MIN_CENTS,
  DEPOSIT_TERMS_DAYS,
  DEPOSIT_TERM_BONUS_PERCENT,
  RATE_PPM_SCALE,
  SAVINGS_SPREAD_PERCENT,
} from './constants.ts'
import type {
  AccountLogEvent,
  CommandRejectedEvent,
  Deposit,
  DepositBrokenEvent,
  DepositMaturedEvent,
  DepositOpenedEvent,
  DepositsState,
  GameState,
  MarketDefinitions,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

export type DepositCommandOutcome =
  | { accepted: true; event: DepositOpenedEvent | DepositBrokenEvent }
  | { accepted: false; event: CommandRejectedEvent }

export function initialDeposits(): DepositsState {
  return { nextId: 1, open: [] }
}

/** Reject a deposits block that could not have come from `initialDeposits` plus commands. */
export function assertDeposits(deposits: DepositsState): void {
  if (typeof deposits !== 'object' || deposits === null || Array.isArray(deposits)) {
    throw new Error(`deposits must be an object, received ${describeValue(deposits)}`)
  }
  if (!Number.isSafeInteger(deposits.nextId) || deposits.nextId < 1) {
    throw new Error(`deposit next id must be a safe integer >= 1, received ${describeValue(deposits.nextId)}`)
  }
  if (!Array.isArray(deposits.open) || deposits.open.length > DEPOSIT_MAX_OPEN) {
    throw new Error(`deposits must be a list of at most ${DEPOSIT_MAX_OPEN}, received ${describeValue(deposits.open)}`)
  }
  const seen = new Set<number>()
  for (const deposit of deposits.open) {
    if (typeof deposit !== 'object' || deposit === null) {
      throw new Error(`deposit must be an object, received ${describeValue(deposit)}`)
    }
    if (!Number.isSafeInteger(deposit.id) || deposit.id < 1 || deposit.id >= deposits.nextId || seen.has(deposit.id)) {
      throw new Error(`deposit id must be a unique safe integer below ${deposits.nextId}, received ${describeValue(deposit.id)}`)
    }
    seen.add(deposit.id)
    if (!Number.isSafeInteger(deposit.principalCents) || deposit.principalCents <= 0) {
      throw new Error(`deposit principal must be a positive safe integer, received ${describeValue(deposit.principalCents)}`)
    }
    if (!Number.isSafeInteger(deposit.openedDay) || deposit.openedDay < 0) {
      throw new Error(`deposit opened day must be a safe integer >= 0, received ${describeValue(deposit.openedDay)}`)
    }
    if (!(DEPOSIT_TERMS_DAYS as readonly number[]).includes(deposit.termDays)) {
      throw new Error(`deposit term must be 30, 60 or 90, received ${describeValue(deposit.termDays)}`)
    }
    if (typeof deposit.annualRate !== 'number' || !Number.isFinite(deposit.annualRate) || deposit.annualRate < 0) {
      throw new Error(`deposit rate must be a finite number >= 0, received ${describeValue(deposit.annualRate)}`)
    }
    if (deposit.maturityDay !== deposit.openedDay + deposit.termDays) {
      throw new Error(`deposit maturity day ${deposit.maturityDay} is not opened day plus term`)
    }
  }
}

function rejected(day: number, command: string, reason: string): CommandRejectedEvent {
  return { kind: 'commandRejected', day, command, reason }
}

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

function open(state: GameState): Deposit[] {
  return state.deposits?.open ?? []
}

/** Decimal annual rate for a term at a policy rate. Floored at 0. */
export function depositAnnualRate(policyPercent: number, termDays: 30 | 60 | 90): number {
  if (typeof policyPercent !== 'number' || !Number.isFinite(policyPercent)) {
    throw new Error(`policy rate must be a finite number, received ${describeValue(policyPercent)}`)
  }
  return Math.max(0, policyPercent - SAVINGS_SPREAD_PERCENT + DEPOSIT_TERM_BONUS_PERCENT[termDays]) / 100
}

/** Simple interest over `days` days, rounded half up (all values are >= 0). */
export function depositInterestCents(principalCents: number, annualRate: number, days: number): number {
  const interest = Math.round((principalCents * annualRate * days) / DEPOSIT_DAYS_PER_YEAR)
  if (!Number.isSafeInteger(interest) || interest < 0) {
    throw new Error(`deposit interest is not a safe integer >= 0, received ${describeValue(interest)}`)
  }
  return interest
}

/** Interest the deposit pays at maturity. */
export function depositMaturityInterestCents(deposit: Deposit): number {
  return depositInterestCents(deposit.principalCents, deposit.annualRate, deposit.termDays)
}

/** Principal plus the interest earned so far, pro rata, capped at the term. Used for net worth. */
export function depositValueCents(deposit: Deposit, day: number): number {
  const elapsed = Math.min(Math.max(0, day - deposit.openedDay), deposit.termDays)
  return deposit.principalCents + depositInterestCents(deposit.principalCents, deposit.annualRate, elapsed)
}

/** The penalty a break costs: 2% of the principal. */
export function depositPenaltyCents(deposit: Deposit): number {
  return Math.round((deposit.principalCents * DEPOSIT_BREAK_PENALTY_PPM) / RATE_PPM_SCALE)
}

/** What a break pays: the principal less the penalty. The interest is lost. */
export function depositBreakValueCents(deposit: Deposit): number {
  return deposit.principalCents - depositPenaltyCents(deposit)
}

/** Sum of the break values of every open deposit. */
export function totalBreakValueCents(state: GameState): number {
  let total = 0
  for (const deposit of open(state)) total += depositBreakValueCents(deposit)
  if (!Number.isSafeInteger(total)) throw new Error(`deposit break total is not a safe integer, received ${describeValue(total)}`)
  return total
}

/** Sum of the pro-rata values of every open deposit on `day`. */
export function totalDepositValueCents(state: GameState, day: number): number {
  let total = 0
  for (const deposit of open(state)) total += depositValueCents(deposit, day)
  if (!Number.isSafeInteger(total)) throw new Error(`deposit value total is not a safe integer, received ${describeValue(total)}`)
  return total
}

function loanPaymentPending(state: GameState): boolean {
  return state.loan.interestDueCents + (state.loan.principalDueCents ?? 0) > 0
}

/**
 * Lock cash or savings. Rejected, with nothing changed, for a bad amount, term or source, while a
 * bill or a loan payment is pending, below the minimum, with the maximum already open, or when the
 * source holds less than the amount.
 */
export function interpretOpenDeposit(state: GameState, defs: MarketDefinitions, cmd: unknown): DepositCommandOutcome {
  const day = state.market.day
  const record = typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) ? (cmd as Record<string, unknown>) : {}
  const issue = amountReason(record.amountCents)
  if (issue !== null) return { accepted: false, event: rejected(day, 'openDeposit', issue) }
  const amount = record.amountCents as number
  const term = record.termDays
  if (typeof term !== 'number' || !(DEPOSIT_TERMS_DAYS as readonly number[]).includes(term)) {
    return { accepted: false, event: rejected(day, 'openDeposit', 'unknownTerm') }
  }
  const termDays = term as 30 | 60 | 90
  const from = record.from
  if (from !== 'cash' && from !== 'savings') return { accepted: false, event: rejected(day, 'openDeposit', 'unknownAccount') }
  if (state.bill !== null) return { accepted: false, event: rejected(day, 'openDeposit', 'billPending') }
  if (loanPaymentPending(state)) return { accepted: false, event: rejected(day, 'openDeposit', 'loanPaymentPending') }
  if (amount < DEPOSIT_MIN_CENTS) return { accepted: false, event: rejected(day, 'openDeposit', 'belowMinimum') }
  if (open(state).length >= DEPOSIT_MAX_OPEN) return { accepted: false, event: rejected(day, 'openDeposit', 'tooManyDeposits') }
  const balance = from === 'cash' ? state.accounts.cashCents : state.accounts.savingsCents
  if (amount > balance) return { accepted: false, event: rejected(day, 'openDeposit', 'insufficientFunds') }
  const deposits = state.deposits ?? (state.deposits = initialDeposits())
  const annualRate = depositAnnualRate(readPolicyRatePercent(state.market, defs), termDays)
  const deposit: Deposit = {
    id: deposits.nextId,
    principalCents: amount,
    openedDay: day,
    termDays,
    annualRate,
    maturityDay: day + termDays,
  }
  deposits.nextId += 1
  deposits.open.push(deposit)
  if (from === 'cash') state.accounts.cashCents -= amount
  else state.accounts.savingsCents -= amount
  return {
    accepted: true,
    event: {
      kind: 'depositOpened',
      day,
      id: deposit.id,
      principalCents: amount,
      termDays,
      annualRate,
      maturityDay: deposit.maturityDay,
      from,
    },
  }
}

/** Remove a deposit from the list and return its break event. The caller moves the cents. */
function takeDeposit(state: GameState, id: number, forced: boolean, to: 'cash' | 'savings'): DepositBrokenEvent {
  const deposits = state.deposits
  const index = deposits === undefined ? -1 : deposits.open.findIndex((item) => item.id === id)
  if (deposits === undefined || index < 0) throw new Error(`deposit ${describeValue(id)} is not open`)
  const deposit = deposits.open[index] as Deposit
  deposits.open.splice(index, 1)
  const penaltyCents = depositPenaltyCents(deposit)
  return {
    kind: 'depositBroken',
    day: state.market.day,
    id,
    principalCents: deposit.principalCents,
    paidCents: deposit.principalCents - penaltyCents,
    penaltyCents,
    forced,
    to,
  }
}

/** Break the whole deposit. The principal less the penalty goes to savings, the interest is lost. */
export function interpretBreakDeposit(state: GameState, cmd: unknown): DepositCommandOutcome {
  const day = state.market.day
  const id = typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) ? (cmd as { id?: unknown }).id : undefined
  if (typeof id !== 'number' || !open(state).some((item) => item.id === id)) {
    return { accepted: false, event: rejected(day, 'breakDeposit', 'unknownDeposit') }
  }
  const event = takeDeposit(state, id, false, 'savings')
  state.accounts.savingsCents += event.paidCents
  return { accepted: true, event }
}

/**
 * Break one open deposit for a missed loan payment: the principal less the penalty goes to cash.
 * Used by the loan forced sale, which picks the deposit that matures last first.
 */
export function breakDepositForLoan(state: GameState, id: number): DepositBrokenEvent {
  const event = takeDeposit(state, id, true, 'cash')
  state.accounts.cashCents += event.paidCents
  return event
}

/** Open deposits in forced-sale order: the one that matures last first, the later id first on a tie. */
export function depositsForForcedSale(state: GameState): Deposit[] {
  return open(state)
    .slice()
    .sort((a, b) => b.maturityDay - a.maturityDay || b.id - a.id)
}

/**
 * Pay every deposit that has reached its maturity day: principal plus interest into savings. Call
 * this each day after savings accrual. The `depositMatured` events carry the interest the FI check counts.
 */
export function settleDeposits(state: GameState): AccountLogEvent[] {
  const deposits = state.deposits
  if (deposits === undefined || deposits.open.length === 0) return []
  const day = state.market.day
  const events: AccountLogEvent[] = []
  const keep: Deposit[] = []
  for (const deposit of deposits.open) {
    if (deposit.maturityDay > day) {
      keep.push(deposit)
      continue
    }
    const interestCents = depositMaturityInterestCents(deposit)
    const savings = state.accounts.savingsCents + deposit.principalCents + interestCents
    if (!Number.isSafeInteger(savings)) throw new Error(`savings after a deposit matured is not a safe integer, received ${describeValue(savings)}`)
    state.accounts.savingsCents = savings
    const matured: DepositMaturedEvent = {
      kind: 'depositMatured',
      day,
      id: deposit.id,
      principalCents: deposit.principalCents,
      interestCents,
      savingsCents: savings,
    }
    events.push(matured)
  }
  deposits.open = keep
  return events
}
