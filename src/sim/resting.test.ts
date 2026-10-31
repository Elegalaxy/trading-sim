import { describe, expect, it } from 'vitest'

import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { MAX_RESTING_ORDERS } from './resting.ts'
import type { GameState, MarketDefinitions, RestingEvent } from './types.ts'

const defs: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
    { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
}

type Bar = [open: number, high: number, low: number, close: number]

/** Flat NOVA bars at the open price, except the ones given by index. */
function setBars(game: GameState, spec: Record<number, Bar>): void {
  const price = game.market.assets.NOVA.priceCents
  game.session.bars.NOVA = Array.from({ length: 16 }, (_, i) => {
    const bar = spec[i] ?? [price, price, price, price]
    return { open: bar[0], high: bar[1], low: bar[2], close: bar[3], volume: 0 }
  })
}

function opened(spec: Record<number, Bar> = {}): GameState {
  const game = createGame(defs, 'demo')
  applyCommand(game, defs, { type: 'skip' })
  setBars(game, spec)
  return game
}

function resting(game: GameState): RestingEvent[] {
  return game.log.filter((event): event is RestingEvent => event.kind === 'resting')
}

function rejection(game: GameState): string | null {
  const event = game.log.findLast((entry) => entry.kind === 'commandRejected')
  return event !== undefined && event.kind === 'commandRejected' ? event.reason : null
}

describe('limit orders', () => {
  it('rests until a bar touches the limit, then fills at the limit with a fee and no spread', () => {
    const game = opened({ 3: [4800, 4800, 4600, 4800] })
    applyCommand(game, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 10, limitCents: 4700 })
    expect(game.resting.orders).toHaveLength(1)
    applyCommand(game, defs, { type: 'tick', steps: 3 })
    expect(game.positions.NOVA).toBeUndefined()
    expect(game.resting.orders).toHaveLength(1)
    const cash = game.accounts.tradingCents
    applyCommand(game, defs, { type: 'tick', steps: 1 })
    expect(game.positions.NOVA.signedShares).toBe(10)
    expect(game.resting.orders).toHaveLength(0)
    expect(game.accounts.tradingCents).toBe(cash - 47000 - 47)
    const filled = resting(game).at(-1)
    expect(filled).toMatchObject({ action: 'filled', detail: 'limit', priceCents: 4700, time: '17:45', side: 'buy' })
  })

  it('fills at the open when a bar opens past the limit', () => {
    const game = opened({ 2: [4500, 4800, 4500, 4800] })
    applyCommand(game, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 10, limitCents: 4700 })
    applyCommand(game, defs, { type: 'tick', steps: 3 })
    expect(resting(game).at(-1)?.priceCents).toBe(4500)
  })

  it('sells above the market and fills on the high', () => {
    const game = opened({ 1: [4800, 5100, 4800, 4800] })
    applyCommand(game, defs, { type: 'limitOrder', asset: 'NOVA', side: 'sell', quantity: 5, limitCents: 5000 })
    applyCommand(game, defs, { type: 'tick', steps: 2 })
    expect(game.positions.NOVA.signedShares).toBe(-5)
    expect(resting(game).at(-1)).toMatchObject({ priceCents: 5000, side: 'sell' })
  })

  it('rejects a limit on the wrong side of the market, too big, or too many', () => {
    const game = opened()
    const place = (extra: Record<string, unknown>) =>
      applyCommand(game, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 1, limitCents: 4700, ...extra })
    place({ limitCents: 4800 })
    expect(rejection(game)).toBe('limitNotBelowMarket')
    place({ side: 'sell', limitCents: 4700 })
    expect(rejection(game)).toBe('limitNotAboveMarket')
    place({ quantity: 100000 })
    expect(rejection(game)).toBe('insufficientBuyingPower')
    place({ quantity: 0 })
    expect(rejection(game)).toBe('quantityNotInteger')
    place({ tpCents: 4600 })
    expect(rejection(game)).toBe('takeProfitWrongSide')
    place({ slCents: 4800 })
    expect(rejection(game)).toBe('stopLossWrongSide')
    expect(game.resting.orders).toHaveLength(0)
    for (let i = 0; i < MAX_RESTING_ORDERS; i += 1) place({})
    expect(game.resting.orders).toHaveLength(MAX_RESTING_ORDERS)
    place({})
    expect(rejection(game)).toBe('tooManyOrders')
  })

  it('needs the market open and can be cancelled', () => {
    const closed = createGame(defs, 'demo')
    applyCommand(closed, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 1, limitCents: 4700 })
    expect(rejection(closed)).toBe('marketClosed')

    const game = opened()
    applyCommand(game, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 1, limitCents: 4700 })
    const id = game.resting.orders[0].id
    applyCommand(game, defs, { type: 'cancelOrder', id })
    expect(game.resting.orders).toHaveLength(0)
    expect(resting(game).at(-1)?.action).toBe('cancelled')
    applyCommand(game, defs, { type: 'cancelOrder', id })
    expect(rejection(game)).toBe('noSuchOrder')
  })

  it('carries over to the next day and fills against the rest of the session at End day', () => {
    const game = opened({ 15: [4800, 4800, 4600, 4800] })
    applyCommand(game, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 10, limitCents: 4700 })
    endDay(game, defs)
    expect(game.positions.NOVA.signedShares).toBe(10)
    expect(resting(game).at(-1)).toMatchObject({ action: 'filled', time: '20:45' })

    const later = opened()
    applyCommand(later, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 10, limitCents: 100 })
    endDay(later, defs)
    expect(later.resting.orders).toHaveLength(1)
    expect(later.market.day).toBe(1)
  })

  it('drops an order that fails the 5x check when it fills', () => {
    const game = opened({ 1: [4800, 4800, 4700, 4800] })
    applyCommand(game, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 300, limitCents: 4700 })
    expect(game.resting.orders).toHaveLength(1)
    // Spend the buying power on another asset before the limit fills.
    applyCommand(game, defs, { type: 'order', asset: 'HRBU', side: 'buy', quantity: 400 })
    applyCommand(game, defs, { type: 'tick', steps: 2 })
    expect(game.resting.orders).toHaveLength(0)
    const dropped = resting(game).at(-1)
    expect(dropped).toMatchObject({ action: 'dropped', reason: 'insufficientBuyingPower' })
    expect(game.positions.NOVA).toBeUndefined()
  })
})

