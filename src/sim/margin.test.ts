import { describe, expect, it } from 'vitest'

import {
  DAILY_MOVE_CAP_DENOMINATOR,
  DAILY_MOVE_CAP_NUMERATOR,
  MARGIN_LIQUIDATION_RATIO_DENOMINATOR,
  MARGIN_LIQUIDATION_RATIO_NUMERATOR,
  MARGIN_WARNING_RATIO_DENOMINATOR,
  MARGIN_WARNING_RATIO_NUMERATOR,
  RATE_PPM_SCALE,
  STARTING_CASH_CENTS,
  TRADE_FEE_DENOMINATOR,
} from './constants.ts'
import { applyCommand, createGame, endDay, settleTradingAccount } from './game.ts'
import { formatEvent } from './log.ts'
import { tradingEquity } from './trading.ts'
import type {
  AccountLogEvent,
  GameState,
  LiquidationEvent,
  MarginCheckEvent,
  MarketDefinitions,
  OrderSide,
} from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugMargin(message: string): void {
  io.writeSync(1, `[DEBUG margin] ${message}\n`)
}

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
  { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018, spreadPpm: 3000, borrowFeePpm: 200 },
  { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100 },
  { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014, spreadPpm: 2000, borrowFeePpm: 150 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
]

function market(): MarketDefinitions {
  return {
    assets: ASSETS,
    environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
    events: [],
  }
}

function order(asset: string, side: OrderSide, quantity: number) {
  return { type: 'order' as const, asset, side, quantity }
}

function roundDivHalfAway(numerator: number, denominator: number): number {
  const negative = numerator < 0
  const num = negative ? -numerator : numerator
  const quotient = Math.floor(num / denominator)
  const remainder = num % denominator
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient
  return negative ? -rounded : rounded
}

/** Same half-spread rounding as trading.ts. This market has no event-day widening. */
function halfSpreadCents(price: number, spreadPpm: number): number {
  return roundDivHalfAway(price * spreadPpm, RATE_PPM_SCALE * 2)
}

function feeCents(notional: number): number {
  return roundDivHalfAway(notional * 1, TRADE_FEE_DENOMINATOR)
}

function spreadOf(id: string): number {
  const ppm = ASSETS.find((asset) => asset.id === id)?.spreadPpm
  if (ppm === undefined) throw new Error(`[DEBUG margin] missing spread for ${id}`)
  return ppm
}

function cloneGame(game: GameState): GameState {
  return JSON.parse(JSON.stringify(game)) as GameState
}

/**
 * Largest extra buy or sell the live order command accepts.
 * Probes are clones, so a rejection does not touch the caller's book.
 */
function searchOrders(game: GameState, defs: MarketDefinitions, asset: string, side: OrderSide): number {
  const accepted = (quantity: number): boolean => {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return false
    const trial = cloneGame(game)
    applyCommand(trial, defs, order(asset, side, quantity))
    return trial.log.at(-1)?.kind === 'orderFill'
  }
  if (!accepted(1)) return 0
  let lo = 1
  let hi = 2
  while (accepted(hi)) {
    lo = hi
    if (hi >= 1_000_000) break
    hi *= 2
  }
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (accepted(mid)) lo = mid
    else hi = mid
  }
  return lo
}

function aboveRatio(equity: number, gross: number, numerator: number, denominator: number): boolean {
  return equity * denominator > gross * numerator
}

function atOrBelowRatio(equity: number, gross: number, numerator: number, denominator: number): boolean {
  return equity * denominator <= gross * numerator
}

/**
 * Move the quote by the confirmed daily cap, floor(price × 8 / 100) cents.
 * The market RNG is not drawn. Fair value is left where it was.
 */
function forceCappedMove(game: GameState, assetId: string, direction: -1 | 1): { before: number; move: number; after: number } {
  const asset = game.market.assets[assetId]
  if (asset === undefined) throw new Error(`[DEBUG margin] missing ${assetId}`)
  const before = asset.priceCents
  const move = Math.floor((before * DAILY_MOVE_CAP_NUMERATOR) / DAILY_MOVE_CAP_DENOMINATOR)
  const after = before + direction * move
  if (!Number.isSafeInteger(after) || after <= 0) {
    throw new Error(`[DEBUG margin] capped price for ${assetId} is ${after}`)
  }
  asset.priceCents = after
  return { before, move, after }
}

function streamPicture(game: GameState): string {
  return JSON.stringify(game.market.streams)
}

function fairPicture(game: GameState): string {
  return Object.entries(game.market.assets)
    .map(([id, asset]) => `${id}:${asset.fairValue}`)
    .join(',')
}

