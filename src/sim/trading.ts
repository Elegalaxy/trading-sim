// Market orders. One net position per asset: positive is long, negative is short.
// Prices and money are integer cents. This step has no leverage, no margin
// interest, and no liquidation. Orders read the market and do not write it,
// so they do not move a price, a fair value, or a random stream.
//
// Equity and the 5x cap (section 7):
//   equity = trading-account cents + sum(signedShares × current price cents)
//   gross  = sum(abs(signedShares) × current price cents)
// Both use the position after this order and the current quoted price, not the fill.
// Trading cash may be negative. That negative balance is the margin loan.
// Wallet cash and savings are not used and are not part of equity.
// Margin ratio = equity / gross. An order that would push the ratio below 20%
// is rejected. Exactly 20% is allowed, which is 5x. Equity below zero is rejected.
// If gross is 0 there is no ratio. The order is accepted only when the fee can be
// booked, so trading cash is not left negative with no position.
// A buy pays shares × fill price + fee and may drive trading cash negative.
// A sell credits shares × fill price, then the fee is deducted.
// Margin interest, liquidation, and the backstop are in margin.ts.
//
// Fee: 0.1% of the fill notional, rounded half away from zero to cents.
// Spread: the asset's spreadPpm (1000 ppm = 0.10% of price, up to 4000 ppm = 0.40%).
// Half of that, in cents, is the half spread. Buy fills at price + half spread.
// Sell fills at price − half spread.
// Event day, provisional: a stock's spread doubles when today's feed has a headline
// whose target is that asset (event id `type:asset:day` with day === market.day),
// or when any calendar item is already applied today. The index doubles only for
// the calendar case. Doubling happens before the half-spread rounding.
// The feed stored while the player trades was generated at the end of this day
// (`feed.day` is market.day + 1). Its headlines name events that fired on market.day.
//
// Realized ledger: closing or reducing realizes (exit fill − entry average) × closed
// shares for a long, and the opposite for a short. Entry average is costCents /
// abs(shares). A partial close removes round-half-away(cost × closed / open) cents
// of basis; a full close removes the whole basis. Fees and borrow fees then reduce
// that day's total. The ledger is for Step 17. This step does not check FI.
//
// Borrow: at the end of the day, inside endDay, after the market step. Each short
// pays its borrowFeePpm (100 ppm = 0.01% a day, up to 300 ppm = 0.03%) of
// abs(shares) × the post-step price, rounded half away from zero. The fee is
// logged on the post-step day, same clock as savings accrual, and deducted from
// the trading account. Only positive trading cash pays it. If cash is short, or
// already negative, the rest is logged unpaid. Unpaid is not added to the margin
// loan, and a negative balance is not zeroed. Wallet cash and savings are not
// touched. The full assessed fee, including the unpaid part, reduces that day's
// realized total.

import {
  BORROW_FEE_PPM_MAX,
  BORROW_FEE_PPM_MIN,
  MARGIN_MIN_RATIO_DENOMINATOR,
  MARGIN_MIN_RATIO_NUMERATOR,
  RATE_PPM_SCALE,
  SPREAD_PPM_MAX,
  SPREAD_PPM_MIN,
  TRADE_FEE_DENOMINATOR,
  TRADE_FEE_NUMERATOR,
} from './constants.ts'
import { quoteMarket } from './session.ts'
import type {
  AssetDefinition,
  BorrowFeeEvent,
  CommandRejectedEvent,
  GameState,
  MarketDefinitions,
  MarketState,
  OpenPosition,
  OrderFillEvent,
  OrderSide,
  RealizedEvent,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

export type OrderOutcome = {
  accepted: boolean
  events: Array<OrderFillEvent | RealizedEvent | CommandRejectedEvent>
}

type Projection = {
  signedShares: number
  costCents: number
  closedShares: number
  realizedCents: number
}

/** Integer division, half away from zero. Numerator and denominator are safe integers. */
function roundDivHalfAway(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error(
      `division expected a safe integer over a positive safe integer, received ${describeValue(numerator)} / ${describeValue(denominator)}`,
    )
  }
  const negative = numerator < 0
  const num = negative ? -numerator : numerator
  const quotient = Math.floor(num / denominator)
  const remainder = num % denominator
  const twice = remainder * 2
  if (!Number.isSafeInteger(twice)) {
    throw new Error(`division remainder is too large, received ${describeValue(numerator)} / ${describeValue(denominator)}`)
  }
  const rounded = twice >= denominator ? quotient + 1 : quotient
  if (!Number.isSafeInteger(rounded)) {
    throw new Error(`division result is not a safe integer, received ${describeValue(numerator)} / ${describeValue(denominator)}`)
  }
  return negative ? -rounded : rounded
}

