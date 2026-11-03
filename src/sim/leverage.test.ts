import { describe, expect, it } from 'vitest'

import { MAX_LEVERAGE } from './constants.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { settleFunding } from './funding.ts'
import { marginBase, tradingEquity } from './trading.ts'
import type { GameState, MarketDefinitions } from './types.ts'

// Leverage is chosen per position. A position needs its value over its leverage as margin,
// and the order gate, the warning and the liquidation read equity against that margin.

const defs: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300, liquidityNotionalCents: 10_000_000_000_000 },
    { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
}

function opened(): GameState {
  const game = createGame(defs, 'demo')
  applyCommand(game, defs, { type: 'skip' })
  return game
}

function rejection(game: GameState): string | null {
  const event = game.log.findLast((entry) => entry.kind === 'commandRejected')
  return event !== undefined && event.kind === 'commandRejected' ? event.reason : null
}

describe('per-position leverage', () => {
  it('stores the leverage on the position and defaults to 5', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10, leverage: 20 })
    expect(game.positions.NOVA.leverage).toBe(20)
    applyCommand(game, defs, { type: 'order', asset: 'HRBU', side: 'buy', quantity: 10 })
    expect(game.positions.HRBU.leverage).toBe(5)
  })

  it('needs margin equal to the value over the leverage', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 100, leverage: 10 })
    const book = tradingEquity(game, defs)
    expect(book.required).toBe(Math.ceil(book.gross / 10))
    expect(marginBase(book)).toBe(book.required * 5)
  })

  it('lets a high leverage open a bigger position than 5x allows, and 5x refuse it', () => {
    const big = 2500
    const five = opened()
    applyCommand(five, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: big, leverage: 5 })
    expect(rejection(five)).toBe('insufficientBuyingPower')
    const fifty = opened()
    applyCommand(fifty, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: big, leverage: 50 })
    expect(fifty.positions.NOVA.signedShares).toBe(big)
  })

  it('rejects a leverage outside 1 to the maximum', () => {
    for (const bad of [0, -1, 1.5, MAX_LEVERAGE + 1]) {
      const game = opened()
      applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1, leverage: bad })
      expect(rejection(game)).toBe('leverageInvalid')
      expect(game.positions.NOVA).toBeUndefined()
    }
  })

  it('keeps the leverage of an open position and refuses to add at another', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10, leverage: 3 })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 5, leverage: 8 })
    expect(rejection(game)).toBe('leverageMismatch')
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 5 })
    expect(game.positions.NOVA).toMatchObject({ signedShares: 15, leverage: 3 })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 5 })
    expect(game.positions.NOVA).toMatchObject({ signedShares: 10, leverage: 3 })
  })

  it('takes the new leverage when a position flips', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 5, leverage: 3 })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 8, leverage: 10 })
    expect(game.positions.NOVA).toMatchObject({ signedShares: -3, leverage: 10 })
  })

  it('carries the leverage of a limit order to the position it opens', () => {
    const game = opened()
    const price = game.market.assets.NOVA.priceCents
    applyCommand(game, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 10, limitCents: price - 100, leverage: 25 })
    expect(game.resting.orders[0]?.leverage).toBe(25)
    game.session.bars.NOVA = Array.from({ length: 16 }, (_, i) => ({
      open: price,
      high: price,
      low: i === 1 ? price - 200 : price,
      close: price,
      volume: 1_000_000_000,
    }))
    applyCommand(game, defs, { type: 'tick', steps: 2 })
    expect(game.positions.NOVA).toMatchObject({ signedShares: 10, leverage: 25 })
  })

  it('liquidates a high-leverage position once equity falls to half its margin', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 2500, leverage: 50 })
    expect(game.positions.NOVA).toBeDefined()
    // A loss that 5x would shrug off: equity 100 against about 2400 of margin.
    const book = tradingEquity(game, defs)
    game.accounts.tradingCents -= book.equity - 100
    endDay(game, defs)
    expect(game.positions.NOVA).toBeUndefined()
    expect(game.log.some((event) => event.kind === 'liquidation')).toBe(true)
  })
})

describe('perpetual-style liquidation and funding', () => {
  it('liquidates inside the session on the bar that crosses the mark, with a fee', () => {
    const game = opened()
    const price = game.market.assets.NOVA.priceCents
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 2500, leverage: 50 })
    // A flat session, then a 3% drop in bar 5: a move that wipes a 50x margin.
    const drop = Math.round(price * 0.97)
    game.session.bars.NOVA = Array.from({ length: 16 }, (_, i) => ({
      open: i < 5 ? price : drop,
      high: i < 5 ? price : drop,
      low: i < 5 ? price : drop,
      close: i < 5 ? price : drop,
      volume: 1_000_000_000,
    }))
    applyCommand(game, defs, { type: 'tick', steps: 5 })
    expect(game.positions.NOVA).toBeDefined()
    applyCommand(game, defs, { type: 'tick', steps: 1 })
    expect(game.positions.NOVA).toBeUndefined()
    const liquidation = game.log.find((event) => event.kind === 'liquidation')
    expect(liquidation).toMatchObject({ asset: 'NOVA', quantity: 2500, time: '18:15' })
    if (liquidation?.kind !== 'liquidation') throw new Error('missing liquidation')
    expect(liquidation.fee).toBe(Math.round((2500 * liquidation.fill * 5000) / 1_000_000))
    expect(liquidation.fee).toBeGreaterThan(0)
    expect(game.session.clock).toBe(6)
  })

  it('does not liquidate a 5x position on the same small drop', () => {
    const game = opened()
    const price = game.market.assets.NOVA.priceCents
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 150, leverage: 5 })
    const drop = Math.round(price * 0.97)
    game.session.bars.NOVA = Array.from({ length: 16 }, () => ({ open: drop, high: drop, low: drop, close: drop, volume: 1_000_000_000 }))
    applyCommand(game, defs, { type: 'tick', steps: 4 })
    expect(game.positions.NOVA).toBeDefined()
  })

  it('charges funding to the side the day favoured more, and never pays the player', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10 })
    applyCommand(game, defs, { type: 'order', asset: 'HRBU', side: 'sell', quantity: 10 })
    const nova = game.market.assets.NOVA.priceCents
    const hrbu = game.market.assets.HRBU.priceCents
    game.market.log = [
      { kind: 'priceStep', day: 1, asset: 'NOVA', previous: Math.round(nova / 1.08), fair: nova, pull: 0, noise: 0, rawMove: 0, cappedMove: 0, capped: false, newPrice: nova, gapAfter: 0 },
      { kind: 'priceStep', day: 1, asset: 'HRBU', previous: Math.round(hrbu / 1.08), fair: hrbu, pull: 0, noise: 0, rawMove: 0, cappedMove: 0, capped: false, newPrice: hrbu, gapAfter: 0 },
    ]
    const cash = game.accounts.tradingCents
    const events = settleFunding(game, defs)
    const long = events.find((event) => event.asset === 'NOVA')
    const short = events.find((event) => event.asset === 'HRBU')
    // A +8% day: the long is the crowded side and pays the base plus 0.4% (capped at 0.2%).
    expect(long?.ratePpm).toBe(100 + 2000)
    expect(short?.ratePpm).toBe(100)
    expect(game.accounts.tradingCents).toBe(cash - (long?.amount ?? 0) - (short?.amount ?? 0))
    expect(events.every((event) => event.amount >= 0)).toBe(true)
  })
})

