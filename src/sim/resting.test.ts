import { describe, expect, it } from 'vitest'

import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { formatEvent } from './log.ts'
import { assertResting, MAX_EXIT_LEVELS, MAX_RESTING_ORDERS, upgradeResting } from './resting.ts'
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
    return { open: bar[0], high: bar[1], low: bar[2], close: bar[3], volume: 1_000_000_000 }
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

/** NOVA exit levels as [price, quantity] pairs per kind, in stored order. */
function prices(game: GameState): { side: string; takeProfit: Array<[number, number | null]>; stopLoss: Array<[number, number | null]> } | null {
  const exit = game.resting.exits.NOVA
  if (exit === undefined) return null
  const pick = (kind: string) =>
    exit.levels.filter((level) => level.kind === kind).map((level): [number, number | null] => [level.priceCents, level.quantity])
  return { side: exit.side, takeProfit: pick('takeProfit'), stopLoss: pick('stopLoss') }
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
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [[5000, null]], stopLoss: [[4600, null]] })
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
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [], stopLoss: [[4600, null]] })
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
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [], stopLoss: [[4600, null]] })
  })
})

describe('partial and multi-level exits', () => {
  function long10(spec: Record<number, Bar>): GameState {
    const game = opened(spec)
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10 })
    return game
  }

  function addExit(game: GameState, kind: string, priceCents: number, quantity?: number): void {
    applyCommand(game, defs, { type: 'addExit', asset: 'NOVA', kind, priceCents, ...(quantity === undefined ? {} : { quantity }) })
  }

  function realizedAfter(game: GameState, filled: RestingEvent): number | null {
    const index = game.log.indexOf(filled)
    const next = game.log[index + 1]
    return next?.kind === 'realized' ? next.amount : null
  }

  it('closes only its quantity, keeps the entry average, then the next level closes the rest', () => {
    const game = long10({ 2: [4800, 5100, 4800, 5000], 4: [5000, 5300, 5000, 5200] })
    addExit(game, 'takeProfit', 5000, 4)
    addExit(game, 'takeProfit', 5200)
    applyCommand(game, defs, { type: 'setExits', asset: 'NOVA', slCents: 4600 })
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [[5000, 4], [5200, null]], stopLoss: [[4600, null]] })
    const cost = game.positions.NOVA.costCents
    const cash = game.accounts.tradingCents

    applyCommand(game, defs, { type: 'tick', steps: 3 })
    expect(game.positions.NOVA.signedShares).toBe(6)
    expect(game.positions.NOVA.costCents).toBe(cost - Math.round((cost * 4) / 10))
    expect(game.accounts.tradingCents).toBe(cash + 20000 - 20)
    const first = resting(game).at(-1) as RestingEvent
    expect(first).toMatchObject({ action: 'filled', detail: 'takeProfit', quantity: 4, priceCents: 5000, fee: 20, time: '17:30' })
    expect(realizedAfter(game, first)).toBe(20000 - Math.round((cost * 4) / 10))
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [[5200, null]], stopLoss: [[4600, null]] })

    applyCommand(game, defs, { type: 'tick', steps: 2 })
    expect(game.positions.NOVA).toBeUndefined()
    expect(game.resting.exits.NOVA).toBeUndefined()
    expect(resting(game).at(-1)).toMatchObject({ detail: 'takeProfit', quantity: 6, priceCents: 5200 })
  })

  it('fills every level one bar reaches, nearest the open first, at the better open on a gap', () => {
    const swept = long10({ 0: [4800, 5300, 4800, 5250] })
    addExit(swept, 'takeProfit', 5200, 3)
    addExit(swept, 'takeProfit', 5000, 4)
    applyCommand(swept, defs, { type: 'tick', steps: 1 })
    expect(resting(swept).slice(-2).map((event) => [event.priceCents, event.quantity])).toEqual([
      [5000, 4],
      [5200, 3],
    ])
    expect(swept.positions.NOVA.signedShares).toBe(3)
    expect(swept.resting.exits.NOVA).toBeUndefined()

    const gapped = long10({ 0: [5400, 5400, 5400, 5400] })
    addExit(gapped, 'takeProfit', 5000, 4)
    addExit(gapped, 'takeProfit', 5200, 4)
    applyCommand(gapped, defs, { type: 'tick', steps: 1 })
    expect(resting(gapped).slice(-2).map((event) => event.priceCents)).toEqual([5400, 5400])
    expect(gapped.positions.NOVA.signedShares).toBe(2)
  })

  it('fills only the stops when one bar touches both kinds, highest stop first for a long', () => {
    const game = long10({ 0: [4800, 5100, 4400, 4800] })
    addExit(game, 'takeProfit', 5000, 4)
    addExit(game, 'stopLoss', 4500, 3)
    addExit(game, 'stopLoss', 4600, 3)
    applyCommand(game, defs, { type: 'tick', steps: 1 })
    expect(resting(game).slice(-2).map((event) => [event.detail, event.priceCents, event.quantity])).toEqual([
      ['stopLoss', 4600, 3],
      ['stopLoss', 4500, 3],
    ])
    expect(game.positions.NOVA.signedShares).toBe(4)
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [[5000, 4]], stopLoss: [] })
  })

  it('works for a short, lowest target first', () => {
    const game = opened({ 1: [4800, 4800, 4400, 4500] })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 10 })
    addExit(game, 'takeProfit', 4600, 5)
    addExit(game, 'takeProfit', 4500, 5)
    addExit(game, 'stopLoss', 5000, 5)
    applyCommand(game, defs, { type: 'tick', steps: 2 })
    expect(resting(game).slice(-2).map((event) => [event.priceCents, event.side])).toEqual([
      [4600, 'buy'],
      [4500, 'buy'],
    ])
    expect(game.positions.NOVA).toBeUndefined()
    expect(game.resting.exits.NOVA).toBeUndefined()
  })

  it('rejects a bad kind, size, side or too many levels', () => {
    const game = long10({})
    addExit(game, 'trailing', 5000)
    expect(rejection(game)).toBe('exitKindInvalid')
    addExit(game, 'takeProfit', 5000, 11)
    expect(rejection(game)).toBe('exitQuantityTooLarge')
    addExit(game, 'takeProfit', 5000, 0)
    expect(rejection(game)).toBe('quantityNotInteger')
    addExit(game, 'stopLoss', 4900, 2)
    expect(rejection(game)).toBe('stopLossWrongSide')
    for (let i = 0; i < MAX_EXIT_LEVELS; i += 1) addExit(game, 'takeProfit', 5000 + i * 100, 1)
    addExit(game, 'takeProfit', 6000, 1)
    expect(rejection(game)).toBe('tooManyExits')
    applyCommand(game, defs, { type: 'setExits', asset: 'NOVA', tpCents: 6000 })
    expect(rejection(game)).toBe('tooManyExits')
    applyCommand(game, defs, { type: 'setExits', asset: 'NOVA', slCents: 4600 })
    expect(prices(game)?.stopLoss).toEqual([[4600, null]])
  })

  it('cancels one level by id', () => {
    const game = long10({})
    addExit(game, 'takeProfit', 5000, 4)
    addExit(game, 'stopLoss', 4600)
    const [tp, sl] = game.resting.exits.NOVA.levels
    applyCommand(game, defs, { type: 'cancelExit', asset: 'NOVA', id: tp.id })
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [], stopLoss: [[4600, null]] })
    expect(resting(game).at(-1)).toMatchObject({ action: 'cancelled', detail: 'takeProfit', quantity: 4 })
    applyCommand(game, defs, { type: 'cancelExit', asset: 'NOVA', id: tp.id })
    expect(rejection(game)).toBe('noSuchExit')
    applyCommand(game, defs, { type: 'cancelExit', asset: 'NOVA', id: sl.id })
    expect(game.resting.exits.NOVA).toBeUndefined()
  })

  it('shrinks levels when the position is reduced, keeps them when it grows, drops them on close or flip', () => {
    const game = long10({})
    addExit(game, 'takeProfit', 5000, 8)
    addExit(game, 'stopLoss', 4600, 3)
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 5 })
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [[5000, 5]], stopLoss: [[4600, 3]] })
    const resized = resting(game).at(-1) as RestingEvent
    expect(resized).toMatchObject({ action: 'resized', detail: 'takeProfit', quantity: 5, reason: 'positionReduced' })
    expect(formatEvent(resized)).toBe('day=0 kind=resting action=resized asset=NOVA detail=takeProfit side=sell quantity=5 price=5000 fee=0 reason=positionReduced')
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 5 })
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [[5000, 5]], stopLoss: [[4600, 3]] })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 10 })
    expect(game.resting.exits.NOVA).toBeUndefined()
    expect(resting(game).filter((event) => event.reason === 'positionClosed')).toHaveLength(2)

    const flipped = long10({})
    addExit(flipped, 'takeProfit', 5000, 4)
    applyCommand(flipped, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 20 })
    expect(flipped.positions.NOVA.signedShares).toBe(-10)
    expect(flipped.resting.exits.NOVA).toBeUndefined()
  })

  it('shrinks the rest after a partial stop, so a later level never closes more than is open', () => {
    const game = long10({ 1: [4800, 4800, 4550, 4600] })
    addExit(game, 'stopLoss', 4600, 6)
    addExit(game, 'takeProfit', 5000, 8)
    applyCommand(game, defs, { type: 'tick', steps: 2 })
    expect(game.positions.NOVA.signedShares).toBe(4)
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [[5000, 4]], stopLoss: [] })
  })

  it('attaches a partial take profit from a filled limit', () => {
    const game = opened({ 1: [4800, 4800, 4700, 4700], 3: [4700, 5100, 4700, 5000] })
    const limit = { type: 'limitOrder', asset: 'NOVA', side: 'buy', quantity: 10, limitCents: 4700, tpCents: 5000, slCents: 4600 }
    applyCommand(game, defs, { ...limit, tpQuantity: 11 })
    expect(rejection(game)).toBe('exitQuantityTooLarge')
    applyCommand(game, defs, { ...limit, tpQuantity: 4 })
    expect(game.resting.orders[0]).toMatchObject({ tpQuantity: 4 })
    applyCommand(game, defs, { type: 'tick', steps: 2 })
    expect(prices(game)).toEqual({ side: 'long', takeProfit: [[5000, 4]], stopLoss: [[4600, null]] })
    applyCommand(game, defs, { type: 'tick', steps: 2 })
    expect(game.positions.NOVA.signedShares).toBe(6)
    expect(resting(game).at(-1)).toMatchObject({ detail: 'takeProfit', quantity: 4, priceCents: 5000 })
  })
})

