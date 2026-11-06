import { describe, expect, it } from 'vitest'

import { BASE_MONTHLY_EXPENSES_CENTS } from './constants.ts'
import { upcomingCalendar } from './calendar.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { createEmployer, fastForwardEmployer, isLayoffRollDay, layoffChance, severanceCents } from './layoffs.ts'
import { loanLimitCents } from './loan.ts'
import { formatEvent } from './log.ts'
import { nextFloat } from './rng.ts'
import type {
  AccountLogEvent,
  CalendarDefinitions,
  CalendarOutcome,
  GameState,
  JobDefinition,
  LayoffDefinitions,
  MarketDefinitions,
} from './types.ts'

const JOBS: readonly JobDefinition[] = [
  { id: 'jobless', name: 'Jobless', slots: 0, payCents: 0, requirement: 'none', perk: 'none', energyCost: 0, stressCost: 0, sleepHours: 8 },
  { id: 'shopAssistant', name: 'Shop assistant', slots: 1, payCents: 60_000, requirement: 'none', perk: 'staffDiscount', energyCost: 5, stressCost: 2, sleepHours: 8 },
  { id: 'officeClerk', name: 'Office clerk', slots: 2, payCents: 110_000, requirement: 'none', perk: 'steadyRoutine', energyCost: 10, stressCost: 8, sleepHours: 8 },
  { id: 'nightWarehouse', name: 'Night-shift warehouse', slots: 2, payCents: 130_000, requirement: 'none', perk: 'quietBreaks', energyCost: 20, stressCost: 12, sleepHours: 6 },
  { id: 'tradingFloor', name: 'Trading-floor assistant', slots: 2, payCents: 100_000, requirement: 'none', perk: 'industryContacts', energyCost: 12, stressCost: 15, sleepHours: 7 },
  { id: 'freelanceAnalyst', name: 'Freelance analyst', slots: 1, payCents: 80_000, requirement: 'none', perk: 'analystTools', energyCost: 6, stressCost: 6, sleepHours: 8 },
]

const LAYOFFS: LayoffDefinitions = {
  jobs: [
    { jobId: 'shopAssistant', sector: 'A', baseChance: 0.1 },
    { jobId: 'nightWarehouse', sector: 'A', baseChance: 0.12 },
    { jobId: 'officeClerk', sector: 'B', baseChance: 0.06 },
    { jobId: 'tradingFloor', sector: 'B', baseChance: 0.1 },
  ],
  growthBelow: 0.08,
  growthAbove: -0.04,
  sectorFall: 0.1,
  sectorRise: -0.04,
  sectorMovePercent: 5,
  maxChance: 0.4,
  trueChance: 0.6,
}

const BANDS = ['low', 'mid', 'high'] as const

const CALENDAR: CalendarDefinitions = {
  daysPerMonth: 30,
  schedule: [
    { kind: 'growthRelease', dayOfMonth: 10, entryId: 'growth' },
    { kind: 'inflationRelease', dayOfMonth: 20, entryId: 'inflation' },
    { kind: 'policyDecision', dayOfMonth: 25, entryId: 'policyRate' },
  ],
  growthEntryId: 'growth',
  inflationEntryId: 'inflation',
  policyEntryId: 'policyRate',
  inflationLowBelow: 2,
  inflationHighAt: 4,
  growthLowBelow: 1,
  growthHighAt: 3,
  rateStep: 0.25,
  policy: BANDS.flatMap((inflationBand) => BANDS.map((growthBand) => ({ inflationBand, growthBand, hold: 0.5, up: 0.25, down: 0.25 }))),
  growthRelease: BANDS.map((band) => ({ band, above: 0.25, inline: 0.5, below: 0.25 })),
  inflationRelease: BANDS.map((band) => ({ band, above: 0.25, inline: 0.5, below: 0.25 })),
  effects: (['policyDecision', 'growthRelease', 'inflationRelease'] as const).flatMap((kind) => {
    const outcomes: CalendarOutcome[] = kind === 'policyDecision' ? ['up', 'down', 'hold'] : ['above', 'inline', 'below']
    return outcomes.flatMap((outcome) => [
      { kind, outcome, sector: 'A' as const, percent: 0 },
      { kind, outcome, sector: 'B' as const, percent: 0 },
    ])
  }),
}

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 1000, borrowFeePpm: 100 },
  { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.022, spreadPpm: 1000, borrowFeePpm: 100 },
  { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.022, spreadPpm: 1000, borrowFeePpm: 100 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1000, borrowFeePpm: 100 },
]

