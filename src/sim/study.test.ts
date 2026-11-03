import { describe, expect, it } from 'vitest'
import {
  RESEARCH_POINTS_DAYTIME,
  RESEARCH_POINTS_EVENING,
  RESEARCH_POINTS_MAX,
  STARTING_RESEARCH_POINTS,
  STUDY_ENERGY_DAYTIME,
} from './constants.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { formatEvent } from './log.ts'
import type { GameState, JobDefinition, MarketDefinitions } from './types.ts'

const MARKET_DEFINITIONS: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
}

const JOB_DEFINITIONS: readonly JobDefinition[] = [
  { id: 'jobless', name: 'Jobless', slots: 0, payCents: 0, requirement: 'none', perk: 'none', energyCost: 0, stressCost: 0, sleepHours: 8 },
  { id: 'shopAssistant', name: 'Shop assistant', slots: 1, payCents: 60_000, requirement: 'none', perk: 'none', energyCost: 5, stressCost: 2, sleepHours: 8 },
]

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugStudy(message: string): void {
  io.writeSync(1, `[DEBUG study] ${message}\n`)
}

function lastRejection(game: GameState): string | null {
  const event = game.log.at(-1)
  return event?.kind === 'commandRejected' ? event.reason : null
}

describe('free time: research, courses and verify', () => {
  it('lets a jobless player research by day and by evening, once each', () => {
    const game = createGame(MARKET_DEFINITIONS, 'study', { jobs: JOB_DEFINITIONS, jobId: 'jobless' })
    const energy = game.stats.energy
    applyCommand(game, MARKET_DEFINITIONS, { type: 'study', slot: 'daytime', activity: 'research' })
    expect(game.study.points).toBe(STARTING_RESEARCH_POINTS + RESEARCH_POINTS_DAYTIME)
    expect(game.stats.energy).toBe(energy - STUDY_ENERGY_DAYTIME)
    debugStudy(formatEvent(game.log.at(-1)!))
    applyCommand(game, MARKET_DEFINITIONS, { type: 'study', slot: 'daytime', activity: 'research' })
    expect(lastRejection(game)).toBe('slotUsed')
    // A jobless player can still open the market after a daytime of research.
    applyCommand(game, MARKET_DEFINITIONS, { type: 'skip' })
    expect(game.section).toBe('market')
    applyCommand(game, MARKET_DEFINITIONS, { type: 'study', slot: 'evening', activity: 'research' })
    expect(lastRejection(game)).toBe('marketOpen')
    endDay(game, MARKET_DEFINITIONS)
    expect(game.study.used).toEqual([])
  })

  it('gives a worker the evening only, and keeps the market closed after it', () => {
    const game = createGame(MARKET_DEFINITIONS, 'study-job', { jobs: JOB_DEFINITIONS, jobId: 'shopAssistant' })
    applyCommand(game, MARKET_DEFINITIONS, { type: 'study', slot: 'daytime', activity: 'research' })
    expect(lastRejection(game)).toBe('notFree')
    applyCommand(game, MARKET_DEFINITIONS, { type: 'study', slot: 'evening', activity: 'research' })
    expect(game.study.points).toBe(STARTING_RESEARCH_POINTS + RESEARCH_POINTS_EVENING)
    applyCommand(game, MARKET_DEFINITIONS, { type: 'skip' })
    expect(lastRejection(game)).toBe('studiedEvening')
    expect(game.section).toBe('work')
    applyCommand(game, MARKET_DEFINITIONS, { type: 'study', slot: 'evening', activity: 'course' })
    expect(lastRejection(game)).toBe('slotUsed')
  })

  it('spends one point per verify, once a day, and refuses without points', () => {
    const game = createGame(MARKET_DEFINITIONS, 'verify', { jobs: JOB_DEFINITIONS, jobId: 'jobless' })
    for (let n = 0; n < STARTING_RESEARCH_POINTS; n += 1) {
      applyCommand(game, MARKET_DEFINITIONS, { type: 'verify' })
      expect(game.perception.verified).toBe(true)
      applyCommand(game, MARKET_DEFINITIONS, { type: 'verify' })
      expect(lastRejection(game)).toBe('alreadyVerified')
      endDay(game, MARKET_DEFINITIONS)
    }
    expect(game.study.points).toBe(0)
    applyCommand(game, MARKET_DEFINITIONS, { type: 'verify' })
    expect(lastRejection(game)).toBe('noResearch')
    expect(game.perception.verified).toBe(false)
  })

  it('caps research points', () => {
    const game = createGame(MARKET_DEFINITIONS, 'cap', { jobs: JOB_DEFINITIONS, jobId: 'jobless' })
    for (let day = 0; day < 6; day += 1) {
      applyCommand(game, MARKET_DEFINITIONS, { type: 'study', slot: 'daytime', activity: 'research' })
      applyCommand(game, MARKET_DEFINITIONS, { type: 'study', slot: 'evening', activity: 'research' })
      endDay(game, MARKET_DEFINITIONS)
    }
    expect(game.study.points).toBe(RESEARCH_POINTS_MAX)
  })

  it('refuses course study without an enrolment', () => {
    const game = createGame(MARKET_DEFINITIONS, 'course', { jobs: JOB_DEFINITIONS, jobId: 'jobless' })
    applyCommand(game, MARKET_DEFINITIONS, { type: 'study', slot: 'daytime', activity: 'course' })
    expect(lastRejection(game)).toBe('notEnrolled')
    expect(game.study.used).toEqual([])
  })
})
