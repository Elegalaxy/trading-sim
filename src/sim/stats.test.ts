import { describe, expect, it } from 'vitest'

import { STARTING_CASH_CENTS, STARTING_TRADING_CENTS } from './constants.ts'
import { applyCommand, createGame, endDay, settleTradingAccount } from './game.ts'
import { stateHash } from './hash.ts'
import { activeJob } from './jobs.ts'
import { formatEvent } from './log.ts'
import { createMarket, stepMarketDay } from './market.ts'
import {
  ENERGY_WARNING_BELOW,
  STRESS_WARNING_ABOVE,
  applyEndOfDayStats,
  isLargeDrawdown,
} from './stats.ts'
import { tradingEquity } from './trading.ts'
import type {
  ConsumableDefinition,
  GameState,
  JobDefinition,
  MarketDefinitions,
  StatChangeEvent,
} from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugStats(message: string): void {
  io.writeSync(1, `[DEBUG stats] ${message}\n`)
}

// Requirement is none here so a test can start in a course-gated job.
// Costs, sleep, and perks are the plan's provisional table.
const JOBS: readonly JobDefinition[] = [
  { id: 'jobless', name: 'Jobless', slots: 0, payCents: 0, requirement: 'none', perk: 'none', energyCost: 0, stressCost: 0, sleepHours: 8 },
  { id: 'shopAssistant', name: 'Shop assistant', slots: 1, payCents: 60_000, requirement: 'none', perk: 'staffDiscount', energyCost: 5, stressCost: 2, sleepHours: 8 },
  { id: 'officeClerk', name: 'Office clerk', slots: 2, payCents: 110_000, requirement: 'none', perk: 'steadyRoutine', energyCost: 10, stressCost: 8, sleepHours: 8 },
  { id: 'nightWarehouse', name: 'Night-shift warehouse', slots: 2, payCents: 130_000, requirement: 'none', perk: 'quietBreaks', energyCost: 20, stressCost: 12, sleepHours: 6 },
  { id: 'tradingFloor', name: 'Trading-floor assistant', slots: 2, payCents: 100_000, requirement: 'none', perk: 'industryContacts', energyCost: 12, stressCost: 15, sleepHours: 7 },
  { id: 'freelanceAnalyst', name: 'Freelance analyst', slots: 1, payCents: 80_000, requirement: 'none', perk: 'analystTools', energyCost: 6, stressCost: 6, sleepHours: 8 },
]

const ITEMS: readonly ConsumableDefinition[] = [
  { id: 'coffee', name: 'Coffee', costCents: 1_000, energy: 15, stress: 0 },
  { id: 'herbalTea', name: 'Herbal tea', costCents: 1_000, energy: 0, stress: -12 },
  { id: 'homeCookedMeal', name: 'Home-cooked meal', costCents: 2_000, energy: 8, stress: -6 },
  { id: 'nightOut', name: 'Night out', costCents: 6_000, energy: 0, stress: -25 },
]

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
]

function market(volatility = 0.022): MarketDefinitions {
  return {
    assets: ASSETS.map((asset) => (asset.kind === 'stock' ? { ...asset, dailyVolatility: volatility } : asset)),
    environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
    events: [],
  }
}

function start(jobId: string, volatility = 0.022): GameState {
  return createGame(market(volatility), jobId, { jobs: JOBS, jobId, consumables: ITEMS })
}

function changes(game: GameState, stat: 'energy' | 'stress'): StatChangeEvent[] {
  return game.log.filter((event): event is StatChangeEvent => event.kind === 'statChange' && event.stat === stat)
}

