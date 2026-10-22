// Player time. `applyCommand` and `endDay` are the harness and UI entry points.
// `endDay` steps the market once, charges short borrow fees, then accrues savings.
// It does not draw a random stream of its own, and it does not write player lines
// onto the market. Orders never change prices.

import {
  assertPlayerAccounts,
  assertPolicyRateEntry,
  interpretCommand,
  readPolicyRatePercent,
  settleSavings,
} from './accounts.ts'
import { STARTING_CASH_CENTS, STARTING_SAVINGS_CENTS, STARTING_TRADING_CENTS } from './constants.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { interpretOrder, settleBorrowFees } from './trading.ts'
import type { CommandLogEvent, GameState, MarketDefinitions, OpenPosition, RealizedDay } from './types.ts'

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

function assertPending(pending: readonly CommandLogEvent[]): void {
  for (const event of pending) {
    if (typeof event !== 'object' || event === null) {
      throw new Error(`pending account event must be an object, received ${describeValue(event)}`)
    }
    const kind = (event as { kind?: unknown }).kind
    if (kind !== 'transfer' && kind !== 'commandRejected' && kind !== 'orderFill' && kind !== 'realized') {
      throw new Error(`pending account event must be a command, received ${describeValue(kind)}`)
    }
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
  assertPositions(state.positions)
  assertRealized(state.realized)
  if (!Array.isArray(state.pending)) {
    throw new Error(`game pending log must be an array, received ${describeValue(state.pending)}`)
  }
  assertPending(state.pending)
  if (!Array.isArray(state.log)) {
    throw new Error(`game log must be an array, received ${describeValue(state.log)}`)
  }
}

/** Day 0 market plus 3E cash, 3E trading, and empty savings. */
export function createGame(defs: MarketDefinitions, seed: string): GameState {
  assertDefinitionsObject(defs)
  return {
    market: createMarket(defs, seed),
    accounts: {
      cashCents: STARTING_CASH_CENTS,
      tradingCents: STARTING_TRADING_CENTS,
      savingsCents: STARTING_SAVINGS_CENTS,
      accruedSavingsCents: 0,
    },
    positions: {},
    realized: [],
    pending: [],
    log: [],
  }
}

function isOrderCommand(cmd: unknown): boolean {
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return false
  return (cmd as { type?: unknown }).type === 'order'
}

/** Apply one player command. A rejection logs the reason and leaves balances and positions unchanged. */
export function applyCommand(state: GameState, defs: MarketDefinitions, cmd: unknown): GameState {
  assertDefinitionsObject(defs)
  assertGame(state)
  if (isOrderCommand(cmd)) {
    const outcome = interpretOrder(state, defs, cmd)
    for (const event of outcome.events) state.pending.push(event)
  } else {
    const outcome = interpretCommand(state.accounts, state.market.day, cmd)
    state.pending.push(outcome.event)
  }
  state.log = state.pending.slice()
  return state
}

/**
 * Advance one player day: the existing market step once, then short borrow fees,
 * then savings interest. Borrow uses the post-step prices. The policy rate is
 * read after the step. Player events stay off the market log.
 */
export function endDay(state: GameState, defs: MarketDefinitions): GameState {
  assertDefinitionsObject(defs)
  assertGame(state)
  const commands = state.pending.slice()
  assertPolicyRateEntry(state.market, defs)
  stepMarketDay(state.market, defs)
  const borrow = settleBorrowFees(state, defs)
  const policyRate = readPolicyRatePercent(state.market, defs)
  const savings = settleSavings(state.accounts, state.market.day, policyRate)
  state.pending = []
  state.log = [...commands, ...borrow, ...savings]
  return state
}
