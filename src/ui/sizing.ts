// Order sizing for the order panel. The sim only knows whole shares, so every mode
// ends as a quantity. Leverage here is a sizing helper: it converts the cost you put
// in (pre-leverage) into the value you hold (post-leverage). The real limit is still
// the account-wide 5x cap and the daily margin check in the sim.

import {
  MARGIN_LIQUIDATION_RATIO_DENOMINATOR,
  MARGIN_LIQUIDATION_RATIO_NUMERATOR,
} from '../sim/constants.ts'

export const SIZE_MODES = ['quantity', 'cost', 'value'] as const
export type SizeMode = (typeof SIZE_MODES)[number]

export const SIZING_LEVERAGE = [1, 2, 3, 5] as const

/** Whole shares for a dollar amount at a fill price. Cost is multiplied by leverage first. */
export function sharesForAmount(mode: 'cost' | 'value', amountCents: number, leverage: number, fillCents: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error(`amount must be a positive safe integer, received ${String(amountCents)}`)
  if (!Number.isSafeInteger(leverage) || leverage < 1) throw new Error(`leverage must be a whole number from 1, received ${String(leverage)}`)
  if (!Number.isSafeInteger(fillCents) || fillCents <= 0) throw new Error(`fill price must be a positive safe integer, received ${String(fillCents)}`)
  const value = mode === 'cost' ? amountCents * leverage : amountCents
  return Math.floor(value / fillCents)
}

/**
 * The price at which the daily check would liquidate the book, with other positions
 * held where they are. `equity` and `gross` are after the order, `netShares` is the
 * signed position after the order, `priceCents` the quote. Null when flat or already past it.
 */
export function liquidationPrice(equity: number, gross: number, netShares: number, priceCents: number): number | null {
  if (netShares === 0) return null
  const ratio = MARGIN_LIQUIDATION_RATIO_NUMERATOR / MARGIN_LIQUIDATION_RATIO_DENOMINATOR
  const shares = Math.abs(netShares)
  const others = gross - shares * priceCents
  const price =
    netShares > 0
      ? (ratio * others + shares * priceCents - equity) / ((1 - ratio) * shares)
      : (equity + shares * priceCents - ratio * others) / ((1 + ratio) * shares)
  if (!Number.isFinite(price) || price <= 0) return null
  return Math.round(price)
}
