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

  it('keeps the fill ledger, checks its rows, and loads a save from before it', () => {
    // Orders need a spread and a fee schedule, which the shared definitions leave out.
    const trading: MarketDefinitions = {
      ...DEFS,
      assets: DEFS.assets.map((asset) => ({ ...asset, spreadPpm: 1000, borrowFeePpm: 100 })),
    }
    const game = createGame(trading, 'demo')
    applyCommand(game, trading, { type: 'skip' })
    applyCommand(game, trading, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 10 })
    applyCommand(game, trading, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 4 })
    expect(game.fills).toHaveLength(2)
    const storage = memory()
    writeSave({ mode: 'seeded', seed: 'demo', state: game }, storage)
    const loaded = assertLoaded(loadSave(storage))
    expect(loaded.state.fills).toEqual(game.fills)

    const raw = storage.raw(SAVE_KEY)
    if (raw === null) throw new Error('[DEBUG save] missing save')
    const oldSave = JSON.parse(raw) as { state: Record<string, unknown> }
    delete oldSave.state.fills
    expect(inspectSave(oldSave).ok).toBe(true)

    const badVia = JSON.parse(raw) as { state: { fills: Array<Record<string, unknown>> } }
    badVia.state.fills[0]!.via = 'sneaky'
    const via = inspectSave(badVia)
    expect(via.ok).toBe(false)
    if (!via.ok) expect(via.reason).toBe('shape:state.fills[0].via')

    const badNumber = JSON.parse(raw) as { state: { fills: Array<Record<string, unknown>> } }
    badNumber.state.fills[1]!.fillCents = Number.POSITIVE_INFINITY
    const nonFinite = inspectSave(badNumber)
    expect(nonFinite.ok).toBe(false)
    if (!nonFinite.ok) expect(nonFinite.reason).toBe('non-finite:state.fills[1].fillCents')

    const extra = JSON.parse(raw) as { state: { fills: Array<Record<string, unknown>> } }
    extra.state.fills[0]!.note = 'x'
    expect(inspectSave(extra).ok).toBe(false)
  })

  it('keeps the closed days, checks their rows, and loads a save from before them', () => {
    const game = createGame(DEFS, 'demo')
    playUntil(game, 3)
    expect(game.past.map((row) => row.day)).toEqual([1, 2, 3])
    const storage = memory()
    writeSave({ mode: 'seeded', seed: 'demo', state: game }, storage)
    const loaded = assertLoaded(loadSave(storage))
    expect(loaded.state.past).toEqual(game.past)
    expect(loaded.state.past[0]?.bars.NOVA).toHaveLength(16)

    const raw = storage.raw(SAVE_KEY)
    if (raw === null) throw new Error('[DEBUG save] missing save')
    const oldSave = JSON.parse(raw) as { state: Record<string, unknown> }
    delete oldSave.state.past
    expect(inspectSave(oldSave).ok).toBe(true)

    const backwards = JSON.parse(raw) as { state: { past: Array<Record<string, unknown>> } }
    backwards.state.past[1]!.day = 1
    const order = inspectSave(backwards)
    expect(order.ok).toBe(false)
    if (!order.ok) expect(order.reason).toBe('shape:state.past[1].day')

    const nonFinite = JSON.parse(raw) as { state: { past: Array<Record<string, unknown>> } }
    nonFinite.state.past[0]!.equityCents = Number.POSITIVE_INFINITY
    const infinite = inspectSave(nonFinite)
    expect(infinite.ok).toBe(false)
    if (!infinite.ok) expect(infinite.reason).toBe('non-finite:state.past[0].equityCents')

    const badBar = JSON.parse(raw) as { state: { past: Array<{ bars: Record<string, Array<Record<string, unknown>>> }> } }
    delete badBar.state.past[0]!.bars.NOVA![0]!.volume
    const bar = inspectSave(badBar)
    expect(bar.ok).toBe(false)
    if (!bar.ok) expect(bar.reason).toBe('shape:state.past[0].bars.NOVA[0]')
  })

  it('keeps Health and Equipment tiers, and loads a lifestyle from before them', () => {
    const game = createGame(DEFS, 'demo')
    game.lifestyle = { home: 1, infoFeed: 0, health: 1, equipment: 2 }
    const storage = memory()
    writeSave({ mode: 'seeded', seed: 'demo', state: game }, storage)
    const loaded = assertLoaded(loadSave(storage))
    expect(loaded.state.lifestyle).toEqual({ home: 1, infoFeed: 0, health: 1, equipment: 2 })

    const raw = storage.raw(SAVE_KEY)
    if (raw === null) throw new Error('[DEBUG save] missing save')
    const old = JSON.parse(raw) as { state: { lifestyle: Record<string, unknown> } }
    delete old.state.lifestyle.health
    delete old.state.lifestyle.equipment
    expect(inspectSave(old).ok).toBe(true)

    const bad = JSON.parse(raw) as { state: { lifestyle: Record<string, unknown> } }
    bad.state.lifestyle.equipment = Number.POSITIVE_INFINITY
    const result = inspectSave(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('non-finite:state.lifestyle.equipment')

    const extra = JSON.parse(raw) as { state: { lifestyle: Record<string, unknown> } }
    extra.state.lifestyle.garden = 1
    expect(inspectSave(extra).ok).toBe(false)
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

describe('trader book in a save', () => {
  function withParticipants(book?: unknown): unknown {
    const game = createGame(DEFS, 'demo')
    const storage = memory()
    writeSave({ mode: 'seeded', seed: 'demo', state: game }, storage)
    const raw = storage.raw(SAVE_KEY)
    if (raw === null) throw new Error('[DEBUG save] missing save')
    const parsed = JSON.parse(raw) as { state: { market: { participants?: unknown } } }
    const stream = parsed.state.market.participants === undefined ? { a: 1, b: 2, c: 3, d: 4 } : undefined
    parsed.state.market.participants = {
      stream,
      informed: 1,
      news: 1,
      heat: 1,
      shares: {},
      chase: {},
      mood: {},
      closes: {},
      leaked: [],
      ...(book === undefined ? {} : { book }),
    }
    return parsed
  }

  const types = { value: 0, noise: 0, informed: 0, news: 0, consensus: 0, crowd: 0, trend: 0, contrarian: 0 }
  const book = () => ({
    activeFromDay: 1,
    mix: { ...types, value: 1 },
    efficiency: 0.9,
    carry: { NOVA: 1 },
    seenAnchor: { NOVA: 4800 },
    pos: { NOVA: { ...types } },
    eventPos: { 'e|NOVA|crowd': 0.2 },
    vol: { NOVA: 0 },
    lastFlow: { NOVA: 0 },
  })

  it('accepts participants with and without a book', () => {
    expect(inspectSave(withParticipants()).ok).toBe(true)
    expect(inspectSave(withParticipants(book())).ok).toBe(true)
  })

  it('rejects a bad book', () => {
    const missing = book() as Record<string, unknown>
    delete missing.vol
    const extra = { ...book(), note: 1 }
    const badType = { ...book(), mix: { ...types } } as Record<string, unknown>
    delete (badType.mix as Record<string, unknown>).trend
    const nonFinite = { ...book(), carry: { NOVA: Number.POSITIVE_INFINITY } }
    const badPos = { ...book(), pos: { NOVA: { ...types, value: 'x' } } }
    for (const bad of [missing, extra, badType, nonFinite, badPos, 'text', null]) {
      const result = inspectSave(withParticipants(bad))
      // null is dropped by the helper's spread check only when undefined, so null reaches the check.
      expect(result.ok).toBe(false)
    }
    const found = inspectSave(withParticipants(nonFinite))
    if (!found.ok) expect(found.reason).toBe('non-finite:state.market.participants.book.carry.NOVA')
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
