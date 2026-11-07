import { describe, expect, it } from 'vitest'

import { MARKET_DEFINITIONS } from './index.ts'
import { TRADER_DEFINITIONS } from './traders.ts'
import { applyCommand, createGame, endDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { createMarket, stepMarketDay } from '../sim/market.ts'
import type { CalendarOutcome, MarketDefinitions, MarketState } from '../sim/types.ts'

// Information traders with the real events, calendar and placeholder trader numbers (price-model plan, Step P3).

const defs: MarketDefinitions = { ...MARKET_DEFINITIONS, traders: TRADER_DEFINITIONS }
const effects = defs.calendar!.effects

/** Day 10 is the growth release (rolled at the end of day 7). Run to day 9, set the outcome, run the release day. */
function releaseDay(seed: string, outcome: (expected: CalendarOutcome) => CalendarOutcome): { state: MarketState; before: number; expected: CalendarOutcome; actual: CalendarOutcome } {
  const state = createMarket(defs, seed)
  for (let day = 1; day <= 7; day += 1) stepMarketDay(state, defs)
  const roll = state.calendarRolls.find((item) => item.day === 10)
  if (roll === undefined) throw new Error('no roll for day 10')
  roll.outcome = outcome(roll.expected)
  for (let day = 8; day <= 9; day += 1) stepMarketDay(state, defs)
  const before = state.assets.NOVA.priceCents
  stepMarketDay(state, defs)
  return { state, before, expected: roll.expected, actual: roll.outcome }
}

/** The news traders' full-size target on the release (other events on the same day trade too, so read the key). */
function news(state: MarketState): number {
  return state.participants!.book!.eventPos['calendar:growthRelease:10|NOVA|news|target'] ?? Number.NaN
}

function percent(outcome: CalendarOutcome): number {
  return effects.find((row) => row.kind === 'growthRelease' && row.outcome === outcome && row.sector === 'A')!.percent
}

describe('calendar releases under the traders model', () => {
  it('move the price less when the result equals the consensus than when it is a surprise', () => {
    for (const seed of ['cal0', 'cal1', 'cal2', 'cal3']) {
      const same = releaseDay(seed, (expected) => expected)
      // The outcome furthest from the consensus in effect on the stock.
      const others = (['above', 'inline', 'below'] as const).filter((item) => item !== same.expected)
      const far = others.reduce((best, item) => (Math.abs(percent(item) - percent(same.expected)) > Math.abs(percent(best) - percent(same.expected)) ? item : best))
      const surprise = releaseDay(seed, () => far)
      expect(same.actual).toBe(same.expected)
      // Same seed and events: only the release outcome differs. The consensus position was already built.
      expect(Math.abs(news(same.state))).toBeLessThan(Math.abs(news(surprise.state)))
      // The news traders buy e x (public impact - priced in): a result equal to the consensus is almost all priced in.
      const efficiency = same.state.participants!.book!.efficiency
      expect(Math.abs(news(same.state))).toBeLessThan(0.3 * efficiency * Math.abs(percent(same.expected)) / 100 + 0.002)
      expect(Math.abs(news(surprise.state))).toBeGreaterThan(0.5 * efficiency * Math.abs(percent(far) - percent(same.expected)) / 100)
      // The price moves further on the surprise than on the matching result (the other events of the day are the same in both).
      const move = (run: typeof same): number => run.state.assets.NOVA.priceCents / run.before - 1
      expect(Math.abs(move(surprise) - move(same))).toBeGreaterThan(0.005)
    }
  })

  it('build the consensus position before the release and clear it afterwards', () => {
    const { state } = releaseDay('cal-keys', (expected) => expected)
    const keys = Object.keys(state.participants!.book!.eventPos).filter((key) => key.startsWith('calendar:growthRelease:10|NOVA|'))
    expect(keys.sort()).toEqual(['calendar:growthRelease:10|NOVA|consensus', 'calendar:growthRelease:10|NOVA|consensus|target', 'calendar:growthRelease:10|NOVA|news', 'calendar:growthRelease:10|NOVA|news|target'])
    for (let day = 11; day <= 40; day += 1) stepMarketDay(state, defs)
    expect(Object.keys(state.participants!.book!.eventPos).filter((key) => key.startsWith('calendar:growthRelease:10|'))).toEqual([])
  })
})

describe('information traders on the real market', () => {
  it('give the same hash for the same seed twice and stay finite over a run', () => {
    const hash = (seed: string) => {
      const state = createMarket(defs, seed)
      for (let i = 0; i < 120; i += 1) stepMarketDay(state, defs)
      for (const value of Object.values(state.participants!.book!.eventPos)) expect(Number.isFinite(value)).toBe(true)
      return stateHash(state)
    }
    expect(hash('info-det')).toBe(hash('info-det'))
    expect(hash('info-det')).not.toBe(hash('info-det2'))
  })

  it('print at End day the close the session showed, across events and releases', () => {
    const game = createGame(defs, 'info-session')
    for (let day = 0; day < 40; day += 1) {
      applyCommand(game, defs, { type: 'skip' })
      if (day % 4 === 0) applyCommand(game, defs, { type: 'order', asset: 'KSR', side: 'buy', quantity: 900, leverage: 20 })
      applyCommand(game, defs, { type: 'tick', steps: 16 })
      const printed = Object.fromEntries(Object.keys(game.market.assets).map((id) => [id, game.session.bars[id][15].close]))
      endDay(game, defs)
      for (const id of Object.keys(printed)) expect(game.market.assets[id].priceCents).toBe(printed[id])
    }
  }, 60_000)
})
