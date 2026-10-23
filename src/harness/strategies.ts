// Harness strategies. They place orders through applyCommand and never write
// the market. maxLongIndex and maxShortIndex press M4X up to the 5x cap
// (margin ratio 20%). A rejected order shrinks the quantity. The walk is capped.
// random draws a stream created in the harness. It does not touch the game's
// market, events, info, or distortion streams.

import {
  MARGIN_MIN_RATIO_DENOMINATOR,
  MARGIN_MIN_RATIO_NUMERATOR,
} from '../sim/constants.ts'
import { applyCommand } from '../sim/game.ts'
import { createRng, nextInt } from '../sim/rng.ts'
import { tradingEquity } from '../sim/trading.ts'
import type { GameState, MarketDefinitions, OrderSide, RngStream } from '../sim/types.ts'

export const STRATEGY_NAMES = ['hold', 'maxLongIndex', 'maxShortIndex', 'random'] as const

export type StrategyName = (typeof STRATEGY_NAMES)[number]

export type DayAction = {
  orders: number
  rejections: number
  lastQuantity: number
}

const INDEX_ID = 'M4X'
const MAX_WALK = 64
const MAX_TOP_UP = 8

export function isStrategyName(value: string): value is StrategyName {
  return (STRATEGY_NAMES as readonly string[]).includes(value)
}

/** A fresh stream. `random:${runSeed}` is not the game seed and is not a game stream. */
export function createRandomStream(runSeed: string): RngStream {
  if (typeof runSeed !== 'string' || runSeed.length === 0) {
    throw new Error(`[DEBUG batch] random stream needs a run seed, received ${JSON.stringify(runSeed)}`)
  }
  const created = createRng(`random:${runSeed}`)
  const source = created.distortion
  return { a: source.a, b: source.b, c: source.c, d: source.d }
}

function emptyAction(): DayAction {
  return { orders: 0, rejections: 0, lastQuantity: 0 }
}

function requireAssetPrice(game: GameState, assetId: string): number {
  const price = game.market.assets[assetId]?.priceCents
  if (!Number.isSafeInteger(price) || price <= 0) {
    throw new Error(`[DEBUG batch] asset ${assetId} price must be a positive safe integer, received ${String(price)}`)
  }
  return price
}

/**
 * Largest extra buy or sell that the pre-trade 5x gross can cover.
 * Spread and the fee reduce equity, so this is an upper bound. The caller
 * reduces the quantity when the order is rejected.
 */
function upperExtraShares(game: GameState, defs: MarketDefinitions, assetId: string, side: OrderSide): number {
  const price = requireAssetPrice(game, assetId)
  const book = tradingEquity(game, defs)
  if (!Number.isSafeInteger(book.equity) || !Number.isSafeInteger(book.gross)) {
    throw new Error(`[DEBUG batch] trading equity is not a safe integer, equity=${book.equity} gross=${book.gross}`)
  }
  if (book.equity <= 0) return 0
  const signed = game.positions[assetId]?.signedShares ?? 0
  if (!Number.isSafeInteger(signed)) {
    throw new Error(`[DEBUG batch] position ${assetId} shares are not a safe integer, received ${String(signed)}`)
  }
  const thisGross = Math.abs(signed) * price
  if (!Number.isSafeInteger(thisGross)) {
    throw new Error(`[DEBUG batch] position gross for ${assetId} overflowed`)
  }
  const otherGross = book.gross - thisGross
  if (!Number.isSafeInteger(otherGross) || otherGross < 0) {
    throw new Error(`[DEBUG batch] other gross for ${assetId} is ${otherGross}`)
  }
  const maxGross = Math.floor((book.equity * MARGIN_MIN_RATIO_DENOMINATOR) / MARGIN_MIN_RATIO_NUMERATOR)
  if (!Number.isSafeInteger(maxGross)) {
    throw new Error(`[DEBUG batch] 5x gross overflowed from equity ${book.equity}`)
  }
  const room = maxGross - otherGross
  if (room <= 0) return 0
  const maxShares = Math.floor(room / price)
  const extra = side === 'buy' ? maxShares - signed : signed - -maxShares
  if (!Number.isSafeInteger(extra)) {
    throw new Error(`[DEBUG batch] extra shares for ${assetId} overflowed`)
  }
  return extra > 0 ? extra : 0
}