describe('take profit and stop loss', () => {
  function longOpen(spec: Record<number, Bar>): GameState {
    const game = opened(spec)
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10 })
    applyCommand(game, defs, { type: 'setExits', asset: 'NOVA', tpCents: 5000, slCents: 4600 })
    return game
  }

  it('closes the whole position at the take profit', () => {
    const game = longOpen({ 2: [4800, 5100, 4800, 5000] })
    expect(game.resting.exits.NOVA).toEqual({ side: 'long', tpCents: 5000, slCents: 4600 })
    applyCommand(game, defs, { type: 'tick', steps: 3 })
    expect(game.positions.NOVA).toBeUndefined()
    expect(game.resting.exits.NOVA).toBeUndefined()
    expect(resting(game).at(-1)).toMatchObject({ action: 'filled', detail: 'takeProfit', priceCents: 5000, quantity: 10, side: 'sell' })
  })

  it('takes the stop when one bar touches both, and gaps through it to the open', () => {
    const both = longOpen({ 0: [4800, 5100, 4500, 4800] })
    applyCommand(both, defs, { type: 'tick', steps: 1 })
    expect(resting(both).at(-1)).toMatchObject({ detail: 'stopLoss', priceCents: 4600 })

    const gap = longOpen({ 1: [4400, 4400, 4400, 4400] })
    applyCommand(gap, defs, { type: 'tick', steps: 2 })
    expect(resting(gap).at(-1)).toMatchObject({ detail: 'stopLoss', priceCents: 4400 })
  })

  it('works for a short', () => {
    const game = opened({ 1: [4800, 4800, 4500, 4600] })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 10 })
    applyCommand(game, defs, { type: 'setExits', asset: 'NOVA', tpCents: 5000 })
    expect(rejection(game)).toBe('takeProfitWrongSide')
    applyCommand(game, defs, { type: 'setExits', asset: 'NOVA', tpCents: 4500, slCents: 5000 })
    applyCommand(game, defs, { type: 'tick', steps: 2 })
    expect(game.positions.NOVA).toBeUndefined()
    expect(resting(game).at(-1)).toMatchObject({ detail: 'takeProfit', priceCents: 4500, side: 'buy' })
  })

  it('rejects exits without a position or on the wrong side', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'setExits', asset: 'NOVA', tpCents: 5000 })
    expect(rejection(game)).toBe('noPosition')
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    applyCommand(game, defs, { type: 'setExits', asset: 'NOVA', slCents: 4900 })
    expect(rejection(game)).toBe('stopLossWrongSide')
  })

  it('clears an exit with null and drops exits when the position closes or flips', () => {
    const game = longOpen({})
    applyCommand(game, defs, { type: 'setExits', asset: 'NOVA', tpCents: null })
    expect(game.resting.exits.NOVA).toEqual({ side: 'long', tpCents: null, slCents: 4600 })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 20 })
    expect(game.positions.NOVA.signedShares).toBe(-10)
    expect(game.resting.exits.NOVA).toBeUndefined()
    expect(resting(game).some((event) => event.reason === 'positionClosed')).toBe(true)
  })

  it('sets the exits of a filled limit for the next bar only', () => {
    const game = opened({ 1: [4800, 4800, 4500, 4700] })
    applyCommand(game, defs, {
      type: 'limitOrder',
      asset: 'NOVA',
      side: 'buy',
      quantity: 10,
      limitCents: 4700,
      slCents: 4600,
    })
    applyCommand(game, defs, { type: 'tick', steps: 2 })
    // The bar that filled the limit also dipped to 4500, but the stop was not live yet.
    expect(game.positions.NOVA.signedShares).toBe(10)
    expect(game.resting.exits.NOVA).toEqual({ side: 'long', tpCents: null, slCents: 4600 })
  })
})

describe('resting orders and the market', () => {
  it('never change the market', () => {
    const idle = createGame(defs, 'demo')
    const played = createGame(defs, 'demo')
    for (let day = 0; day < 10; day += 1) {
      applyCommand(played, defs, { type: 'skip' })
      const price = played.market.assets.NOVA.priceCents
      applyCommand(played, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 1, limitCents: price - 1 })
      applyCommand(played, defs, { type: 'tick', steps: 6 })
      endDay(idle, defs)
      endDay(played, defs)
      expect(stateHash(played.market)).toBe(stateHash(idle.market))
    }
  })
})
