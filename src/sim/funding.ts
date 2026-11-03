// Funding, the holding cost of an open position. It replaces margin interest and the short
// borrow fee, the way a perpetual future has a funding rate and no loan.
//
// Every open position pays once a day, after the market step, on its value at the new price:
//   paid = value x (base + crowd)
// `base` is 0.01% a day for both sides. `crowd` is extra, paid only by the side the day's move
// favoured: a rising day (long crowded) makes longs pay more, a falling day makes shorts pay
// more. It is 5% of the move, up to 0.2% a day. The player pays and never receives, because
// there is no counterparty. Funding is booked to trading cash (which may go negative) and to
// the realized ledger, and does not depend on the leverage. Nothing here draws a random stream.

import {
  FUNDING_BASE_PPM,
  FUNDING_TREND_CAP_PPM,
  FUNDING_TREND_PERCENT,
  RATE_PPM_SCALE,
} from './constants.ts'
import { recordRealized } from './trading.ts'
import type { FundingEvent, GameState, MarketDefinitions } from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

/** The day's move of one asset in the market log, as a fraction. Zero when it has no step. */
function dayMove(state: GameState, assetId: string): number {
  for (const event of state.market.log) {
    if ((event.kind !== 'priceStep' && event.kind !== 'indexStep') || event.asset !== assetId) continue
    if (!Number.isSafeInteger(event.previous) || event.previous <= 0) {
      throw new Error(`funding previous price for ${assetId} must be a positive safe integer, received ${describeValue(event.previous)}`)
    }
    return (event.newPrice - event.previous) / event.previous
  }
  return 0
}

/** Funding for the day that just ended. Call it after the market step and before the margin check. */
export function settleFunding(state: GameState, defs: MarketDefinitions): FundingEvent[] {
  const day = state.market.day
  const events: FundingEvent[] = []
  for (const def of defs.assets) {
    const position = state.positions[def.id]
    if (position === undefined || position.signedShares === 0) continue
    const price = state.market.assets[def.id]?.priceCents
    if (!Number.isSafeInteger(price) || price === undefined || price <= 0) {
      throw new Error(`asset ${def.id} price must be a positive safe integer, received ${describeValue(price)}`)
    }
    const shares = Math.abs(position.signedShares)
    const notional = shares * price
    if (!Number.isSafeInteger(notional)) throw new Error(`funding notional for ${def.id} is not a safe integer`)
    const side: 'long' | 'short' = position.signedShares > 0 ? 'long' : 'short'
    const trend = Math.max(
      -FUNDING_TREND_CAP_PPM,
      Math.min(FUNDING_TREND_CAP_PPM, Math.round(dayMove(state, def.id) * RATE_PPM_SCALE * (FUNDING_TREND_PERCENT / 100))),
    )
    const crowd = side === 'long' ? Math.max(0, trend) : Math.max(0, -trend)
    const ratePpm = FUNDING_BASE_PPM + crowd
    const amount = Math.round((notional * ratePpm) / RATE_PPM_SCALE)
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`funding for ${def.id} must be a safe integer >= 0, received ${describeValue(amount)}`)
    }
    state.accounts.tradingCents -= amount
    if (!Number.isSafeInteger(state.accounts.tradingCents)) {
      throw new Error(`trading cash after funding is not a safe integer, received ${describeValue(state.accounts.tradingCents)}`)
    }
    if (amount !== 0) recordRealized(state, day, -amount)
    events.push({ kind: 'funding', day, asset: def.id, side, notional, ratePpm, amount })
  }
  return events
}
