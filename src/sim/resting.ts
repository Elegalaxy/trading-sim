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
// - A take profit or stop loss level belongs to one open position. A position holds up
//   to 4 levels of each kind. A level closes its `quantity` shares, or the whole position
//   when the quantity is null (old saves, `setExits`). It never closes more than is open.
//   Long: take profit above the quote, stop loss below. Short: the other way round.
//   A stop fills at the stop, or at the bar's open if the bar opened past it. A take
//   profit fills at the target, or at a better open. Levels hit in one bar fill nearest
//   the open first. If one bar touches a stop and a take profit, only the stops fill in
//   that bar. A stop is not margin-checked, like any close. The fee applies, the spread
//   does not. A filled level is removed.
// - `setExits` sets the whole-position take profit and stop loss. `addExit` adds a level
//   with an optional quantity, `cancelExit` removes one.
// - A limit fill sets its exits for the next bar, never the same bar. Closing or
//   flipping a position removes its exits. Reducing it shrinks any level larger than
//   what is left.
// - Orders and exits are placed in the market section. Cancelling works any time.

import { MAX_LEVERAGE, SESSION_STEPS } from './constants.ts'
import { clockTime, sessionPrice } from './session.ts'
import { settleIntradayMargin } from './margin.ts'
import { recordFill } from './fills.ts'
import { closePartOfPosition, interpretOrder } from './trading.ts'
import type {
  CommandLogEvent,
  ExitKind,
  ExitLevel,
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
/** Levels of one kind (take profit or stop loss) on one position. */
export const MAX_EXIT_LEVELS = 4

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
  leverage?: number,
): string | null {
  const clone = structuredClone(state)
  const outcome = interpretOrder(clone, defs, { type: 'order', asset, side, quantity, leverage }, fixedFill)
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
  const sizes: { tpQuantity?: number; slQuantity?: number } = {}
  for (const key of ['tpQuantity', 'slQuantity'] as const) {
    const size = record[key]
    if (size === undefined || size === null) continue
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1) return rejectEvent(state, command, 'quantityNotInteger')
    if (size > quantity) return rejectEvent(state, command, 'exitQuantityTooLarge')
    sizes[key] = size
  }
  const leverage = record.leverage
  if (leverage !== undefined && (typeof leverage !== 'number' || !Number.isSafeInteger(leverage) || leverage < 1 || leverage > MAX_LEVERAGE)) {
    return rejectEvent(state, command, 'leverageInvalid')
  }
  const margin = marginProblem(state, defs, asset, side, quantity, limit, leverage)
  if (margin !== null) return rejectEvent(state, command, margin)
  const order: RestingOrder = {
    id: state.resting.nextId,
    asset,
    side,
    quantity,
    limitCents: limit,
    tpCents: tp,
    slCents: sl,
    ...(tp === null || sizes.tpQuantity === undefined ? {} : { tpQuantity: sizes.tpQuantity }),
    ...(sl === null || sizes.slQuantity === undefined ? {} : { slQuantity: sizes.slQuantity }),
    ...(leverage === undefined ? {} : { leverage }),
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

function closingSide(side: 'long' | 'short'): OrderSide {
  return side === 'long' ? 'sell' : 'buy'
}

/** The levels of a position on this side, or none when its exits belong to the other side. */
function levelsOf(state: GameState, asset: string, side: 'long' | 'short'): ExitLevel[] {
  const current = state.resting.exits[asset]
  return current !== undefined && current.side === side ? current.levels : []
}

function storeLevels(state: GameState, asset: string, side: 'long' | 'short', levels: ExitLevel[]): void {
  if (levels.length === 0) delete state.resting.exits[asset]
  else state.resting.exits[asset] = { side, levels }
}

function newLevel(state: GameState, kind: ExitKind, priceCents: number, quantity: number | null): ExitLevel {
  const level: ExitLevel = { id: state.resting.nextId, kind, priceCents, quantity }
  state.resting.nextId += 1
  return level
}

/**
 * Set or clear the whole-position take profit and stop loss of an open position. A
 * missing field keeps the old value, null clears it. Partial levels are left alone.
 */
export function interpretSetExits(state: GameState, defs: MarketDefinitions, cmd: unknown): CommandLogEvent[] {
  const command = 'setExits'
  const record = (typeof cmd === 'object' && cmd !== null ? cmd : {}) as Record<string, unknown>
  if (!knownAsset(defs, record.asset)) return rejectEvent(state, command, 'unknownAsset')
  const asset = record.asset
  const position = state.positions[asset]
  if (position === undefined) return rejectEvent(state, command, 'noPosition')
  const side: 'long' | 'short' = position.signedShares > 0 ? 'long' : 'short'
  const levels = levelsOf(state, asset, side).slice()
  const whole = (kind: ExitKind): ExitLevel | undefined => levels.find((level) => level.kind === kind && level.quantity === null)
  const before: Record<ExitKind, number | null> = {
    takeProfit: whole('takeProfit')?.priceCents ?? null,
    stopLoss: whole('stopLoss')?.priceCents ?? null,
  }
  const next = { ...before }
  if (record.tpCents !== undefined) {
    if (record.tpCents !== null && typeof record.tpCents !== 'number') return rejectEvent(state, command, 'takeProfitNotPrice')
    next.takeProfit = record.tpCents
  }
  if (record.slCents !== undefined) {
    if (record.slCents !== null && typeof record.slCents !== 'number') return rejectEvent(state, command, 'stopLossNotPrice')
    next.stopLoss = record.slCents
  }
  if (next.takeProfit === before.takeProfit && next.stopLoss === before.stopLoss) return rejectEvent(state, command, 'nothingToChange')
  const quote = sessionPrice(state, asset)
  const problem = exitProblem(
    side,
    next.takeProfit !== before.takeProfit ? next.takeProfit : null,
    next.stopLoss !== before.stopLoss ? next.stopLoss : null,
    quote,
  )
  if (problem !== null) return rejectEvent(state, command, problem)
  for (const kind of ['takeProfit', 'stopLoss'] as const) {
    const adds = before[kind] === null && next[kind] !== null
    if (adds && levels.filter((level) => level.kind === kind).length >= MAX_EXIT_LEVELS) {
      return rejectEvent(state, command, 'tooManyExits')
    }
  }
  const closing = closingSide(side)
  const shares = Math.abs(position.signedShares)
  const events: CommandLogEvent[] = []
  for (const kind of ['takeProfit', 'stopLoss'] as const) {
    const was = before[kind]
    const now = next[kind]
    if (was === now) continue
    const old = whole(kind)
    if (old !== undefined) levels.splice(levels.indexOf(old), 1)
    if (now === null) {
      events.push(restingEvent(state, 'cancelled', asset, kind, closing, shares, was ?? 0))
    } else {
      levels.push(newLevel(state, kind, now, null))
      events.push(restingEvent(state, 'placed', asset, kind, closing, shares, now))
    }
  }
  storeLevels(state, asset, side, levels)
  return events
}

/**
 * Add one take profit or stop loss level to an open position. Takes `asset`, `kind`,
 * `priceCents` and an optional `quantity` in shares. A missing quantity means the whole position.
 */
export function interpretAddExit(state: GameState, defs: MarketDefinitions, cmd: unknown): CommandLogEvent[] {
  const command = 'addExit'
  const record = (typeof cmd === 'object' && cmd !== null ? cmd : {}) as Record<string, unknown>
  if (!knownAsset(defs, record.asset)) return rejectEvent(state, command, 'unknownAsset')
  const asset = record.asset
  const kind = record.kind
  if (kind !== 'takeProfit' && kind !== 'stopLoss') return rejectEvent(state, command, 'exitKindInvalid')
  const position = state.positions[asset]
  if (position === undefined) return rejectEvent(state, command, 'noPosition')
  const side: 'long' | 'short' = position.signedShares > 0 ? 'long' : 'short'
  const price = record.priceCents
  if (!isPrice(price)) return rejectEvent(state, command, kind === 'takeProfit' ? 'takeProfitNotPrice' : 'stopLossNotPrice')
  const quote = sessionPrice(state, asset)
  const problem = exitProblem(side, kind === 'takeProfit' ? price : null, kind === 'stopLoss' ? price : null, quote)
  if (problem !== null) return rejectEvent(state, command, problem)
  const shares = Math.abs(position.signedShares)
  const quantity = record.quantity === undefined || record.quantity === null ? null : record.quantity
  if (quantity !== null) {
    if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1) {
      return rejectEvent(state, command, 'quantityNotInteger')
    }
    if (quantity > shares) return rejectEvent(state, command, 'exitQuantityTooLarge')
  }
  const levels = levelsOf(state, asset, side).slice()
  if (levels.filter((level) => level.kind === kind).length >= MAX_EXIT_LEVELS) return rejectEvent(state, command, 'tooManyExits')
  levels.push(newLevel(state, kind, price, quantity))
  storeLevels(state, asset, side, levels)
  return [restingEvent(state, 'placed', asset, kind, closingSide(side), quantity ?? shares, price)]
}

