// Player time. `applyCommand` and `endDay` are the harness and UI entry points.
// `endDay` steps the market once, then charges margin interest, short borrow,
// the margin check, and savings accrual. It then updates energy and stress for
// the job that just finished. On day 30, 60, 90, 120, and later 30th days it
// runs the monthly cycle before the player acts, then the FI check. It does not draw a random stream of its own,
// and it does not write player lines onto the market. Orders never change prices.
// A jobless day starts at the end of sleep. A day with a job starts at work.
// `skip` opens the market from the end of work, or from the end of sleep when
// jobless. Orders before the market are rejected. End day is allowed in any
// section, except while a bill is pending or the run has ended. The next day
// starts at sleep or at work, following the job that is active that morning.
// Day 120 does not step again. The bill from the start of that day still blocks
// End day. After it is paid, End day seals the run at the day-120 prices.

import {
  assertPlayerAccounts,
  assertPolicyRateEntry,
  interpretCommand,
  readPolicyRatePercent,
  settleSavings,
} from './accounts.ts'
import {
  RUN_LENGTH_DAYS,
  SAVINGS_PAY_INTERVAL_DAYS,
  STARTING_CASH_CENTS,
  STARTING_SAVINGS_CENTS,
  STARTING_TRADING_CENTS,
} from './constants.ts'
import { assertDayState, interpretSkip, isDaySection } from './day.ts'
import { assertPerception, copySocialPosts, shownFeed, undistortedFeed } from './distortion.ts'
import {
  activeJob,
  applyDueJobChange,
  assertPlayerJob,
  initialPlayerJob,
  interpretSetJob,
  playerIsJobless,
  recordJobDay,
  sectionForJob,
} from './jobs.ts'
import { applyFiCheck, finishAtDayLimit, initialFi } from './fi.ts'
import {
  assertLifestyle,
  assertLifestyleCommand,
  initialLifestyle,
  interpretBuyCourse,
  interpretSetLifestyle,
  playerVisibleFeed,
} from './lifestyle.ts'
import { assertLoan, initialLoan, interpretRepayLoan, interpretTakeLoan, settleMissedLoanInterest } from './loan.ts'
import { settleMargin, settleMarginInterest } from './margin.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { applyMonthlyCycle, interpretPayBill, isMonthlyCycleDay, reviewCoverable } from './monthly.ts'
import {
  applyEndOfDayStats,
  assertPlayerStats,
  assertStatsCommand,
  copyConsumables,
  initialStats,
  interpretConsume,
  interpretReadNews,
  interpretVerify,
} from './stats.ts'
import { interpretOrder, settleBorrowFees, tradingEquity } from './trading.ts'
import {
  RUN_OUTCOMES,
  type AccountLogEvent,
  type CommandLogEvent,
  type FiTracker,
  type GameState,
  type ConsumableDefinition,
  type JobDefinition,
  type MarketDefinitions,
  type OpenPosition,
  type ShownFeed,
  type SocialPostDefinition,
  type PendingBill,
  type RealizedDay,
  type RunEnd,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

function assertDefinitionsObject(defs: MarketDefinitions): void {
  if (typeof defs !== 'object' || defs === null || Array.isArray(defs)) {
    throw new Error(`market definitions must be an object, received ${describeValue(defs)}`)
  }
}

function assertSafeInteger(value: unknown, label: string, allowNegative: boolean): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new Error(
      `${label} must be a safe integer${allowNegative ? '' : ' >= 0'}, received ${describeValue(value)}`,
    )
  }
}