function layoffDefs(layoffs: LayoffDefinitions = LAYOFFS): MarketDefinitions {
  return {
    assets: ASSETS,
    environment: [
      { id: 'growth', start: 2, driftSpeed: 0 },
      { id: 'inflation', start: 3, driftSpeed: 0 },
      { id: 'policyRate', start: 4, driftSpeed: 0 },
    ],
    events: [],
    calendar: CALENDAR,
    layoffs,
  }
}

const defs = layoffDefs()

function start(jobId: string, seed = 'lay'): GameState {
  return createGame(defs, seed, { jobs: JOBS, jobId })
}

/** Put a growth print for `day` on the market, as the calendar would have rolled it. */
function withPrint(game: GameState, day: number, outcome: CalendarOutcome): void {
  game.market.calendarRolls = [{ kind: 'growthRelease', day, roll: 0.5, outcome, expected: 'inline', applied: true }]
}

describe('roll days', () => {
  it('are day 10, 40 and 70 and no others', () => {
    const days: number[] = []
    for (let day = 0; day <= 130; day += 1) if (isLayoffRollDay(day)) days.push(day)
    expect(days).toEqual([10, 40, 70])
  })

  it('sit on the growth release day of the calendar', () => {
    const game = start('jobless')
    const growth = upcomingCalendar(game.market, 119)
      .filter((item) => item.kind === 'growthRelease')
      .map((item) => item.day)
    expect(growth).toEqual(expect.arrayContaining([10, 40, 70]))
    for (const day of growth) expect(isLayoffRollDay(day)).toBe(day + 20 < 120)
  })
})

describe('layoff chance', () => {
  it('is the base chance per job when nothing moves', () => {
    const game = start('jobless')
    expect(layoffChance(game, defs, 'shopAssistant', 10)).toBeCloseTo(0.1, 12)
    expect(layoffChance(game, defs, 'nightWarehouse', 10)).toBeCloseTo(0.12, 12)
    expect(layoffChance(game, defs, 'officeClerk', 10)).toBeCloseTo(0.06, 12)
    expect(layoffChance(game, defs, 'tradingFloor', 10)).toBeCloseTo(0.1, 12)
  })

  it('is 0 for the freelance analyst, jobless, an unknown job, and definitions without layoffs', () => {
    const game = start('jobless')
    expect(layoffChance(game, defs, 'freelanceAnalyst', 10)).toBe(0)
    expect(layoffChance(game, defs, 'jobless', 10)).toBe(0)
    expect(layoffChance(game, defs, 'nobody', 10)).toBe(0)
    expect(layoffChance(game, { ...defs, layoffs: undefined }, 'shopAssistant', 10)).toBe(0)
  })

  it('rises 0.08 after a weak growth print, falls 0.04 after a strong one, and ignores an inline or missing one', () => {
    const game = start('jobless')
    withPrint(game, 10, 'below')
    expect(layoffChance(game, defs, 'shopAssistant', 10)).toBeCloseTo(0.18, 12)
    withPrint(game, 10, 'above')
    expect(layoffChance(game, defs, 'shopAssistant', 10)).toBeCloseTo(0.06, 12)
    withPrint(game, 10, 'inline')
    expect(layoffChance(game, defs, 'shopAssistant', 10)).toBeCloseTo(0.1, 12)
    // A print on another day does not count.
    withPrint(game, 11, 'below')
    expect(layoffChance(game, defs, 'shopAssistant', 10)).toBeCloseTo(0.1, 12)
    game.market.calendarRolls = []
    expect(layoffChance(game, defs, 'shopAssistant', 10)).toBeCloseTo(0.1, 12)
  })

  it('adds 0.10 when the job sector fell 5% or more, takes 0.04 when it rose 5% or more (against the start price on day 10)', () => {
    const game = start('jobless')
    // Sector A: NOVA -6%, BLSW -4% average -5%.
    game.market.assets.NOVA.priceCents = Math.round(4800 * 0.94)
    game.market.assets.BLSW.priceCents = Math.round(11200 * 0.96)
    expect(layoffChance(game, defs, 'shopAssistant', 10)).toBeCloseTo(0.2, 12)
    // The same fall does not touch a sector B job.
    expect(layoffChance(game, defs, 'officeClerk', 10)).toBeCloseTo(0.06, 12)
    game.market.assets.NOVA.priceCents = Math.round(4800 * 1.06)
    game.market.assets.BLSW.priceCents = Math.round(11200 * 1.05)
    expect(layoffChance(game, defs, 'shopAssistant', 10)).toBeCloseTo(0.06, 12)
    // A move inside the band counts for nothing.
    game.market.assets.NOVA.priceCents = Math.round(4800 * 1.03)
    game.market.assets.BLSW.priceCents = Math.round(11200 * 0.99)
    expect(layoffChance(game, defs, 'shopAssistant', 10)).toBeCloseTo(0.1, 12)
  })

  it('reads the close 20 days earlier from the past record, and a missing row gives 0', () => {
    const game = start('jobless')
    game.market.assets.NOVA.priceCents = 4000
    game.market.assets.BLSW.priceCents = 10000
    // Day 40 looks back to day 20, which is not recorded: no move.
    expect(layoffChance(game, defs, 'shopAssistant', 40)).toBeCloseTo(0.1, 12)
    game.past = [{ day: 20, prices: { NOVA: 5000, BLSW: 12000, KSR: 6400, M4X: 100000 }, bars: {}, equityCents: 0 }]
    // NOVA -20%, BLSW -16.7%: a fall.
    expect(layoffChance(game, defs, 'shopAssistant', 40)).toBeCloseTo(0.2, 12)
    // A row missing one stock gives 0 again.
    game.past = [{ day: 20, prices: { NOVA: 5000, KSR: 6400, M4X: 100000 }, bars: {}, equityCents: 0 }]
    expect(layoffChance(game, defs, 'shopAssistant', 40)).toBeCloseTo(0.1, 12)
  })

  it('is clamped to 0 .. 0.40', () => {
    const game = start('jobless')
    const high: LayoffDefinitions = { ...LAYOFFS, jobs: [{ jobId: 'shopAssistant', sector: 'A', baseChance: 0.35 }] }
    withPrint(game, 10, 'below')
    game.market.assets.NOVA.priceCents = 4000
    game.market.assets.BLSW.priceCents = 9000
    expect(layoffChance(game, layoffDefs(high), 'shopAssistant', 10)).toBe(0.4)
    const low: LayoffDefinitions = { ...LAYOFFS, jobs: [{ jobId: 'shopAssistant', sector: 'A', baseChance: 0.02 }] }
    withPrint(game, 10, 'above')
    game.market.assets.NOVA.priceCents = 6000
    game.market.assets.BLSW.priceCents = 14000
    expect(layoffChance(game, layoffDefs(low), 'shopAssistant', 10)).toBe(0)
  })
})

