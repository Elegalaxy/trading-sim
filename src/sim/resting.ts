// Limit orders, take profit and stop loss. Nothing here is random and nothing moves a
// price. Orders and exits rest on `GameState.resting` and are checked against the
// 15-minute bars of the session (session.ts) as the clock moves, and for the rest of
// the day when End day is pressed. They carry over to the next day.
//
// Rules (section 5, "Limit orders and exits"):
// - A limit buy rests below the quote at the clock, a limit sell above it. A bar fills
//   it when its low (buy) or high (sell) reaches the limit. The fill price is the limit,
//   or the bar's open when the bar opened past the limit. There is no spread. The fee
//   and the 5x check apply. An order that fails the check at fill time is dropped.
// - A take profit or stop loss belongs to one open position and closes all of it.
//   Long: take profit above the quote, stop loss below. Short: the other way round.
//   A stop fills at the stop, or at the bar's open if the bar opened past it. A take
//   profit fills at the target, or at a better open. If one bar touches both, the stop
//   wins. A stop is not margin-checked, like any close. The fee applies, the spread
//   does not.
// - A limit fill sets its exits for the next bar, never the same bar. Closing or
//   flipping a position removes its exits.
// - Orders are placed in the market section. Cancelling works any time.

import { SESSION_STEPS } from './constants.ts'
import { clockTime, sessionPrice } from './session.ts'
import { closeWholePosition, interpretOrder } from './trading.ts'
import type {
  CommandLogEvent,
  GameState,
  MarketDefinitions,
  OrderSide,
  PositionExit,
  RestingEvent,
  RestingKind,
  RestingOrder,
  RestingState,
} from './types.ts'

export const MAX_RESTING_ORDERS = 8

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

export function initialResting(): RestingState {
  return { nextId: 1, orders: [], exits: {} }
}

function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function rejectEvent(state: GameState, command: string, reason: string): CommandLogEvent[] {
  return [{ kind: 'commandRejected', day: state.market.day, command, reason }]
}

function restingEvent(
  state: GameState,
  action: RestingEvent['action'],
  asset: string,
  detail: RestingKind,
  side: OrderSide | null,
  quantity: number,
  priceCents: number,
  extra?: { fee?: number; time?: string; reason?: string },
): RestingEvent {
  return {
    kind: 'resting',
    day: state.market.day,
    action,
    asset,
    detail,
    side,
    quantity,
    priceCents,
    fee: extra?.fee ?? 0,
    time: extra?.time ?? null,
    reason: extra?.reason ?? null,
  }
}

function knownAsset(defs: MarketDefinitions, asset: unknown): asset is string {
  return typeof asset === 'string' && defs.assets.some((def) => def.id === asset)
}

/** Null when the price is on the right side of the reference, else the reason. */
function exitProblem(side: 'long' | 'short', tp: number | null, sl: number | null, reference: number): string | null {
  if (tp !== null) {
    if (!isPrice(tp)) return 'takeProfitNotPrice'
    if (side === 'long' ? tp <= reference : tp >= reference) return 'takeProfitWrongSide'
  }
  if (sl !== null) {
    if (!isPrice(sl)) return 'stopLossNotPrice'
    if (side === 'long' ? sl >= reference : sl <= reference) return 'stopLossWrongSide'
  }
  return null
}

/** Why a market order of this size would be turned down at this price, or null. */
function marginProblem(
  state: GameState,
  defs: MarketDefinitions,
  asset: string,
  side: OrderSide,
  quantity: number,
  fixedFill: number,
): string | null {
  const clone = structuredClone(state)
  const outcome = interpretOrder(clone, defs, { type: 'order', asset, side, quantity }, fixedFill)
  if (outcome.accepted) return null
  const rejection = outcome.events.find((event) => event.kind === 'commandRejected')
  return rejection !== undefined && rejection.kind === 'commandRejected' ? rejection.reason : 'rejected'
}