function assertPending(pending: readonly CommandLogEvent[]): void {
  for (const event of pending) {
    if (typeof event !== 'object' || event === null) {
      throw new Error(`pending account event must be an object, received ${describeValue(event)}`)
    }
    const kind = (event as { kind?: unknown }).kind
    if (
      kind !== 'transfer' &&
      kind !== 'commandRejected' &&
      kind !== 'orderFill' &&
      kind !== 'realized' &&
      kind !== 'skip' &&
      kind !== 'sectionChange' &&
      kind !== 'jobChangeRequested' &&
      kind !== 'billPaid' &&
      kind !== 'coverableCheck' &&
      kind !== 'runEnded' &&
      kind !== 'statChange' &&
      kind !== 'consume' &&
      kind !== 'newsRead' &&
      kind !== 'newsVerified' &&
      kind !== 'lifestyleChange' &&
      kind !== 'coursePurchased' &&
      kind !== 'loanTaken' &&
      kind !== 'loanRepaid'
    ) {
      throw new Error(`pending account event must be a command, received ${describeValue(kind)}`)
    }
    if (kind === 'statChange' || kind === 'consume' || kind === 'newsRead' || kind === 'newsVerified') {
      assertStatsCommand(event)
    }
    if (kind === 'lifestyleChange' || kind === 'coursePurchased') {
      assertLifestyleCommand(event)
    }
    if (kind === 'skip' || kind === 'sectionChange') {
      const from = (event as { from?: unknown }).from
      const to = (event as { to?: unknown }).to
      if (!isDaySection(from) || !isDaySection(to)) {
        throw new Error(
          `pending ${kind} from and to must be sections, received ${describeValue(from)} -> ${describeValue(to)}`,
        )
      }
    }
    if (event.kind === 'jobChangeRequested') {
      assertSafeInteger(event.day, 'pending job request day', false)
      if (typeof event.from !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(event.from)) {
        throw new Error(`pending job request from must be an id token, received ${describeValue(event.from)}`)
      }
      if (typeof event.to !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(event.to)) {
        throw new Error(`pending job request to must be an id token, received ${describeValue(event.to)}`)
      }
      assertSafeInteger(event.effectiveDay, 'pending job request effective day', false)
      if (event.effectiveDay < event.day) {
        throw new Error(`pending job request effective day ${event.effectiveDay} is before day ${event.day}`)
      }
    }
    if (event.kind === 'billPaid') {
      assertSafeInteger(event.day, 'pending bill payment day', false)
      assertSafeInteger(event.amountCents, 'pending bill payment amount', false)
      assertSafeInteger(event.cashCents, 'pending bill payment cash', false)
      if (event.amountCents <= 0) {
        throw new Error(`pending bill payment amount must be > 0, received ${describeValue(event.amountCents)}`)
      }
    }
    if (event.kind === 'coverableCheck') {
      assertSafeInteger(event.day, 'pending cover check day', false)
      assertSafeInteger(event.cashCents, 'pending cover check cash', false)
      assertSafeInteger(event.savingsCents, 'pending cover check savings', false)
      assertSafeInteger(event.tradingEquityCents, 'pending cover check trading equity', true)
      assertSafeInteger(event.loanLimitCents, 'pending cover check loan limit', false)
      assertSafeInteger(event.totalCents, 'pending cover check total', true)
      assertSafeInteger(event.billCents, 'pending cover check bill', false)
      if (event.billCents <= 0) {
        throw new Error(`pending cover check bill must be > 0, received ${describeValue(event.billCents)}`)
      }
      const sum = event.cashCents + event.savingsCents + event.tradingEquityCents + event.loanLimitCents
      if (sum !== event.totalCents) {
        throw new Error(`pending cover check total ${event.totalCents} is not the sum of its parts ${sum}`)
      }
    }
    if (event.kind === 'runEnded') {
      assertSafeInteger(event.day, 'pending run end day', false)
      if (typeof event.reason !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(event.reason)) {
        throw new Error(`pending run end reason must be an id token, received ${describeValue(event.reason)}`)
      }
    }
    if (event.kind === 'loanTaken') {
      assertSafeInteger(event.day, 'pending loan draw day', false)
      assertSafeInteger(event.amountCents, 'pending loan draw amount', false)
      assertSafeInteger(event.balanceCents, 'pending loan draw balance', false)
      assertSafeInteger(event.cashCents, 'pending loan draw cash', false)
      assertSafeInteger(event.limitCents, 'pending loan draw limit', false)
      if (event.amountCents <= 0) {
        throw new Error(`pending loan draw amount must be > 0, received ${describeValue(event.amountCents)}`)
      }
    }
    if (event.kind === 'loanRepaid') {
      assertSafeInteger(event.day, 'pending loan repayment day', false)
      assertSafeInteger(event.amountCents, 'pending loan repayment amount', false)
      assertSafeInteger(event.balanceCents, 'pending loan repayment balance', false)
      assertSafeInteger(event.cashCents, 'pending loan repayment cash', false)
      if (event.amountCents <= 0) {
        throw new Error(`pending loan repayment amount must be > 0, received ${describeValue(event.amountCents)}`)
      }
    }
  }
}

