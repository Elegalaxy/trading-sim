// Harness strategies. They place orders through applyCommand and never write
// the market. Each day starts at the end of sleep, so actDay skips to the
// market section before any order. maxLongIndex and maxShortIndex press M4X
// up to the 5x cap (margin ratio 20%). A rejected order shrinks the quantity.
// The walk is capped. random draws a stream created in the harness. It does
// not touch the game's market, events, info, or distortion streams.
// longNova10, longNova20, longNova50 and shortNova50 hold the most volatile stock
// at that leverage, as large as the margin allows. They open again after a
// liquidation. They exist to measure how often high leverage is liquidated and
// how often the backstop is used.
// followHeadlines, fadeHeadlines and buyRumour trade the news a player can read
// (the visible feed for the bot's job and lifestyle, without stress bias) at 1x,
// one stock trade per asset, each a fifth of trading equity. The headline bots
// trade a stock headline the way its event points (fade: the other way) and close
// it NEWS_HOLD_DAYS later. buyRumour trades a stock rumour the way it claims and
// closes it in the session after the claimed day, when the headline would be out.
// They measure whether reading the news pays after spread and fees (plan Step M0).

import {
  MARGIN_MIN_RATIO_DENOMINATOR,
  MARGIN_MIN_RATIO_NUMERATOR,
} from '../sim/constants.ts'
import { applyCommand } from '../sim/game.ts'
import { activeJob } from '../sim/jobs.ts'
import { playerVisibleFeed } from '../sim/lifestyle.ts'
import { createRng, nextInt } from '../sim/rng.ts'
import { tradingEquity } from '../sim/trading.ts'
import type { GameState, MarketDefinitions, OrderSide, RngStream } from '../sim/types.ts'

export const STRATEGY_NAMES = [
  'hold',
  'maxLongIndex',
  'maxShortIndex',
  'random',
  'longNova10',
  'longNova20',
  'longNova50',
  'shortNova50',
  'followHeadlines',
  'fadeHeadlines',
  'buyRumour',
] as const

export type StrategyName = (typeof STRATEGY_NAMES)[number]

export type DayAction = {
  orders: number
  rejections: number
  lastQuantity: number
}

const INDEX_ID = 'M4X'
const LEVERAGED_ASSET = 'NOVA'

/** Strategies that hold one stock at a chosen leverage. */
const LEVERAGED: Partial<Record<StrategyName, { side: OrderSide; leverage: number }>> = {
  longNova10: { side: 'buy', leverage: 10 },
  longNova20: { side: 'buy', leverage: 20 },
  longNova50: { side: 'buy', leverage: 50 },
  shortNova50: { side: 'sell', leverage: 50 },
}
/** Each retry shrinks the order by this share, since the fee and spread eat margin. */
const SHRINK = 0.97
const MAX_SHRINKS = 40
const MAX_WALK = 64
const MAX_TOP_UP = 8
/** Market days a headline trade is held. */
const NEWS_HOLD_DAYS = 3
/** Share of trading equity one news trade uses, at 1x. */
const NEWS_SHARE = 0.2

type NewsMode = 'follow' | 'fade' | 'rumour'

const NEWS_BOTS: Partial<Record<StrategyName, NewsMode>> = {
  followHeadlines: 'follow',
  fadeHeadlines: 'fade',
  buyRumour: 'rumour',
}

/** What the news bots remember between days. One per run. */
export type BotMemory = {
  /** The market day on which each open news trade is closed, by asset. */
  exitDay: Record<string, number>
}

export function createBotMemory(): BotMemory {
  return { exitDay: {} }
}

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
  leverage?: number,
): boolean {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error(`[DEBUG batch] order quantity must be a positive safe integer, received ${String(quantity)}`)
  }
  const before = game.pending.length
  applyCommand(game, defs, { type: 'order', asset, side, quantity, leverage })
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

/**
 * Open the largest position the margin allows at `leverage`: start from free margin times
 * leverage, then shrink until the order is accepted. Does nothing when a position is open.
 */
