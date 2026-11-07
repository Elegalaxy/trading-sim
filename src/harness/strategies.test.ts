import { describe, expect, it } from 'vitest'

import { MARKET_DEFINITIONS } from '../content/index.ts'
import { applyCommand, createGame, endDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { tradingEquity } from '../sim/trading.ts'
import { createEventStudy, finishStudyRun, recordStudyDay, startStudyRun, studyLines } from './eventStudy.ts'
import { STRATEGY_NAMES, actDay, createBotMemory } from './strategies.ts'

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

  it('move the market only because their order is large (market depth M13)', () => {
    const idle = createGame(defs, 'bot')
    const idleAgain = createGame(defs, 'bot')
    actDay('hold', idle, defs, null)
    actDay('hold', idleAgain, defs, null)
    endDay(idle, defs)
    endDay(idleAgain, defs)
    expect(stateHash(idle.market)).toBe(stateHash(idleAgain.market))
    const traded = createGame(defs, 'bot')
    actDay('longNova50', traded, defs, null)
    endDay(traded, defs)
    // A whole account at 50x is far beyond the free share of NOVA's daily trading.
    expect(stateHash(traded.market)).not.toBe(stateHash(idle.market))
    expect(traded.market.assets.NOVA.priceCents).toBeGreaterThan(idle.market.assets.NOVA.priceCents)
    const small = createGame(defs, 'bot')
    applyCommand(small, defs, { type: 'skip' })
    applyCommand(small, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 20, leverage: 5 })
    expect(small.positions.NOVA?.signedShares).toBe(20)
    endDay(small, defs)
    expect(stateHash(small.market)).toBe(stateHash(idle.market))
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

describe('1x index bots', () => {
  it('are listed', () => {
    expect(STRATEGY_NAMES).toEqual(expect.arrayContaining(['longIndex1x', 'shortIndex1x']))
  })

  it('open the index once at 1x, hold, and leave the market equal to an idle run', () => {
    for (const [name, sign] of [
      ['longIndex1x', 1],
      ['shortIndex1x', -1],
    ] as const) {
      const game = createGame(defs, 'index1x')
      const idle = createGame(defs, 'index1x')
      let orders = 0
      let shares = 0
      for (let day = 0; day < 20 && game.runEnd === null && game.bill === null; day += 1) {
        orders += actDay(name, game, defs, null).orders
        actDay('hold', idle, defs, null)
        if (day === 0) {
          const position = game.positions.M4X
          expect(position?.leverage).toBe(1)
          expect(Math.sign(position?.signedShares ?? 0)).toBe(sign)
          shares = position?.signedShares ?? 0
          const book = tradingEquity(game, defs)
          // Whole index shares only (,000 each), so at least two thirds of a $3,000 account.
          expect(book.required).toBeGreaterThan(book.equity * 0.6)
        }
        endDay(game, defs)
        endDay(idle, defs)
        expect(stateHash(game.market)).toBe(stateHash(idle.market))
        expect(game.positions.M4X?.signedShares).toBe(shares)
      }
      expect(orders).toBe(1)
    }
  })
})

describe('news bots and the event study', () => {
  it('trade the news, close on time, and see the same market as an idle run', () => {
    for (const name of ['followHeadlines', 'fadeHeadlines', 'buyRumour'] as const) {
      const game = createGame(defs, 'news')
      const idle = createGame(defs, 'news')
      const memory = createBotMemory()
      let orders = 0
      for (let day = 0; day < 40 && game.runEnd === null && game.bill === null; day += 1) {
        orders += actDay(name, game, defs, null, memory).orders
        actDay('hold', idle, defs, null)
        for (const [asset, exit] of Object.entries(memory.exitDay)) {
          // An open trade is never kept past its exit day.
          expect(exit).toBeGreaterThan(game.market.day)
          expect(game.positions[asset]?.signedShares ?? 0).not.toBe(0)
        }
        endDay(game, defs)
        endDay(idle, defs)
        expect(stateHash(game.market)).toBe(stateHash(idle.market))
      }
      expect(orders).toBeGreaterThan(2)
    }
  })

  it('reports signed moves around effects and rumours', () => {
    const study = createEventStudy(defs)
    for (const seed of ['study-1', 'study-2']) {
      const game = createGame(defs, seed)
      startStudyRun(study, game.market)
      for (let day = 0; day < 60 && game.runEnd === null && game.bill === null; day += 1) {
        actDay('hold', game, defs, null)
        endDay(game, defs)
        recordStudyDay(study, game.market)
      }
      finishStudyRun(study)
    }
    const lines = studyLines(study)
    expect(lines[0]).toMatch(/^\[sim\] study cappedStockDayShare=\d\.\d{6} /)
    const stock = lines.find((line) => line.startsWith('[sim] study group=stock '))
    expect(stock).toMatch(/ d-3=-?\d+\.\d{3} .* d0=-?\d+\.\d{3} .* after3=-?\d+\.\d{3} /)
    expect(lines.some((line) => line.startsWith('[sim] study group=rumour:false:'))).toBe(true)
    const drift = lines.filter((line) => line.startsWith('[sim] study drift '))
    expect(drift.map((line) => line.split(' ')[3])).toEqual(['asset=NOVA', 'asset=BLSW', 'asset=HRBU', 'asset=KSR', 'asset=M4X'])
    expect(drift[0]).toMatch(
      /^\[sim\] study drift asset=NOVA runs=2 days=\d+ meanDailyPct=-?\d+\.\d{4} meanLogPct=-?\d+\.\d{4} meanChangePct=-?\d+\.\d{2} se=\d+\.\d{2} medianChangePct=-?\d+\.\d{2} fairDailyPct=-?\d+\.\d{4} expectedFairDailyPct=-?\d+\.\d{4}$/,
    )
    expect(drift[4]).toMatch(/ fairDailyPct=n\/a expectedFairDailyPct=n\/a$/)
  })
})
