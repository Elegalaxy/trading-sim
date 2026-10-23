// End-of-day leverage. Call this after the market step and before savings.
// There is no intraday margin check. Orders never change prices, and this
// file does not draw a random stream.
//
// 1. Margin interest. Annual rate = max(0, policy percent + 3) / 100.
//    Borrowed = max(0, −trading cash). Interest is round half away from zero
//    of borrowed × annual rate / 365, deducted from trading cash.
// 2. The short borrow fee stays in trading.ts and runs between interest and
//    the check. This file does not charge it.
// 3. Margin check at the quoted price. Ratio = equity / gross. Gross of 0 has
//    no ratio. At or below 15% with a position open, log a warning. At or
//    below 10%, close whole positions until the ratio is above 15% or nothing
//    remains. Worst unrealized money loss first. A tie keeps the earlier asset
//    in the definition list. A long's loss is (price − average cost) × shares.
//    A short's is (average cost − price) × abs(shares). Each close uses the
//    Step 10 sell or buy fill.
// 4. If equity is still negative, add the shortfall to trading cash so equity
//    is 0 and log the write-off.
// 5. Log a wipe-out when end equity is below 10% of equity at the start of
//    the day, before the market step. The run continues. Stress is unchanged.

import {
  MARGIN_DAYS_PER_YEAR,
  MARGIN_INTEREST_SPREAD_PERCENT,
  MARGIN_LIQUIDATION_RATIO_DENOMINATOR,
  MARGIN_LIQUIDATION_RATIO_NUMERATOR,
  MARGIN_WARNING_RATIO_DENOMINATOR,
  MARGIN_WARNING_RATIO_NUMERATOR,
  WIPE_OUT_RATIO_DENOMINATOR,
  WIPE_OUT_RATIO_NUMERATOR,
} from './constants.ts'
import { closeWholePosition, recordRealized, tradingEquity } from './trading.ts'
import type {
  BackstopWriteOffEvent,
  GameState,
  LiquidationEvent,
  MarginCheckEvent,
  MarginInterestEvent,
  MarginLogEvent,
  MarginWarningEvent,
  MarketDefinitions,
  OpenPosition,
  WipeOutEvent,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

/** Half away from zero. `Math.round` alone sends −1.5 to −1. */
function roundHalfAwayFromZero(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`margin amount must be a finite number, received ${describeValue(value)}`)
  }
  const rounded = Math.round(Math.abs(value))
  const delta = value < 0 ? -rounded : rounded
  if (!Number.isSafeInteger(delta)) {
    throw new Error(`margin amount is not a safe integer, received ${describeValue(value)}`)
  }
  return delta
}

function ratio(equity: number, gross: number): number | null {
  if (gross === 0) return null
  return equity / gross
}

/** −1 when equity/gross is below num/den, 0 when equal, 1 when above. */
function compareRatio(equity: number, gross: number, numerator: number, denominator: number): -1 | 0 | 1 {
  if (gross <= 0) throw new Error(`margin ratio needs a positive position value, received ${describeValue(gross)}`)
  const left = equity * denominator
  const right = gross * numerator
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw new Error(
      `margin ratio comparison overflowed, equity=${describeValue(equity)} positionValue=${describeValue(gross)}`,
    )
  }
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function checkEvent(day: number, equity: number, gross: number): MarginCheckEvent {
  return {
    kind: 'marginCheck',
    day,
    equity,
    positionValue: gross,
    ratio: ratio(equity, gross),
  }
}

/**
 * Unrealized money result in cents. The worst position is the most negative.
 * Long: (price − average cost) × shares = price × shares − cost.
 * Short: (average cost − price) × abs(shares) = cost − price × abs(shares).
 */
function unrealizedCents(position: OpenPosition, price: number): number {
  if (position.signedShares > 0) {
    const marked = price * position.signedShares
    if (!Number.isSafeInteger(marked)) {
      throw new Error(`long mark for ${position.asset} is not a safe integer, received ${describeValue(marked)}`)
    }
    const pnl = marked - position.costCents
    if (!Number.isSafeInteger(pnl)) {
      throw new Error(`long unrealized for ${position.asset} is not a safe integer, received ${describeValue(pnl)}`)
    }
    return pnl
  }
  const shares = -position.signedShares
  const marked = price * shares
  if (!Number.isSafeInteger(marked)) {
    throw new Error(`short mark for ${position.asset} is not a safe integer, received ${describeValue(marked)}`)
  }
  const pnl = position.costCents - marked
  if (!Number.isSafeInteger(pnl)) {
    throw new Error(`short unrealized for ${position.asset} is not a safe integer, received ${describeValue(pnl)}`)
  }
  return pnl
}

/** Most negative unrealized result. Equal results keep the earlier definition. */
function worstAsset(state: GameState, defs: MarketDefinitions): string {
  let worstId = ''
  let worstPnl = 0
  let found = false
  for (const def of defs.assets) {
    const position = state.positions[def.id]
    if (position === undefined) continue
    const price = state.market.assets[def.id]?.priceCents
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new Error(`asset ${def.id} price must be a positive safe integer, received ${describeValue(price)}`)
    }
    const pnl = unrealizedCents(position, price)
    if (!found || pnl < worstPnl) {
      found = true
      worstId = def.id
      worstPnl = pnl
    }
  }
  if (!found) throw new Error('liquidation found no open position')
  return worstId
}

