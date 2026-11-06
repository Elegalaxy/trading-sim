import { describe, expect, it } from 'vitest'

import {
  BASE_MONTHLY_EXPENSES_CENTS,
  EQUIPMENT_FEE_DENOMINATOR,
  EQUIPMENT_FEE_NUMERATOR,
  EQUIPMENT_TIER_COST_CENTS,
  HEALTH_STRESS_CEILING,
  HEALTH_TIER_COST_CENTS,
  HOME_RECOVERY_ENERGY,
  HOME_RECOVERY_STRESS,
  HOME_TIER_COST_CENTS,
  INFO_FEED_TIER_COST_CENTS,
  STARTING_RESEARCH_POINTS,
} from './constants.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { initialLifestyle, interpretSetLifestyle, lifestyleExpensesCents, tierOf, upfrontCents } from './lifestyle.ts'
import type { ConsumableDefinition, GameState, JobDefinition, MarketDefinitions, OrderFillEvent, StatChangeEvent } from './types.ts'

const JOBS: readonly JobDefinition[] = [
  { id: 'jobless', name: 'Jobless', slots: 0, payCents: 0, requirement: 'none', perk: 'none', energyCost: 0, stressCost: 0, sleepHours: 8 },
  { id: 'rough', name: 'Rough job', slots: 2, payCents: 100_000, requirement: 'none', perk: 'none', energyCost: 10, stressCost: 40, sleepHours: 8 },
  { id: 'night', name: 'Night job', slots: 2, payCents: 130_000, requirement: 'none', perk: 'none', energyCost: 20, stressCost: 12, sleepHours: 6 },
]

const ITEMS: readonly ConsumableDefinition[] = [
  { id: 'coffee', name: 'Coffee', costCents: 400, energy: 12, stress: 2 },
  { id: 'energyDrink', name: 'Energy drink', costCents: 600, energy: 22, stress: 0, nextEnergy: -10 },
  { id: 'homeMeal', name: 'Home meal', costCents: 800, energy: 10, stress: -6, requiresHome: 1 },
  { id: 'gym', name: 'Gym', costCents: 1_200, energy: -6, stress: -15, nextEnergy: 4, freeWithHealth: true },
  { id: 'nightOut', name: 'Night out', costCents: 6_000, energy: 0, stress: -28, nextStress: 5, nextEnergy: -12 },
]

const defs: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
}

function start(jobId = 'jobless', lifestyle: Partial<GameState['lifestyle']> = {}): GameState {
  const game = createGame(defs, 'demo', { jobs: JOBS, jobId, consumables: ITEMS })
  game.lifestyle = { ...initialLifestyle(), ...lifestyle }
  return game
}

function causes(game: GameState, stat: 'energy' | 'stress'): string[] {
  return game.log.filter((e): e is StatChangeEvent => e.kind === 'statChange' && e.stat === stat).map((e) => `${e.cause}:${e.delta}`)
}

function lastRejection(game: GameState): string | null {
  const event = game.pending.findLast((entry) => entry.kind === 'commandRejected')
  return event !== undefined && event.kind === 'commandRejected' ? event.reason : null
}

describe('items with a next-morning effect', () => {
  it('applies now and again at the next End day, after the job costs', () => {
    const game = start('jobless')
    game.stats.energy = 50
    applyCommand(game, defs, { type: 'consume', item: 'energyDrink' })
    expect(game.stats.energy).toBe(72)
    expect(game.accounts.cashCents).toBe(300_000 - 600)
    endDay(game, defs)
    // The log holds the day's commands too: the drink, then at End day +4 home recovery and the -10 crash.
    expect(causes(game, 'energy')).toEqual(['consume:22', 'homeRecovery:4', 'consumeNext:-10'])
    expect(game.stats.energy).toBe(66)
    expect(game.stats.consumed).toEqual([])
  })

  it('lands both stats for an item that leaves stress and energy behind', () => {
    const game = start('jobless')
    game.stats.stress = 60
    applyCommand(game, defs, { type: 'consume', item: 'nightOut' })
    expect(game.stats.stress).toBe(32)
    endDay(game, defs)
    expect(causes(game, 'stress')).toEqual(['consume:-28', 'homeRecovery:-3', 'consumeNext:5'])
    expect(causes(game, 'energy')).toContain('consumeNext:-12')
  })

  it('a next-morning effect needs the item to have been used that day', () => {
    const game = start('jobless')
    endDay(game, defs)
    expect(causes(game, 'energy').some((entry) => entry.startsWith('consumeNext'))).toBe(false)
  })
})

