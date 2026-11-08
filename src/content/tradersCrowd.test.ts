import { describe, expect, it } from 'vitest'

import { MARKET_DEFINITIONS } from './index.ts'
import { TRADER_DEFINITIONS } from './traders.ts'
import { applyCommand, createGame, endDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { createMarket, stepMarketDay } from '../sim/market.ts'
import { depthScaleFor, loopGains, normalisedMix, planTraderStock } from '../sim/traders.ts'
import { TRADER_TYPES, type MarketDefinitions, type MarketState } from '../sim/types.ts'

// Crowd, trend, contrarians and market-maker thinning with the real events and placeholder numbers
// (price-model plan, Step P4).

const defs: MarketDefinitions = { ...MARKET_DEFINITIONS, traders: TRADER_DEFINITIONS }
const stocks = defs.assets.filter((asset) => asset.kind === 'stock')
const nova = stocks.find((asset) => asset.id === 'NOVA')!

function stepTo(state: MarketState, day: number): void {
  while (state.day < day) stepMarketDay(state, defs)
}

describe('loop gain', () => {
  // The self-reinforcing terms (trend and the crowd's return chase, times their rates) must stay below 1 plus
  // the value traders' pull per unit of gap (rate x weight / full gap), at every corner of the mix ranges
  // (each type at its minimum or maximum before normalising) and at both ends of the crowd's heat.
  it('stays below 1 + the value pull at every corner of the mix ranges', () => {
    const heat = MARKET_DEFINITIONS.participants!.crowd
    let worst = 0
    for (let corner = 0; corner < 2 ** TRADER_TYPES.length; corner += 1) {
      const draws = TRADER_TYPES.map((_, index) => (corner >> index) & 1)
      const mix = normalisedMix(TRADER_DEFINITIONS, draws)
      for (const level of [heat.heatMin, heat.heatMax]) {
        const { selfGain, valuePull } = loopGains(TRADER_DEFINITIONS, mix, level)
        worst = Math.max(worst, selfGain / (1 + valuePull))
        expect(selfGain).toBeLessThan(1 + valuePull)
      }
    }
    // Some headroom, not just under the line.
    expect(worst).toBeLessThan(0.9)
  })
})

describe('the full mix over many runs', () => {
  it('stays finite and inside 35% of the anchor over 300 seeds x 120 days', () => {
    let widest = 0
    for (let s = 0; s < 300; s += 1) {
      const state = createMarket(defs, `stable-${s}`)
      for (let d = 0; d < 120; d += 1) {
        stepMarketDay(state, defs)
        const book = state.participants!.book!
        for (const asset of stocks) {
          const price = state.assets[asset.id].priceCents
          const anchor = state.assets[asset.id].fairValue * book.carry[asset.id]
          expect(Number.isFinite(price) && Number.isFinite(anchor) && price > 0).toBe(true)
          widest = Math.max(widest, Math.abs(price / anchor - 1))
        }
      }
    }
    expect(widest).toBeLessThan(0.35)
  }, 300_000)
})

describe('crowd, trend and contrarians', () => {
  // A market at day 6 with the crowd made large (so its effect is clear against the noise).
  function prepared(seed: string): MarketState {
    const state = createMarket(defs, seed)
    stepTo(state, 6)
    state.participants!.book!.mix.crowd = 2.5
    state.participants!.heat = 1.5
    return state
  }

  it('buy a rumour and sell it when the claimed day passes with no event (false rumour)', () => {
    // The same market with and without a believed rumour of an event that never fires (claimed day 15). The
    // other types react to the pump too and single runs are noisy, so compare the mean over many seeds.
    const seeds = 40
    const id = 'earningsBeat:NOVA:15'
    const mean: number[] = Array(31).fill(0)
    let size = 0
    for (let s = 0; s < seeds; s += 1) {
      const control = prepared(`fr${s}`)
      const rumoured = prepared(`fr${s}`)
      expect(rumoured.scheduled.some((event) => event.id === id) || rumoured.active.some((effect) => effect.id === id)).toBe(false)
      rumoured.participants!.shares[id] = 1
      size += (rumoured.participants!.book!.mix.crowd * TRADER_DEFINITIONS.types.crowd.base * rumoured.participants!.heat) / seeds
      for (let day = 7; day <= 30; day += 1) {
        stepMarketDay(control, defs)
        stepMarketDay(rumoured, defs)
        mean[day] += (rumoured.assets.NOVA.priceCents / control.assets.NOVA.priceCents - 1) / seeds
      }
      // The leg is gone once the claimed day has passed.
      expect(`${id}|NOVA|crowd` in rumoured.participants!.book!.eventPos).toBe(false)
    }
    const peak = Math.max(...mean.slice(8, 13))
    // Pumped before the claimed day ...
    expect(peak).toBeGreaterThan(0.25 * size)
    // ... sold on and after it (the price falls from the peak to below the unrumoured run) ...
    expect(Math.min(...mean.slice(15, 20))).toBeLessThan(0.25 * peak)
    // ... and the difference does not last.
    expect(Math.abs(mean[22]) + Math.abs(mean[23]) + Math.abs(mean[24])).toBeLessThan(3 * peak)
  })

  it('lets a hot rumour that came true close red on its event day', () => {
    let red = 0
    let tried = 0
    for (let s = 0; s < 400 && tried < 8; s += 1) {
      const state = createMarket(defs, `hot-${s}`)
      stepTo(state, 3)
      // An up event on one stock, rolled at the end of the last step, firing a few days later.
      const event = state.scheduled.find((item) => item.direction === 'up' && item.target === 'NOVA' && item.typeId === 'earningsBeat')
      if (event === undefined) continue
      tried += 1
      state.participants!.book!.mix.crowd = 2.5
      state.participants!.heat = 1.5
      state.participants!.shares[event.id] = 1
      stepTo(state, event.eventDay - 1)
      const book = state.participants!.book!
      expect(book.eventPos[`${event.id}|NOVA|crowd`]).toBeGreaterThan(0)
      const before = state.assets.NOVA.priceCents
      stepMarketDay(state, defs)
      // The news target is efficiency x (public impact - what the crowd already holds), so much smaller than unrumoured.
      expect(book.eventPos[`${event.id}|NOVA|news|target`]).toBeLessThan(book.efficiency * 0.05)
      if (state.assets.NOVA.priceCents < before) red += 1
      expect(`${event.id}|NOVA|crowd` in book.eventPos).toBe(false)
    }
    expect(tried).toBeGreaterThanOrEqual(3)
    expect(red).toBeGreaterThanOrEqual(1)
  })

  it('trend buys a rising stock, contrarians fade a stretched move, and the crowd capitulates at a bottom', () => {
    const state = createMarket(defs, 'unit')
    stepTo(state, 12)
    const price = state.assets.NOVA.priceCents
    // closes: the last entry is the stock's price, the history before it; the plan pushes the price itself first.
    const fresh = (closes: number[], mood: number): ReturnType<typeof planTraderStock> => {
      const copy = structuredClone(state)
      copy.participants!.book!.history!.NOVA = closes.slice(0, -1)
      for (const type of TRADER_TYPES) copy.participants!.book!.pos.NOVA[type] = 0
      copy.participants!.book!.lastFlow.NOVA = 0
      copy.participants!.mood.NOVA = mood
      copy.assets.NOVA.priceCents = closes[closes.length - 1]
      return planTraderStock(copy, defs, nova, 0, 0)
    }
    // Rising 8% over the last five days: trend buys, contrarians sell, the crowd (feed mood 0) chases the return.
    const up = Array.from({ length: 11 }, (_, i) => price * (0.88 + 0.016 * i))
    const rising = fresh(up, 0)
    expect(rising.dq.trend).toBeGreaterThan(0)
    expect(rising.dq.contrarian).toBeLessThan(0)
    expect(rising.dq.crowd).toBeGreaterThan(0)
    // A fall of 15% over ten days with positive feed mood: the crowd capitulates (mood -0.5) and sells.
    const down = Array.from({ length: 11 }, (_, i) => price * (1.05 - 0.015 * i))
    const falling = fresh(down, 0.8)
    expect(falling.crowdMood).toBeCloseTo(-0.5, 6)
    expect(falling.dq.crowd).toBeLessThan(0)
    expect(falling.dq.trend).toBeLessThan(0)
    // Mood stays inside the clamp whatever the feed says.
    expect(Math.abs(fresh(up, 5).crowdMood)).toBeLessThanOrEqual(TRADER_DEFINITIONS.crowdMoodClamp)
  })

  it('thins market-maker depth after a volatile stretch and keeps the volatility average up to date', () => {
    expect(depthScaleFor(TRADER_DEFINITIONS, nova.dailyVolatility, nova.dailyVolatility)).toBe(1)
    const thin = depthScaleFor(TRADER_DEFINITIONS, nova.dailyVolatility * 3, nova.dailyVolatility)
    expect(thin).toBeLessThan(1)
    expect(thin).toBeGreaterThanOrEqual(TRADER_DEFINITIONS.depthScaleMin)
    const state = createMarket(defs, 'vol')
    stepTo(state, 30)
    for (const asset of stocks) expect(state.participants!.book!.vol[asset.id]).toBeGreaterThan(0)
  })

  it('keeps writing the crowd mood and the closes that the social feed and liquidity grabs read', () => {
    const state = createMarket(defs, 'mood-seed')
    let moods = 0
    for (let day = 0; day < 60; day += 1) {
      stepMarketDay(state, defs)
      if (Object.values(state.participants!.mood).some((value) => value !== 0)) moods += 1
    }
    expect(moods).toBeGreaterThan(0)
    expect(state.participants!.closes.NOVA.length).toBeGreaterThan(0)
    expect(state.participants!.book!.history!.NOVA.length).toBeGreaterThan(5)
  })

  it('stays deterministic and prints at End day the close the session showed', () => {
    const hash = (seed: string) => {
      const state = createMarket(defs, seed)
      for (let i = 0; i < 90; i += 1) stepMarketDay(state, defs)
      return stateHash(state)
    }
    expect(hash('crowd-det')).toBe(hash('crowd-det'))
    const game = createGame(defs, 'crowd-session')
    for (let day = 0; day < 30; day += 1) {
      applyCommand(game, defs, { type: 'skip' })
      applyCommand(game, defs, { type: 'tick', steps: 16 })
      const printed = Object.fromEntries(Object.keys(game.market.assets).map((id) => [id, game.session.bars[id][15].close]))
      endDay(game, defs)
      for (const id of Object.keys(printed)) expect(game.market.assets[id].priceCents).toBe(printed[id])
    }
  })
})