function isWipeOut(endEquity: number, startEquity: number): boolean {
  if (!Number.isSafeInteger(endEquity) || !Number.isSafeInteger(startEquity)) {
    throw new Error(
      `wipe-out equity must be safe integers, received start=${describeValue(startEquity)} end=${describeValue(endEquity)}`,
    )
  }
  if (startEquity <= 0) return false
  const left = endEquity * WIPE_OUT_RATIO_DENOMINATOR
  const right = startEquity * WIPE_OUT_RATIO_NUMERATOR
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw new Error('wipe-out comparison overflowed a safe integer')
  }
  return left < right
}

/**
 * Charge one day of margin interest. A zero borrowed amount still logs a
 * zero charge so the day's inputs are visible. The realized ledger takes the
 * interest as a negative amount, the same way it takes a borrow fee.
 */
export function settleMarginInterest(state: GameState, policyPercent: number): MarginInterestEvent {
  if (typeof policyPercent !== 'number' || !Number.isFinite(policyPercent)) {
    throw new Error(`policy rate must be a finite number, received ${describeValue(policyPercent)}`)
  }
  const cash = state.accounts.tradingCents
  if (!Number.isSafeInteger(cash)) {
    throw new Error(`trading cash must be a safe integer, received ${describeValue(cash)}`)
  }
  const day = state.market.day
  if (!Number.isSafeInteger(day) || day < 0) {
    throw new Error(`margin day must be a safe integer >= 0, received ${describeValue(day)}`)
  }
  const borrowed = cash < 0 ? -cash : 0
  const annualRate = Math.max(0, policyPercent + MARGIN_INTEREST_SPREAD_PERCENT) / 100
  const interest = roundHalfAwayFromZero((borrowed * annualRate) / MARGIN_DAYS_PER_YEAR)
  if (interest < 0) throw new Error(`margin interest must be >= 0, received ${interest}`)
  const tradingCents = cash - interest
  if (!Number.isSafeInteger(tradingCents)) {
    throw new Error(`trading cash after margin interest is not a safe integer, received ${describeValue(tradingCents)}`)
  }
  state.accounts.tradingCents = tradingCents
  if (interest !== 0) recordRealized(state, day, -interest)
  return {
    kind: 'marginInterest',
    day,
    borrowed,
    policyRate: policyPercent,
    annualRate,
    interest,
    tradingCents,
  }
}

/**
 * Margin check, warning, liquidation, backstop, and wipe-out flag.
 * `equityAtDayStart` is trading equity before the market step.
 * Interest and the short borrow fee must already have been charged.
 */
export function settleMargin(state: GameState, defs: MarketDefinitions, equityAtDayStart: number): MarginLogEvent[] {
  if (!Number.isSafeInteger(equityAtDayStart)) {
    throw new Error(`start-of-day equity must be a safe integer, received ${describeValue(equityAtDayStart)}`)
  }
  const day = state.market.day
  const events: MarginLogEvent[] = []
  const opening = tradingEquity(state, defs)
  events.push(checkEvent(day, opening.equity, opening.gross))

  const warn =
    opening.gross > 0 &&
    compareRatio(opening.equity, opening.gross, MARGIN_WARNING_RATIO_NUMERATOR, MARGIN_WARNING_RATIO_DENOMINATOR) <= 0
  const liquidate =
    opening.gross > 0 &&
    compareRatio(
      opening.equity,
      opening.gross,
      MARGIN_LIQUIDATION_RATIO_NUMERATOR,
      MARGIN_LIQUIDATION_RATIO_DENOMINATOR,
    ) <= 0
  if (warn) {
    const warning: MarginWarningEvent = {
      kind: 'marginWarning',
      day,
      equity: opening.equity,
      positionValue: opening.gross,
      ratio: opening.equity / opening.gross,
    }
    events.push(warning)
  }

  if (liquidate) {
    const limit = defs.assets.length
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('liquidation needs at least one asset')
    let closed = 0
    while (closed <= limit) {
      const current = tradingEquity(state, defs)
      if (current.gross === 0) break
      const stillUnder =
        compareRatio(current.equity, current.gross, MARGIN_WARNING_RATIO_NUMERATOR, MARGIN_WARNING_RATIO_DENOMINATOR) <=
        0
      if (!stillUnder) break
      const asset = worstAsset(state, defs)
      const close = closeWholePosition(state, defs, asset)
      closed += 1
      const after = tradingEquity(state, defs)
      const logged: LiquidationEvent = {
        kind: 'liquidation',
        day,
        asset: close.asset,
        quantity: close.quantity,
        fill: close.fillPrice,
        ratioAfter: ratio(after.equity, after.gross),
      }
      events.push(logged)
    }
    if (closed > limit) throw new Error('liquidation did not finish within the asset count')
    const finished = tradingEquity(state, defs)
    events.push(checkEvent(day, finished.equity, finished.gross))
  }

  const afterClose = tradingEquity(state, defs)
  if (afterClose.equity < 0) {
    const amount = -afterClose.equity
    const nextCash = state.accounts.tradingCents + amount
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(nextCash)) {
      throw new Error(`backstop amount is not a safe integer, received ${describeValue(amount)}`)
    }
    state.accounts.tradingCents = nextCash
    const floored = tradingEquity(state, defs)
    if (floored.equity !== 0) {
      throw new Error(`backstop left equity at ${floored.equity}`)
    }
    const writeOff: BackstopWriteOffEvent = { kind: 'backstopWriteOff', day, amount }
    events.push(writeOff)
  }

  const endEquity = tradingEquity(state, defs).equity
  if (endEquity < 0) throw new Error(`trading equity stayed negative at ${endEquity}`)
  if (isWipeOut(endEquity, equityAtDayStart)) {
    const wiped: WipeOutEvent = { kind: 'wipeOut', day, startEquity: equityAtDayStart, endEquity }
    events.push(wiped)
  }
  return events
}