function assertBill(bill: PendingBill | null): void {
  if (bill === null) return
  if (typeof bill !== 'object' || Array.isArray(bill)) {
    throw new Error(`pending bill must be an object, received ${describeValue(bill)}`)
  }
  if (!Number.isSafeInteger(bill.day) || bill.day < SAVINGS_PAY_INTERVAL_DAYS || bill.day % SAVINGS_PAY_INTERVAL_DAYS !== 0) {
    throw new Error(
      `pending bill day must be a positive multiple of ${SAVINGS_PAY_INTERVAL_DAYS}, received ${describeValue(bill.day)}`,
    )
  }
  if (!Number.isSafeInteger(bill.amountCents) || bill.amountCents <= 0) {
    throw new Error(`pending bill amount must be a positive safe integer, received ${describeValue(bill.amountCents)}`)
  }
}

function assertRunEnd(runEnd: RunEnd | null): void {
  if (runEnd === null) return
  if (typeof runEnd !== 'object' || Array.isArray(runEnd)) {
    throw new Error(`run end must be an object, received ${describeValue(runEnd)}`)
  }
  if (!(RUN_OUTCOMES as readonly string[]).includes(runEnd.outcome)) {
    throw new Error(`run end outcome must be won, lost, or finished, received ${describeValue(runEnd.outcome)}`)
  }
  if (!Number.isSafeInteger(runEnd.day) || runEnd.day < 1) {
    throw new Error(`run end day must be a safe integer >= 1, received ${describeValue(runEnd.day)}`)
  }
  if (typeof runEnd.reason !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(runEnd.reason)) {
    throw new Error(`run end reason must be an id token, received ${describeValue(runEnd.reason)}`)
  }
  if (!Number.isSafeInteger(runEnd.netWorthCents)) {
    throw new Error(`run end net worth must be a safe integer, received ${describeValue(runEnd.netWorthCents)}`)
  }
  if (!Number.isSafeInteger(runEnd.score)) {
    throw new Error(`run end score must be a safe integer, received ${describeValue(runEnd.score)}`)
  }
}

function assertFi(fi: FiTracker): void {
  if (typeof fi !== 'object' || fi === null || Array.isArray(fi)) {
    throw new Error(`FI tracker must be an object, received ${describeValue(fi)}`)
  }
  if (!Number.isSafeInteger(fi.streak) || fi.streak < 0) {
    throw new Error(`FI streak must be a safe integer >= 0, received ${describeValue(fi.streak)}`)
  }
  if (!Array.isArray(fi.interest)) {
    throw new Error(`FI interest must be an array, received ${describeValue(fi.interest)}`)
  }
  let previous = 0
  for (const row of fi.interest) {
    if (typeof row !== 'object' || row === null) {
      throw new Error(`FI interest row must be an object, received ${describeValue(row)}`)
    }
    if (!Number.isSafeInteger(row.day) || row.day <= previous) {
      throw new Error(`FI interest day must be a safe integer greater than ${previous}, received ${describeValue(row.day)}`)
    }
    if (!Number.isSafeInteger(row.cents) || row.cents <= 0) {
      throw new Error(`FI interest cents must be a positive safe integer, received ${describeValue(row.cents)}`)
    }
    previous = row.day
  }
  if (fi.status === null) return
  if (typeof fi.status !== 'object' || Array.isArray(fi.status)) {
    throw new Error(`FI status must be an object, received ${describeValue(fi.status)}`)
  }
  if (!Number.isSafeInteger(fi.status.day) || fi.status.day < 1) {
    throw new Error(`FI status day must be a safe integer >= 1, received ${describeValue(fi.status.day)}`)
  }
  if (!Number.isSafeInteger(fi.status.windowDays) || fi.status.windowDays < 1) {
    throw new Error(`FI span days must be a safe integer >= 1, received ${describeValue(fi.status.windowDays)}`)
  }
  if (!Number.isSafeInteger(fi.status.passiveCents)) {
    throw new Error(`FI passive income must be a safe integer, received ${describeValue(fi.status.passiveCents)}`)
  }
  if (!Number.isSafeInteger(fi.status.expensesCents) || fi.status.expensesCents <= 0) {
    throw new Error(`FI expenses must be a positive safe integer, received ${describeValue(fi.status.expensesCents)}`)
  }
  if (!Number.isSafeInteger(fi.status.streak) || fi.status.streak < 0) {
    throw new Error(`FI status streak must be a safe integer >= 0, received ${describeValue(fi.status.streak)}`)
  }
}

