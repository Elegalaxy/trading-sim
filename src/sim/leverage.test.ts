import { describe, expect, it } from 'vitest'

import { MAX_LEVERAGE } from './constants.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { marginBase, tradingEquity } from './trading.ts'
import type { GameState, MarketDefinitions } from './types.ts'

// Leverage is chosen per position. A position needs its value over its leverage as margin,
// and the order gate, the warning and the liquidation read equity against that margin.

const defs: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
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
      volume: 0,
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