/** Place a limit order. Takes `asset`, `side`, `quantity`, `limitCents`, and optional `tpCents` and `slCents`. */
export function interpretLimitOrder(state: GameState, defs: MarketDefinitions, cmd: unknown): CommandLogEvent[] {
  const command = 'limitOrder'
  const record = (typeof cmd === 'object' && cmd !== null ? cmd : {}) as Record<string, unknown>
  if (record.side !== 'buy' && record.side !== 'sell') return rejectEvent(state, command, 'sideNotBuyOrSell')
  if (!knownAsset(defs, record.asset)) return rejectEvent(state, command, 'unknownAsset')
  const asset = record.asset
  const side = record.side
  const quantity = record.quantity
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1) {
    return rejectEvent(state, command, 'quantityNotInteger')
  }
  const limit = record.limitCents
  if (!isPrice(limit)) return rejectEvent(state, command, 'limitNotPrice')
  if (state.resting.orders.length >= MAX_RESTING_ORDERS) return rejectEvent(state, command, 'tooManyOrders')
  const quote = sessionPrice(state, asset)
  if (side === 'buy' && limit >= quote) return rejectEvent(state, command, 'limitNotBelowMarket')
  if (side === 'sell' && limit <= quote) return rejectEvent(state, command, 'limitNotAboveMarket')
  const tp = record.tpCents === undefined ? null : record.tpCents
  const sl = record.slCents === undefined ? null : record.slCents
  if ((tp !== null && typeof tp !== 'number') || (sl !== null && typeof sl !== 'number')) {
    return rejectEvent(state, command, 'exitNotPrice')
  }
  const problem = exitProblem(side === 'buy' ? 'long' : 'short', tp, sl, limit)
  if (problem !== null) return rejectEvent(state, command, problem)
  const margin = marginProblem(state, defs, asset, side, quantity, limit)
  if (margin !== null) return rejectEvent(state, command, margin)
  const order: RestingOrder = {
    id: state.resting.nextId,
    asset,
    side,
    quantity,
    limitCents: limit,
    tpCents: tp,
    slCents: sl,
  }
  state.resting.nextId += 1
  state.resting.orders.push(order)
  return [restingEvent(state, 'placed', asset, 'limit', side, quantity, limit)]
}

/** Cancel a limit order by id. */
export function interpretCancelOrder(state: GameState, cmd: unknown): CommandLogEvent[] {
  const record = (typeof cmd === 'object' && cmd !== null ? cmd : {}) as { id?: unknown }
  const index = state.resting.orders.findIndex((order) => order.id === record.id)
  if (index < 0) return rejectEvent(state, 'cancelOrder', 'noSuchOrder')
  const [order] = state.resting.orders.splice(index, 1)
  return [restingEvent(state, 'cancelled', order.asset, 'limit', order.side, order.quantity, order.limitCents)]
}

/**
 * Set or clear the take profit and stop loss of an open position. A missing field keeps
 * the old value, null clears it.
 */
export function interpretSetExits(state: GameState, defs: MarketDefinitions, cmd: unknown): CommandLogEvent[] {
  const command = 'setExits'
  const record = (typeof cmd === 'object' && cmd !== null ? cmd : {}) as Record<string, unknown>
  if (!knownAsset(defs, record.asset)) return rejectEvent(state, command, 'unknownAsset')
  const asset = record.asset
  const position = state.positions[asset]
  if (position === undefined) return rejectEvent(state, command, 'noPosition')
  const side: 'long' | 'short' = position.signedShares > 0 ? 'long' : 'short'
  const current = state.resting.exits[asset]
  const before: PositionExit = current !== undefined && current.side === side ? current : { side, tpCents: null, slCents: null }
  const next: PositionExit = { ...before }
  if (record.tpCents !== undefined) {
    if (record.tpCents !== null && typeof record.tpCents !== 'number') return rejectEvent(state, command, 'takeProfitNotPrice')
    next.tpCents = record.tpCents
  }
  if (record.slCents !== undefined) {
    if (record.slCents !== null && typeof record.slCents !== 'number') return rejectEvent(state, command, 'stopLossNotPrice')
    next.slCents = record.slCents
  }
  if (next.tpCents === before.tpCents && next.slCents === before.slCents) return rejectEvent(state, command, 'nothingToChange')
  const quote = sessionPrice(state, asset)
  const problem = exitProblem(
    side,
    next.tpCents !== before.tpCents ? next.tpCents : null,
    next.slCents !== before.slCents ? next.slCents : null,
    quote,
  )
  if (problem !== null) return rejectEvent(state, command, problem)
  if (next.tpCents === null && next.slCents === null) delete state.resting.exits[asset]
  else state.resting.exits[asset] = next
  const closing: OrderSide = side === 'long' ? 'sell' : 'buy'
  const shares = Math.abs(position.signedShares)
  const events: CommandLogEvent[] = []
  const change = (kind: RestingKind, was: number | null, now: number | null): void => {
    if (was === now) return
    if (now === null) events.push(restingEvent(state, 'cancelled', asset, kind, closing, shares, was ?? 0))
    else events.push(restingEvent(state, 'placed', asset, kind, closing, shares, now))
  }
  change('takeProfit', before.tpCents, next.tpCents)
  change('stopLoss', before.slCents, next.slCents)
  return events
}

