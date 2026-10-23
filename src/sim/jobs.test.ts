import { describe, expect, it } from 'vitest'

import { BASE_MONTHLY_EXPENSES_CENTS, CENTS_PER_E, JOB_NOTICE_DAYS, STARTING_CASH_CENTS } from './constants.ts'
import { dayBlocks } from './day.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { jobVisibleFeed } from './jobs.ts'
import { formatEvent } from './log.ts'
import type { GameState, JobDefinition, MarketDefinitions } from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugJobs(message: string): void {
  io.writeSync(1, `[DEBUG jobs] ${message}\n`)
}

const JOBS: readonly JobDefinition[] = [
  { id: 'jobless', name: 'Jobless', slots: 0, payCents: 0, requirement: 'none', perk: 'none', energyCost: 0, stressCost: 0, sleepHours: 8 },
  { id: 'shopAssistant', name: 'Shop assistant', slots: 1, payCents: 60_000, requirement: 'none', perk: 'staffDiscount', energyCost: 5, stressCost: 2, sleepHours: 8 },
  { id: 'officeClerk', name: 'Office clerk', slots: 2, payCents: 110_000, requirement: 'basic', perk: 'steadyRoutine', energyCost: 10, stressCost: 8, sleepHours: 8 },
  { id: 'nightWarehouse', name: 'Night-shift warehouse', slots: 2, payCents: 130_000, requirement: 'none', perk: 'quietBreaks', energyCost: 20, stressCost: 12, sleepHours: 6 },
  { id: 'tradingFloor', name: 'Trading-floor assistant', slots: 2, payCents: 100_000, requirement: 'finance', perk: 'industryContacts', energyCost: 12, stressCost: 15, sleepHours: 7 },
  { id: 'freelanceAnalyst', name: 'Freelance analyst', slots: 1, payCents: 80_000, requirement: 'finance', perk: 'analystTools', energyCost: 6, stressCost: 6, sleepHours: 8 },
]

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 1000, borrowFeePpm: 100 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1000, borrowFeePpm: 100 },
]

function market(withFeed: boolean): MarketDefinitions {
  return {
    assets: ASSETS,
    environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
    events: withFeed
      ? [
          {
            id: 'scandal',
            scope: 'stock',
            targets: ['NOVA'],
            chance: 0,
            direction: { up: 0.5, down: 0.4, none: 0.1 },
            magnitudeMin: 2,
            magnitudeMax: 2,
            duration: 1,
            decay: 'linear',
            headline: '{target} {direction}',
            modifiers: [],
          },
        ]
      : [],
    sources: withFeed
      ? [
          { id: 'cityDesk', tier: 'high', hitRate: 0, visibility: ['infoFeed2'] },
          { id: 'floorWire', tier: 'high', hitRate: 0, visibility: ['jobContacts'] },
          { id: 'sectorNote', tier: 'medium', hitRate: 0, visibility: ['infoFeed1'] },
          { id: 'marketBrief', tier: 'medium', hitRate: 0, visibility: ['base'] },
          { id: 'streetTalk', tier: 'low', hitRate: 0, visibility: ['base', 'infoFeed1'] },
          { id: 'openChatter', tier: 'low', hitRate: 0, visibility: ['base', 'jobContacts'] },
        ]
      : undefined,
  }
}

function advance(game: GameState, defs: MarketDefinitions, days: number): void {
  for (let step = 0; step < days; step += 1) endDay(game, defs)
}

function salaryLines(game: GameState): string[] {
  return game.log.filter((event) => event.kind === 'salaryPaid').map((event) => formatEvent(event))
}

function sourceIds(feed: GameState['market']['feed']): string[] {
  return feed.items.map((item) => (item.kind === 'rumour' ? item.sourceId : item.eventId)).sort()
}