function requirePpm(value: number | undefined, min: number, max: number, label: string): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max} ppm, received ${describeValue(value)}`)
  }
  return value
}

function findAsset(defs: MarketDefinitions, id: string): AssetDefinition | undefined {
  let found: AssetDefinition | undefined
  for (const def of defs.assets) {
    if (def.id !== id) continue
    if (found !== undefined) throw new Error(`asset id ${id} is duplicated`)
    found = def
  }
  return found
}

function rejected(day: number, reason: string): OrderOutcome {
  const event: CommandRejectedEvent = { kind: 'commandRejected', day, command: 'order', reason }
  return { accepted: false, events: [event] }
}

/** Non-finite and non-integer quantities are rejected before the sign check. */
function quantityReason(quantity: unknown): string | null {
  if (typeof quantity !== 'number') return 'quantityNotInteger'
  if (Number.isNaN(quantity)) return 'quantityNaN'
  if (!Number.isFinite(quantity)) return 'quantityNotFinite'
  if (!Number.isInteger(quantity)) return 'quantityNotInteger'
  if (!Number.isSafeInteger(quantity)) return 'quantityNotSafeInteger'
  if (quantity < 0) return 'quantityNegative'
  if (quantity === 0) return 'quantityZero'
  return null
}

function calendarAppliedToday(market: MarketState): boolean {
  if (!Array.isArray(market.calendarRolls)) {
    throw new Error(`calendar rolls must be an array, received ${describeValue(market.calendarRolls)}`)
  }
  for (const item of market.calendarRolls) {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`calendar roll must be an object, received ${describeValue(item)}`)
    }
    if (item.day === market.day && item.applied === true) return true
  }
  return false
}

/**
 * Today's feed is the feed on the market. A headline widens one stock when its
 * event id is `type:asset:day` and that day is the current market day.
 */
function headlineTargetsAssetToday(market: MarketState, assetId: string): boolean {
  const feed = market.feed
  if (typeof feed !== 'object' || feed === null || !Array.isArray(feed.items)) {
    throw new Error(`market feed must be an object with items, received ${describeValue(feed)}`)
  }
  for (const item of feed.items) {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`feed item must be an object, received ${describeValue(item)}`)
    }
    if (item.kind !== 'headline') continue
    if (typeof item.eventId !== 'string') {
      throw new Error(`headline eventId must be a string, received ${describeValue(item.eventId)}`)
    }
    const parts = item.eventId.split(':')
    if (parts.length !== 3) continue
    const target = parts[1]
    const dayText = parts[2]
    if (target !== assetId || dayText === undefined || !/^[0-9]+$/.test(dayText)) continue
    const eventDay = Number(dayText)
    if (eventDay === market.day) return true
  }
  return false
}

function spreadWidens(market: MarketState, def: AssetDefinition): boolean {
  if (calendarAppliedToday(market)) return true
  if (def.kind === 'index') return false
  return headlineTargetsAssetToday(market, def.id)
}

function halfSpreadCents(price: number, spreadPpm: number, widened: boolean): number {
  const ppm = widened ? spreadPpm * 2 : spreadPpm
  if (!Number.isSafeInteger(ppm)) {
    throw new Error(`widened spread ppm is not a safe integer, received ${describeValue(ppm)}`)
  }
  const numerator = price * ppm
  if (!Number.isSafeInteger(numerator)) {
    throw new Error(`half-spread numerator is not a safe integer, received ${describeValue(price)} × ${describeValue(ppm)}`)
  }
  return roundDivHalfAway(numerator, RATE_PPM_SCALE * 2)
}

function feeCents(notional: number): number {
  const numerator = notional * TRADE_FEE_NUMERATOR
  if (!Number.isSafeInteger(numerator)) {
    throw new Error(`fee numerator is not a safe integer, received ${describeValue(notional)}`)
  }
  return roundDivHalfAway(numerator, TRADE_FEE_DENOMINATOR)
}

export function recordRealized(state: GameState, day: number, cents: number): void {
  if (!Number.isSafeInteger(day) || day < 0) {
    throw new Error(`realized day must be a safe integer >= 0, received ${describeValue(day)}`)
  }
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`realized cents must be a safe integer, received ${describeValue(cents)}`)
  }
  const rows = state.realized
  const last = rows[rows.length - 1]
  if (last !== undefined && day < last.day) {
    throw new Error(`realized day ${day} is before the last posted day ${last.day}`)
  }
  if (last !== undefined && last.day === day) {
    const next = last.cents + cents
    if (!Number.isSafeInteger(next)) {
      throw new Error(`realized total is not a safe integer, received ${describeValue(next)}`)
    }
    last.cents = next
    return
  }
  if (cents === 0) return
  rows.push({ day, cents })
}

function projectPosition(
  current: OpenPosition | undefined,
  side: OrderSide,
  quantity: number,
  fillPrice: number,
): Projection | 'overflow' {
  const oldShares = current?.signedShares ?? 0
  const oldCost = current?.costCents ?? 0
  const delta = side === 'buy' ? quantity : -quantity
  const newShares = oldShares + delta
  if (!Number.isSafeInteger(newShares)) return 'overflow'

  const sameDirection = oldShares !== 0 && ((oldShares > 0 && delta > 0) || (oldShares < 0 && delta < 0))
  if (oldShares === 0 || sameDirection) {
    const added = fillPrice * quantity
    if (!Number.isSafeInteger(added)) return 'overflow'
    const costCents = oldCost + added
    if (!Number.isSafeInteger(costCents)) return 'overflow'
    return { signedShares: newShares, costCents, closedShares: 0, realizedCents: 0 }
  }

  const openShares = Math.abs(oldShares)
  const closedShares = Math.min(openShares, quantity)
  const closedNotional = closedShares * fillPrice
  if (!Number.isSafeInteger(closedNotional)) return 'overflow'
  let removedCost: number
  if (closedShares === openShares) {
    removedCost = oldCost
  } else {
    const basis = oldCost * closedShares
    if (!Number.isSafeInteger(basis)) return 'overflow'
    removedCost = roundDivHalfAway(basis, openShares)
  }
  if (removedCost > oldCost) {
    throw new Error(`removed cost ${removedCost} exceeds basis ${oldCost}`)
  }
  const realizedCents = oldShares > 0 ? closedNotional - removedCost : removedCost - closedNotional
  if (!Number.isSafeInteger(realizedCents)) return 'overflow'

  if (newShares === 0) {
    return { signedShares: 0, costCents: 0, closedShares, realizedCents }
  }
  const stillSameSide = (oldShares > 0 && newShares > 0) || (oldShares < 0 && newShares < 0)
  if (stillSameSide) {
    const costCents = oldCost - removedCost
    if (!Number.isSafeInteger(costCents) || costCents < 0) {
      throw new Error(`remaining cost must be a safe integer >= 0, received ${describeValue(costCents)}`)
    }
    return { signedShares: newShares, costCents, closedShares, realizedCents }
  }

  const opened = Math.abs(newShares)
  const costCents = fillPrice * opened
  if (!Number.isSafeInteger(costCents)) return 'overflow'
  return { signedShares: newShares, costCents, closedShares, realizedCents }
}

function exposure(
  market: MarketState,
  defs: MarketDefinitions,
  positions: Record<string, OpenPosition>,
): { marked: number; gross: number } | 'overflow' {
  let marked = 0
  let gross = 0
  const known = new Set<string>()
  for (const def of defs.assets) {
    known.add(def.id)
    const shares = positions[def.id]?.signedShares ?? 0
    const price = market.assets[def.id]?.priceCents
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new Error(`asset ${def.id} price must be a positive safe integer, received ${describeValue(price)}`)
    }
    const markedPart = shares * price
    const grossPart = Math.abs(shares) * price
    if (!Number.isSafeInteger(markedPart) || !Number.isSafeInteger(grossPart)) return 'overflow'
    marked += markedPart
    gross += grossPart
    if (!Number.isSafeInteger(marked) || !Number.isSafeInteger(gross)) return 'overflow'
  }
  for (const id of Object.keys(positions)) {
    if (!known.has(id)) throw new Error(`position ${id} is not an asset`)
  }
  return { marked, gross }
}

/**
 * 5x gate. `cash` means the fee cannot be booked: equity would be negative,
 * or the account would be flat with unpaid trading cash. `power` means the
 * ratio would be below 20%. Exactly 20% (`equity × 5 === gross`) is allowed.
 */
function marginDecision(equity: number, gross: number): 'ok' | 'cash' | 'power' | 'overflow' {
  if (gross === 0) return equity < 0 ? 'cash' : 'ok'
  if (equity < 0) return 'cash'
  const left = equity * MARGIN_MIN_RATIO_DENOMINATOR
  const right = gross * MARGIN_MIN_RATIO_NUMERATOR
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return 'overflow'
  if (left < right) return 'power'
  return 'ok'
}

/** Trading-account equity and gross position value at the current quoted prices. */
export function tradingEquity(state: GameState, defs: MarketDefinitions): { equity: number; gross: number } {
  if (!Number.isSafeInteger(state.accounts.tradingCents)) {
    throw new Error(`trading cash must be a safe integer, received ${describeValue(state.accounts.tradingCents)}`)
  }
  const marked = exposure(quoteMarket(state), defs, state.positions)
  if (marked === 'overflow') throw new Error('trading equity overflowed a safe integer')
  const equity = state.accounts.tradingCents + marked.marked
  if (!Number.isSafeInteger(equity)) {
    throw new Error(`trading equity is not a safe integer, received ${describeValue(equity)}`)
  }
  return { equity, gross: marked.gross }
}

type FillQuote = {
  price: number
  halfSpread: number
  fillPrice: number
  fee: number
  cashMove: number
}

/** Step 10 fill. Buy pays notional + fee. Sell receives notional, then pays the fee. */
function quoteFill(
  market: MarketState,
  def: AssetDefinition,
  side: OrderSide,
  quantity: number,
  fixedFill?: number,
): FillQuote | 'overflow' {
  const quoted = market.assets[def.id]
  if (quoted === undefined || !Number.isSafeInteger(quoted.priceCents) || quoted.priceCents <= 0) {
    throw new Error(`asset ${def.id} price must be a positive safe integer, received ${describeValue(quoted?.priceCents)}`)
  }
  // A limit, take profit or stop loss fills at its own price, so there is no spread.
  let halfSpread = 0
  if (fixedFill === undefined) {
    const spreadPpm = requirePpm(def.spreadPpm, SPREAD_PPM_MIN, SPREAD_PPM_MAX, `asset ${def.id} spreadPpm`)
    halfSpread = halfSpreadCents(quoted.priceCents, spreadPpm, spreadWidens(market, def))
  }
  const fillPrice = fixedFill ?? (side === 'buy' ? quoted.priceCents + halfSpread : quoted.priceCents - halfSpread)
  if (!Number.isSafeInteger(fillPrice) || fillPrice <= 0) {
    throw new Error(`fill price for ${def.id} must be a positive safe integer, received ${describeValue(fillPrice)}`)
  }
  const notional = quantity * fillPrice
  if (!Number.isSafeInteger(notional)) return 'overflow'
  const fee = feeCents(notional)
  const cashMove = side === 'buy' ? -(notional + fee) : notional - fee
  if (!Number.isSafeInteger(cashMove)) return 'overflow'
  return { price: quoted.priceCents, halfSpread, fillPrice, fee, cashMove }
}

export type PositionClose = {
  asset: string
  side: OrderSide
  quantity: number
  price: number
  halfSpread: number
  fillPrice: number
  fee: number
}

/**
 * Close one whole position at the Step 10 fill. Skips the 5x check so a
 * liquidation can close a book that is already under 20%. Trading cash may
 * go negative. The realized ledger takes the close P&L and the fee.
 */
export function closeWholePosition(
  state: GameState,
  defs: MarketDefinitions,
  assetId: string,
  fixedFill?: number,
): PositionClose {
  const position = state.positions[assetId]
  if (position === undefined || position.signedShares === 0) {
    throw new Error(`no open position to close for ${assetId}`)
  }
  const quantity = Math.abs(position.signedShares)
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error(`close quantity for ${assetId} must be a positive safe integer, received ${describeValue(position.signedShares)}`)
  }
  const side: OrderSide = position.signedShares > 0 ? 'sell' : 'buy'
  const def = findAsset(defs, assetId)
  if (def === undefined) throw new Error(`position ${assetId} is not an asset`)
  const quote = quoteFill(quoteMarket(state), def, side, quantity, fixedFill)
  if (quote === 'overflow') throw new Error(`close of ${assetId} overflowed a safe integer`)
  const nextTrading = state.accounts.tradingCents + quote.cashMove
  if (!Number.isSafeInteger(nextTrading)) {
    throw new Error(`close of ${assetId} left trading cash outside a safe integer, received ${describeValue(nextTrading)}`)
  }
  const projection = projectPosition(position, side, quantity, quote.fillPrice)
  if (projection === 'overflow') throw new Error(`close of ${assetId} overflowed a safe integer`)
  if (projection.signedShares !== 0) {
    throw new Error(`close of ${assetId} left ${projection.signedShares} shares`)
  }
  state.accounts.tradingCents = nextTrading
  delete state.positions[assetId]
  if (projection.closedShares > 0) recordRealized(state, state.market.day, projection.realizedCents)
  recordRealized(state, state.market.day, -quote.fee)
  return {
    asset: assetId,
    side,
    quantity,
    price: quote.price,
    halfSpread: quote.halfSpread,
    fillPrice: quote.fillPrice,
    fee: quote.fee,
  }
}

/**
 * Fill one market order, or reject it and leave positions, balances, and the
 * realized ledger unchanged. See the equity rule at the top of this file.
 */
export function interpretOrder(
  state: GameState,
  defs: MarketDefinitions,
  cmd: unknown,
  fixedFill?: number,
): OrderOutcome {
  const day = state.market.day
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) {
    return rejected(day, 'quantityNotInteger')
  }
  const record = cmd as { asset?: unknown; side?: unknown; quantity?: unknown }
  if (record.side !== 'buy' && record.side !== 'sell') {
    return rejected(day, 'sideNotBuyOrSell')
  }
  const quantityIssue = quantityReason(record.quantity)
  if (quantityIssue !== null) return rejected(day, quantityIssue)
  const quantity = record.quantity as number
  if (typeof record.asset !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(record.asset)) {
    return rejected(day, 'unknownAsset')
  }
  const def = findAsset(defs, record.asset)
  if (def === undefined) return rejected(day, 'unknownAsset')

  const market = quoteMarket(state)
  const quote = quoteFill(market, def, record.side, quantity, fixedFill)
  if (quote === 'overflow') return rejected(day, 'notionalNotSafeInteger')
  const nextTrading = state.accounts.tradingCents + quote.cashMove
  if (!Number.isSafeInteger(nextTrading)) {
    return rejected(day, 'notionalNotSafeInteger')
  }

  const projection = projectPosition(state.positions[def.id], record.side, quantity, quote.fillPrice)
  if (projection === 'overflow') return rejected(day, 'notionalNotSafeInteger')
  const nextPositions: Record<string, OpenPosition> = { ...state.positions }
  if (projection.signedShares === 0) delete nextPositions[def.id]
  else {
    nextPositions[def.id] = {
      asset: def.id,
      signedShares: projection.signedShares,
      costCents: projection.costCents,
    }
  }
  const marked = exposure(market, defs, nextPositions)
  if (marked === 'overflow') return rejected(day, 'notionalNotSafeInteger')
  const equity = nextTrading + marked.marked
  if (!Number.isSafeInteger(equity)) return rejected(day, 'notionalNotSafeInteger')
  const margin = marginDecision(equity, marked.gross)
  if (margin === 'overflow') return rejected(day, 'notionalNotSafeInteger')
  if (margin === 'cash') return rejected(day, 'insufficientTradingCash')
  if (margin === 'power') return rejected(day, 'insufficientBuyingPower')

  state.accounts.tradingCents = nextTrading
  if (projection.signedShares === 0) delete state.positions[def.id]
  else state.positions[def.id] = nextPositions[def.id] as OpenPosition

  const fill: OrderFillEvent = {
    kind: 'orderFill',
    day,
    asset: def.id,
    side: record.side,
    quantity,
    price: quote.price,
    halfSpread: quote.halfSpread,
    fillPrice: quote.fillPrice,
    fee: quote.fee,
  }
  const events: Array<OrderFillEvent | RealizedEvent> = [fill]
  if (projection.closedShares > 0) {
    recordRealized(state, day, projection.realizedCents)
    events.push({
      kind: 'realized',
      day,
      asset: def.id,
      amount: projection.realizedCents,
    })
  }
  recordRealized(state, day, -quote.fee)
  return { accepted: true, events }
}

/**
 * Charge one day of borrow fees for every short. Call this after the market
 * step. Longs pay nothing. A zero rounded fee is still logged.
 */
export function settleBorrowFees(state: GameState, defs: MarketDefinitions): BorrowFeeEvent[] {
  const day = state.market.day
  const events: BorrowFeeEvent[] = []
  const known = new Set<string>()
  for (const def of defs.assets) {
    known.add(def.id)
    const position = state.positions[def.id]
    if (position === undefined || position.signedShares >= 0) continue
    const shares = -position.signedShares
    if (!Number.isSafeInteger(shares) || shares <= 0) {
      throw new Error(`short ${def.id} shares must be a positive safe integer, received ${describeValue(position.signedShares)}`)
    }
    const price = state.market.assets[def.id]?.priceCents
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new Error(`asset ${def.id} price must be a positive safe integer, received ${describeValue(price)}`)
    }
    const ratePpm = requirePpm(def.borrowFeePpm, BORROW_FEE_PPM_MIN, BORROW_FEE_PPM_MAX, `asset ${def.id} borrowFeePpm`)
    const basis = shares * price
    if (!Number.isSafeInteger(basis)) {
      throw new Error(`borrow basis for ${def.id} is not a safe integer, received ${describeValue(shares)} × ${describeValue(price)}`)
    }
    const numerator = basis * ratePpm
    if (!Number.isSafeInteger(numerator)) {
      throw new Error(`borrow numerator for ${def.id} is not a safe integer, received ${describeValue(numerator)}`)
    }
    const assessed = roundDivHalfAway(numerator, RATE_PPM_SCALE)
    if (assessed < 0) throw new Error(`borrow fee for ${def.id} must be >= 0, received ${assessed}`)
    const cash = state.accounts.tradingCents
    if (!Number.isSafeInteger(cash)) {
      throw new Error(`trading cash must be a safe integer, received ${describeValue(cash)}`)
    }
    const payable = cash > 0 ? cash : 0
    const paid = assessed > payable ? payable : assessed
    const unpaid = assessed - paid
    if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(unpaid) || paid < 0 || unpaid < 0) {
      throw new Error(`borrow split for ${def.id} is not valid, assessed=${assessed} paid=${paid} unpaid=${unpaid}`)
    }
    const nextCash = cash - paid
    if (!Number.isSafeInteger(nextCash)) {
      throw new Error(`trading cash after the borrow fee is not a safe integer, received ${describeValue(nextCash)}`)
    }
    state.accounts.tradingCents = nextCash
    recordRealized(state, day, -assessed)
    events.push({
      kind: 'borrowFee',
      day,
      asset: def.id,
      shares,
      price,
      ratePpm,
      assessed,
      paid,
      unpaid,
    })
  }
  for (const id of Object.keys(state.positions)) {
    if (!known.has(id)) throw new Error(`position ${id} is not an asset`)
  }
  return events
}