describe('exits from old saves', () => {
  it('reads a level without a quantity as the whole position', () => {
    const game = long10Plain()
    game.resting.exits.NOVA = { side: 'long', levels: [{ id: game.resting.nextId, kind: 'takeProfit', priceCents: 5000, quantity: null }] }
    game.resting.nextId += 1
    applyCommand(game, defs, { type: 'tick', steps: 3 })
    expect(game.positions.NOVA).toBeUndefined()
    expect(resting(game).at(-1)).toMatchObject({ detail: 'takeProfit', quantity: 10 })
  })

  it('upgrades the old one-TP-one-SL shape to whole-position levels', () => {
    const game = long10Plain()
    const legacy = { nextId: 3, orders: [], exits: { NOVA: { side: 'long', tpCents: 5000, slCents: null } } }
    expect(() => assertResting(legacy as unknown as GameState['resting'])).toThrow('resting exit for NOVA is not valid')
    const upgraded = upgradeResting(legacy)
    expect(upgraded).toEqual({
      nextId: 4,
      orders: [],
      exits: { NOVA: { side: 'long', levels: [{ id: 3, kind: 'takeProfit', priceCents: 5000, quantity: null }] } },
    })
    expect(legacy.exits.NOVA).toEqual({ side: 'long', tpCents: 5000, slCents: null })
    game.resting = upgraded
    applyCommand(game, defs, { type: 'tick', steps: 3 })
    expect(game.positions.NOVA).toBeUndefined()
    expect(upgradeResting(game.resting)).toEqual(game.resting)
  })

  function long10Plain(): GameState {
    const game = opened({ 2: [4800, 5100, 4800, 5000] })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10 })
    return game
  }
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
