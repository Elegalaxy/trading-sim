// Trading account numbers shown next to the order ticket. Equity is the trading balance plus
// the positions at the current quote, so it already contains the floating P&L. Gross is the sum
// of the position values. Required margin is the sum of each position's value over its
// leverage, and free margin is the equity left after it.

import { MARKET_DEFINITIONS } from '../content/index.ts'
import { sessionPrice } from '../sim/session.ts'
import { tradingEquity } from '../sim/trading.ts'
import type { GameState } from '../sim/types.ts'

/**
 * Long P&L is (price - average) * shares. Short P&L is (average - price) * shares.
 * average is costCents / abs(signedShares).
 */
export function unrealizedCents(price: number, signedShares: number, costCents: number): number {
  const shares = Math.abs(signedShares)
  if (!Number.isSafeInteger(shares) || shares <= 0) {
    throw new Error(`position shares must be a positive safe integer, received ${String(signedShares)}`)
  }
  if (!Number.isSafeInteger(price) || price <= 0) {
    throw new Error(`position price must be a positive safe integer, received ${String(price)}`)
  }
  if (!Number.isSafeInteger(costCents) || costCents < 0) {
    throw new Error(`position cost must be a safe integer >= 0, received ${String(costCents)}`)
  }
  const average = costCents / shares
  const pnl = signedShares > 0 ? (price - average) * shares : (average - price) * shares
  if (!Number.isFinite(pnl)) throw new Error(`unrealized P&L is not finite for ${String(signedShares)} shares`)
  const cents = Math.round(pnl)
  if (!Number.isSafeInteger(cents) || Math.abs(pnl - cents) > 1e-3) {
    throw new Error(`unrealized P&L ${String(pnl)} is not a whole number of cents`)
  }
  return cents
}

export type AccountSummary = {
  /** The trading account balance. Negative means a margin loan. */
  balance: number
  /** Floating P&L of every open position at the current quote. */
  floating: number
  equity: number
  gross: number
  /** Margin the open positions need: each position's value over its leverage. */
  required: number
  /** Equity not tied up as margin. A new order of value V at leverage L needs V / L of it. */
  freeMargin: number
}

export function accountSummary(game: GameState): AccountSummary {
  const book = tradingEquity(game, MARKET_DEFINITIONS)
  let floating = 0
  for (const def of MARKET_DEFINITIONS.assets) {
    const position = game.positions[def.id]
    if (position === undefined || position.signedShares === 0) continue
    floating += unrealizedCents(sessionPrice(game, def.id), position.signedShares, position.costCents)
  }
  return {
    balance: game.accounts.tradingCents,
    floating,
    equity: book.equity,
    gross: book.gross,
    required: book.required,
    freeMargin: book.equity - book.required,
  }
}
