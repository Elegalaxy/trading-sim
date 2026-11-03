import { describe, expect, it } from 'vitest'

import { applyCommand, createGame, endDay } from './game.ts'
import { assertFills, closeTime, FILLS_MAX } from './fills.ts'
import { settleMissedLoanInterest } from './loan.ts'
import type { FillRecord, GameState, LiquidationEvent, MarketDefinitions, OrderFillEvent } from './types.ts'

const defs: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
    { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018, spreadPpm: 1000, borrowFeePpm: 100 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
}

type Bar = [open: number, high: number, low: number, close: number]

/** Flat NOVA bars at the open price, except the ones given by index. Deep volume, so no slippage. */
function setBars(game: GameState, spec: Record<number, Bar>): void {
  const price = game.market.assets.NOVA.priceCents
  game.session.bars.NOVA = Array.from({ length: 16 }, (_, i) => {
    const bar = spec[i] ?? [price, price, price, price]
    return { open: bar[0], high: bar[1], low: bar[2], close: bar[3], volume: 1_000_000_000 }
  })
}

function opened(spec: Record<number, Bar> = {}, seed = 'demo'): GameState {
  const game = createGame(defs, seed)
  applyCommand(game, defs, { type: 'skip' })
  setBars(game, spec)
  return game
}

function fillEvents(game: GameState): OrderFillEvent[] {
  return game.log.filter((event): event is OrderFillEvent => event.kind === 'orderFill')
}

function last(game: GameState): FillRecord {
  const row = game.fills.at(-1)
  if (row === undefined) throw new Error('the fill ledger is empty')
  return row
}