/** Drop exits whose position is gone or on the other side now. */
export function pruneExits(state: GameState): CommandLogEvent[] {
  const events: CommandLogEvent[] = []
  for (const asset of Object.keys(state.resting.exits)) {
    const exit = state.resting.exits[asset]
    const shares = state.positions[asset]?.signedShares ?? 0
    const side = shares > 0 ? 'long' : shares < 0 ? 'short' : null
    if (side === exit.side) continue
    const closing: OrderSide = exit.side === 'long' ? 'sell' : 'buy'
    if (exit.tpCents !== null) events.push(restingEvent(state, 'cancelled', asset, 'takeProfit', closing, 0, exit.tpCents, { reason: 'positionClosed' }))
    if (exit.slCents !== null) events.push(restingEvent(state, 'cancelled', asset, 'stopLoss', closing, 0, exit.slCents, { reason: 'positionClosed' }))
    delete state.resting.exits[asset]
  }
  return events
}

function triggerExits(state: GameState, defs: MarketDefinitions, index: number): CommandLogEvent[] {
  const events: CommandLogEvent[] = []
  for (const def of defs.assets) {
    const exit = state.resting.exits[def.id]
    const position = state.positions[def.id]
    const bar = state.session.bars[def.id]?.[index]
    if (exit === undefined || position === undefined || bar === undefined) continue
    const long = exit.side === 'long'
    const stopHit = exit.slCents !== null && (long ? bar.low <= exit.slCents : bar.high >= exit.slCents)
    const targetHit = exit.tpCents !== null && (long ? bar.high >= exit.tpCents : bar.low <= exit.tpCents)
    let detail: RestingKind
    let fill: number
    if (stopHit && exit.slCents !== null) {
      detail = 'stopLoss'
      fill = long ? Math.min(exit.slCents, bar.open) : Math.max(exit.slCents, bar.open)
    } else if (targetHit && exit.tpCents !== null) {
      detail = 'takeProfit'
      fill = long ? Math.max(exit.tpCents, bar.open) : Math.min(exit.tpCents, bar.open)
    } else {
      continue
    }
    const closed = closeWholePosition(state, defs, def.id, fill)
    delete state.resting.exits[def.id]
    events.push(
      restingEvent(state, 'filled', def.id, detail, closed.side, closed.quantity, closed.fillPrice, {
        fee: closed.fee,
        time: clockTime(index),
      }),
    )
  }
  return events
}

