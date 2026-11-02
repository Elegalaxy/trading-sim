import { describe, expect, it } from 'vitest'

import { MARKET_DEFINITIONS } from '../content/index.ts'
import { createGame, endDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { tradingEquity } from '../sim/trading.ts'
import { STRATEGY_NAMES, actDay } from './strategies.ts'

// The high-leverage bots open one large position at their leverage, leave the market
// alone, and open again after a liquidation.

const defs = MARKET_DEFINITIONS

describe('high-leverage strategies', () => {
  it('are listed', () => {
    expect(STRATEGY_NAMES).toEqual(expect.arrayContaining(['longNova10', 'longNova20', 'longNova50', 'shortNova50']))
  })

  it('open a large position at the chosen leverage on the first day', () => {
    for (const [name, leverage, sign] of [
      ['longNova10', 10, 1],
      ['longNova20', 20, 1],
      ['longNova50', 50, 1],
      ['shortNova50', 50, -1],
    ] as const) {
      const game = createGame(defs, 'bot')
      const action = actDay(name, game, defs, null)
      const position = game.positions.NOVA
      expect(action.orders).toBe(1)
      expect(position?.leverage).toBe(leverage)
      expect(Math.sign(position?.signedShares ?? 0)).toBe(sign)
      const book = tradingEquity(game, defs)
      // Most of the margin is used, and the margin rule still holds.
      expect(book.equity).toBeGreaterThanOrEqual(book.required)
      expect(book.required).toBeGreaterThan(book.equity * 0.5)
    }
  })

  it('do not change the market', () => {
    const traded = createGame(defs, 'bot')
    const idle = createGame(defs, 'bot')
    actDay('longNova50', traded, defs, null)
    actDay('hold', idle, defs, null)
    endDay(traded, defs)
    endDay(idle, defs)
    expect(stateHash(traded.market)).toBe(stateHash(idle.market))
  })

  it('hold an open position and do not add to it', () => {
    const game = createGame(defs, 'bot')
    actDay('longNova20', game, defs, null)
    const shares = game.positions.NOVA?.signedShares
    endDay(game, defs)
    if (game.positions.NOVA === undefined) return
    const next = actDay('longNova20', game, defs, null)
    expect(next.orders).toBe(0)
    expect(game.positions.NOVA?.signedShares).toBe(shares)
  })
})
