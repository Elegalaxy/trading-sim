import { describe, expect, it } from 'vitest'

import { applyCommand, createGame, endDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { STARTING_CASH_CENTS } from '../sim/constants.ts'
import type { GameState, MarketDefinitions } from '../sim/types.ts'
import {
  DAMAGED_SAVE_MESSAGE,
  SAVE_KEY,
  SAVE_VERSION,
  inspectSave,
  loadSave,
  writeSave,
  type SaveResult,
  type SaveStorage,
} from './save.ts'
import {
  DAMAGED_SCORES_MESSAGE,
  SCORES_KEY,
  loadScores,
  recordScore,
  type ScoreResult,
  type ScoreRow,
} from './scores.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugSave(message: string): void {
  io.writeSync(1, `[DEBUG save] ${message}\n`)
}

const DEFS: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022 },
    { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018 },
    { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01 },
    { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0 },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
}

type Command = { type: 'skip' } | { type: 'transfer'; from: 'trading'; to: 'cash'; amountCents: number }

function memory(): SaveStorage & { raw(key: string): string | null } {
  const map = new Map<string, string>()
  return {
    getItem(key) {
      return map.get(key) ?? null
    },
    setItem(key, value) {
      if (typeof key !== 'string' || key.length === 0 || typeof value !== 'string') {
        throw new Error(`storage write rejected key=${JSON.stringify(key)}`)
      }
      map.set(key, value)
    },
    raw(key) {
      return map.get(key) ?? null
    },
  }
}

function assertLoaded(result: SaveResult): Extract<SaveResult, { ok: true }>['save'] {
  if (!result.ok) throw new Error(`[DEBUG save] load rejected reason=${result.reason}`)
  return result.save
}

function assertScores(result: ScoreResult): Extract<ScoreResult, { ok: true }>['scores'] {
  if (!result.ok) throw new Error(`[DEBUG save] scores rejected reason=${result.reason}`)
  return result.scores
}

function commandsOn(day: number): Command[] {
  if (day === 4) return [{ type: 'skip' }]
  if (day === 11) return [{ type: 'transfer', from: 'trading', to: 'cash', amountCents: 2500 }]
  if (day === 50) return [{ type: 'transfer', from: 'trading', to: 'cash', amountCents: 1000 }]
  return []
}

function playUntil(game: GameState, targetDay: number): void {
  if (!Number.isSafeInteger(targetDay) || targetDay < game.market.day) {
    throw new Error(`[DEBUG save] target day ${targetDay} is behind day ${game.market.day}`)
  }
  while (game.market.day < targetDay) {
    const day = game.market.day
    for (const command of commandsOn(day)) {
      const before = game.pending.length
      applyCommand(game, DEFS, command)
      const added = game.pending.slice(before)
      const rejected = added.find((event) => event.kind === 'commandRejected')
      if (rejected !== undefined) {
        throw new Error(`[DEBUG save] day ${day} rejected ${rejected.command} ${rejected.reason}`)
      }
    }
    endDay(game, DEFS)
  }
}