/** A warning is certain and always real (or always false), so a run follows the notice to its end. */
function sure(trueChance: number): MarketDefinitions {
  return layoffDefs({
    ...LAYOFFS,
    maxChance: 1,
    trueChance,
    jobs: LAYOFFS.jobs.map((job) => ({ ...job, baseChance: 1 })),
  })
}

/** Play to the end of `day`, paying any bill. Returns the log of each day played, keyed by day. */
function playTo(game: GameState, gameDefs: MarketDefinitions, day: number): Map<number, AccountLogEvent[]> {
  const logs = new Map<number, AccountLogEvent[]>()
  while (game.market.day < day) {
    if (game.bill !== null) applyCommand(game, gameDefs, { type: 'payBill' })
    endDay(game, gameDefs)
    logs.set(game.market.day, game.log.slice())
  }
  return logs
}

function kinds(log: readonly AccountLogEvent[]): string[] {
  return log.map((event) => event.kind)
}

function drawn(seed: string, draws: number): ReturnType<typeof createEmployer> {
  const employer = createEmployer(seed)
  for (let i = 0; i < draws; i += 1) nextFloat(employer.stream)
  return employer
}

describe('the employer stream', () => {
  it('draws exactly two floats on every roll day, jobless or in an exempt job, and none on other days', () => {
    for (const jobId of ['jobless', 'freelanceAnalyst', 'nightWarehouse']) {
      const game = start(jobId)
      expect(game.employer?.stream).toEqual(drawn('lay', 0).stream)
      playTo(game, defs, 9)
      expect(game.employer?.stream).toEqual(drawn('lay', 0).stream)
      playTo(game, defs, 10)
      expect(game.employer?.stream).toEqual(drawn('lay', 2).stream)
      playTo(game, defs, 39)
      expect(game.employer?.stream).toEqual(drawn('lay', 2).stream)
      playTo(game, defs, 40)
      expect(game.employer?.stream).toEqual(drawn('lay', 4).stream)
      playTo(game, defs, 100)
      expect(game.employer?.stream).toEqual(drawn('lay', 6).stream)
    }
  })

  it('is the same for the same seed and commands: employer state and logs match every day', () => {
    const run = (): { employer: unknown; lines: string[] } => {
      const game = start('nightWarehouse', 'same')
      const lines: string[] = []
      for (const [day, log] of playTo(game, sure(0.6), 60)) for (const event of log) lines.push(`${day} ${formatEvent(event)}`)
      return { employer: structuredClone(game.employer), lines }
    }
    const first = run()
    const second = run()
    expect(second.employer).toEqual(first.employer)
    expect(second.lines).toEqual(first.lines)
    expect(first.lines.some((line) => line.includes('kind=layoffWarning'))).toBe(true)
  })

  it('has no employer and draws nothing when the definitions omit layoffs', () => {
    const plain = { ...defs, layoffs: undefined }
    const game = createGame(plain, 'lay', { jobs: JOBS, jobId: 'nightWarehouse' })
    expect(game.employer).toBeUndefined()
    playTo(game, plain, 45)
    expect(game.employer).toBeUndefined()
    expect(kinds(game.log).some((kind) => kind.startsWith('layoff'))).toBe(false)
  })

  it('does not touch the market: a jobless run and a warehouse run of one seed hash the same every day', () => {
    const jobless = start('jobless', 'hash')
    const worker = start('nightWarehouse', 'hash')
    const gameDefs = sure(1)
    for (let day = 1; day <= 100; day += 1) {
      playTo(jobless, gameDefs, day)
      playTo(worker, gameDefs, day)
      expect(stateHash(worker.market), `day ${day}`).toBe(stateHash(jobless.market))
    }
    // The warehouse worker really was cut along the way, so the notices did run.
    expect(worker.employer?.barred).toEqual(['nightWarehouse'])
  })

  it('fast-forwards two draws per roll day on or before the day', () => {
    const employer = createEmployer('ff')
    fastForwardEmployer(employer, 40)
    expect(employer.stream).toEqual(drawn('ff', 4).stream)
    const none = createEmployer('ff')
    fastForwardEmployer(none, 9)
    expect(none.stream).toEqual(drawn('ff', 0).stream)
  })
})