function assertPositions(positions: Record<string, OpenPosition>): void {
  if (typeof positions !== 'object' || positions === null || Array.isArray(positions)) {
    throw new Error(`positions must be an object, received ${describeValue(positions)}`)
  }
  for (const [id, position] of Object.entries(positions)) {
    if (typeof position !== 'object' || position === null) {
      throw new Error(`position ${id} must be an object, received ${describeValue(position)}`)
    }
    if (position.asset !== id) {
      throw new Error(`position key ${id} must match its asset, received ${describeValue(position.asset)}`)
    }
    if (!Number.isSafeInteger(position.signedShares) || position.signedShares === 0) {
      throw new Error(
        `position ${id} signedShares must be a non-zero safe integer, received ${describeValue(position.signedShares)}`,
      )
    }
    if (!Number.isSafeInteger(position.costCents) || position.costCents < 0) {
      throw new Error(
        `position ${id} costCents must be a safe integer >= 0, received ${describeValue(position.costCents)}`,
      )
    }
  }
}

function assertRealized(realized: readonly RealizedDay[]): void {
  if (!Array.isArray(realized)) {
    throw new Error(`realized ledger must be an array, received ${describeValue(realized)}`)
  }
  let previous = -1
  for (const row of realized) {
    if (typeof row !== 'object' || row === null) {
      throw new Error(`realized row must be an object, received ${describeValue(row)}`)
    }
    if (!Number.isSafeInteger(row.day) || row.day <= previous) {
      throw new Error(`realized day must be a safe integer greater than ${previous}, received ${describeValue(row.day)}`)
    }
    if (!Number.isSafeInteger(row.cents)) {
      throw new Error(`realized cents must be a safe integer, received ${describeValue(row.cents)}`)
    }
    previous = row.day
  }
}

function assertGame(state: GameState): void {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new Error(`game state must be an object, received ${describeValue(state)}`)
  }
  if (typeof state.market !== 'object' || state.market === null) {
    throw new Error(`game market must be an object, received ${describeValue(state.market)}`)
  }
  assertPlayerAccounts(state.accounts)
  assertDayState(state.section, state.sleepHours)
  assertPlayerJob(state.job)
  const employed = activeJob(state.job)
  if (state.sleepHours !== employed.sleepHours) {
    throw new Error(
      `sleep hours must match ${employed.id}, received ${state.sleepHours} for ${employed.sleepHours}`,
    )
  }
  assertPositions(state.positions)
  assertRealized(state.realized)
  if (!Array.isArray(state.pending)) {
    throw new Error(`game pending log must be an array, received ${describeValue(state.pending)}`)
  }
  assertPending(state.pending)
  if (!Array.isArray(state.log)) {
    throw new Error(`game log must be an array, received ${describeValue(state.log)}`)
  }
  assertBill(state.bill)
  assertRunEnd(state.runEnd)
  assertFi(state.fi)
  assertPlayerStats(state.stats, state.consumables)
  assertLifestyle(state.lifestyle)
  assertLoan(state.loan)
}

/**
 * Bias the visible feed once, from the positions and stress held now.
 * Call this at day start. Later trades do not call it again.
 * Only the distortion stream may advance. The stored feed is not written.
 */
export function refreshPerception(state: GameState): void {
  const visible = playerVisibleFeed(state.market.feed, activeJob(state.job), state.lifestyle)
  const built = shownFeed(
    visible,
    state.positions,
    state.stats.stress,
    state.market.streams.distortion,
    state.socialPosts,
    state.market.day,
  )
  state.perception = {
    day: state.market.day,
    shown: built.feed,
    events: built.events,
    verified: false,
  }
}

/** The biased feed, or the true visible feed after verify. */
export function viewedFeed(state: GameState): ShownFeed {
  if (!state.perception.verified) return state.perception.shown
  return undistortedFeed(playerVisibleFeed(state.market.feed, activeJob(state.job), state.lifestyle))
}

/** Optional menus and starting job. Omitted jobs means jobless. Omitted consumables means nothing is for sale. */
export type GameStart = {
  jobs?: readonly JobDefinition[]
  jobId?: string
  consumables?: readonly ConsumableDefinition[]
  socialPosts?: readonly SocialPostDefinition[]
}