describe('fill ledger', () => {
  it('starts empty and numbers rows from 1', () => {
    expect(createGame(defs, 'demo').fills).toEqual([])
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10 })
    applyCommand(game, defs, { type: 'order', asset: 'BLSW', side: 'buy', quantity: 2 })
    expect(game.fills.map((row) => row.n)).toEqual([1, 2])
  })

  it('records a market order that opens, then one that closes with its P&L', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10 })
    const opening = last(game)
    const fill = fillEvents(game)[0]
    expect(opening).toMatchObject({ asset: 'NOVA', side: 'buy', quantity: 10, via: 'market', realizedCents: null, time: '17:00', day: 0 })
    expect(opening.fillCents).toBe(fill?.fillPrice)
    expect(opening.feeCents).toBe(fill?.fee)
    expect(opening.slippageCents).toBe(0)

    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 10 })
    const closing = last(game)
    const realized = game.log.find((event) => event.kind === 'realized')
    expect(closing).toMatchObject({ side: 'sell', via: 'market' })
    expect(closing.realizedCents).toBe(realized?.kind === 'realized' ? realized.amount : null)
    expect(game.fills).toHaveLength(2)
  })

  it('keeps nothing for a rejected order', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 0 })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1_000_000_000 })
    expect(game.fills).toEqual([])
  })

  it('records the slippage a large order paid', () => {
    const game = createGame(defs, 'demo')
    applyCommand(game, defs, { type: 'skip' })
    game.session.bars.NOVA = game.session.bars.NOVA.map((bar) => ({ ...bar, volume: 100 }))
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 60 })
    const fill = fillEvents(game)[0]
    expect(fill?.slippage).toBeGreaterThan(0)
    expect(last(game).slippageCents).toBe(fill?.slippage)
  })

  it('records a limit fill at its own price and bar time', () => {
    const game = opened({ 3: [4800, 4800, 4600, 4800] })
    applyCommand(game, defs, { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 10, limitCents: 4700 })
    expect(game.fills).toEqual([])
    applyCommand(game, defs, { type: 'tick', steps: 4 })
    expect(last(game)).toMatchObject({ asset: 'NOVA', side: 'buy', quantity: 10, fillCents: 4700, via: 'limit', time: '17:45', realizedCents: null })
  })

  it('records take profit and stop loss fills, a partial exit included', () => {
    const game = opened({ 2: [4800, 5100, 4800, 5000], 5: [5000, 5000, 4400, 4500] })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10 })
    applyCommand(game, defs, { type: 'addExit', asset: 'NOVA', kind: 'takeProfit', priceCents: 5000, quantity: 4 })
    applyCommand(game, defs, { type: 'addExit', asset: 'NOVA', kind: 'stopLoss', priceCents: 4500 })
    applyCommand(game, defs, { type: 'tick', steps: 6 })
    const exits = game.fills.filter((row) => row.via === 'takeProfit' || row.via === 'stopLoss')
    expect(exits.map((row) => [row.via, row.side, row.quantity, row.fillCents, row.time])).toEqual([
      ['takeProfit', 'sell', 4, 5000, '17:30'],
      ['stopLoss', 'sell', 6, 4500, '18:15'],
    ])
    expect(exits[0]?.realizedCents).toBeGreaterThan(0)
    expect(exits[1]?.realizedCents).toBeLessThan(0)
    expect(game.positions.NOVA).toBeUndefined()
  })

  it('records a liquidation with the trade fee and the liquidation fee together', () => {
    // A flat session, then a 3% drop from bar 5 on: a move that wipes a 50x margin.
    const game = opened({ 5: [4656, 4656, 4656, 4656], 6: [4656, 4656, 4656, 4656] })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 2500, leverage: 50 })
    applyCommand(game, defs, { type: 'tick', steps: 6 })
    const event = game.log.find((entry): entry is LiquidationEvent => entry.kind === 'liquidation')
    expect(event).toBeDefined()
    const row = last(game)
    expect(row).toMatchObject({ asset: 'NOVA', side: 'sell', quantity: 2500, via: 'liquidation', time: '18:15' })
    expect(row.fillCents).toBe(event?.fill)
    expect(row.feeCents).toBeGreaterThan(event?.fee ?? 0)
    expect(row.realizedCents).toBeLessThan(0)
  })

  it('records a forced sale for missed loan interest at the close', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    game.loan.balanceCents = 100_000
    game.loan.interestDueCents = 100
    game.loan.interestDay = game.market.day
    game.accounts.cashCents = 0
    game.accounts.savingsCents = 0
    settleMissedLoanInterest(game, defs)
    expect(last(game)).toMatchObject({ asset: 'NOVA', side: 'sell', quantity: 1, via: 'forcedSale', time: closeTime() })
    expect(closeTime()).toBe('20:45')
  })

  it('does not record a bill preview', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 5 })
    const before = structuredClone(game.fills)
    // The cover check at month end closes positions on a scratch copy only.
    for (let day = 0; day < 31 && game.bill === null && game.runEnd === null; day += 1) endDay(game, defs)
    expect(game.fills.slice(0, before.length)).toEqual(before)
    expect(game.fills.every((row) => row.via !== 'forcedSale')).toBe(true)
  })

  it('gives the same rows for the same seed and commands', () => {
    const run = (): FillRecord[] => {
      const game = opened({ 3: [4800, 4900, 4700, 4800] }, 'same')
      applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 7, leverage: 5 })
      applyCommand(game, defs, { type: 'addExit', asset: 'NOVA', kind: 'takeProfit', priceCents: 4900 })
      applyCommand(game, defs, { type: 'tick', steps: 16 })
      endDay(game, defs)
      return game.fills
    }
    expect(run()).toEqual(run())
    expect(run().length).toBeGreaterThan(1)
  })

  it('changes no market or session state', () => {
    const quiet = opened()
    const busy = opened()
    applyCommand(busy, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10 })
    expect(busy.market).toEqual(quiet.market)
    expect(busy.session).toEqual(quiet.session)
  })

  it('checks its own shape', () => {
    const game = opened()
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10 })
    expect(() => assertFills(game.fills)).not.toThrow()
    const row = game.fills[0] as FillRecord
    expect(() => assertFills([{ ...row, n: 2 }])).toThrow(/numbered/)
    expect(() => assertFills([{ ...row, via: 'sneaky' }])).toThrow(/via/)
    expect(() => assertFills([{ ...row, quantity: 0 }])).toThrow(/non-positive/)
    expect(() => assertFills([{ ...row, time: '7:5' }])).toThrow(/HH:MM/)
    expect(() => assertFills([{ ...row, realizedCents: 1.5 }])).toThrow(/realizedCents/)
    expect(() => assertFills(Array.from({ length: FILLS_MAX + 1 }, (_, i) => ({ ...row, n: i + 1 })))).toThrow(/limit/)
  })
})