function triggerLimits(state: GameState, defs: MarketDefinitions, index: number): CommandLogEvent[] {
  const events: CommandLogEvent[] = []
  for (const order of state.resting.orders.slice()) {
    const bar = state.session.bars[order.asset]?.[index]
    if (bar === undefined) continue
    const buy = order.side === 'buy'
    const hit = buy ? bar.low <= order.limitCents : bar.high >= order.limitCents
    if (!hit) continue
    const fill = buy ? Math.min(order.limitCents, bar.open) : Math.max(order.limitCents, bar.open)
    state.resting.orders = state.resting.orders.filter((other) => other.id !== order.id)
    const outcome = interpretOrder(
      state,
      defs,
      { type: 'order', asset: order.asset, side: order.side, quantity: order.quantity },
      fill,
    )
    if (!outcome.accepted) {
      const rejection = outcome.events.find((event) => event.kind === 'commandRejected')
      const reason = rejection !== undefined && rejection.kind === 'commandRejected' ? rejection.reason : 'rejected'
      events.push(restingEvent(state, 'dropped', order.asset, 'limit', order.side, order.quantity, order.limitCents, { reason, time: clockTime(index) }))
      continue
    }
    for (const event of outcome.events) events.push(event)
    const filled = outcome.events.find((event) => event.kind === 'orderFill')
    events.push(
      restingEvent(state, 'filled', order.asset, 'limit', order.side, order.quantity, fill, {
        fee: filled !== undefined && filled.kind === 'orderFill' ? filled.fee : 0,
        time: clockTime(index),
      }),
    )
    const shares = state.positions[order.asset]?.signedShares ?? 0
    const wanted = buy ? shares > 0 : shares < 0
    if (wanted && (order.tpCents !== null || order.slCents !== null)) {
      const side = buy ? 'long' : 'short'
      const old = state.resting.exits[order.asset]
      const base: PositionExit = old !== undefined && old.side === side ? old : { side, tpCents: null, slCents: null }
      state.resting.exits[order.asset] = {
        side,
        tpCents: order.tpCents ?? base.tpCents,
        slCents: order.slCents ?? base.slCents,
      }
    }
  }
  return events
}

/**
 * Move the clock from `from` to `to` one bar at a time, filling whatever the bars
 * touch. Quotes (equity, the 5x check) are read at each bar's close. The clock ends at `to`.
 */
export function advanceClock(state: GameState, defs: MarketDefinitions, from: number, to: number): CommandLogEvent[] {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to > SESSION_STEPS || from > to) {
    throw new Error(`clock move must go forward inside 0 to ${SESSION_STEPS}, received ${describeValue(from)} to ${describeValue(to)}`)
  }
  const events: CommandLogEvent[] = []
  if (state.resting.orders.length === 0 && Object.keys(state.resting.exits).length === 0) {
    state.session.clock = to
    return events
  }
  for (let index = from; index < to; index += 1) {
    state.session.clock = index + 1
    for (const event of triggerExits(state, defs, index)) events.push(event)
    for (const event of triggerLimits(state, defs, index)) events.push(event)
    for (const event of pruneExits(state)) events.push(event)
  }
  state.session.clock = to
  return events
}

/** Plain value check for resting state from a save or a command. */
export function assertResting(resting: RestingState): void {
  if (typeof resting !== 'object' || resting === null || Array.isArray(resting)) {
    throw new Error(`resting must be an object, received ${describeValue(resting)}`)
  }
  if (!Number.isSafeInteger(resting.nextId) || resting.nextId < 1) {
    throw new Error(`resting nextId must be a safe integer >= 1, received ${describeValue(resting.nextId)}`)
  }
  if (!Array.isArray(resting.orders) || resting.orders.length > MAX_RESTING_ORDERS) {
    throw new Error(`resting orders must be an array of at most ${MAX_RESTING_ORDERS}`)
  }
  for (const order of resting.orders) {
    if (
      typeof order !== 'object' ||
      order === null ||
      !Number.isSafeInteger(order.id) ||
      order.id >= resting.nextId ||
      (order.side !== 'buy' && order.side !== 'sell') ||
      typeof order.asset !== 'string' ||
      !Number.isSafeInteger(order.quantity) ||
      order.quantity < 1 ||
      !isPrice(order.limitCents) ||
      (order.tpCents !== null && !isPrice(order.tpCents)) ||
      (order.slCents !== null && !isPrice(order.slCents))
    ) {
      throw new Error('resting order is not a valid order')
    }
  }
  if (typeof resting.exits !== 'object' || resting.exits === null || Array.isArray(resting.exits)) {
    throw new Error(`resting exits must be an object, received ${describeValue(resting.exits)}`)
  }
  for (const [asset, exit] of Object.entries(resting.exits)) {
    if (
      typeof exit !== 'object' ||
      exit === null ||
      (exit.side !== 'long' && exit.side !== 'short') ||
      (exit.tpCents !== null && !isPrice(exit.tpCents)) ||
      (exit.slCents !== null && !isPrice(exit.slCents)) ||
      (exit.tpCents === null && exit.slCents === null)
    ) {
      throw new Error(`resting exit for ${asset} is not valid`)
    }
  }
}