describe('item requirements and prices', () => {
  it('a home-cooked meal needs a kitchen (Home tier 1)', () => {
    const none = start('jobless', { home: 0 })
    applyCommand(none, defs, { type: 'consume', item: 'homeMeal' })
    expect(lastRejection(none)).toBe('needsKitchen')
    expect(none.accounts.cashCents).toBe(300_000)
    const studio = start('jobless', { home: 1 })
    applyCommand(studio, defs, { type: 'consume', item: 'homeMeal' })
    expect(lastRejection(studio)).toBeNull()
    expect(studio.accounts.cashCents).toBe(300_000 - 800)
  })

  it('the gym session is free with the Health membership, and logged as free', () => {
    const member = start('jobless', { health: 1 })
    applyCommand(member, defs, { type: 'consume', item: 'gym' })
    expect(member.accounts.cashCents).toBe(300_000)
    expect(member.pending.findLast((e) => e.kind === 'consume')).toMatchObject({ item: 'gym', cost: 0 })
    const other = start('jobless')
    applyCommand(other, defs, { type: 'consume', item: 'gym' })
    expect(other.accounts.cashCents).toBe(300_000 - 1_200)
  })

  it('still allows one use a day and refuses without cash', () => {
    const game = start('jobless')
    applyCommand(game, defs, { type: 'consume', item: 'coffee' })
    applyCommand(game, defs, { type: 'consume', item: 'coffee' })
    expect(lastRejection(game)).toBe('alreadyConsumed')
    game.accounts.cashCents = 100
    applyCommand(game, defs, { type: 'consume', item: 'energyDrink' })
    expect(lastRejection(game)).toBe('insufficientFunds')
  })
})

describe('Home overnight recovery', () => {
  it('grows with the tier and needs a full night', () => {
    for (const tier of [0, 1, 2, 3]) {
      const game = start('jobless', { home: tier })
      game.stats.energy = 40
      game.stats.stress = 60
      endDay(game, defs)
      expect(game.stats.energy).toBe(40 + (HOME_RECOVERY_ENERGY[tier] ?? 0))
      expect(game.stats.stress).toBe(60 - (HOME_RECOVERY_STRESS[tier] ?? 0))
    }
    const night = start('night', { home: 3 })
    night.stats.energy = 70
    endDay(night, defs)
    expect(causes(night, 'energy').some((entry) => entry.startsWith('homeRecovery'))).toBe(false)
  })

  it('a quiet room (tier 2) halves the short-sleep penalty, rounded up', () => {
    const flat = start('night', { home: 2 })
    endDay(flat, defs)
    // 6 hours of sleep is 1 short: -8 energy and +4 stress, halved.
    expect(causes(flat, 'energy')).toEqual(['job:-20', 'shortSleep:-4'])
    expect(causes(flat, 'stress')).toEqual(['job:12', 'shortSleep:2'])
    const room = start('night', { home: 1 })
    endDay(room, defs)
    expect(causes(room, 'energy')).toEqual(['job:-20', 'shortSleep:-8'])
  })

  it('a home office (tier 3) halves the stress from a big loss and a margin warning', () => {
    const run = (home: number): string[] => {
      const game = start('jobless', { home })
      game.positions.NOVA = { asset: 'NOVA', signedShares: 100, costCents: 480_000 }
      game.accounts.tradingCents = -380_000
      const nova = game.market.assets.NOVA
      if (nova === undefined) throw new Error('missing NOVA')
      nova.fairValue = 1
      endDay(game, defs)
      return causes(game, 'stress').filter((entry) => !entry.startsWith('homeRecovery'))
    }
    expect(run(2)).toEqual(['drawdown:10', 'marginWarning:8'])
    expect(run(3)).toEqual(['drawdown:5', 'marginWarning:4'])
  })
})

describe('Health membership', () => {
  it('keeps the job alone from pushing stress above the ceiling', () => {
    const free = start('rough')
    free.stats.stress = 80
    endDay(free, defs)
    expect(causes(free, 'stress')[0]).toBe('job:20')
    const member = start('rough', { health: 1 })
    member.stats.stress = 80
    endDay(member, defs)
    expect(causes(member, 'stress')[0]).toBe(`job:${HEALTH_STRESS_CEILING - 80}`)
    const high = start('rough', { health: 1 })
    high.stats.stress = 95
    endDay(high, defs)
    expect(causes(high, 'stress').some((entry) => entry.startsWith('job'))).toBe(false)
  })
})