function placeLeveraged(game: GameState, defs: MarketDefinitions, side: OrderSide, leverage: number): DayAction {
  const action = emptyAction()
  if ((game.positions[LEVERAGED_ASSET]?.signedShares ?? 0) !== 0) return action
  const price = requireAssetPrice(game, LEVERAGED_ASSET)
  const book = tradingEquity(game, defs)
  const room = book.equity - book.required
  if (room <= 0) return action
  let quantity = Math.floor((room * leverage) / price)
  for (let tries = 0; quantity > 0 && tries < MAX_SHRINKS; tries += 1) {
    if (submit(game, defs, LEVERAGED_ASSET, side, quantity, leverage)) {
      action.orders += 1
      action.lastQuantity = quantity
      return action
    }
    action.rejections += 1
    quantity = Math.floor(quantity * SHRINK)
  }
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

function stockTarget(defs: MarketDefinitions, eventId: string): string | null {
  const target = eventId.split(':')[1]
  if (target === undefined) return null
  const asset = defs.assets.find((item) => item.id === target)
  return asset?.kind === 'stock' ? asset.id : null
}

/** Close every news trade whose day has come. A position already liquidated is just forgotten. */
function closeDueNews(game: GameState, defs: MarketDefinitions, memory: BotMemory, action: DayAction): void {
  for (const asset of Object.keys(memory.exitDay).sort()) {
    const due = memory.exitDay[asset]
    if (due === undefined || game.market.day < due) continue
    delete memory.exitDay[asset]
    const shares = game.positions[asset]?.signedShares ?? 0
    if (shares === 0) continue
    const quantity = Math.abs(shares)
    if (submit(game, defs, asset, shares > 0 ? 'sell' : 'buy', quantity)) {
      action.orders += 1
      action.lastQuantity = quantity
    } else {
      action.rejections += 1
    }
  }
}

/** Open a 1x trade worth NEWS_SHARE of equity, or what free margin allows. Shrinks on rejection. */
function openNews(game: GameState, defs: MarketDefinitions, asset: string, side: OrderSide, action: DayAction): boolean {
  const price = requireAssetPrice(game, asset)
  const book = tradingEquity(game, defs)
  const room = Math.min(book.equity * NEWS_SHARE, book.equity - book.required)
  let quantity = Math.floor(room / price)
  for (let tries = 0; quantity > 0 && tries < MAX_SHRINKS; tries += 1) {
    if (submit(game, defs, asset, side, quantity, 1)) {
      action.orders += 1
      action.lastQuantity = quantity
      return true
    }
    action.rejections += 1
    quantity = Math.floor(quantity * SHRINK)
  }
  return false
}

function placeNews(game: GameState, defs: MarketDefinitions, mode: NewsMode, memory: BotMemory): DayAction {
  const action = emptyAction()
  closeDueNews(game, defs, memory, action)
  const feed = playerVisibleFeed(game.market.feed, activeJob(game.job), game.lifestyle)
  for (const item of feed.items) {
    if ((mode === 'rumour') !== (item.kind === 'rumour') || item.direction === undefined) continue
    const asset = stockTarget(defs, item.kind === 'headline' ? item.eventId : item.targetEventId)
    if (asset === null || memory.exitDay[asset] !== undefined) continue
    if ((game.positions[asset]?.signedShares ?? 0) !== 0) continue
    const withNews = item.direction === 'up' ? 'buy' : 'sell'
    const side: OrderSide = mode === 'fade' ? (withNews === 'buy' ? 'sell' : 'buy') : withNews
    const exit = item.kind === 'rumour' ? game.market.day + item.leadDays : game.market.day + NEWS_HOLD_DAYS
    if (openNews(game, defs, asset, side, action)) memory.exitDay[asset] = exit
  }
  return action
}

/** Open the market. A day starts closed, and an order before this is rejected. */
function skipToMarket(game: GameState, defs: MarketDefinitions): void {
  const from = game.section
  const before = game.pending.length
  applyCommand(game, defs, { type: 'skip' })
  const added = game.pending.slice(before)
  let skipped = false
  let rejected = false
  let reason = ''
  for (const event of added) {
    if (event.kind === 'skip') skipped = true
    else if (event.kind === 'sectionChange') {
      if (event.to !== 'market') {
        throw new Error(`[DEBUG batch] skip sectionChange went to ${event.to}`)
      }
    } else if (event.kind === 'commandRejected') {
      rejected = true
      reason = event.reason
    } else {
      throw new Error(`[DEBUG batch] unexpected skip log event ${event.kind}`)
    }
  }
  if (!skipped || rejected || game.section !== 'market') {
    throw new Error(
      `[DEBUG batch] skip from=${from} did not open the market section=${game.section} skipped=${skipped} rejected=${rejected} reason=${reason}`,
    )
  }
}

/**
 * One day of the named strategy. `randomStream` is required only for `random`,
 * and `memory` only for the news bots.
 */
export function actDay(
  strategy: StrategyName,
  game: GameState,
  defs: MarketDefinitions,
  randomStream: RngStream | null,
  memory?: BotMemory,
): DayAction {
  skipToMarket(game, defs)
  if (strategy === 'hold') return emptyAction()
  if (strategy === 'maxLongIndex') {
    assertIndex(defs)
    return placeTowardCap(game, defs, 'buy')
  }
  if (strategy === 'maxShortIndex') {
    assertIndex(defs)
    return placeTowardCap(game, defs, 'sell')
  }
  const leveraged = LEVERAGED[strategy]
  if (leveraged !== undefined) return placeLeveraged(game, defs, leveraged.side, leveraged.leverage)
  const news = NEWS_BOTS[strategy]
  if (news !== undefined) {
    if (memory === undefined) throw new Error(`[DEBUG batch] ${strategy} is missing its bot memory`)
    return placeNews(game, defs, news, memory)
  }
  if (randomStream === null) throw new Error('[DEBUG batch] random strategy is missing its harness stream')
  return placeRandom(game, defs, randomStream)
}
