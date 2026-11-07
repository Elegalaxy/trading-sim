import { describe, expect, it } from 'vitest'

import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { depthScaleFor, traderModelOn, valueTarget } from './traders.ts'
import type {
  MarketDefinitions,
  MarketState,
  ParticipantFlowEvent,
  ParticipantDefinitions,
  PriceStepEvent,
  TraderDefinitions,
} from './types.ts'

// Traders model core engine (price-model plan, Step P2). Inline definitions: src/sim may not import content.

const PARTICIPANTS: ParticipantDefinitions = {
  depthDays: 10,
  informed: { capitalCents: 15_000_000, regimeMin: 1, regimeMax: 1, magnitudeRefPercent: 5 },
  news: { efficiencyMin: 0.5, efficiencyMax: 0.5 },
  consensus: { capitalCents: 1, magnitudeRefPercent: 3 },
  crowd: { capitalCents: 1, heatMin: 1, heatMax: 1, tierWeight: { low: 0.3, medium: 0.6, high: 1 }, headlineWeight: 0.5, chaseDecay: 0.5 },
  momentum: { capitalCents: 1, lookbackDays: 3, thresholdPercent: 3 },
}

function traders(valueBase: number): TraderDefinitions {
  const row = (base: number, rate: number) => ({ base, mixMin: 0.5, mixMax: 1.5, rate })
  return {
    types: {
      value: row(valueBase, 0.5),
      noise: row(0.03, 1),
      informed: row(0.03, 0.7),
      news: row(0.03, 1),
      consensus: row(0.03, 0.7),
      crowd: row(0.03, 0.6),
      trend: row(0.015, 0.5),
      contrarian: row(0.015, 0.5),
    },
    efficiencyMin: 0.5,
    efficiencyMax: 1.3,
    premiumPerDay: 0.0002,
    anchorHalfLifeDays: 3,
    valueDeadBand: 0.01,
    valueFullGap: 0.1,
    valueDeepGap: 0.2,
    valueDeepSlope: 3,
    valueMaxMultiple: 3,
    noiseAr: 0.7,
    noiseShare: 0.5,
    informedMagnitudeRefPercent: 5,
    informedHoldDays: 1,
    informedDecayDays: 3,
    newsHoldDays: 3,
    newsDecayDays: 3,
    consensusRampDays: 2,
    consensusDecayDays: 4,
    crowdReturnDays: 5,
    crowdDrawdownDays: 10,
    crowdReturnScale: 0.05,
    crowdCapitulation: -0.08,
    crowdMoodClamp: 1.5,
    trendDays: 5,
    trendScale: 0.04,
    contrarianThreshold: 0.04,
    contrarianScale: 0.04,
    contrarianMoodWeight: 0.3,
    contrarianFlowWeight: 0.5,
    contrarianFlowScale: 0.02,
    volEwma: 0.1,
    volSens: 1,
    depthScaleMin: 0.4,
  }
}

const PLAIN: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300, liquidityNotionalCents: 100_000_000 },
    { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100, liquidityNotionalCents: 100_000_000 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
  participants: PARTICIPANTS,
}

const ON: MarketDefinitions = { ...PLAIN, traders: traders(0.1) }

function run(defs: MarketDefinitions, seed: string, days: number): MarketState {
  const state = createMarket(defs, seed)
  for (let i = 0; i < days; i += 1) stepMarketDay(state, defs)
  return state
}

function priceStep(state: MarketState, asset: string): PriceStepEvent {
  const found = state.log.find((event): event is PriceStepEvent => event.kind === 'priceStep' && event.asset === asset)
  if (found === undefined) throw new Error(`no priceStep for ${asset}`)
  return found
}

function valueFlow(state: MarketState, asset: string): ParticipantFlowEvent {
  const found = state.log.find(
    (event): event is ParticipantFlowEvent => event.kind === 'participantFlow' && event.party === 'value' && event.asset === asset,
  )
  if (found === undefined) throw new Error(`no value flow for ${asset}`)
  return found
}

