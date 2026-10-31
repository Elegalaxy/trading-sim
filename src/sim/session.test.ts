import { describe, expect, it } from 'vitest'

import { SESSION_STEPS } from './constants.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { clockTime, quoteMarket } from './session.ts'
import { stateHash } from './hash.ts'
import type { GameState, MarketDefinitions } from './types.ts'

const defs: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
    { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
}

function open(game: GameState): void {
  applyCommand(game, defs, { type: 'skip' })
}

describe('intraday session', () => {
  it('opens at the stored price and closes at the price the next End day prints', () => {
    const game = createGame(defs, 'demo')
    for (let day = 0; day < 20; day += 1) {
      for (const id of Object.keys(game.market.assets)) {
        const bars = game.session.bars[id]
        expect(bars).toHaveLength(SESSION_STEPS)
        expect(bars[0].open).toBe(game.market.assets[id].priceCents)
        for (let i = 1; i < bars.length; i += 1) expect(bars[i].open).toBe(bars[i - 1].close)
        for (const bar of bars) {
          expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close))
          expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close))
          expect(bar.low).toBeGreaterThan(0)
          expect(bar.volume).toBeGreaterThanOrEqual(0)
          expect(bar.high).toBeLessThanOrEqual(Math.floor((bars[0].open * 112) / 100))
          expect(bar.low).toBeGreaterThanOrEqual(Math.ceil((bars[0].open * 88) / 100))
        }
      }
      const expected = Object.fromEntries(Object.keys(game.market.assets).map((id) => [id, game.session.bars[id][SESSION_STEPS - 1].close]))
      endDay(game, defs)
      for (const id of Object.keys(expected)) expect(game.market.assets[id].priceCents).toBe(expected[id])
      expect(game.session.day).toBe(game.market.day)
      expect(game.session.clock).toBe(0)
    }
  })

  it('does not change the market, with or without clock steps', () => {
    const idle = createGame(defs, 'demo')
    const played = createGame(defs, 'demo')
    for (let day = 0; day < 10; day += 1) {
      open(played)
      applyCommand(played, defs, { type: 'tick', steps: 5 })
      endDay(idle, defs)
      endDay(played, defs)
      expect(stateHash(played.market)).toBe(stateHash(idle.market))
      expect(played.session.bars).toEqual(idle.session.bars)
    }
  })

  it('is the same for the same seed and different for another seed', () => {
    const a = createGame(defs, 'demo')
    const b = createGame(defs, 'demo')
    const c = createGame(defs, 'other')
    expect(a.session.bars).toEqual(b.session.bars)
    expect(a.session.bars.NOVA).not.toEqual(c.session.bars.NOVA)
  })

  it('moves the clock only in the market section and not past the close', () => {
    const game = createGame(defs, 'demo')
    applyCommand(game, defs, { type: 'tick' })
    expect(game.session.clock).toBe(0)
    expect(game.pending.at(-1)).toMatchObject({ kind: 'commandRejected', command: 'tick', reason: 'marketClosed' })
    open(game)
    applyCommand(game, defs, { type: 'tick' })
    expect(game.session.clock).toBe(1)
    applyCommand(game, defs, { type: 'tick', steps: 99 })
    expect(game.session.clock).toBe(SESSION_STEPS)
    applyCommand(game, defs, { type: 'tick' })
    expect(game.pending.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'sessionOver' })
    applyCommand(game, defs, { type: 'tick', steps: 0 })
    expect(game.pending.at(-1)).toMatchObject({ reason: 'stepsNotPositiveInteger' })
    expect(clockTime(0)).toBe('17:00')
    expect(clockTime(SESSION_STEPS)).toBe('21:00')
  })

  it('fills an order at the quote for the clock, not at the open', () => {
    const game = createGame(defs, 'demo')
    open(game)
    applyCommand(game, defs, { type: 'tick', steps: 9 })
    const quote = game.session.bars.NOVA[8].close
    expect(quoteMarket(game).assets.NOVA.priceCents).toBe(quote)
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    const fill = game.pending.find((event) => event.kind === 'orderFill')
    expect(fill).toMatchObject({ price: quote })
    expect(game.market.assets.NOVA.priceCents).toBe(game.session.bars.NOVA[0].open)
  })

  it('fills at the open price at clock 0, as before', () => {
    const game = createGame(defs, 'demo')
    open(game)
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    expect(game.pending.find((event) => event.kind === 'orderFill')).toMatchObject({ price: 4800 })
  })

  it('stays flat on day 120, which has no next step', () => {
    const game = createGame(defs, 'demo')
    for (let day = 0; day < 120; day += 1) {
      game.bill = null
      game.runEnd = null
      endDay(game, defs)
    }
    expect(game.market.day).toBe(120)
    for (const bar of game.session.bars.NOVA) expect(bar.close).toBe(game.market.assets.NOVA.priceCents)
  })
})
