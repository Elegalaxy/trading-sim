// Player accounts. Transfers and savings interest do not draw a random stream
// and do not write to the market. Interest uses the policy rate after the
// market step; the formula is next to the savings constants.

import {
  POLICY_RATE_ENTRY_ID,
  SAVINGS_DAYS_PER_YEAR,
  SAVINGS_PAY_INTERVAL_DAYS,
  SAVINGS_SPREAD_PERCENT,
} from './constants.ts'
import {
  ACCOUNT_NAMES,
  type AccountLogEvent,
  type AccountName,
  type CommandRejectedEvent,
  type MarketDefinitions,
  type MarketState,
  type PlayerAccounts,
  type SavingsAccrualEvent,
  type SavingsInterestPaidEvent,
  type TransferEvent,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

export type CommandOutcome =
  | { accepted: true; event: TransferEvent }
  | { accepted: false; event: CommandRejectedEvent }

export function assertPlayerAccounts(accounts: PlayerAccounts): void {
  if (typeof accounts !== 'object' || accounts === null || Array.isArray(accounts)) {
    throw new Error(`player accounts must be an object, received ${describeValue(accounts)}`)
  }
  for (const key of ['cashCents', 'tradingCents', 'savingsCents', 'accruedSavingsCents'] as const) {
    const value = accounts[key]
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`player ${key} must be a safe integer >= 0, received ${describeValue(value)}`)
    }
  }
}

function assertOpenDay(day: number): void {
  if (!Number.isSafeInteger(day) || day < 0) {
    throw new Error(`account day must be a safe integer >= 0, received ${describeValue(day)}`)
  }
}

export function isAccountName(value: unknown): value is AccountName {
  return typeof value === 'string' && (ACCOUNT_NAMES as readonly string[]).includes(value)
}

function balanceOf(accounts: PlayerAccounts, name: AccountName): number {
  if (name === 'cash') return accounts.cashCents
  if (name === 'trading') return accounts.tradingCents
  return accounts.savingsCents
}

function setBalance(accounts: PlayerAccounts, name: AccountName, cents: number): void {
  if (name === 'cash') accounts.cashCents = cents
  else if (name === 'trading') accounts.tradingCents = cents
  else accounts.savingsCents = cents
}

function commandName(cmd: unknown): string {
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return 'invalid'
  if (!Object.hasOwn(cmd, 'type')) return 'invalid'
  const type = (cmd as { type: unknown }).type
  if (typeof type !== 'string' || type.length === 0 || /[\r\n]/.test(type)) return 'invalid'
  return type
}

function accountLabel(value: unknown): string {
  if (typeof value === 'string') {
    if (/[\r\n]/.test(value)) return 'invalid'
    return value
  }
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  const text = String(value)
  if (/[\r\n]/.test(text)) return 'invalid'
  return text
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

function rejected(day: number, command: string, reason: string, account?: string): CommandRejectedEvent {
  const event: CommandRejectedEvent = { kind: 'commandRejected', day, command, reason }
  if (account !== undefined) event.account = account
  return event
}

/**
 * Move an exact cent amount, or reject the command and leave every balance as it was.
 * The only accepted command is `transfer`.
 */
export function interpretCommand(accounts: PlayerAccounts, day: number, cmd: unknown): CommandOutcome {
  assertPlayerAccounts(accounts)
  assertOpenDay(day)
  const command = commandName(cmd)
  if (command !== 'transfer') {
    return { accepted: false, event: rejected(day, command, 'notTransfer') }
  }
  const record = cmd as { from?: unknown; to?: unknown; amountCents?: unknown }
  const amountIssue = amountReason(record.amountCents)
  if (amountIssue !== null) {
    return { accepted: false, event: rejected(day, 'transfer', amountIssue) }
  }
  const amount = record.amountCents as number
  if (!isAccountName(record.from)) {
    return { accepted: false, event: rejected(day, 'transfer', 'unknownAccount', accountLabel(record.from)) }
  }
  if (!isAccountName(record.to)) {
    return { accepted: false, event: rejected(day, 'transfer', 'unknownAccount', accountLabel(record.to)) }
  }
  if (record.from === record.to) {
    return { accepted: false, event: rejected(day, 'transfer', 'sameAccount') }
  }
  const source = balanceOf(accounts, record.from)
  if (amount > source) {
    return { accepted: false, event: rejected(day, 'transfer', 'insufficientFunds') }
  }
  const destination = balanceOf(accounts, record.to)
  const nextSource = source - amount
  const nextDestination = destination + amount
  if (!Number.isSafeInteger(nextSource) || nextSource < 0) {
    throw new Error(`transfer left ${record.from} at ${nextSource} cents`)
  }
  if (!Number.isSafeInteger(nextDestination) || nextDestination < 0) {
    throw new Error(`transfer left ${record.to} at ${nextDestination} cents`)
  }
  setBalance(accounts, record.from, nextSource)
  setBalance(accounts, record.to, nextDestination)
  const event: TransferEvent = {
    kind: 'transfer',
    day,
    from: record.from,
    to: record.to,
    amountCents: amount,
    cashCents: accounts.cashCents,
    tradingCents: accounts.tradingCents,
    savingsCents: accounts.savingsCents,
  }
  return { accepted: true, event }
}

/** Half away from zero. `Math.round` alone sends -1.5 to -1. */
function roundHalfAwayFromZero(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`savings accrual must be a finite number, received ${describeValue(value)}`)
  }
  const rounded = Math.round(Math.abs(value))
  const delta = value < 0 ? -rounded : rounded
  if (!Number.isSafeInteger(delta)) {
    throw new Error(`savings accrual is not a safe integer, received ${describeValue(value)}`)
  }
  return delta
}