/** Remove one exit level by asset and id. */
export function interpretCancelExit(state: GameState, cmd: unknown): CommandLogEvent[] {
  const record = (typeof cmd === 'object' && cmd !== null ? cmd : {}) as { asset?: unknown; id?: unknown }
  const asset = typeof record.asset === 'string' ? record.asset : null
  const exit = asset === null ? undefined : state.resting.exits[asset]
  const level = exit?.levels.find((item) => item.id === record.id)
  if (asset === null || exit === undefined || level === undefined) return rejectEvent(state, 'cancelExit', 'noSuchExit')
  storeLevels(state, asset, exit.side, exit.levels.filter((item) => item !== level))
  const shares = Math.abs(state.positions[asset]?.signedShares ?? 0)
  return [restingEvent(state, 'cancelled', asset, level.kind, closingSide(exit.side), level.quantity ?? shares, level.priceCents)]
}

/** Drop exits whose position is gone or on the other side now, and shrink levels larger than the position. */
export function pruneExits(state: GameState): CommandLogEvent[] {
  const events: CommandLogEvent[] = []
  for (const asset of Object.keys(state.resting.exits)) {
    const exit = state.resting.exits[asset]
    const shares = state.positions[asset]?.signedShares ?? 0
    const side = shares > 0 ? 'long' : shares < 0 ? 'short' : null
    const closing = closingSide(exit.side)
    if (side !== exit.side) {
      for (const level of exit.levels) {
        events.push(restingEvent(state, 'cancelled', asset, level.kind, closing, 0, level.priceCents, { reason: 'positionClosed' }))
      }
      delete state.resting.exits[asset]
      continue
    }
    const open = Math.abs(shares)
    for (const level of exit.levels) {
      if (level.quantity === null || level.quantity <= open) continue
      level.quantity = open
      events.push(restingEvent(state, 'resized', asset, level.kind, closing, open, level.priceCents, { reason: 'positionReduced' }))
    }
  }
  return events
}

