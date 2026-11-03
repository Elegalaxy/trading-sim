import { describe, expect, it } from 'vitest'

import { SLIPPAGE_FREE_SHARE, SLIPPAGE_MAX_PPM } from './constants.ts'
import { applyCommand, createGame } from './game.ts'
import { formatEvent } from './log.ts'
import { fillBarVolume, slippageCents } from './trading.ts'
import type { GameState, MarketDefinitions, OrderFillEvent } from './types.ts'

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

function lastFill(game: GameState): OrderFillEvent {
  const fill = [...game.log].reverse().find((event): event is OrderFillEvent => event.kind === 'orderFill')
  if (fill === undefined) throw new Error('no order fill in the log')
  return fill
}

describe('slippage', () => {
  it('is free up to the free share of the bar and grows with the square root after it', () => {
    expect(slippageCents(10_000, 0.02, 50, 1000)).toBe(0)
    expect(slippageCents(10_000, 0.02, 1000 * SLIPPAGE_FREE_SHARE, 1000)).toBe(0)
    const small = slippageCents(10_000, 0.02, 200, 1000)
    const big = slippageCents(10_000, 0.02, 1000, 1000)
    expect(small).toBeGreaterThan(0)
    expect(big).toBeGreaterThan(small)
    // 20% of the bar: 0.02 x sqrt(0.15) = 0.775% of $100.
    expect(small).toBe(Math.round(10_000 * 0.02 * Math.sqrt(0.15)))
  })

  it('uses a volatility floor for the index and caps the extra', () => {
    expect(slippageCents(100_000, 0, 500, 1000)).toBeGreaterThan(0)
    expect(slippageCents(10_000, 0.5, 1_000_000, 1000)).toBe(Math.round((10_000 * SLIPPAGE_MAX_PPM) / 1_000_000))
  })

  it('leaves a small order at price plus half spread and logs nothing extra', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 5 })
    const fill = lastFill(game)
    expect(fill.slippage).toBeUndefined()
    expect(fill.fillPrice).toBe(fill.price + fill.halfSpread)
    expect(formatEvent(fill)).not.toContain('slippage')
  })

  it('makes a large buy pay more and a large sell receive less than the quote', () => {
    const game = opened()
    const volume = fillBarVolume(game, 'NOVA')
    const quantity = Math.ceil(volume * 0.3)
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity, leverage: 50 })
    const buy = lastFill(game)
    expect(buy.slippage).toBeGreaterThan(0)
    expect(buy.fillPrice).toBe(buy.price + buy.halfSpread + (buy.slippage ?? 0))
    expect(formatEvent(buy)).toContain(`slippage=${buy.slippage}`)

    const short = opened()
    applyCommand(short, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity, leverage: 50 })
    const sell = lastFill(short)
    expect(sell.fillPrice).toBe(sell.price - sell.halfSpread - (sell.slippage ?? 0))
  })

  it('does not change the market or the session', () => {
    const quiet = opened()
    const busy = opened()
    const volume = fillBarVolume(busy, 'NOVA')
    applyCommand(busy, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: Math.ceil(volume * 0.3), leverage: 50 })
    expect(busy.market).toEqual(quiet.market)
    expect(busy.session).toEqual(quiet.session)
  })

  it('charges a stop but not a take profit or a limit order', () => {
    const game = opened()
    const price = game.market.assets.NOVA.priceCents
    const quantity = Math.ceil(fillBarVolume(game, 'NOVA') * 0.3)
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity, leverage: 50 })
    expect(game.positions.NOVA?.signedShares).toBe(quantity)
    applyCommand(game, defs, { type: 'addExit', asset: 'NOVA', kind: 'stopLoss', priceCents: price - 50 })
    const bars = game.session.bars.NOVA
    game.session.bars.NOVA = bars.map((bar, i) => (i === 0 ? { ...bar, open: price, high: price, low: price - 80, close: price } : bar))
    applyCommand(game, defs, { type: 'tick', steps: 1 })
    const stop = game.log.find((event) => event.kind === 'resting' && event.detail === 'stopLoss' && event.action === 'filled')
    if (stop?.kind !== 'resting') throw new Error('stop did not fill')
    expect(stop.priceCents).toBeLessThan(price - 50)

    const limit = opened()
    applyCommand(limit, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity, limitCents: price - 30, leverage: 50 })
    limit.session.bars.NOVA = limit.session.bars.NOVA.map((bar, i) => (i === 0 ? { ...bar, open: price, high: price, low: price - 80, close: price } : bar))
    applyCommand(limit, defs, { type: 'tick', steps: 1 })
    const filled = lastFill(limit)
    expect(filled.fillPrice).toBe(price - 30)
    expect(filled.slippage).toBeUndefined()
  })
})