describe('jobs, notice, salary, and feed visibility', () => {
  it('starts jobless when no job is passed, and shop assistant shows part-time work', () => {
    expect(CENTS_PER_E).toBe(100_000)
    expect(JOB_NOTICE_DAYS).toBe(3)
    const defs = market(false)
    const jobless = createGame(defs, 'demo')
    expect(jobless.job.jobId).toBe('jobless')
    expect(jobless.section).toBe('sleep')
    expect(jobless.sleepHours).toBe(8)
    expect(jobless.job.pending).toBeNull()
    debugJobs(`default job=${jobless.job.jobId} section=${jobless.section} sleepHours=${jobless.sleepHours}`)

    const shop = createGame(defs, 'shop', { jobs: JOBS, jobId: 'shopAssistant' })
    expect(shop.section).toBe('work')
    expect(shop.sleepHours).toBe(8)
    expect(shop.job.pending).toBeNull()
    const blocks = dayBlocks(shop.sleepHours, false, 1)
    expect(blocks[0]?.clock).toBe('23:00-07:00 (8h)')
    expect(blocks[1]?.clock).toBe('08:00-12:00')
    expect(blocks[1]?.empty).toBe(false)
    expect(blocks[2]?.clock).toBe('17:00-21:00')
    debugJobs(`shop section=${shop.section} work=${blocks[1]?.clock} sleep=${blocks[0]?.clock}`)

    applyCommand(shop, defs, { type: 'skip' })
    expect(shop.section).toBe('market')
    expect(shop.log.some((event) => event.kind === 'skip' && event.from === 'work')).toBe(true)
    debugJobs('shop skip from=work to=market')
  })

  it('rejects locked and unknown jobs without throwing, and applies night warehouse after 3 days', () => {
    const defs = market(false)
    const game = createGame(defs, 'notice', { jobs: JOBS, jobId: 'shopAssistant' })
    const before = JSON.stringify({
      jobId: game.job.jobId,
      pending: game.job.pending,
      sleepHours: game.sleepHours,
      cash: game.accounts.cashCents,
    })
    for (const jobId of ['officeClerk', 'tradingFloor', 'freelanceAnalyst']) {
      expect(() => applyCommand(game, defs, { type: 'setJob', jobId })).not.toThrow()
      const rejected = game.log.at(-1)
      if (rejected?.kind !== 'commandRejected') throw new Error(`[DEBUG jobs] missing rejection for ${jobId}`)
      expect(rejected.reason).toBe('jobLocked')
      expect(rejected.command).toBe('setJob')
      expect(formatEvent(rejected)).toBe(`day=0 kind=commandRejected command="setJob" reason=jobLocked`)
      debugJobs(formatEvent(rejected) + ` job=${jobId}`)
    }
    expect(() => applyCommand(game, defs, { type: 'setJob', jobId: 'ceo' })).not.toThrow()
    expect(game.log.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'unknownJob' })
    expect(() => applyCommand(game, defs, { type: 'setJob' })).not.toThrow()
    expect(game.log.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'unknownJob' })
    expect(() => applyCommand(game, defs, { type: 'setJob', jobId: 'shopAssistant' })).not.toThrow()
    expect(game.log.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'alreadyEmployed' })
    expect(
      JSON.stringify({
        jobId: game.job.jobId,
        pending: game.job.pending,
        sleepHours: game.sleepHours,
        cash: game.accounts.cashCents,
      }),
    ).toBe(before)
    debugJobs('locked and unknown choices left the job unchanged')

    expect(() => createGame(defs, 'locked', { jobs: JOBS, jobId: 'officeClerk' })).toThrow(/locked/)

    applyCommand(game, defs, { type: 'setJob', jobId: 'nightWarehouse' })
    const requested = game.log.at(-1)
    if (requested?.kind !== 'jobChangeRequested') throw new Error('[DEBUG jobs] missing jobChangeRequested')
    expect(requested).toEqual({
      kind: 'jobChangeRequested',
      day: 0,
      from: 'shopAssistant',
      to: 'nightWarehouse',
      effectiveDay: 3,
    })
    expect(formatEvent(requested)).toBe(
      'day=0 kind=jobChangeRequested from=shopAssistant to=nightWarehouse effectiveDay=3',
    )
    expect(game.job.jobId).toBe('shopAssistant')
    expect(game.sleepHours).toBe(8)
    debugJobs(formatEvent(requested))

    advance(game, defs, 2)
    expect(game.market.day).toBe(2)
    expect(game.job.jobId).toBe('shopAssistant')
    expect(game.sleepHours).toBe(8)
    endDay(game, defs)
    expect(game.market.day).toBe(3)
    expect(game.job.jobId).toBe('nightWarehouse')
    expect(game.job.pending).toBeNull()
    expect(game.sleepHours).toBe(6)
    expect(game.section).toBe('work')
    const changed = game.log.find((event) => event.kind === 'jobChanged')
    if (changed?.kind !== 'jobChanged') throw new Error('[DEBUG jobs] missing jobChanged')
    expect(changed.sleepHours).toBe(6)
    expect(changed.slots).toBe(2)
    expect(formatEvent(changed)).toBe(
      'day=3 kind=jobChanged from=shopAssistant to=nightWarehouse slots=2 sleepHours=6',
    )
    expect(game.log.some((event) => event.kind === 'perkApplied')).toBe(false)
    const night = dayBlocks(game.sleepHours, false, 2)
    expect(night[0]?.clock).toBe('01:00-07:00 (6h)')
    expect(night[1]?.clock).toBe('08:00-16:00')
    expect(night[1]?.empty).toBe(false)
    debugJobs(`${formatEvent(changed)} work=${night[1]?.clock} sleep=${night[0]?.clock}`)

    const costs = JOBS.find((job) => job.id === 'nightWarehouse')
    expect(costs?.energyCost).toBe(20)
    expect(costs?.stressCost).toBe(12)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    debugJobs(`night energy=${costs?.energyCost} stress=${costs?.stressCost} cash unchanged=${game.accounts.cashCents}`)
  })

  it('prorates a mid-month switch and discounts only the bill that comes due while the perk is active', () => {
    const defs = market(false)
    const game = createGame(defs, 'split', { jobs: JOBS, jobId: 'shopAssistant' })
    const quiet = createGame(defs, 'split', { jobs: JOBS, jobId: 'jobless' })
    advance(game, defs, 7)
    expect(game.market.day).toBe(7)
    applyCommand(game, defs, { type: 'setJob', jobId: 'nightWarehouse' })
    advance(game, defs, 23)
    advance(quiet, defs, 30)
    expect(game.market.day).toBe(30)
    expect(stateHash(game.market)).toBe(stateHash(quiet.market))
    const lines = salaryLines(game)
    expect(lines).toEqual([
      'day=30 kind=salaryPaid job=shopAssistant days=10 amount=20000',
      'day=30 kind=salaryPaid job=nightWarehouse days=20 amount=86667',
    ])
    const paid = 20_000 + 86_667
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS + paid - BASE_MONTHLY_EXPENSES_CENTS)
    expect(game.log.some((event) => event.kind === 'perkApplied')).toBe(false)
    const due = game.log.find((event) => event.kind === 'billDue')
    if (due?.kind !== 'billDue') throw new Error('[DEBUG jobs] missing billDue')
    expect(due.amountCents).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    debugJobs(`${lines.join(' | ')} bill=${due.amountCents} cash=${game.accounts.cashCents} hash=${stateHash(game.market)}`)

    const shop = createGame(defs, 'discount', { jobs: JOBS, jobId: 'shopAssistant' })
    advance(shop, defs, 30)
    const discount = shop.log.find((event) => event.kind === 'perkApplied')
    if (discount?.kind !== 'perkApplied') throw new Error('[DEBUG jobs] missing staff discount')
    expect(formatEvent(discount)).toBe('day=30 kind=perkApplied job=shopAssistant perk=staffDiscount')
    const shopDue = shop.log.find((event) => event.kind === 'billDue')
    if (shopDue?.kind !== 'billDue') throw new Error('[DEBUG jobs] missing discounted bill')
    expect(shopDue.amountCents).toBe(95_000)
    expect(salaryLines(shop)).toEqual(['day=30 kind=salaryPaid job=shopAssistant days=30 amount=60000'])
    expect(shop.accounts.cashCents).toBe(STARTING_CASH_CENTS + 60_000 - 95_000)
    debugJobs(`${formatEvent(discount)} ${formatEvent(shopDue)} cash=${shop.accounts.cashCents}`)

    const pending = createGame(defs, 'pending', { jobs: JOBS, jobId: 'jobless' })
    applyCommand(pending, defs, { type: 'transfer', from: 'cash', to: 'trading', amountCents: STARTING_CASH_CENTS })
    advance(pending, defs, 30)
    if (pending.bill === null) throw new Error('[DEBUG jobs] expected a pending bill')
    expect(pending.bill.amountCents).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    const frozen = pending.bill.amountCents
    applyCommand(pending, defs, { type: 'setJob', jobId: 'shopAssistant' })
    expect(pending.job.jobId).toBe('jobless')
    expect(pending.job.pending?.jobId).toBe('shopAssistant')
    expect(pending.bill?.amountCents).toBe(frozen)
    debugJobs(`pending bill stayed ${pending.bill?.amountCents} after requesting shop assistant`)
  })

  it('keeps the market hash and the stored feed identical for every job, and lets perks change only visibility', () => {
    const defs = market(true)
    const baseline = createGame(defs, 'hash', { jobs: JOBS, jobId: 'jobless' })
    const stored = JSON.stringify(baseline.market.feed)
    const joblessSeen = sourceIds(jobVisibleFeed(baseline.market.feed, JOBS[0]!))
    const contacts = JOBS.find((job) => job.id === 'tradingFloor')
    const analyst = JOBS.find((job) => job.id === 'freelanceAnalyst')
    if (contacts === undefined || analyst === undefined) throw new Error('[DEBUG jobs] missing perk jobs')
    const contactSeen = sourceIds(jobVisibleFeed(baseline.market.feed, contacts))
    const analystSeen = sourceIds(jobVisibleFeed(baseline.market.feed, analyst))
    expect(JSON.stringify(baseline.market.feed)).toBe(stored)
    expect(joblessSeen).toEqual(['marketBrief', 'openChatter', 'streetTalk'])
    expect(contactSeen).toContain('floorWire')
    expect(joblessSeen).not.toContain('floorWire')
    expect(analystSeen.every((id) => id !== 'streetTalk' && id !== 'openChatter')).toBe(true)
    expect(analystSeen).toContain('marketBrief')
    debugJobs(`visible jobless=${joblessSeen.join(',')} contacts=${contactSeen.join(',')} analyst=${analystSeen.join(',')}`)

    advance(baseline, defs, 30)
    const hash = stateHash(baseline.market)
    const feed = JSON.stringify(baseline.market.feed)
    for (const job of JOBS) {
      const game = createGame(defs, 'hash', { jobs: JOBS, jobId: 'jobless' })
      const chosen = game.job.catalog.find((item) => item.id === job.id)
      if (chosen === undefined) throw new Error(`[DEBUG jobs] missing ${job.id}`)
      game.job.jobId = chosen.id
      game.sleepHours = chosen.sleepHours
      game.section = chosen.slots === 0 ? 'sleep' : 'work'
      advance(game, defs, 30)
      expect(stateHash(game.market)).toBe(hash)
      expect(JSON.stringify(game.market.feed)).toBe(feed)
      debugJobs(`job=${job.id} marketHash=${stateHash(game.market)} feedDay=${game.market.feed.day} same=true`)
    }
    debugJobs(`market hash without the player block ${hash}`)

    const unlocked = createGame(defs, 'course', { jobs: JOBS, jobId: 'jobless' })
    unlocked.job.courses.push('finance')
    applyCommand(unlocked, defs, { type: 'setJob', jobId: 'tradingFloor' })
    const request = unlocked.log.at(-1)
    if (request?.kind !== 'jobChangeRequested') throw new Error('[DEBUG jobs] finance course did not open the job')
    advance(unlocked, defs, 3)
    const perk = unlocked.log.find((event) => event.kind === 'perkApplied')
    if (perk?.kind !== 'perkApplied') throw new Error('[DEBUG jobs] missing industry contacts')
    expect(formatEvent(perk)).toBe('day=3 kind=perkApplied job=tradingFloor perk=industryContacts')
    expect(unlocked.sleepHours).toBe(7)
    debugJobs(`${formatEvent(perk)} sleepHours=${unlocked.sleepHours}`)
  })
})
