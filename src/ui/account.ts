// Trading account numbers shown next to the order ticket. Equity is the trading balance plus
// the positions at the current quote, so it already contains the floating P&L. Gross is the sum
// of the position values. Buying power is how much more value the 5x limit still allows.

import { MARKET_DEFINITIONS } from '../content/index.ts'
import { MARGIN_MIN_RATIO_DENOMINATOR, MARGIN_MIN_RATIO_NUMERATOR } from '../sim/constants.ts'
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
  /** How much more position value the 5x limit allows right now. */
  buyingPower: number
}

export function accountSummary(game: GameState): AccountSummary {
  const book = tradingEquity(game, MARKET_DEFINITIONS)
  let floating = 0
  for (const def of MARKET_DEFINITIONS.assets) {
    const position = game.positions[def.id]
    if (position === undefined || position.signedShares === 0) continue
    floating += unrealizedCents(sessionPrice(game, def.id), position.signedShares, position.costCents)
  }
  const power =
    Math.max(0, book.equity * MARGIN_MIN_RATIO_DENOMINATOR - book.gross * MARGIN_MIN_RATIO_NUMERATOR) /
    MARGIN_MIN_RATIO_NUMERATOR
  return {
    balance: game.accounts.tradingCents,
    floating,
    equity: book.equity,
    gross: book.gross,
    buyingPower: Math.floor(power),
  }
}