function addCents(left: number, right: number, label: string): number {
  const sum = left + right
  if (!Number.isSafeInteger(sum) || sum < 0) {
    throw new Error(`${label} must be a safe integer >= 0, received ${describeValue(sum)}`)
  }
  return sum
}

/** Calendar name when the run has one, otherwise the provisional `policyRate` id. */
export function policyRateEntryId(defs: MarketDefinitions): string {
  const named = defs.calendar?.policyEntryId
  if (named === undefined) return POLICY_RATE_ENTRY_ID
  if (typeof named !== 'string' || named.length === 0) {
    throw new Error(`policy rate entry id must be a non-empty string, received ${describeValue(named)}`)
  }
  return named
}

function policyEntry(market: MarketState, defs: MarketDefinitions): { id: string; value: number } {
  const id = policyRateEntryId(defs)
  const entry = market.environment.find((item) => item.id === id)
  if (entry === undefined) {
    throw new Error(`savings interest needs environment entry ${id}`)
  }
  if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
    throw new Error(`policy rate ${id} must be a finite number, received ${describeValue(entry.value)}`)
  }
  return { id, value: entry.value }
}

/** Reads the current policy rate. Call this after the market step so today's decision counts. */
export function readPolicyRatePercent(market: MarketState, defs: MarketDefinitions): number {
  return policyEntry(market, defs).value
}

/** Throws before the day advances when the policy entry is missing. */
export function assertPolicyRateEntry(market: MarketState, defs: MarketDefinitions): void {
  policyEntry(market, defs)
}

/**
 * Accrue one day, then pay on each 30th day.
 * Inputs logged on the events: savings balance, policy percent, annual rate,
 * today's cents, and the accumulator before and after payment.
 */
export function settleSavings(accounts: PlayerAccounts, day: number, policyPercent: number): AccountLogEvent[] {
  assertPlayerAccounts(accounts)
  if (!Number.isSafeInteger(day) || day < 1) {
    throw new Error(`savings day must be a safe integer >= 1, received ${describeValue(day)}`)
  }
  if (typeof policyPercent !== 'number' || !Number.isFinite(policyPercent)) {
    throw new Error(`policy rate must be a finite number, received ${describeValue(policyPercent)}`)
  }
  const annualRate = Math.max(0, policyPercent - SAVINGS_SPREAD_PERCENT) / 100
  const accrualCents = roundHalfAwayFromZero((accounts.savingsCents * annualRate) / SAVINGS_DAYS_PER_YEAR)
  if (accrualCents < 0) {
    throw new Error(`savings accrual must be >= 0, received ${accrualCents}`)
  }
  accounts.accruedSavingsCents = addCents(accounts.accruedSavingsCents, accrualCents, 'savings accrual')
  const accrual: SavingsAccrualEvent = {
    kind: 'savingsAccrual',
    day,
    savingsCents: accounts.savingsCents,
    policyRate: policyPercent,
    annualRate,
    accrualCents,
    accruedCents: accounts.accruedSavingsCents,
  }
  const events: AccountLogEvent[] = [accrual]
  if (day % SAVINGS_PAY_INTERVAL_DAYS !== 0) return events
  const amountCents = accounts.accruedSavingsCents
  accounts.savingsCents = addCents(accounts.savingsCents, amountCents, 'savings interest')
  accounts.accruedSavingsCents = 0
  const paid: SavingsInterestPaidEvent = {
    kind: 'savingsInterestPaid',
    day,
    amountCents,
    savingsCents: accounts.savingsCents,
    accruedCents: 0,
  }
  events.push(paid)
  return events
}