describe('notices', () => {
  it('open on a roll day, confirm on the decision day with +8 stress, and cut on the layoff day', () => {
    const game = start('shopAssistant')
    const gameDefs = sure(1)
    const logs = playTo(game, gameDefs, 10)
    expect(kinds(logs.get(10) ?? [])).toContain('layoffWarning')
    expect(game.employer?.notice).toMatchObject({ jobId: 'shopAssistant', warnedDay: 10, decisionDay: 20, layoffDay: 30, stage: 'rumour', real: true })
    playTo(game, gameDefs, 19)
    game.stats.stress = 10
    const confirm = playTo(game, gameDefs, 20).get(20) ?? []
    expect(kinds(confirm)).toContain('layoffConfirmed')
    const stress = confirm.filter((event) => event.kind === 'statChange' && event.cause === 'layoffNotice')
    expect(stress).toMatchObject([{ stat: 'stress', delta: 8 }])
    expect(game.employer?.notice?.stage).toBe('confirmed')
  })

  it('drop a false rumour on the decision day with no stress and no cut', () => {
    const game = start('shopAssistant')
    const gameDefs = sure(0)
    playTo(game, gameDefs, 19)
    const drop = playTo(game, gameDefs, 20).get(20) ?? []
    expect(kinds(drop)).toContain('layoffDropped')
    expect(drop.some((event) => event.kind === 'statChange' && event.cause === 'layoffNotice')).toBe(false)
    expect(game.employer?.notice).toBeNull()
    playTo(game, gameDefs, 30)
    expect(game.job.jobId).toBe('shopAssistant')
    expect(game.employer?.barred).toEqual([])
  })

  it('never open for the freelance analyst or a jobless player', () => {
    for (const jobId of ['freelanceAnalyst', 'jobless']) {
      const game = start(jobId)
      const logs = playTo(game, sure(1), 45)
      for (const log of logs.values()) expect(kinds(log).some((kind) => kind.startsWith('layoff'))).toBe(false)
      expect(game.employer?.notice).toBeNull()
    }
  })
})