describe('local save', () => {
  it('uses the damaged-save message', () => {
    expect(DAMAGED_SAVE_MESSAGE).toBe('This save is damaged and was not used.')
    expect(DAMAGED_SCORES_MESSAGE).toBe('The score list is damaged and was not used.')
  })

  it('round-trips a day-0 game as versioned JSON outside the simulation state', () => {
    const game = createGame(DEFS, 'demo')
    const storage = memory()
    const written = writeSave({ mode: 'seeded', seed: 'demo', state: game }, storage)
    const raw = storage.raw(SAVE_KEY)
    if (raw === null) throw new Error('[DEBUG save] missing save')
    const loaded = assertLoaded(loadSave(storage))
    debugSave(`saved day=${written.day} bytes=${written.bytes} version=${loaded.version}`)
    expect(written.day).toBe(0)
    expect(written.bytes).toBe(new TextEncoder().encode(raw).length)
    expect(loaded.version).toBe(SAVE_VERSION)
    expect(loaded.mode).toBe('seeded')
    expect(loaded.seed).toBe('demo')
    expect(loaded.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Number.isFinite(Date.parse(loaded.savedAt))).toBe(true)
    expect(Object.hasOwn(loaded.state, 'savedAt')).toBe(false)
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(game))
    expect(loadSave(memory()).ok).toBe(false)
  })

  it('rejects a corrupted save and does not use it', () => {
    const storage = memory()
    storage.setItem(SAVE_KEY, '{')
    const invalid = loadSave(storage)
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.reason).toBe('invalid-json')

    const game = createGame(DEFS, 'demo')
    writeSave({ mode: 'seeded', seed: 'demo', state: game }, storage)
    const raw = storage.raw(SAVE_KEY)
    if (raw === null) throw new Error('[DEBUG save] missing save')
    const versioned = JSON.parse(raw) as { version: number }
    versioned.version = 2
    const badVersion = inspectSave(versioned)
    expect(badVersion.ok).toBe(false)
    if (!badVersion.ok) expect(badVersion.reason).toBe('version')

    const fresh = JSON.parse(raw) as { state: { stats: { energy: number } } }
    fresh.state.stats.energy = Number.POSITIVE_INFINITY
    const nonFinite = inspectSave(fresh)
    expect(nonFinite.ok).toBe(false)
    if (!nonFinite.ok) expect(nonFinite.reason).toBe('non-finite:state.stats.energy')

    const brokenShape = JSON.parse(raw) as { state: unknown }
    brokenShape.state = { market: { day: 1 } }
    const shape = inspectSave(brokenShape)
    expect(shape.ok).toBe(false)
    if (!shape.ok) {
      expect(shape.reason.startsWith('shape:')).toBe(true)
      debugSave(`rejected reason=${shape.reason}`)
    }
  })

  it('keeps the same state hash at day 120 after a mid-run save', () => {
    const straight = createGame(DEFS, 'demo')
    const paused = createGame(DEFS, 'demo')
    playUntil(straight, 40)
    playUntil(paused, 40)
    expect(JSON.stringify(straight)).toBe(JSON.stringify(paused))
    expect(paused.accounts.cashCents).not.toBe(STARTING_CASH_CENTS)

    const storage = memory()
    const written = writeSave({ mode: 'seeded', seed: 'demo', state: paused }, storage)
    const loaded = assertLoaded(loadSave(storage))
    expect(written.day).toBe(40)
    expect(loaded.state.market.day).toBe(40)
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(paused))
    debugSave(`mid-run day=${written.day} bytes=${written.bytes}`)

    playUntil(straight, 120)
    playUntil(loaded.state, 120)
    const straightHash = stateHash(straight.market)
    const loadedHash = stateHash(loaded.state.market)
    debugSave(
      `day=120 uninterrupted=${straightHash} resumed=${loadedHash} cash=${straight.accounts.cashCents}`,
    )
    expect(straight.market.day).toBe(120)
    expect(loaded.state.market.day).toBe(120)
    expect(loadedHash).toBe(straightHash)
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(straight))
    expect(loaded.state.accounts.cashCents).toBe(straight.accounts.cashCents)
  })
})

describe('separate scores', () => {
  it('keeps seeded best-per-seed and normal top 10 from mixing', () => {
    const storage = memory()
    const first: ScoreRow = { seed: 'demo', score: 40, day: 120, outcome: 'finished' }
    const worse: ScoreRow = { seed: 'demo', score: 10, day: 100, outcome: 'finished' }
    const better: ScoreRow = { seed: 'demo', score: 80, day: 90, outcome: 'won' }
    const normalSameSeed: ScoreRow = { seed: 'demo', score: 15, day: 120, outcome: 'finished' }
    recordScore('seeded', first, storage)
    recordScore('seeded', worse, storage)
    recordScore('normal', normalSameSeed, storage)
    recordScore('seeded', better, storage)
    for (let score = 1; score <= 12; score += 1) {
      recordScore('normal', { seed: `n${score}`, score, day: 120, outcome: 'finished' }, storage)
    }

    const scores = assertScores(loadScores(storage))
    const raw = storage.raw(SCORES_KEY)
    if (raw === null) throw new Error('[DEBUG save] missing scores')
    const parsed = JSON.parse(raw) as { seeded: Record<string, ScoreRow>; normal: ScoreRow[] }
    debugSave(
      `score mode=seeded seed=demo score=${scores.seeded.demo?.score ?? 'missing'} normal=${scores.normal.length}`,
    )
    expect(scores.seeded.demo).toEqual(better)
    expect(parsed.seeded.demo?.score).toBe(80)
    expect(parsed.normal.find((row) => row.seed === 'demo')?.score).toBe(15)
    expect(scores.normal).toHaveLength(10)
    expect(scores.normal[0]).toEqual(normalSameSeed)
    expect(scores.normal.some((row) => row.score === 1 || row.score === 2 || row.score === 3)).toBe(false)
    expect(scores.normal.some((row) => row.score === 80)).toBe(false)
    expect(Object.keys(scores.seeded)).toEqual(['demo'])
  })
})
