// Player time. `applyCommand` and `endDay` are the harness and UI entry points.
// `endDay` steps the market once, then accrues savings. It does not draw a
// random stream of its own, and it does not write account lines onto the market.

import {
  assertPlayerAccounts,
  assertPolicyRateEntry,
  interpretCommand,
  readPolicyRatePercent,
  settleSavings,
} from './accounts.ts'
import { STARTING_CASH_CENTS, STARTING_SAVINGS_CENTS, STARTING_TRADING_CENTS } from './constants.ts'
import { createMarket, stepMarketDay } from './market.ts'
import type { CommandRejectedEvent, GameState, MarketDefinitions, TransferEvent } from './types.ts'

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

function assertPending(pending: readonly (TransferEvent | CommandRejectedEvent)[]): void {
  for (const event of pending) {
    if (typeof event !== 'object' || event === null) {
      throw new Error(`pending account event must be an object, received ${describeValue(event)}`)
    }
    const kind = (event as { kind?: unknown }).kind
    if (kind !== 'transfer' && kind !== 'commandRejected') {
      throw new Error(`pending account event must be a command, received ${describeValue(kind)}`)
    }
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
    pending: [],
    log: [],
  }
}

/** Apply one player command. A rejection logs the reason and leaves balances unchanged. */
export function applyCommand(state: GameState, defs: MarketDefinitions, cmd: unknown): GameState {
  assertDefinitionsObject(defs)
  assertGame(state)
  const outcome = interpretCommand(state.accounts, state.market.day, cmd)
  state.pending.push(outcome.event)
  state.log = state.pending.slice()
  return state
}

/**
 * Advance one player day: the existing market step once, then savings interest.
 * The policy rate is read after the step. Account events stay off the market log.
 */
export function endDay(state: GameState, defs: MarketDefinitions): GameState {
  assertDefinitionsObject(defs)
  assertGame(state)
  const commands = state.pending.slice()
  assertPolicyRateEntry(state.market, defs)
  stepMarketDay(state.market, defs)
  const policyRate = readPolicyRatePercent(state.market, defs)
  const savings = settleSavings(state.accounts, state.market.day, policyRate)
  state.pending = []
  state.log = [...commands, ...savings]
  return state
}
