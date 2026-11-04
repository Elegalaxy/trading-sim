import { describe, expect, it } from 'vitest'

import { RUN_LENGTH_DAYS, SESSION_STEPS } from './constants.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { assertPast, previewCopy } from './past.ts'
import { tradingEquity } from './trading.ts'
import type { GameState, MarketDefinitions, PastDay } from './types.ts'

const defs: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
    { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
}

function row(game: GameState, index: number): PastDay {
  const found = game.past[index]
  if (found === undefined) throw new Error(`no past row ${index}`)
  return found
}

describe('closed-day record', () => {
  it('starts empty and adds one row per End day with the session, the closes and the equity', () => {
    const game = createGame(defs, 'demo')
    expect(game.past).toEqual([])
    const session = structuredClone(game.session.bars)
    endDay(game, defs)
    expect(game.past).toHaveLength(1)
    const first = row(game, 0)
    expect(first.day).toBe(1)
    expect(first.bars).toEqual(session)
    expect(first.bars.NOVA).toHaveLength(SESSION_STEPS)
    expect(first.prices.NOVA).toBe(game.market.assets.NOVA?.priceCents)
    expect(first.prices.M4X).toBe(game.market.assets.M4X?.priceCents)
    expect(first.equityCents).toBe(tradingEquity(game, defs).equity)
    // The last bar of the session closes at the price End day printed.
    expect(first.bars.NOVA?.at(-1)?.close).toBe(first.prices.NOVA)
    endDay(game, defs)
    endDay(game, defs)
    expect(game.past.map((entry) => entry.day)).toEqual([1, 2, 3])
    expect(() => assertPast(game.past)).not.toThrow()
  })

  it('keeps the closing equity of a day that held a position', () => {
    const game = createGame(defs, 'demo')
    applyCommand(game, defs, { type: 'skip' })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 20 })
    endDay(game, defs)
    expect(row(game, 0).equityCents).toBe(tradingEquity(game, defs).equity)
  })

  it('is a record only: the market hash and a run without it are the same', () => {
    const a = createGame(defs, 'same')
    const b = createGame(defs, 'same')
    for (let day = 0; day < 10; day += 1) endDay(a, defs)
    for (let day = 0; day < 10; day += 1) endDay(b, defs)
    b.past = []
    expect(stateHash(a.market)).toBe(stateHash(b.market))
    expect(a.accounts).toEqual(b.accounts)
  })

  it('copies the bars, so later edits to the session do not change a past row', () => {
    const game = createGame(defs, 'demo')
    endDay(game, defs)
    const kept = structuredClone(row(game, 0).bars)
    const bar = game.session.bars.NOVA?.[0]
    if (bar === undefined) throw new Error('no session bar')
    bar.open += 100
    expect(row(game, 0).bars).toEqual(kept)
  })

  it('previewCopy leaves out the records and does not touch the game', () => {
    const game = createGame(defs, 'demo')
    applyCommand(game, defs, { type: 'skip' })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 5 })
    endDay(game, defs)
    const copy = previewCopy(game)
    expect(copy.past).toEqual([])
    expect(copy.fills).toEqual([])
    expect(game.past).toHaveLength(1)
    expect(game.fills).toHaveLength(1)
    expect(copy.accounts).toEqual(game.accounts)
    expect(copy.market).toEqual(game.market)
  })

  it('checks its own shape', () => {
    const game = createGame(defs, 'demo')
    endDay(game, defs)
    const good = row(game, 0)
    expect(() => assertPast([{ ...good, day: 0 }])).toThrow(/day must rise/)
    expect(() => assertPast([good, { ...good }])).toThrow(/day must rise/)
    expect(() => assertPast([{ ...good, equityCents: 1.5 }])).toThrow(/equityCents/)
    expect(() => assertPast([{ ...good, prices: { NOVA: 0 } }])).toThrow(/price of NOVA/)
    expect(() => assertPast([{ ...good, bars: { NOVA: [{ open: 1, high: 1, low: 1, close: 1 }] } }])).toThrow(/volume/)
    expect(() => assertPast({})).toThrow(/array/)
    expect(() => assertPast(Array.from({ length: RUN_LENGTH_DAYS + 1 }, (_, i) => ({ ...good, day: i + 1 })))).toThrow(/over the run length/)
  })
})