function orderAccepted(
  game: GameState,
  before: number,
  asset: string,
  side: OrderSide,
  quantity: number,
): boolean {
  // applyCommand appends to pending, then replaces log with that pending list.
  // After endDay, log still holds the previous day and pending is empty, so the
  // cursor has to be pending's length from before this command.
  const added = game.pending.slice(before)
  let filled = false
  let rejected = false
  for (const event of added) {
    if (event.kind === 'orderFill') {
      if (event.asset !== asset || event.side !== side || event.quantity !== quantity) {
        throw new Error(
          `[DEBUG batch] fill did not match ${side} ${quantity} ${asset}, received ${event.side} ${event.quantity} ${event.asset}`,
        )
      }
      filled = true
    } else if (event.kind === 'commandRejected') {
      if (event.command !== 'order') {
        throw new Error(`[DEBUG batch] expected an order rejection, received ${event.command}`)
      }
      rejected = true
    } else if (event.kind !== 'realized') {
      throw new Error(`[DEBUG batch] unexpected order log event ${event.kind}`)
    }
  }
  if (filled === rejected) {
    const kinds = added.map((event) => event.kind).join(',')
    throw new Error(
      `[DEBUG batch] order ${side} ${quantity} ${asset} filled=${filled} rejected=${rejected} pendingBefore=${before} pending=${game.pending.length} added=${kinds || 'none'}`,
    )
  }
  return filled
}

function submit(
  game: GameState,
  defs: MarketDefinitions,
  asset: string,
  side: OrderSide,
  quantity: number,
): boolean {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error(`[DEBUG batch] order quantity must be a positive safe integer, received ${String(quantity)}`)
  }
  const before = game.pending.length
  applyCommand(game, defs, { type: 'order', asset, side, quantity })
  return orderAccepted(game, before, asset, side, quantity)
}

/** Buy or sell one more share until the cap rejects it. Stops after MAX_TOP_UP fills. */
function topUp(
  game: GameState,
  defs: MarketDefinitions,
  asset: string,
  side: OrderSide,
  action: DayAction,
): void {
  let added = 0
  while (added < MAX_TOP_UP) {
    if (!submit(game, defs, asset, side, 1)) {
      action.rejections += 1
      return
    }
    added += 1
    action.orders += 1
    action.lastQuantity = 1
  }
  throw new Error(`[DEBUG batch] ${side} ${asset} was still accepted after ${MAX_TOP_UP} extra shares`)
}

/**
 * One order as close as possible to the 5x cap, then stop.
 * If the upper bound fills, single shares top up a short estimate.
 * If it is rejected, the quantity drops by one until it fills or reaches zero.
 */
function placeTowardCap(game: GameState, defs: MarketDefinitions, side: OrderSide): DayAction {
  const action = emptyAction()
  let quantity = upperExtraShares(game, defs, INDEX_ID, side)
  let walks = 0
  while (quantity > 0) {
    walks += 1
    if (walks > MAX_WALK) {
      throw new Error(
        `[DEBUG batch] ${side} ${INDEX_ID} did not fit after ${MAX_WALK} reductions, quantity=${quantity}`,
      )
    }
    if (submit(game, defs, INDEX_ID, side, quantity)) {
      action.orders += 1
      action.lastQuantity = quantity
      if (walks === 1) topUp(game, defs, INDEX_ID, side, action)
      return action
    }
    action.rejections += 1
    quantity -= 1
  }
  if (walks === 0) topUp(game, defs, INDEX_ID, side, action)
  return action
}

function assertIndex(defs: MarketDefinitions): void {
  let found = 0
  for (const asset of defs.assets) {
    if (asset.id !== INDEX_ID) continue
    found += 1
    if (asset.kind !== 'index') throw new Error(`[DEBUG batch] ${INDEX_ID} must be an index, received ${asset.kind}`)
  }
  if (found !== 1) throw new Error(`[DEBUG batch] expected one ${INDEX_ID} asset, received ${found}`)
}

function placeRandom(game: GameState, defs: MarketDefinitions, stream: RngStream): DayAction {
  const action = emptyAction()
  if (defs.assets.length === 0) throw new Error('[DEBUG batch] random strategy has no assets')
  const choice = nextInt(stream, 0, 2)
  if (choice === 0) return action
  const side: OrderSide = choice === 1 ? 'buy' : 'sell'
  const index = nextInt(stream, 0, defs.assets.length - 1)
  const asset = defs.assets[index]
  if (asset === undefined) throw new Error(`[DEBUG batch] random asset index ${index} is missing`)
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(asset.id)) {
    throw new Error(`[DEBUG batch] random asset id is not orderable, received ${JSON.stringify(asset.id)}`)
  }
  if (submit(game, defs, asset.id, side, 1)) {
    action.orders = 1
    action.lastQuantity = 1
  } else {
    action.rejections = 1
  }
  return action
}

/** One day of the named strategy. `randomStream` is required only for `random`. */
export function actDay(
  strategy: StrategyName,
  game: GameState,
  defs: MarketDefinitions,
  randomStream: RngStream | null,
): DayAction {
  if (strategy === 'hold') return emptyAction()
  if (strategy === 'maxLongIndex') {
    assertIndex(defs)
    return placeTowardCap(game, defs, 'buy')
  }
  if (strategy === 'maxShortIndex') {
    assertIndex(defs)
    return placeTowardCap(game, defs, 'sell')
  }
  if (randomStream === null) throw new Error('[DEBUG batch] random strategy is missing its harness stream')
  return placeRandom(game, defs, randomStream)
}