function printEvents(label: string, events: readonly AccountLogEvent[]): void {
  debugMargin(label)
  for (const event of events) debugMargin(formatEvent(event))
}

function checks(events: readonly AccountLogEvent[]): MarginCheckEvent[] {
  return events.filter((event): event is MarginCheckEvent => event.kind === 'marginCheck')
}

function focusKinds(events: readonly AccountLogEvent[]): string[] {
  return events.filter((event) => event.kind === 'marginCheck' || event.kind === 'liquidation').map((event) => event.kind)
}

describe('leverage, margin, and the loss cap', () => {
  it('keeps a 5x long above 10% after one forced -8% day', () => {
    const defs = market()
    const game = createGame(defs, 'down1')
    const streams = streamPicture(game)
    const fairs = fairPicture(game)
    const quantity = searchOrders(game, defs, 'NOVA', 'buy')
    expect(quantity).toBeGreaterThan(1)
    applyCommand(game, defs, order('NOVA', 'buy', quantity))
    expect(game.positions.NOVA?.signedShares).toBe(quantity)
    expect(game.accounts.tradingCents).toBeLessThan(0)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    const opened = tradingEquity(game, defs)
    expect(opened.equity).toBeGreaterThan(0)
    expect(opened.equity * 5).toBeGreaterThanOrEqual(opened.gross)
    const oneMore = cloneGame(game)
    applyCommand(oneMore, defs, order('NOVA', 'buy', 1))
    expect(oneMore.log.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'insufficientBuyingPower' })
    const repay = cloneGame(game)
    applyCommand(repay, defs, { type: 'transfer', from: 'cash', to: 'trading', amountCents: 1 })
    expect(repay.accounts.tradingCents).toBe(game.accounts.tradingCents + 1)
    expect(repay.accounts.cashCents).toBe(STARTING_CASH_CENTS - 1)

    const startEquity = opened.equity
    const moved = forceCappedMove(game, 'NOVA', -1)
    expect(moved.move * DAILY_MOVE_CAP_DENOMINATOR).toBe(moved.before * DAILY_MOVE_CAP_NUMERATOR)
    expect(moved.after).toBe(4416)
    const events = settleTradingAccount(game, defs, startEquity)
    expect(streamPicture(game)).toBe(streams)
    expect(fairPicture(game)).toBe(fairs)
    expect(game.market.log.map((event) => event.kind).filter((kind) => kind === 'noiseRoll')).toEqual([])
    const check = checks(events)[0]
    if (check === undefined) throw new Error('[DEBUG margin] missing one-day marginCheck')
    expect(events.some((event) => event.kind === 'liquidation')).toBe(false)
    expect(events.some((event) => event.kind === 'backstopWriteOff')).toBe(false)
    expect(events.some((event) => event.kind === 'wipeOut')).toBe(false)
    expect(check.equity).toBeGreaterThan(0)
    expect(
      aboveRatio(check.equity, check.positionValue, MARGIN_LIQUIDATION_RATIO_NUMERATOR, MARGIN_LIQUIDATION_RATIO_DENOMINATOR),
    ).toBe(true)
    expect(tradingEquity(game, defs).equity).toBe(check.equity)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    expect(game.accounts.savingsCents).toBe(0)
    if (atOrBelowRatio(check.equity, check.positionValue, MARGIN_WARNING_RATIO_NUMERATOR, MARGIN_WARNING_RATIO_DENOMINATOR)) {
      expect(events.some((event) => event.kind === 'marginWarning')).toBe(true)
    }
    printEvents('one forced -8% day', events)
    debugMargin(
      `one-day -8% equity=${check.equity} positionValue=${check.positionValue} ratio=${check.ratio} shares=${quantity} price ${moved.before}->${moved.after}`,
    )
  })

  it('liquidates a 5x long on the second forced -8% day', () => {
    const defs = market()
    const game = createGame(defs, 'down2')
    const streams = streamPicture(game)
    const fairs = fairPicture(game)
    const quantity = searchOrders(game, defs, 'NOVA', 'buy')
    applyCommand(game, defs, order('NOVA', 'buy', quantity))
    const firstStart = tradingEquity(game, defs).equity
    const firstMove = forceCappedMove(game, 'NOVA', -1)
    const first = settleTradingAccount(game, defs, firstStart)
    expect(first.some((event) => event.kind === 'liquidation')).toBe(false)
    const firstCheck = checks(first)[0]
    if (firstCheck === undefined) throw new Error('[DEBUG margin] missing first marginCheck')
    expect(
      aboveRatio(
        firstCheck.equity,
        firstCheck.positionValue,
        MARGIN_LIQUIDATION_RATIO_NUMERATOR,
        MARGIN_LIQUIDATION_RATIO_DENOMINATOR,
      ),
    ).toBe(true)

    const secondStart = tradingEquity(game, defs).equity
    const secondMove = forceCappedMove(game, 'NOVA', -1)
    expect(secondMove.move).toBe(Math.floor((secondMove.before * 8) / 100))
    const shares = game.positions.NOVA?.signedShares
    expect(shares).toBe(quantity)
    const events = settleTradingAccount(game, defs, secondStart)
    expect(streamPicture(game)).toBe(streams)
    expect(fairPicture(game)).toBe(fairs)
    expect(focusKinds(events)).toEqual(['marginCheck', 'liquidation', 'marginCheck'])
    const [before, after] = checks(events)
    const liquidation = events.find((event): event is LiquidationEvent => event.kind === 'liquidation')
    if (before === undefined || after === undefined || liquidation === undefined) {
      throw new Error('[DEBUG margin] missing two-day liquidation sequence')
    }
    expect(
      atOrBelowRatio(before.equity, before.positionValue, MARGIN_LIQUIDATION_RATIO_NUMERATOR, MARGIN_LIQUIDATION_RATIO_DENOMINATOR),
    ).toBe(true)
    expect(events.some((event) => event.kind === 'marginWarning')).toBe(true)
    const half = halfSpreadCents(secondMove.after, spreadOf('NOVA'))
    expect(liquidation.asset).toBe('NOVA')
    expect(liquidation.quantity).toBe(quantity)
    expect(liquidation.fill).toBe(secondMove.after - half)
    expect(feeCents(quantity * liquidation.fill)).toBeGreaterThanOrEqual(0)
    expect(game.positions).toEqual({})
    expect(after.positionValue).toBe(0)
    expect(after.ratio).toBeNull()
    expect(after.equity).toBeGreaterThanOrEqual(0)
    expect(tradingEquity(game, defs).equity).toBeGreaterThanOrEqual(0)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    expect(game.accounts.savingsCents).toBe(0)
    applyCommand(game, defs, { type: 'transfer', from: 'cash', to: 'trading', amountCents: 1 })
    expect(game.log.at(-1)?.kind).toBe('transfer')
    printEvents(`second forced -8% day price ${firstMove.before}->${firstMove.after}->${secondMove.after}`, events)
    debugMargin(
      `two-day sequence marginCheck equity=${before.equity} ratio=${before.ratio}; liquidation asset=${liquidation.asset} quantity=${liquidation.quantity} fill=${liquidation.fill} ratio=${liquidation.ratioAfter}; marginCheck equity=${after.equity} positionValue=${after.positionValue} ratio=${after.ratio}`,
    )
  })

  it('keeps a 5x short above 10% after one forced +8% day', () => {
    const defs = market()
    const game = createGame(defs, 'up1')
    const streams = streamPicture(game)
    const quantity = searchOrders(game, defs, 'NOVA', 'sell')
    expect(quantity).toBeGreaterThan(1)
    applyCommand(game, defs, order('NOVA', 'sell', quantity))
    expect(game.positions.NOVA?.signedShares).toBe(-quantity)
    const opened = tradingEquity(game, defs)
    expect(opened.equity * 5).toBeGreaterThanOrEqual(opened.gross)
    const oneMore = cloneGame(game)
    applyCommand(oneMore, defs, order('NOVA', 'sell', 1))
    expect(oneMore.log.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'insufficientBuyingPower' })
    const startEquity = opened.equity
    const moved = forceCappedMove(game, 'NOVA', 1)
    expect(moved.move * 100).toBe(moved.before * 8)
    expect(moved.after).toBe(5184)
    const events = settleTradingAccount(game, defs, startEquity)
    expect(streamPicture(game)).toBe(streams)
    const check = checks(events)[0]
    if (check === undefined) throw new Error('[DEBUG margin] missing short marginCheck')
    expect(events.some((event) => event.kind === 'liquidation')).toBe(false)
    expect(events.some((event) => event.kind === 'backstopWriteOff')).toBe(false)
    expect(check.equity).toBeGreaterThan(0)
    expect(
      aboveRatio(check.equity, check.positionValue, MARGIN_LIQUIDATION_RATIO_NUMERATOR, MARGIN_LIQUIDATION_RATIO_DENOMINATOR),
    ).toBe(true)
    expect(game.positions.NOVA?.signedShares).toBe(-quantity)
    expect(events.some((event) => event.kind === 'borrowFee')).toBe(true)
    expect(tradingEquity(game, defs).equity).toBeGreaterThan(0)
    printEvents('one forced +8% short day', events)
    debugMargin(
      `short +8% equity=${check.equity} positionValue=${check.positionValue} ratio=${check.ratio} shares=${-quantity} price ${moved.before}->${moved.after}`,
    )
  })

  it('writes off at most one cent per position closed across 200 max-leverage seeds', { timeout: 120_000 }, () => {
    const defs = market()
    const seeds = 200
    const days = 120
    let liquidationDays = 0
    let writeOffDays = 0
    let maxWriteOff = 0
    for (let n = 0; n < seeds; n += 1) {
      const seed = `lev${n}`
      const game = createGame(defs, seed)
      for (let i = 0; i < days; i += 1) {
        const extra = searchOrders(game, defs, 'M4X', 'buy')
        if (extra > 0) {
          applyCommand(game, defs, order('M4X', 'buy', extra))
          if (game.log.at(-1)?.kind !== 'orderFill') {
            throw new Error(`[DEBUG margin] seed=${seed} day=${game.market.day} rejected cap buy ${extra}`)
          }
        }
        const trial = cloneGame(game)
        applyCommand(trial, defs, order('M4X', 'buy', 1))
        if (trial.log.at(-1)?.kind !== 'commandRejected') {
          throw new Error(`[DEBUG margin] seed=${seed} day=${game.market.day} bought past the 5x cap`)
        }
        endDay(game, defs)
        const closes = game.log.filter((event) => event.kind === 'liquidation').length
        let amount = 0
        for (const event of game.log) {
          if (event.kind !== 'backstopWriteOff') continue
          amount += event.amount
          if (event.amount > closes) {
            printEvents(`write-off seed=${seed} day=${game.market.day}`, game.log)
            throw new Error(
              `[DEBUG margin] write-off seed=${seed} day=${game.market.day} amount=${event.amount} closes=${closes}`,
            )
          }
        }
        if (closes > 0) liquidationDays += 1
        if (amount > 0) writeOffDays += 1
        if (amount > maxWriteOff) maxWriteOff = amount
        const equity = tradingEquity(game, defs).equity
        if (equity < 0) {
          throw new Error(`[DEBUG margin] negative equity seed=${seed} day=${game.market.day} equity=${equity}`)
        }
      }
    }
    debugMargin(
      `max-leverage seeds=${seeds} days=${days} liquidationDays=${liquidationDays} writeOffDays=${writeOffDays} maxWriteOff=${maxWriteOff}`,
    )
    expect(maxWriteOff).toBeLessThanOrEqual(1)
  })

  it('floors a wiped trading account at zero and does not end the run', () => {
    const defs = market()
    const game = createGame(defs, 'wipe')
    const quantity = searchOrders(game, defs, 'NOVA', 'buy')
    applyCommand(game, defs, order('NOVA', 'buy', quantity))
    const startEquity = tradingEquity(game, defs).equity
    const nova = game.market.assets.NOVA
    if (nova === undefined) throw new Error('[DEBUG margin] missing NOVA')
    const fair = nova.fairValue
    nova.priceCents = 1
    expect(nova.fairValue).toBe(fair)
    const events = settleTradingAccount(game, defs, startEquity)
    const end = tradingEquity(game, defs)
    expect(end.equity).toBe(0)
    expect(end.gross).toBe(0)
    expect(game.positions).toEqual({})
    const writeOff = events.find((event) => event.kind === 'backstopWriteOff')
    const wiped = events.find((event) => event.kind === 'wipeOut')
    if (writeOff?.kind !== 'backstopWriteOff' || wiped?.kind !== 'wipeOut') {
      throw new Error('[DEBUG margin] missing backstop or wipe-out')
    }
    expect(writeOff.amount).toBeGreaterThan(0)
    expect(wiped.startEquity).toBe(startEquity)
    expect(wiped.endEquity).toBe(0)
    expect(wiped.endEquity * 100).toBeLessThan(wiped.startEquity * 10)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    expect(game.accounts.savingsCents).toBe(0)
    applyCommand(game, defs, { type: 'transfer', from: 'cash', to: 'trading', amountCents: 1 })
    expect(game.accounts.tradingCents).toBe(1)
    expect(game.log.at(-1)?.kind).toBe('transfer')
    debugMargin(formatEvent(writeOff))
    debugMargin(formatEvent(wiped))
    debugMargin(`wipe-out backstop=${writeOff.amount} endEquity=0 transfer still accepted`)
  })
})