describe('traders model switch', () => {
  it('creates a book only when traders are defined', () => {
    expect(createMarket(PLAIN, 'abc').participants?.book).toBeUndefined()
    const book = createMarket(ON, 'abc').participants?.book
    expect(book?.activeFromDay).toBe(0)
    expect(Object.keys(book?.pos ?? {})).toEqual(['NOVA', 'HRBU'])
  })

  it('runs the current code when the book is missing or not yet active', () => {
    const plain = run(PLAIN, 'switch', 30)
    const noBook = createMarket(ON, 'switch')
    delete noBook.participants?.book
    const late = createMarket(ON, 'switch')
    if (late.participants?.book !== undefined) late.participants.book.activeFromDay = 1000
    for (let i = 0; i < 30; i += 1) {
      stepMarketDay(noBook, ON)
      stepMarketDay(late, ON)
    }
    expect(traderModelOn(late, ON)).toBe(false)
    delete late.participants?.book
    expect(stateHash(noBook)).toBe(stateHash(plain))
    expect(stateHash(late)).toBe(stateHash(plain))
  })

  it('leaves the four main streams in the same place as the current model', () => {
    const plain = run(PLAIN, 'streams', 40)
    const on = run(ON, 'streams', 40)
    expect(on.streams).toEqual(plain.streams)
    expect(on.environment).toEqual(plain.environment)
    expect(on.assets.NOVA.fairValue).toBe(plain.assets.NOVA.fairValue)
  })

  it('gives the same hash for the same seed and a different one for another seed', () => {
    const a = stateHash(run(ON, 'twice', 60))
    expect(stateHash(run(ON, 'twice', 60))).toBe(a)
    expect(stateHash(run(ON, 'other', 60))).not.toBe(a)
  })

  it('keeps finite positions, carry and prices', () => {
    const state = run(ON, 'finite', 200)
    const book = state.participants?.book
    for (const id of ['NOVA', 'HRBU']) {
      expect(Number.isFinite(book?.carry[id])).toBe(true)
      expect(Number.isFinite(book?.vol[id])).toBe(true)
      for (const value of Object.values(book?.pos[id] ?? {})) expect(Number.isFinite(value)).toBe(true)
      expect(Number.isSafeInteger(state.assets[id].priceCents)).toBe(true)
    }
  })
})

describe('traders model rules', () => {
  it('value target: dead band, linear, flat, steeper beyond the deep gap, capped', () => {
    const t = traders(1)
    expect(valueTarget(t, 1, 100, 100.5)).toBe(0)
    expect(valueTarget(t, 1, 100, 106)).toBeCloseTo(0.5, 9)
    expect(valueTarget(t, 1, 100, 115)).toBe(1)
    expect(valueTarget(t, 1, 100, 125)).toBeCloseTo(1 + (3 * 0.05) / 0.1, 9)
    expect(valueTarget(t, 1, 100, 1000)).toBe(3)
    expect(valueTarget(t, 2, 100, 1000)).toBe(6)
    expect(valueTarget(t, 1, 100, 90)).toBeLessThan(0)
  })

  it('market makers thin the depth only above usual volatility, and not below the floor', () => {
    const t = traders(0.1)
    expect(depthScaleFor(t, 0.01, 0.02)).toBe(1)
    expect(depthScaleFor(t, 0.04, 0.02)).toBeCloseTo(0.5, 9)
    expect(depthScaleFor(t, 1, 0.02)).toBe(0.4)
  })

  it('scales positions by the filled share on a capped day and keeps the rest wanted', () => {
    const defs: MarketDefinitions = { ...PLAIN, traders: traders(1) }
    const state = createMarket(defs, 'cap')
    const book = state.participants!.book!
    book.seenAnchor.NOVA = state.assets.NOVA.priceCents * 5
    stepMarketDay(state, defs)
    const step = priceStep(state, 'NOVA')
    expect(step.capped).toBe(true)
    expect(step.cappedMove).toBe(Math.floor((4800 * 8) / 100))
    expect(step.fillScale).toBeGreaterThan(0)
    expect(step.fillScale).toBeLessThan(1)
    expect(step.fillScale).toBeCloseTo(step.cappedMove / step.rawMove, 9)
    const value = valueFlow(state, 'NOVA')
    const wanted = value.demandCents / value.depthCents
    expect(book.pos.NOVA.value).toBeCloseTo(step.fillScale! * wanted, 12)
    expect(book.pos.NOVA.value).toBeLessThan(wanted)
    // Still wanted tomorrow: the target is far above the position, so it buys again.
    stepMarketDay(state, defs)
    expect(valueFlow(state, 'NOVA').demandCents).toBeGreaterThan(0)
    expect(priceStep(state, 'HRBU').capped).toBe(false)
    expect(priceStep(state, 'HRBU').fillScale).toBeUndefined()
  })

  it('logs the anchor and measures the gap against the anchor, not fair value', () => {
    const state = createMarket(ON, 'anchor')
    stepMarketDay(state, ON)
    const step = priceStep(state, 'NOVA')
    expect(step.anchor).toBeDefined()
    expect(step.gapAfter).toBeCloseTo(step.anchor! - step.newPrice, 9)
  })

  it('makes the session preview close equal the End day close, with and without player orders', () => {
    const game = createGame(ON, 'session')
    for (let day = 0; day < 15; day += 1) {
      applyCommand(game, ON, { type: 'skip' })
      applyCommand(game, ON, { type: 'tick', steps: 4 })
      if (day % 2 === 0) applyCommand(game, ON, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1500, leverage: 50 })
      applyCommand(game, ON, { type: 'tick', steps: 12 })
      const printed = Object.fromEntries(Object.keys(game.market.assets).map((id) => [id, game.session.bars[id][15].close]))
      endDay(game, ON)
      for (const id of Object.keys(printed)) expect(game.market.assets[id].priceCents).toBe(printed[id])
    }
  })
})