describe('energy, stress, sleep, and consumables', () => {
  it('lowers energy by the job cost, and adds one short hour for a 6h sleep', () => {
    const office = start('officeClerk')
    expect(office.stats).toMatchObject({ energy: 80, stress: 20 })
    expect(office.section).toBe('work')
    endDay(office, market())
    expect(office.stats).toMatchObject({ energy: 70, stress: 28 })
    expect(changes(office, 'energy').map((event) => event.cause)).toEqual(['job'])
    expect(changes(office, 'energy')[0]).toMatchObject({ before: 80, cause: 'job', delta: -10, after: 70 })
    expect(changes(office, 'stress')[0]).toMatchObject({ before: 20, cause: 'job', delta: 8, after: 28 })
    endDay(office, market())
    endDay(office, market())
    expect(office.stats.energy).toBe(50)
    expect(office.stats.stress).toBe(44)
    expect(office.log.some((event) => event.kind === 'consume')).toBe(false)
    debugStats(`office 3 days no food energy=${office.stats.energy} stress=${office.stats.stress}`)

    const expected = [
      { id: 'jobless', energy: 80, stress: 20, shortSleep: false },
      { id: 'shopAssistant', energy: 75, stress: 22, shortSleep: false },
      { id: 'nightWarehouse', energy: 52, stress: 36, shortSleep: true },
      { id: 'tradingFloor', energy: 68, stress: 35, shortSleep: false },
      { id: 'freelanceAnalyst', energy: 74, stress: 26, shortSleep: false },
    ]
    for (const row of expected) {
      const game = start(row.id)
      const slept = game.sleepHours
      endDay(game, market())
      expect(game.stats.energy).toBe(row.energy)
      expect(game.stats.stress).toBe(row.stress)
      expect(changes(game, 'energy').some((event) => event.cause === 'shortSleep')).toBe(row.shortSleep)
      debugStats(`${row.id} sleep=${slept}h energy=${game.stats.energy} stress=${game.stats.stress} shortSleep=${row.shortSleep}`)
    }

    const night = start('nightWarehouse')
    endDay(night, market())
    const energyLines = changes(night, 'energy')
    const stressLines = changes(night, 'stress')
    expect(energyLines.map((event) => `${event.cause}:${event.delta}`)).toEqual(['job:-20', 'shortSleep:-8'])
    expect(stressLines.map((event) => `${event.cause}:${event.delta}`)).toEqual(['job:12', 'shortSleep:4'])
    debugStats(energyLines.map((event) => formatEvent(event)).join(' | '))
    debugStats(stressLines.map((event) => formatEvent(event)).join(' | '))
  })

  it('rejects a consumable with too little cash or on a second use the same day, and clamps stats', () => {
    const game = start('jobless')
    expect(game.section).toBe('sleep')
    const trading = game.accounts.tradingCents
    expect(() => applyCommand(game, market(), { type: 'consume', item: 'champagne' })).not.toThrow()
    expect(game.log.at(-1)).toMatchObject({ kind: 'commandRejected', command: 'consume', reason: 'unknownItem' })
    expect(() => applyCommand(game, market(), { type: 'consume' })).not.toThrow()
    expect(game.log.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'unknownItem' })

    game.accounts.cashCents = 999
    expect(() => applyCommand(game, market(), { type: 'consume', item: 'coffee' })).not.toThrow()
    expect(game.log.at(-1)).toMatchObject({ kind: 'commandRejected', command: 'consume', reason: 'insufficientFunds' })
    expect(game.accounts.cashCents).toBe(999)
    expect(game.stats.energy).toBe(80)
    expect(game.stats.consumed).toEqual([])
    expect(game.section).toBe('sleep')
    expect(game.accounts.tradingCents).toBe(trading)

    game.accounts.cashCents = 1_000
    applyCommand(game, market(), { type: 'consume', item: 'coffee' })
    expect(game.accounts.cashCents).toBe(0)
    expect(game.stats.energy).toBe(95)
    expect(game.stats.consumed).toEqual(['coffee'])
    const bought = game.log.find((event) => event.kind === 'consume')
    expect(bought).toMatchObject({ item: 'coffee', cost: 1_000, energyDelta: 15, stressDelta: 0 })
    debugStats(bought === undefined ? 'missing consume' : formatEvent(bought))

    expect(() => applyCommand(game, market(), { type: 'consume', item: 'coffee' })).not.toThrow()
    expect(game.log.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'alreadyConsumed' })
    expect(game.accounts.cashCents).toBe(0)
    expect(game.stats.energy).toBe(95)

    applyCommand(game, market(), { type: 'consume', item: 'herbalTea' })
    expect(game.log.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'insufficientFunds' })
    expect(game.stats.stress).toBe(20)

    game.accounts.cashCents = STARTING_CASH_CENTS
    game.stats.energy = 90
    applyCommand(game, market(), { type: 'consume', item: 'herbalTea' })
    expect(game.stats.energy).toBe(90)
    expect(game.stats.stress).toBe(8)
    game.stats.energy = 100
    game.stats.stress = 0
    applyCommand(game, market(), { type: 'consume', item: 'homeCookedMeal' })
    const meal = [...game.log].reverse().find((event) => event.kind === 'consume')
    expect(meal).toMatchObject({ item: 'homeCookedMeal', cost: 2_000, energyDelta: 0, stressDelta: 0 })
    expect(game.stats).toMatchObject({ energy: 100, stress: 0 })
    expect(game.log.filter((event) => event.kind === 'statChange' && event.cause === 'consume')).toHaveLength(2)

    endDay(game, market())
    expect(game.stats.consumed).toEqual([])
    expect(game.stats.newsReads).toBe(0)
    applyCommand(game, market(), { type: 'consume', item: 'coffee' })
    expect(game.stats.energy).toBe(100)
    expect(game.log.filter((event) => event.kind === 'consume').at(-1)).toMatchObject({ energyDelta: 0 })

    const floor = start('nightWarehouse')
    floor.stats.energy = 3
    floor.stats.stress = 95
    endDay(floor, market())
    expect(floor.stats.energy).toBe(0)
    expect(floor.stats.stress).toBe(100)
    expect(changes(floor, 'energy')).toEqual([
      expect.objectContaining({ cause: 'job', before: 3, delta: -3, after: 0 }),
    ])
    expect(changes(floor, 'stress')).toEqual([
      expect.objectContaining({ cause: 'job', before: 95, delta: 5, after: 100 }),
    ])
    for (let day = 0; day < 20; day += 1) endDay(floor, market())
    expect(floor.stats.energy).toBe(0)
    expect(floor.stats.stress).toBe(100)
    expect(floor.stats.energy).toBeGreaterThanOrEqual(0)
    expect(floor.stats.stress).toBeLessThanOrEqual(100)
    debugStats(`clamped night energy=${floor.stats.energy} stress=${floor.stats.stress}`)
  })

  it('scales stress recovery by 1.1 for steady routine and leaves energy alone', () => {
    const game = start('officeClerk')
    applyCommand(game, market(), { type: 'consume', item: 'coffee' })
    expect(game.stats.energy).toBe(95)
    expect(game.stats.stress).toBe(20)
    applyCommand(game, market(), { type: 'consume', item: 'herbalTea' })
    expect(game.stats.stress).toBe(7)
    const tea = [...game.log].reverse().find((event) => event.kind === 'consume')
    expect(tea).toMatchObject({ item: 'herbalTea', cost: 1_000, energyDelta: 0, stressDelta: -13 })
    debugStats(tea === undefined ? 'missing tea' : formatEvent(tea))

    const meal = start('officeClerk')
    applyCommand(meal, market(), { type: 'consume', item: 'homeCookedMeal' })
    expect(meal.stats.energy).toBe(88)
    expect(meal.stats.stress).toBe(13)
    expect(meal.log.find((event) => event.kind === 'consume')).toMatchObject({ energyDelta: 8, stressDelta: -7 })

    const night = start('officeClerk')
    night.stats.stress = 50
    applyCommand(night, market(), { type: 'consume', item: 'nightOut' })
    expect(night.stats.stress).toBe(22)
    expect(night.stats.energy).toBe(80)
    expect(night.log.find((event) => event.kind === 'consume')).toMatchObject({ cost: 6_000, stressDelta: -28, energyDelta: 0 })

    const clamped = start('officeClerk')
    applyCommand(clamped, market(), { type: 'consume', item: 'nightOut' })
    expect(clamped.stats.stress).toBe(0)
    expect(clamped.log.find((event) => event.kind === 'consume')).toMatchObject({ stressDelta: -20 })
    debugStats('steady routine tea -13, meal stress -7, night out -28, clamped night out -20')
  })

  it('charges 2 energy to read the news, and the first quiet-breaks read is free', () => {
    const plain = start('jobless')
    applyCommand(plain, market(), { type: 'readNews' })
    expect(plain.stats.energy).toBe(78)
    expect(plain.stats.newsReads).toBe(1)
    expect(plain.section).toBe('sleep')
    expect(plain.log.find((event) => event.kind === 'newsRead')).toMatchObject({ cost: 2 })
    expect(plain.market.feed).toEqual(createGame(market(), 'jobless', { jobs: JOBS, jobId: 'jobless' }).market.feed)
    debugStats(formatEvent(plain.log.find((event) => event.kind === 'newsRead') as GameState['log'][number]))

    const quiet = start('nightWarehouse')
    expect(quiet.section).toBe('work')
    applyCommand(quiet, market(), { type: 'readNews' })
    expect(quiet.stats.energy).toBe(80)
    expect(quiet.log.find((event) => event.kind === 'newsRead')).toMatchObject({ cost: 0 })
    expect(quiet.log.some((event) => event.kind === 'statChange')).toBe(false)
    applyCommand(quiet, market(), { type: 'readNews' })
    expect(quiet.stats.energy).toBe(78)
    expect(quiet.stats.newsReads).toBe(2)
    expect([...quiet.log].reverse().find((event) => event.kind === 'newsRead')).toMatchObject({ cost: 2 })
    expect(quiet.section).toBe('work')
    endDay(quiet, market())
    expect(quiet.stats.newsReads).toBe(0)
    expect(quiet.stats.energy).toBe(50)
    applyCommand(quiet, market(), { type: 'readNews' })
    expect(quiet.log.at(-1)).toMatchObject({ kind: 'newsRead', cost: 0 })
    expect(quiet.stats.energy).toBe(50)
    debugStats(`quiet first free, second -2, after the day energy=${quiet.stats.energy}`)
  })

  it('adds stress for a 10% drawdown, a margin warning day, and a wipe-out', () => {
    // There is no drawdown flag on the margin log. Wipe-out is the existing flag
    // for ending below 10% of start-of-day equity. A large drawdown is provisional:
    // trading equity fell by 10% or more from the start of that day
    // (drop * 100 >= start * 10, and start > 0). Exactly 10% counts.
    // A wipe-out day is also a large drawdown, so both spikes apply.
    expect(isLargeDrawdown(100_000, 90_000)).toBe(true)
    expect(isLargeDrawdown(100_000, 90_001)).toBe(false)
    expect(isLargeDrawdown(0, -1)).toBe(false)
    const boundary = start('jobless')
    const exactly = applyEndOfDayStats(boundary, activeJob(boundary.job), boundary.sleepHours, 100_000, 90_000, [])
    expect(boundary.stats.stress).toBe(30)
    expect(exactly.map((event) => event.cause)).toEqual(['drawdown'])
    const inside = start('jobless')
    expect(applyEndOfDayStats(inside, activeJob(inside.job), 8, 100_000, 90_001, [])).toEqual([])
    expect(inside.stats.stress).toBe(20)
    debugStats('large drawdown is a 10% equity drop from the start of the day; no drawdown log flag')

    const defs = market(0)
    const wiped = createGame(defs, 'wipe', { jobs: JOBS, jobId: 'jobless', consumables: ITEMS })
    wiped.positions.NOVA = { asset: 'NOVA', signedShares: 100, costCents: 480_000 }
    wiped.accounts.tradingCents = -300_000
    const startEquity = tradingEquity(wiped, defs).equity
    const nova = wiped.market.assets.NOVA
    if (nova === undefined) throw new Error('[DEBUG stats] missing NOVA')
    nova.priceCents = 1
    const margin = settleTradingAccount(wiped, defs, startEquity)
    const endEquity = tradingEquity(wiped, defs).equity
    expect(margin.some((event) => event.kind === 'marginWarning')).toBe(true)
    expect(margin.some((event) => event.kind === 'wipeOut')).toBe(true)
    expect(isLargeDrawdown(startEquity, endEquity)).toBe(true)
    const spikes = applyEndOfDayStats(wiped, activeJob(wiped.job), wiped.sleepHours, startEquity, endEquity, margin)
    expect(wiped.stats.stress).toBe(63)
    expect(spikes.map((event) => `${event.cause}:${event.delta}`)).toEqual([
      'drawdown:10',
      'marginWarning:8',
      'wipeOut:25',
    ])
    debugStats(
      `wipe day start=${startEquity} end=${endEquity} stress=${wiped.stats.stress} causes=${spikes.map((event) => event.cause).join(',')}`,
    )

    const lived = start('jobless', 0)
    const book = lived.market.assets.NOVA
    if (book === undefined) throw new Error('[DEBUG stats] missing lived NOVA')
    book.fairValue = 1
    lived.positions.NOVA = { asset: 'NOVA', signedShares: 100, costCents: 480_000 }
    lived.accounts.tradingCents = -380_000
    const before = tradingEquity(lived, market(0)).equity
    endDay(lived, market(0))
    const after = tradingEquity(lived, market(0)).equity
    expect(isLargeDrawdown(before, after)).toBe(true)
    expect(lived.log.some((event) => event.kind === 'marginWarning')).toBe(true)
    expect(changes(lived, 'stress').map((event) => event.cause)).toEqual(['drawdown', 'marginWarning'])
    expect(lived.stats.stress).toBe(38)
    expect(lived.stats.energy).toBe(80)
    debugStats(`endDay drawdown ${before}->${after} stress=${lived.stats.stress} energy=${lived.stats.energy}`)
  })

  it('keeps a jobless no-trade market hash identical to stepping the market alone', () => {
    const defs = market()
    const game = createGame(defs, 'demo', { jobs: JOBS, jobId: 'jobless', consumables: ITEMS })
    const alone = createMarket(defs, 'demo')
    expect(stateHash(game.market)).toBe(stateHash(alone))
    for (let day = 0; day < 10; day += 1) {
      endDay(game, defs)
      stepMarketDay(alone, defs)
      expect(stateHash(game.market)).toBe(stateHash(alone))
    }
    expect(game.stats).toMatchObject({ energy: 80, stress: 20, consumed: [], newsReads: 0 })
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    expect(game.accounts.tradingCents).toBe(STARTING_TRADING_CENTS)
    expect(ENERGY_WARNING_BELOW).toBe(40)
    expect(STRESS_WARNING_ABOVE).toBe(60)
    debugStats(`jobless no-trade days=10 hash=${stateHash(game.market)} energy=${game.stats.energy} stress=${game.stats.stress}`)
  })
})