/** Levels of one kind that this bar touches, nearest the open first. */
function touched(exit: PositionExit, kind: ExitKind, bar: { high: number; low: number }): ExitLevel[] {
  const long = exit.side === 'long'
  const hits = exit.levels.filter((level) => {
    if (level.kind !== kind) return false
    if (kind === 'stopLoss') return long ? bar.low <= level.priceCents : bar.high >= level.priceCents
    return long ? bar.high >= level.priceCents : bar.low <= level.priceCents
  })
  // A long falls into its highest stop first and rises into its lowest target first.
  const descending = (kind === 'stopLoss') === long
  return hits.sort((a, b) => (descending ? b.priceCents - a.priceCents : a.priceCents - b.priceCents) || a.id - b.id)
}

function exitFill(level: ExitLevel, long: boolean, open: number): number {
  if (level.kind === 'stopLoss') return long ? Math.min(level.priceCents, open) : Math.max(level.priceCents, open)
  return long ? Math.max(level.priceCents, open) : Math.min(level.priceCents, open)
}

function triggerExits(state: GameState, defs: MarketDefinitions, index: number): CommandLogEvent[] {
  const events: CommandLogEvent[] = []
  for (const def of defs.assets) {
    const exit = state.resting.exits[def.id]
    const bar = state.session.bars[def.id]?.[index]
    if (exit === undefined || state.positions[def.id] === undefined || bar === undefined) continue
    const stops = touched(exit, 'stopLoss', bar)
    const hits = stops.length > 0 ? stops : touched(exit, 'takeProfit', bar)
    for (const level of hits) {
      const position = state.positions[def.id]
      if (position === undefined) break
      const open = Math.abs(position.signedShares)
      const fill = exitFill(level, exit.side === 'long', bar.open)
      const stopVolume = level.kind === 'stopLoss' ? bar.volume : undefined
      const closed = closePartOfPosition(state, defs, def.id, Math.min(level.quantity ?? open, open), fill, stopVolume)
      exit.levels = exit.levels.filter((item) => item !== level)
      recordFill(state, {
        asset: def.id,
        side: closed.side,
        quantity: closed.quantity,
        fillCents: closed.fillPrice,
        feeCents: closed.fee,
        realizedCents: closed.realizedCents,
        slippageCents: closed.slippage,
        via: level.kind,
        time: clockTime(index),
      })
      events.push(
        restingEvent(state, 'filled', def.id, level.kind, closed.side, closed.quantity, closed.fillPrice, {
          fee: closed.fee,
          time: clockTime(index),
        }),
      )
      events.push({ kind: 'realized', day: state.market.day, asset: def.id, amount: closed.realizedCents })
    }
    // A closed position takes its other levels with it.
    if (state.positions[def.id] === undefined || exit.levels.length === 0) delete state.resting.exits[def.id]
  }
  return events
}

