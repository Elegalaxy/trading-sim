// Order sizing for the order panel. The sim only knows whole shares, so every mode
// ends as a quantity. Leverage is the real per-position leverage: cost is the margin
// you put in, and value is what you hold (cost times leverage).

import {
  MARGIN_LIQUIDATION_RATIO_DENOMINATOR,
  MARGIN_LIQUIDATION_RATIO_NUMERATOR,
  MARGIN_MIN_RATIO_DENOMINATOR,
  MARGIN_MIN_RATIO_NUMERATOR,
} from '../sim/constants.ts'

export const SIZE_MODES = ['quantity', 'cost', 'value'] as const
export type SizeMode = (typeof SIZE_MODES)[number]

export const SIZING_LEVERAGE = [1, 2, 3, 5, 10, 20, 50] as const

/** Whole shares for a dollar amount at a fill price. Cost is multiplied by leverage first. */
export function sharesForAmount(mode: 'cost' | 'value', amountCents: number, leverage: number, fillCents: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error(`amount must be a positive safe integer, received ${String(amountCents)}`)
  if (!Number.isSafeInteger(leverage) || leverage < 1) throw new Error(`leverage must be a whole number from 1, received ${String(leverage)}`)
  if (!Number.isSafeInteger(fillCents) || fillCents <= 0) throw new Error(`fill price must be a positive safe integer, received ${String(fillCents)}`)
  const value = mode === 'cost' ? amountCents * leverage : amountCents
  return Math.floor(value / fillCents)
}

/**
 * The price at which the daily check would liquidate the book, with other positions held
 * where they are. `equity` and `required` (margin of all positions) are after the order,
 * `netShares` and `leverage` describe this asset's position after the order, `priceCents`
 * is the quote. Liquidation is at equity of half the required margin (the 10% mark against
 * the 20% start). Null when flat or the price would have to be zero or below.
 */
export function liquidationPrice(
  equity: number,
  required: number,
  netShares: number,
  priceCents: number,
  leverage: number,
): number | null {
  if (netShares === 0) return null
  const half =
    (MARGIN_LIQUIDATION_RATIO_NUMERATOR / MARGIN_LIQUIDATION_RATIO_DENOMINATOR) /
    (MARGIN_MIN_RATIO_NUMERATOR / MARGIN_MIN_RATIO_DENOMINATOR)
  const shares = Math.abs(netShares)
  const othersRequired = required - (shares * priceCents) / leverage
  const price =
    netShares > 0
      ? (shares * priceCents - equity + half * othersRequired) / (shares * (1 - half / leverage))
      : (equity + shares * priceCents - half * othersRequired) / (shares * (1 + half / leverage))
  if (!Number.isFinite(price) || price <= 0) return null
  return Math.round(price)
}