describe('the layoff day', () => {
  it('pays half a month as severance, ends the job, logs it, and bars the employer', () => {
    const game = start('nightWarehouse')
    const gameDefs = sure(1)
    playTo(game, gameDefs, 29)
    const cashBefore = game.accounts.cashCents
    const log = playTo(game, gameDefs, 30).get(30) ?? []
    const order = kinds(log).filter((kind) => ['laidOff', 'severancePaid', 'jobChanged', 'salaryPaid'].includes(kind))
    expect(order.slice(0, 3)).toEqual(['laidOff', 'severancePaid', 'jobChanged'])
    expect(order.slice(3).every((kind) => kind === 'salaryPaid')).toBe(true)
    const paid = log.find((event) => event.kind === 'severancePaid')
    expect(paid).toMatchObject({ job: 'nightWarehouse', amountCents: 65_000 })
    expect(severanceCents(130_000)).toBe(65_000)
    expect(log.find((event) => event.kind === 'jobChanged')).toMatchObject({ from: 'nightWarehouse', to: 'jobless' })
    expect(game.job.jobId).toBe('jobless')
    expect(game.sleepHours).toBe(8)
    expect(game.section).toBe('sleep')
    expect(game.employer?.barred).toEqual(['nightWarehouse'])
    expect(game.employer?.notice).toBeNull()
    // Salary for the 30 days worked is still paid, normally, by the monthly cycle, then the bill.
    const salary = log.find((event) => event.kind === 'salaryPaid' && event.amountCents > 0)
    expect(salary).toMatchObject({ job: 'nightWarehouse', days: 30, amountCents: 130_000 })
    expect(game.accounts.cashCents).toBe(cashBefore + 65_000 + 130_000 - (game.bill === null ? BASE_MONTHLY_EXPENSES_CENTS : 0))
  })

  it('still pays severance when a switch takes effect the same morning, then switches', () => {
    const game = start('nightWarehouse')
    const gameDefs = sure(1)
    playTo(game, gameDefs, 27)
    applyCommand(game, gameDefs, { type: 'setJob', jobId: 'shopAssistant' })
    expect(game.job.pending).toMatchObject({ jobId: 'shopAssistant', effectiveDay: 30 })
    const log = playTo(game, gameDefs, 30).get(30) ?? []
    expect(kinds(log).filter((kind) => kind === 'severancePaid')).toHaveLength(1)
    const changes = log.filter((event) => event.kind === 'jobChanged')
    expect(changes.map((event) => (event.kind === 'jobChanged' ? `${event.from}>${event.to}` : ''))).toEqual([
      'nightWarehouse>jobless',
      'jobless>shopAssistant',
    ])
    expect(game.job.jobId).toBe('shopAssistant')
    expect(game.employer?.barred).toEqual(['nightWarehouse'])
  })

  it('is avoided, with no severance, when the player left before it', () => {
    const game = start('nightWarehouse')
    const gameDefs = sure(1)
    playTo(game, gameDefs, 21)
    applyCommand(game, gameDefs, { type: 'setJob', jobId: 'shopAssistant' })
    const log = playTo(game, gameDefs, 30).get(30) ?? []
    expect(kinds(log)).toContain('layoffAvoided')
    expect(kinds(log)).not.toContain('severancePaid')
    expect(kinds(log)).not.toContain('laidOff')
    expect(game.job.jobId).toBe('shopAssistant')
    expect(game.employer?.barred).toEqual([])
    expect(game.employer?.notice).toBeNull()
  })

  it('rejects rehiring the barred employer for the rest of the run, and lets another job through', () => {
    const game = start('nightWarehouse')
    const gameDefs = sure(1)
    playTo(game, gameDefs, 30)
    applyCommand(game, gameDefs, { type: 'setJob', jobId: 'nightWarehouse' })
    expect(game.pending.at(-1)).toMatchObject({ kind: 'commandRejected', command: 'setJob', reason: 'rehireBlocked' })
    expect(game.job.pending).toBeNull()
    applyCommand(game, gameDefs, { type: 'setJob', jobId: 'shopAssistant' })
    expect(game.pending.at(-1)).toMatchObject({ kind: 'jobChangeRequested', to: 'shopAssistant' })
  })

  it('lowers the loan limit by the lost pay and prices the bill for the new job (no staff discount after a shop layoff)', () => {
    const game = start('shopAssistant')
    const control = start('shopAssistant')
    const gameDefs = sure(1)
    const noLayoffs = layoffDefs({ ...LAYOFFS, jobs: [] })
    playTo(game, gameDefs, 29)
    playTo(control, noLayoffs, 29)
    expect(loanLimitCents(game)).toBe(loanLimitCents(control))
    const before = loanLimitCents(game)
    const log = playTo(game, gameDefs, 30).get(30) ?? []
    const controlLog = playTo(control, noLayoffs, 30).get(30) ?? []
    expect(loanLimitCents(game)).toBe(before - 60_000)
    const bill = log.find((event) => event.kind === 'billDue')
    const controlBill = controlLog.find((event) => event.kind === 'billDue')
    expect(bill).toMatchObject({ amountCents: BASE_MONTHLY_EXPENSES_CENTS })
    expect(controlBill).toMatchObject({ amountCents: BASE_MONTHLY_EXPENSES_CENTS - BASE_MONTHLY_EXPENSES_CENTS / 20 })
  })
})
