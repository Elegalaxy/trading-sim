import { describe, expect, it } from 'vitest'

import { MARKET_DEFINITIONS } from './index.ts'
import { TRADER_DEFINITIONS } from './traders.ts'
import { applyCommand, createGame, endDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { createMarket, stepMarketDay } from '../sim/market.ts'
import { createRng, nextNormal } from '../sim/rng.ts'
import { valueTarget } from '../sim/traders.ts'
import type { MarketDefinitions } from '../sim/types.ts'

// Traders model with the real events, calendar and placeholder trader numbers (price-model plan, Step P2).
// Only the value and noise types trade at this step.

const defs: MarketDefinitions = { ...MARKET_DEFINITIONS, traders: TRADER_DEFINITIONS }
const stocks = defs.assets.filter((asset) => asset.kind === 'stock')

describe('traders model on the real market', () => {
  it('leaves the current market unchanged when traders are not in the definitions', () => {
    // P6: MARKET_DEFINITIONS now carries traders, so the old model is the same set with traders removed.
    const { traders: _traders, ...old } = MARKET_DEFINITIONS
    const a = createMarket(old, 'same')
    const b = createMarket(old, 'same')
    for (let i = 0; i < 30; i += 1) {
      stepMarketDay(a, old)
      stepMarketDay(b, old)
    }
    expect(a.participants?.book).toBeUndefined()
    expect(stateHash(a)).toBe(stateHash(b))
  })

  it('prints at End day the close the session showed, with orders in the day', () => {
    const game = createGame(defs, 'real-session')
    for (let day = 0; day < 20; day += 1) {
      applyCommand(game, defs, { type: 'skip' })
      if (day % 3 === 0) applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1200, leverage: 50 })
      applyCommand(game, defs, { type: 'tick', steps: 16 })
      const printed = Object.fromEntries(Object.keys(game.market.assets).map((id) => [id, game.session.bars[id][15].close]))
      endDay(game, defs)
      for (const id of Object.keys(printed)) expect(game.market.assets[id].priceCents).toBe(printed[id])
    }
  })

  it('gives the same hash for the same seed twice', () => {
    const hash = (seed: string) => {
      const state = createMarket(defs, seed)
      for (let i = 0; i < 120; i += 1) stepMarketDay(state, defs)
      return stateHash(state)
    }
    expect(hash('det')).toBe(hash('det'))
    expect(hash('det')).not.toBe(hash('det2'))
  })

  // The plan asks for the mean daily log change of anchor and price to be within 0.01% of the premium.
  // `carryCorrectionPerDay` removes the two second-order effects that `expectedDrift` leaves out (see
  // `types.ts`). With 50 seeds x 1,000 days x 4 stocks the standard error is about 0.01, so the test
  // allows 0.02 around the premium and requires the price to follow the anchor to within 0.01.
  it('keeps the mean daily log change of the anchor near the premium and the price near the anchor', () => {
    const seeds = 50
    const days = 1000
    let anchorSum = 0
    let priceSum = 0
    let count = 0
    for (let s = 0; s < seeds; s += 1) {
      const market = createMarket(defs, `drift-${s}`)
      const start = new Map(stocks.map((asset) => [asset.id, { anchor: market.assets[asset.id].fairValue, price: market.assets[asset.id].priceCents }]))
      for (let d = 0; d < days; d += 1) stepMarketDay(market, defs)
      const book = market.participants!.book!
      for (const asset of stocks) {
        const first = start.get(asset.id)!
        const anchor = market.assets[asset.id].fairValue * book.carry[asset.id]
        anchorSum += Math.log(anchor / first.anchor) / days
        priceSum += Math.log(market.assets[asset.id].priceCents / first.price) / days
        count += 1
      }
    }
    const anchorPct = (anchorSum / count) * 100
    const pricePct = (priceSum / count) * 100
    // 0.0005 is the correction measured in P2b that puts the anchor's mean log change at the premium; P5
    // lowers it on purpose so the held index drifts 0 to +4% in 120 days, which moves the anchor by the same amount.
    const neutralCorrection = 0.0005
    const expectedPct = (TRADER_DEFINITIONS.premiumPerDay + (TRADER_DEFINITIONS.carryCorrectionPerDay ?? 0) - neutralCorrection) * 100
    expect(Math.abs(anchorPct - expectedPct)).toBeLessThan(0.02)
    expect(Math.abs(pricePct - anchorPct)).toBeLessThan(0.01)
  }, 120_000)

  // The value loop trades the gap (price-model plan, P2b). Check it is stable over the whole mix range:
  // alone it converges without crossing the anchor by more than the dead band, and with the AR(1) noise
  // traders the gap stays bounded and its spread does not grow between the first and second half.
  describe('value loop stability', () => {
    const t = TRADER_DEFINITIONS
    const cap = 0.08
    const weights = [0.5, 0.75, 1, 1.25, 1.5].map((mix) => t.types.value.base * mix)
    const step = (price: number, anchor: number, weight: number, extra: number): number => {
      const demand = t.types.value.rate * valueTarget(t, weight, price, anchor) + extra
      return price * (1 + Math.max(-cap, Math.min(cap, demand)))
    }

    it('converges to the anchor without oscillating, from small and deep gaps', () => {
      for (const weight of weights) {
        for (const start of [0.9, 0.7, 0.5, 1.1, 1.3, 2, 4]) {
          let price = 100 * start
          let crossings = 0
          let last = Math.sign(100 / price - 1)
          for (let day = 0; day < 200; day += 1) {
            price = step(price, 100, weight, 0)
            expect(Number.isFinite(price)).toBe(true)
            const sign = Math.sign(100 / price - 1)
            if (sign !== 0 && last !== 0 && sign !== last) crossings += 1
            if (sign !== 0) last = sign
          }
          expect(crossings).toBeLessThanOrEqual(1)
          expect(Math.abs(100 / price - 1)).toBeLessThanOrEqual(t.valueDeadBand + 1e-9)
        }
      }
    })

    it('stays bounded with noise traders across the mix range', () => {
      const stream = createRng('value-noise-stability').market
      for (const weight of weights) {
        for (const noiseMix of [0.5, 1, 1.5]) {
          const sigma = 0.02 * t.noiseShare * noiseMix
          let price = 100
          let noisePos = 0
          const gaps: number[] = []
          for (let day = 0; day < 6000; day += 1) {
            const dq = t.types.noise.rate * (t.noiseAr * noisePos + sigma * nextNormal(stream) - noisePos)
            noisePos += dq
            price = step(price, 100, weight, dq)
            expect(Number.isFinite(price) && price > 0).toBe(true)
            gaps.push(Math.abs(100 / price - 1))
          }
          const sd = (from: number, to: number): number => Math.sqrt(gaps.slice(from, to).reduce((sum, g) => sum + g * g, 0) / (to - from))
          expect(Math.max(...gaps)).toBeLessThan(0.25)
          expect(sd(3000, 6000)).toBeLessThan(sd(0, 3000) * 1.25)
        }
      }
    })
  })
})