/** Exits from a filled limit. A whole-position level replaces the old one of its kind. */
function attachExits(state: GameState, order: RestingOrder, side: 'long' | 'short', time: string): CommandLogEvent[] {
  const events: CommandLogEvent[] = []
  const levels = levelsOf(state, order.asset, side).slice()
  const wanted: Array<[ExitKind, number | null, number | undefined]> = [
    ['takeProfit', order.tpCents, order.tpQuantity],
    ['stopLoss', order.slCents, order.slQuantity],
  ]
  for (const [kind, price, size] of wanted) {
    if (price === null) continue
    const quantity = size ?? null
    const old = quantity === null ? levels.find((level) => level.kind === kind && level.quantity === null) : undefined
    if (old !== undefined) levels.splice(levels.indexOf(old), 1)
    else if (levels.filter((level) => level.kind === kind).length >= MAX_EXIT_LEVELS) {
      events.push(restingEvent(state, 'dropped', order.asset, kind, closingSide(side), quantity ?? 0, price, { reason: 'tooManyExits', time }))
      continue
    }
    levels.push(newLevel(state, kind, price, quantity))
  }
  storeLevels(state, order.asset, side, levels)
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
      { type: 'order', asset: order.asset, side: order.side, quantity: order.quantity, leverage: order.leverage },
      fill,
      'limit',
      clockTime(index),
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
      for (const event of attachExits(state, order, buy ? 'long' : 'short', clockTime(index))) events.push(event)
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
  if (
    state.resting.orders.length === 0 &&
    Object.keys(state.resting.exits).length === 0 &&
    Object.keys(state.positions).length === 0
  ) {
    state.session.clock = to
    return events
  }
  for (let index = from; index < to; index += 1) {
    state.session.clock = index + 1
    for (const event of triggerExits(state, defs, index)) events.push(event)
    for (const event of triggerLimits(state, defs, index)) events.push(event)
    // An open position is watched after every bar, like a perpetual future.
    for (const event of settleIntradayMargin(state, defs, clockTime(index))) events.push(event)
    for (const event of pruneExits(state)) events.push(event)
  }
  state.session.clock = to
  return events
}

/**
 * Resting state from a save made before exit levels. An old exit held one take profit
 * and one stop loss for the whole position; each becomes a level with no quantity. New
 * exits are kept as they are. Returns a copy; anything else is left for `assertResting`.
 */
export function upgradeResting(saved: unknown): RestingState {
  const resting = structuredClone(saved) as RestingState
  if (typeof resting !== 'object' || resting === null || typeof resting.exits !== 'object' || resting.exits === null) return resting
  for (const [asset, exit] of Object.entries(resting.exits as Record<string, unknown>)) {
    if (typeof exit !== 'object' || exit === null || 'levels' in exit) continue
    const old = exit as { side: 'long' | 'short'; tpCents?: unknown; slCents?: unknown }
    const levels: ExitLevel[] = []
    for (const [kind, price] of [['takeProfit', old.tpCents], ['stopLoss', old.slCents]] as const) {
      if (!isPrice(price) || !Number.isSafeInteger(resting.nextId)) continue
      levels.push({ id: resting.nextId, kind, priceCents: price, quantity: null })
      resting.nextId += 1
    }
    resting.exits[asset] = { side: old.side, levels }
  }
  return resting
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
      (order.slCents !== null && !isPrice(order.slCents)) ||
      (order.tpQuantity !== undefined && (!Number.isSafeInteger(order.tpQuantity) || order.tpQuantity < 1)) ||
      (order.slQuantity !== undefined && (!Number.isSafeInteger(order.slQuantity) || order.slQuantity < 1))
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
      !Array.isArray(exit.levels) ||
      exit.levels.length === 0
    ) {
      throw new Error(`resting exit for ${asset} is not valid`)
    }
    for (const kind of ['takeProfit', 'stopLoss'] as const) {
      if (exit.levels.filter((level) => level?.kind === kind).length > MAX_EXIT_LEVELS) {
        throw new Error(`resting exit for ${asset} has more than ${MAX_EXIT_LEVELS} ${kind} levels`)
      }
    }
    for (const level of exit.levels) {
      if (
        typeof level !== 'object' ||
        level === null ||
        !Number.isSafeInteger(level.id) ||
        level.id >= resting.nextId ||
        (level.kind !== 'takeProfit' && level.kind !== 'stopLoss') ||
        !isPrice(level.priceCents) ||
        (level.quantity !== null && (!Number.isSafeInteger(level.quantity) || level.quantity < 1))
      ) {
        throw new Error(`resting exit level for ${asset} is not valid`)
      }
    }
  }
}