/** Day 0 market plus 3E cash, 3E trading, and empty savings. The starting job applies immediately. */
export function createGame(defs: MarketDefinitions, seed: string, start?: GameStart): GameState {
  assertDefinitionsObject(defs)
  const playerJob = initialPlayerJob(start?.jobs, start?.jobId)
  const job = activeJob(playerJob)
  const state: GameState = {
    market: createMarket(defs, seed),
    accounts: {
      cashCents: STARTING_CASH_CENTS,
      tradingCents: STARTING_TRADING_CENTS,
      savingsCents: STARTING_SAVINGS_CENTS,
      accruedSavingsCents: 0,
    },
    section: sectionForJob(job),
    sleepHours: job.sleepHours,
    job: playerJob,
    positions: {},
    realized: [],
    pending: [],
    log: [],
    bill: null,
    runEnd: null,
    fi: initialFi(),
    stats: initialStats(),
    consumables: copyConsumables(start?.consumables),
    socialPosts: copySocialPosts(start?.socialPosts),
    perception: {
      day: 0,
      shown: { day: 1, items: [] },
      events: [],
      verified: false,
    },
    lifestyle: initialLifestyle(),
    loan: initialLoan(),
  }
  refreshPerception(state)
  return state
}

/** Why `endDay` must not advance, or null when the day can end. */
export function endDayBlockReason(state: GameState): 'billPending' | 'runEnded' | null {
  if (state.runEnd !== null) return 'runEnded'
  if (state.bill !== null) return 'billPending'
  return null
}

function commandType(cmd: unknown): string | null {
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return null
  const type = (cmd as { type?: unknown }).type
  return typeof type === 'string' ? type : null
}

/** Apply one player command. A rejection logs the reason and leaves balances and positions unchanged. */
export function applyCommand(state: GameState, defs: MarketDefinitions, cmd: unknown): GameState {
  assertDefinitionsObject(defs)
  assertGame(state)
  assertPerception(state.perception, state.market.day, state.market.feed.day)
  if (state.runEnd !== null) {
    const command = commandType(cmd) ?? 'invalid'
    state.pending.push({
      kind: 'commandRejected',
      day: state.market.day,
      command,
      reason: 'runEnded',
    })
    state.log = state.pending.slice()
    return state
  }
  const type = commandType(cmd)
  if (type === 'order') {
    if (state.section !== 'market') {
      state.pending.push({
        kind: 'commandRejected',
        day: state.market.day,
        command: 'order',
        reason: 'marketClosed',
      })
    } else {
      const outcome = interpretOrder(state, defs, cmd)
      for (const event of outcome.events) state.pending.push(event)
    }
  } else if (type === 'skip') {
    const outcome = interpretSkip(state.section, state.market.day, playerIsJobless(state.job))
    if (outcome.accepted) state.section = outcome.section
    const events = outcome.accepted ? outcome.events : [outcome.event]
    for (const event of events) state.pending.push(event)
  } else if (type === 'setJob') {
    const outcome = interpretSetJob(state, cmd)
    if (outcome.accepted) state.job.pending = outcome.pending
    state.pending.push(outcome.event)
  } else if (type === 'payBill') {
    const outcome = interpretPayBill(state)
    state.pending.push(outcome.event)
  } else if (type === 'consume') {
    const outcome = interpretConsume(state, cmd)
    if (outcome.accepted) {
      for (const event of outcome.events) state.pending.push(event)
    } else {
      state.pending.push(outcome.event)
    }
  } else if (type === 'readNews') {
    for (const event of interpretReadNews(state)) state.pending.push(event)
  } else if (type === 'verify') {
    for (const event of interpretVerify(state)) state.pending.push(event)
  } else if (type === 'setLifestyle') {
    const outcome = interpretSetLifestyle(state, cmd)
    state.pending.push(outcome.event)
  } else if (type === 'buyCourse') {
    const outcome = interpretBuyCourse(state, cmd)
    state.pending.push(outcome.event)
  } else if (type === 'takeLoan') {
    const outcome = interpretTakeLoan(state, cmd)
    state.pending.push(outcome.event)
  } else if (type === 'repayLoan') {
    const outcome = interpretRepayLoan(state, cmd)
    state.pending.push(outcome.event)
  } else {
    const outcome = interpretCommand(state.accounts, state.market.day, cmd, state.loan.balanceCents)
    state.pending.push(outcome.event)
  }
  state.log = state.pending.slice()
  if (state.bill !== null) {
    for (const event of reviewCoverable(state, defs)) {
      state.pending.push(event)
      state.log.push(event)
    }
  }
  return state
}