describe('information feed extras', () => {
  it('tier 1 makes the first news read free, tier 2 makes Verify cost no energy', () => {
    const base = start('jobless')
    applyCommand(base, defs, { type: 'readNews' })
    expect(base.pending.findLast((e) => e.kind === 'newsRead')).toMatchObject({ cost: 2 })
    const tier1 = start('jobless', { infoFeed: 1 })
    applyCommand(tier1, defs, { type: 'readNews' })
    applyCommand(tier1, defs, { type: 'readNews' })
    const reads = tier1.pending.filter((e) => e.kind === 'newsRead')
    expect(reads.map((e) => (e.kind === 'newsRead' ? e.cost : -1))).toEqual([0, 2])

    const plain = start('jobless', { infoFeed: 1 })
    applyCommand(plain, defs, { type: 'verify' })
    expect(plain.pending.findLast((e) => e.kind === 'newsVerified')).toMatchObject({ cost: 2 })
    const tier2 = start('jobless', { infoFeed: 2 })
    const energy = tier2.stats.energy
    applyCommand(tier2, defs, { type: 'verify' })
    expect(tier2.pending.findLast((e) => e.kind === 'newsVerified')).toMatchObject({ cost: 0 })
    expect(tier2.stats.energy).toBe(energy)
    expect(tier2.study.points).toBe(STARTING_RESEARCH_POINTS - 1)
  })
})

describe('Equipment fee tier', () => {
  const buy = (equipment: number): OrderFillEvent => {
    const game = start('jobless', { equipment })
    applyCommand(game, defs, { type: 'skip' })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 100 })
    const fill = game.pending.findLast((e): e is OrderFillEvent => e.kind === 'orderFill')
    if (fill === undefined) throw new Error('no fill')
    return fill
  }

  it('tier 2 charges 0.08% instead of 0.1%', () => {
    const base = buy(0)
    const pro = buy(2)
    expect(base.fee).toBe(Math.round((100 * base.fillPrice) / 1000))
    expect(pro.fee).toBe(Math.round((100 * pro.fillPrice * EQUIPMENT_FEE_NUMERATOR) / EQUIPMENT_FEE_DENOMINATOR))
    expect(pro.fee).toBeLessThan(base.fee)
    expect(buy(1).fee).toBe(base.fee)
  })
})

describe('four lifestyle categories', () => {
  it('adds every tier to the monthly expenses and prices an upgrade at twice the monthly cost', () => {
    const lifestyle = { home: 1, infoFeed: 2, health: 1, equipment: 2 }
    expect(lifestyleExpensesCents(lifestyle)).toBe(
      BASE_MONTHLY_EXPENSES_CENTS + HOME_TIER_COST_CENTS + 2 * INFO_FEED_TIER_COST_CENTS + HEALTH_TIER_COST_CENTS + 2 * EQUIPMENT_TIER_COST_CENTS,
    )
    expect(upfrontCents('health', 0, 1)).toBe(2 * HEALTH_TIER_COST_CENTS)
    expect(upfrontCents('equipment', 0, 2)).toBe(2 * 2 * EQUIPMENT_TIER_COST_CENTS)
    expect(upfrontCents('equipment', 2, 0)).toBe(0)
  })

  it('buys and logs Health and Equipment, and rejects a tier past the top', () => {
    const game = start('jobless')
    const bought = interpretSetLifestyle(game, { type: 'setLifestyle', category: 'health', tier: 1 })
    expect(bought).toMatchObject({ accepted: true, event: { category: 'health', from: 0, to: 1, upfront: 2 * HEALTH_TIER_COST_CENTS } })
    expect(tierOf(game.lifestyle, 'health')).toBe(1)
    const tooHigh = interpretSetLifestyle(game, { type: 'setLifestyle', category: 'equipment', tier: 3 })
    expect(tooHigh).toMatchObject({ accepted: false, event: { reason: 'invalidTier' } })
    applyCommand(game, defs, { type: 'setLifestyle', category: 'equipment', tier: 2 })
    expect(game.pending.findLast((e) => e.kind === 'lifestyleChange')).toMatchObject({
      category: 'equipment',
      to: 2,
      expensesCents: BASE_MONTHLY_EXPENSES_CENTS + HEALTH_TIER_COST_CENTS + 2 * EQUIPMENT_TIER_COST_CENTS,
    })
  })

  it('treats a lifestyle from an older save (no Health or Equipment) as tier 0', () => {
    const old = { home: 1, infoFeed: 0 }
    expect(tierOf(old, 'health')).toBe(0)
    expect(tierOf(old, 'equipment')).toBe(0)
    expect(lifestyleExpensesCents(old)).toBe(BASE_MONTHLY_EXPENSES_CENTS + HOME_TIER_COST_CENTS)
  })
})
