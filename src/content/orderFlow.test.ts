import { describe, expect, it } from 'vitest'

import { applyCommand, createGame, endDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { tradingEquity } from '../sim/trading.ts'
import type { GameState } from '../sim/types.ts'
import { MARKET_DEFINITIONS as defs } from './index.ts'

function opened(seed: string): GameState {
  const game = createGame(defs, seed)
  applyCommand(game, defs, { type: 'skip' })
  return game
}

function buy(game: GameState, quantity: number, leverage = 50): void {
  applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity, leverage })
}

function sell(game: GameState, quantity: number): void {
  applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity })
}

describe('player orders in the order flow', () => {
  it('leave the market alone below the free share, down to the bar', () => {
    const idle = opened('flow')
    const small = opened('flow')
    buy(small, 20, 5)
    expect(small.positions.NOVA?.signedShares).toBe(20)
    expect(small.session.bars).toEqual(idle.session.bars)
    endDay(idle, defs)
    endDay(small, defs)
    expect(stateHash(small.market)).toBe(stateHash(idle.market))
  })

  it('push the rest of the session and the close, never the bars already played', () => {
    const idle = opened('push')
    const big = opened('push')
    applyCommand(big, defs, { type: 'tick', steps: 3 })
    applyCommand(idle, defs, { type: 'tick', steps: 3 })
    const before = structuredClone(big.session.bars.NOVA)
    buy(big, 1200)
    expect(big.positions.NOVA?.signedShares).toBe(1200)
    const bars = big.session.bars.NOVA
    expect(bars.slice(0, 3)).toEqual(before.slice(0, 3))
    expect(bars[3].open).toBe(before[3].open)
    expect(bars[15].close).toBeGreaterThan(idle.session.bars.NOVA[15].close)
    for (let i = 1; i < bars.length; i += 1) expect(bars[i].open).toBe(bars[i - 1].close)
    for (const bar of bars) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close))
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close))
    }
    const printed = bars[15].close
    applyCommand(big, defs, { type: 'tick', steps: 13 })
    endDay(big, defs)
    expect(big.market.assets.NOVA.priceCents).toBe(printed)
  })

  it('add nothing when the order is placed at the close, and keep the same run for the same commands', () => {
    const idle = opened('close')
    const late = opened('close')
    applyCommand(late, defs, { type: 'tick', steps: 16 })
    buy(late, 1200)
    applyCommand(idle, defs, { type: 'tick', steps: 16 })
    expect(late.session.bars).toEqual(idle.session.bars)
    const a = opened('twice')
    const b = opened('twice')
    for (const game of [a, b]) {
      buy(game, 900)
      applyCommand(game, defs, { type: 'tick', steps: 4 })
      sell(game, 300)
      endDay(game, defs)
    }
    expect(stateHash(a.market)).toBe(stateHash(b.market))
    expect(a.session.bars).toEqual(b.session.bars)
  })

  it('make a pump and dump lose money over many seeds', () => {
    let total = 0
    const runs = 120
    for (let seed = 0; seed < runs; seed += 1) {
      const game = opened(`pump-${seed}`)
      const start = tradingEquity(game, defs).equity
      buy(game, 1000)
      applyCommand(game, defs, { type: 'tick', steps: 8 })
      const held = game.positions.NOVA?.signedShares ?? 0
      if (held > 0) sell(game, held)
      total += tradingEquity(game, defs).equity - start
    }
    expect(total / runs).toBeLessThan(0)
  })
})