/**
 * Margin interest, short borrow, the margin check, liquidation, the backstop,
 * and the wipe-out flag. Call this after prices have moved and before savings.
 * `equityAtDayStart` is trading equity from before the market step.
 * This does not draw a random stream and does not clear the command log.
 */
export function settleTradingAccount(
  state: GameState,
  defs: MarketDefinitions,
  equityAtDayStart: number,
): AccountLogEvent[] {
  assertDefinitionsObject(defs)
  assertGame(state)
  const policyRate = readPolicyRatePercent(state.market, defs)
  const interest = settleMarginInterest(state, policyRate)
  const borrow = settleBorrowFees(state, defs)
  const margin = settleMargin(state, defs, equityAtDayStart)
  return [interest, ...borrow, ...margin]
}

function savingsInterestReceived(events: readonly AccountLogEvent[]): number {
  let total = 0
  for (const event of events) {
    if (event.kind !== 'savingsInterestPaid') continue
    if (!Number.isSafeInteger(event.amountCents) || event.amountCents < 0) {
      throw new Error(`savings interest paid must be a safe integer >= 0, received ${describeValue(event.amountCents)}`)
    }
    total += event.amountCents
    if (!Number.isSafeInteger(total)) {
      throw new Error(`savings interest total is not a safe integer, received ${describeValue(total)}`)
    }
  }
  return total
}

/**
 * Advance one player day: the existing market step once, then margin interest,
 * short borrow, the margin check, then savings accrual. Interest and borrow
 * use the post-step prices and that day's policy rate. When the new day number
 * is a multiple of 30, the monthly cycle pays savings interest, salary, loan
 * interest, and the bill before the player acts. Unpaid loan interest is
 * collected at the end of that day, before the next market step: positions
 * first, then savings. That sale does not pay the expense bill. Energy and
 * stress are updated after the margin settlement and before the FI check. Player
 * events stay off the market log. A wipe-out does not end the run. A pending
 * bill or an ended run throws before the market steps. On day 120, End day
 * seals the run and does not step prices. The day-120 bill still blocks that
 * seal. End day is otherwise allowed in any section. The next day starts at
 * sleep when jobless, and at work when a job occupies that section.
 */
export function endDay(state: GameState, defs: MarketDefinitions): GameState {
  assertDefinitionsObject(defs)
  assertGame(state)
  assertPerception(state.perception, state.market.day, state.market.feed.day)
  const block = endDayBlockReason(state)
  if (block !== null) throw new Error(`end day blocked: ${block}`)
  const loanEvents = settleMissedLoanInterest(state, defs)
  if (state.runEnd !== null) {
    state.log = [...state.pending, ...loanEvents]
    state.pending = []
    return state
  }
  if (state.market.day >= RUN_LENGTH_DAYS) {
    const ended = finishAtDayLimit(state, defs)
    state.log = [...state.log, ...loanEvents, ended]
    state.pending = []
    return state
  }
  recordJobDay(state)
  const commands = state.pending.slice()
  const workedJob = activeJob(state.job)
  const sleptHours = state.sleepHours
  const equityAtStart = tradingEquity(state, defs).equity
  assertPolicyRateEntry(state.market, defs)
  stepMarketDay(state.market, defs)
  const traded = settleTradingAccount(state, defs, equityAtStart)
  const policyRate = readPolicyRatePercent(state.market, defs)
  const savings = settleSavings(state.accounts, state.market.day, policyRate)
  const endEquity = tradingEquity(state, defs).equity
  const statEvents = applyEndOfDayStats(state, workedJob, sleptHours, equityAtStart, endEquity, traded)
  const jobEvents = applyDueJobChange(state)
  const monthly = isMonthlyCycleDay(state.market.day) ? applyMonthlyCycle(state, defs) : []
  const fi = applyFiCheck(state, defs, savingsInterestReceived(monthly))
  state.pending = []
  state.log = [...commands, ...loanEvents, ...traded, ...savings, ...statEvents, ...jobEvents, ...monthly, ...fi]
  const job = activeJob(state.job)
  state.section = sectionForJob(job)
  state.sleepHours = job.sleepHours
  refreshPerception(state)
  return state
}
