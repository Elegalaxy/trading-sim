import { describe, expect, it } from 'vitest'

import {
  BASE_MONTHLY_EXPENSES_CENTS,
  COURSE_COST_CENTS,
  HOME_TIER_COST_CENTS,
  INFO_FEED_TIER_COST_CENTS,
  LIFESTYLE_UPFRONT_MULTIPLIER,
  STARTING_CASH_CENTS,
} from './constants.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { jobVisibleFeed } from './jobs.ts'
import { lifestyleExpensesCents, playerVisibleFeed } from './lifestyle.ts'
import { formatEvent } from './log.ts'
import type { GameState, JobDefinition, MarketDefinitions } from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugLifestyle(message: string): void {
  io.writeSync(1, `[DEBUG lifestyle] ${message}\n`)
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

function billDueCents(game: GameState): number {
  const due = [...game.log].reverse().find((event) => event.kind === 'billDue')
  if (due?.kind !== 'billDue') throw new Error('[DEBUG lifestyle] missing billDue')
  return due.amountCents
}

function rejectionReason(game: GameState): string {
  const event = [...game.log].reverse().find((entry) => entry.kind === 'commandRejected')
  if (event?.kind !== 'commandRejected') throw new Error('[DEBUG lifestyle] missing commandRejected')
  return event.reason
}

function sourceIds(feed: GameState['market']['feed']): string[] {
  return feed.items.map((item) => (item.kind === 'rumour' ? item.sourceId : item.eventId)).sort()
}

describe('lifestyle upgrades, downgrades, and courses', () => {
  it('raises the next bill by the tier cost and refunds nothing on a downgrade', () => {
    expect(HOME_TIER_COST_CENTS).toBe(15_000)
    expect(INFO_FEED_TIER_COST_CENTS).toBe(10_000)
    expect(LIFESTYLE_UPFRONT_MULTIPLIER).toBe(2)
    expect(COURSE_COST_CENTS).toBe(50_000)
    const defs = market(false)
    const game = createGame(defs, 'life', { jobs: JOBS, jobId: 'jobless' })
    expect(game.lifestyle).toEqual({ home: 0, infoFeed: 0 })
    expect(game.stats.energy).toBe(80)
    const upfront = HOME_TIER_COST_CENTS * LIFESTYLE_UPFRONT_MULTIPLIER
    applyCommand(game, defs, { type: 'setLifestyle', category: 'home', tier: 1 })
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS - upfront)
    expect(game.lifestyle.home).toBe(1)
    expect(game.stats.energy).toBe(80)
    expect(lifestyleExpensesCents(game.lifestyle)).toBe(BASE_MONTHLY_EXPENSES_CENTS + HOME_TIER_COST_CENTS)
    const change = game.log.at(-1)
    if (change?.kind !== 'lifestyleChange') throw new Error('[DEBUG lifestyle] missing lifestyleChange')
    expect(formatEvent(change)).toBe(
      `day=0 kind=lifestyleChange category=home from=0 to=1 upfront=${upfront} expenses=${BASE_MONTHLY_EXPENSES_CENTS + HOME_TIER_COST_CENTS}`,
    )
    debugLifestyle(
      `upgrade home 0->1 upfront=${change.upfront} cash=${game.accounts.cashCents} expenses=${change.expensesCents}`,
    )

    advance(game, defs, 30)
    expect(billDueCents(game)).toBe(BASE_MONTHLY_EXPENSES_CENTS + HOME_TIER_COST_CENTS)
    expect(game.bill).toBeNull()
    const paid = STARTING_CASH_CENTS - upfront - (BASE_MONTHLY_EXPENSES_CENTS + HOME_TIER_COST_CENTS)
    expect(game.accounts.cashCents).toBe(paid)
    debugLifestyle(`next bill=${billDueCents(game)} after home tier 1`)

    applyCommand(game, defs, { type: 'setLifestyle', category: 'home', tier: 0 })
    expect(game.accounts.cashCents).toBe(paid)
    expect(game.lifestyle.home).toBe(0)
    const downgrade = [...game.log].reverse().find((event) => event.kind === 'lifestyleChange')
    if (downgrade?.kind !== 'lifestyleChange') throw new Error('[DEBUG lifestyle] missing downgrade')
    expect(downgrade.upfront).toBe(0)
    expect(downgrade.expensesCents).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    debugLifestyle(`downgrade home 1->0 upfront=${downgrade.upfront} cash=${game.accounts.cashCents}`)

    advance(game, defs, 30)
    expect(billDueCents(game)).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    expect(game.accounts.cashCents).toBe(paid - BASE_MONTHLY_EXPENSES_CENTS)
    debugLifestyle(`next bill=${billDueCents(game)} after downgrade, cash did not rise`)
  })

  it('leaves a pending bill unchanged when lifestyle is downgraded', () => {
    const defs = market(false)
    const game = createGame(defs, 'pending', { jobs: JOBS, jobId: 'jobless' })
    applyCommand(game, defs, { type: 'setLifestyle', category: 'home', tier: 1 })
    const moved = game.accounts.cashCents
    applyCommand(game, defs, { type: 'transfer', from: 'cash', to: 'trading', amountCents: moved })
    expect(game.accounts.cashCents).toBe(0)
    advance(game, defs, 30)
    if (game.bill === null) throw new Error('[DEBUG lifestyle] expected a pending bill')
    const frozen = game.bill.amountCents
    expect(frozen).toBe(BASE_MONTHLY_EXPENSES_CENTS + HOME_TIER_COST_CENTS)
    applyCommand(game, defs, { type: 'setLifestyle', category: 'home', tier: 0 })
    expect(game.bill?.amountCents).toBe(frozen)
    expect(game.accounts.cashCents).toBe(0)
    expect(game.lifestyle.home).toBe(0)
    debugLifestyle(`pending bill stayed ${game.bill?.amountCents} after downgrade`)

    applyCommand(game, defs, { type: 'transfer', from: 'trading', to: 'cash', amountCents: frozen })
    applyCommand(game, defs, { type: 'payBill' })
    expect(game.bill).toBeNull()
    advance(game, defs, 30)
    expect(billDueCents(game)).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    debugLifestyle(`following bill=${billDueCents(game)} after the frozen bill was paid`)
  })

  it('applies the staff discount to base plus tier costs', () => {
    const defs = market(false)
    const game = createGame(defs, 'shop', { jobs: JOBS, jobId: 'shopAssistant' })
    applyCommand(game, defs, { type: 'setLifestyle', category: 'infoFeed', tier: 1 })
    const expenses = BASE_MONTHLY_EXPENSES_CENTS + INFO_FEED_TIER_COST_CENTS
    expect(lifestyleExpensesCents(game.lifestyle)).toBe(expenses)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS - INFO_FEED_TIER_COST_CENTS * LIFESTYLE_UPFRONT_MULTIPLIER)
    advance(game, defs, 30)
    const discounted = expenses - Math.round((expenses * 5) / 100)
    expect(billDueCents(game)).toBe(discounted)
    const perk = game.log.find((event) => event.kind === 'perkApplied')
    if (perk?.kind !== 'perkApplied') throw new Error('[DEBUG lifestyle] missing staff discount')
    expect(perk.perk).toBe('staffDiscount')
    debugLifestyle(`shop bill=${billDueCents(game)} expenses=${expenses} perk=${perk.perk}`)
  })

  it('unlocks course-gated jobs and does not change the monthly bill', () => {
    const defs = market(false)
    const game = createGame(defs, 'course', { jobs: JOBS, jobId: 'jobless' })
    for (const jobId of ['officeClerk', 'tradingFloor', 'freelanceAnalyst']) {
      expect(() => applyCommand(game, defs, { type: 'setJob', jobId })).not.toThrow()
      expect(rejectionReason(game)).toBe('jobLocked')
      expect(game.job.jobId).toBe('jobless')
      debugLifestyle(`before course ${jobId} rejected ${rejectionReason(game)}`)
    }

    applyCommand(game, defs, { type: 'buyCourse', course: 'finance' })
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS - COURSE_COST_CENTS)
    expect(game.job.courses).toEqual(['finance'])
    expect(lifestyleExpensesCents(game.lifestyle)).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    const bought = game.log.at(-1)
    if (bought?.kind !== 'coursePurchased') throw new Error('[DEBUG lifestyle] missing coursePurchased')
    expect(formatEvent(bought)).toBe(`day=0 kind=coursePurchased course=finance cost=${COURSE_COST_CENTS}`)
    debugLifestyle(`coursePurchased finance cost=${bought.cost} expenses=${lifestyleExpensesCents(game.lifestyle)}`)

    applyCommand(game, defs, { type: 'setJob', jobId: 'tradingFloor' })
    expect(game.log.at(-1)?.kind).toBe('jobChangeRequested')
    applyCommand(game, defs, { type: 'setJob', jobId: 'freelanceAnalyst' })
    expect(game.job.pending?.jobId).toBe('freelanceAnalyst')
    expect(() => applyCommand(game, defs, { type: 'setJob', jobId: 'officeClerk' })).not.toThrow()
    expect(rejectionReason(game)).toBe('jobLocked')

    const cash = game.accounts.cashCents
    applyCommand(game, defs, { type: 'buyCourse', course: 'basic' })
    expect(game.job.courses).toEqual(['finance', 'basic'])
    expect(game.accounts.cashCents).toBe(cash - COURSE_COST_CENTS)
    applyCommand(game, defs, { type: 'setJob', jobId: 'officeClerk' })
    expect(game.job.pending?.jobId).toBe('officeClerk')
    expect(() => applyCommand(game, defs, { type: 'buyCourse', course: 'finance' })).not.toThrow()
    expect(rejectionReason(game)).toBe('alreadyOwned')
    expect(game.accounts.cashCents).toBe(cash - COURSE_COST_CENTS)
    debugLifestyle('finance unlocks tradingFloor and freelanceAnalyst; basic unlocks officeClerk')

    advance(game, defs, 30)
    expect(billDueCents(game)).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    debugLifestyle(`course bill=${billDueCents(game)} unchanged`)
  })

  it('rejects too little cash without throwing or changing tiers', () => {
    const defs = market(false)
    const game = createGame(defs, 'broke', { jobs: JOBS, jobId: 'jobless' })
    applyCommand(game, defs, { type: 'transfer', from: 'cash', to: 'trading', amountCents: STARTING_CASH_CENTS })
    expect(game.accounts.cashCents).toBe(0)
    expect(() => applyCommand(game, defs, { type: 'setLifestyle', category: 'home', tier: 1 })).not.toThrow()
    expect(rejectionReason(game)).toBe('insufficientFunds')
    expect(game.lifestyle.home).toBe(0)
    expect(game.accounts.cashCents).toBe(0)
    expect(() => applyCommand(game, defs, { type: 'buyCourse', course: 'basic' })).not.toThrow()
    expect(rejectionReason(game)).toBe('insufficientFunds')
    expect(game.job.courses).toEqual([])
    expect(() => applyCommand(game, defs, { type: 'setLifestyle', category: 'home', tier: 4 })).not.toThrow()
    expect(rejectionReason(game)).toBe('invalidTier')
    expect(() => applyCommand(game, defs, { type: 'setLifestyle', category: 'yacht', tier: 1 })).not.toThrow()
    expect(rejectionReason(game)).toBe('unknownCategory')
    expect(() => applyCommand(game, defs, { type: 'setLifestyle', category: 'home', tier: 0 })).not.toThrow()
    expect(rejectionReason(game)).toBe('alreadyAtTier')
    expect(() => applyCommand(game, defs, { type: 'buyCourse' })).not.toThrow()
    expect(rejectionReason(game)).toBe('unknownCourse')
    debugLifestyle('rejected insufficientFunds cash=0 home=0 courses=')
  })

  it('changes only feed visibility, and the market hash without the player block stays identical', () => {
    const defs = market(true)
    const game = createGame(defs, 'hash', { jobs: JOBS, jobId: 'jobless' })
    const stored = JSON.stringify(game.market.feed)
    const jobless = JOBS[0]
    if (jobless === undefined) throw new Error('[DEBUG lifestyle] missing jobless')
    const baseSeen = sourceIds(playerVisibleFeed(game.market.feed, jobless, game.lifestyle))
    expect(baseSeen).toEqual(sourceIds(jobVisibleFeed(game.market.feed, jobless)))
    expect(baseSeen).toEqual(['marketBrief', 'openChatter', 'streetTalk'])
    expect(JSON.stringify(game.market.feed)).toBe(stored)

    applyCommand(game, defs, { type: 'setLifestyle', category: 'infoFeed', tier: 1 })
    expect(JSON.stringify(game.market.feed)).toBe(stored)
    const tier1 = sourceIds(playerVisibleFeed(game.market.feed, jobless, game.lifestyle))
    expect(tier1).toContain('sectorNote')
    expect(tier1).toContain('streetTalk')
    expect(tier1).not.toContain('cityDesk')

    applyCommand(game, defs, { type: 'setLifestyle', category: 'infoFeed', tier: 2 })
    expect(JSON.stringify(game.market.feed)).toBe(stored)
    const tier2 = sourceIds(playerVisibleFeed(game.market.feed, jobless, game.lifestyle))
    expect(tier2).toContain('cityDesk')
    expect(tier2).toContain('sectorNote')
    expect(tier2).toContain('marketBrief')
    expect(tier2).not.toContain('streetTalk')
    expect(tier2).not.toContain('openChatter')
    debugLifestyle(`visible tier0=${baseSeen.join(',')} tier1=${tier1.join(',')} tier2=${tier2.join(',')}`)

    const contacts = JOBS.find((job) => job.id === 'tradingFloor')
    const analyst = JOBS.find((job) => job.id === 'freelanceAnalyst')
    if (contacts === undefined || analyst === undefined) throw new Error('[DEBUG lifestyle] missing perk jobs')
    const contactSeen = sourceIds(playerVisibleFeed(game.market.feed, contacts, { home: 0, infoFeed: 2 }))
    expect(contactSeen).toContain('floorWire')
    expect(contactSeen).toContain('cityDesk')
    expect(contactSeen).not.toContain('openChatter')
    const analystSeen = sourceIds(playerVisibleFeed(game.market.feed, analyst, { home: 0, infoFeed: 1 }))
    expect(analystSeen).toContain('sectorNote')
    expect(analystSeen.every((id) => id !== 'streetTalk' && id !== 'openChatter')).toBe(true)
    expect(JSON.stringify(game.market.feed)).toBe(stored)

    const plain = createGame(defs, 'hash', { jobs: JOBS, jobId: 'jobless' })
    advance(plain, defs, 30)
    advance(game, defs, 30)
    expect(stateHash(game.market)).toBe(stateHash(plain.market))
    expect(JSON.stringify(game.market.feed)).toBe(JSON.stringify(plain.market.feed))
    expect(billDueCents(game)).toBe(BASE_MONTHLY_EXPENSES_CENTS + INFO_FEED_TIER_COST_CENTS * 2)
    expect(billDueCents(plain)).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    debugLifestyle(`market hash without the player block ${stateHash(game.market)}`)
  })
})
