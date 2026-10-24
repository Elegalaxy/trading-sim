// Versioned run save. `savedAt` is the wall clock and is not part of the simulation.
// `state` is the game JSON. It must not contain a Date.

import type { GameState, RunOutcome } from '../sim/types.ts'

export const SAVE_KEY = 'trading-sim.save.v1'
export const SAVE_VERSION = 1
export const DAMAGED_SAVE_MESSAGE = 'This save is damaged and was not used.'

const SEED_PATTERN = /^[A-Za-z0-9-]{1,32}$/
const SAVED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RUN_MODES = ['seeded', 'normal'] as const
const OUTCOMES = ['won', 'lost', 'finished'] as const
const SECTIONS = ['sleep', 'work', 'market'] as const

const ENVELOPE_KEYS = ['version', 'savedAt', 'mode', 'seed', 'state'] as const
const STATE_KEYS = [
  'market',
  'accounts',
  'section',
  'sleepHours',
  'job',
  'positions',
  'realized',
  'pending',
  'log',
  'bill',
  'runEnd',
  'fi',
  'stats',
  'consumables',
  'socialPosts',
  'perception',
  'lifestyle',
  'loan',
] as const
const MARKET_KEYS = [
  'day',
  'streams',
  'assets',
  'environment',
  'calendarRules',
  'calendarRolls',
  'scheduled',
  'active',
  'log',
  'feed',
] as const
const STREAM_NAMES = ['market', 'events', 'info', 'distortion'] as const
const STREAM_KEYS = ['a', 'b', 'c', 'd'] as const
const ACCOUNT_KEYS = ['cashCents', 'tradingCents', 'savingsCents', 'accruedSavingsCents'] as const
const JOB_KEYS = ['catalog', 'jobId', 'pending', 'worked', 'courses'] as const
const FI_KEYS = ['streak', 'interest', 'status'] as const
const STAT_KEYS = ['energy', 'stress', 'consumed', 'newsReads'] as const
const PERCEPTION_KEYS = ['day', 'shown', 'events', 'verified'] as const
const LIFESTYLE_KEYS = ['home', 'infoFeed'] as const
const LOAN_KEYS = ['balanceCents', 'interestDueCents', 'interestDay'] as const
const RUN_END_KEYS = ['outcome', 'day', 'reason', 'netWorthCents', 'score'] as const

export type RunMode = (typeof RUN_MODES)[number]

export type SaveStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * `seed` is not stored on the simulation state, so the envelope keeps it for the header.
 * The other fields are the versioned save from Step 25.
 */
export type SaveFile = {
  version: 1
  savedAt: string
  mode: RunMode
  seed: string
  state: GameState
}

export type SaveFailure = {
  ok: false
  reason: string
  cause: unknown
}

export type SaveResult = { ok: true; save: SaveFile } | SaveFailure

export function isRunMode(value: unknown): value is RunMode {
  return typeof value === 'string' && (RUN_MODES as readonly string[]).includes(value)
}

export function isSeed(value: unknown): value is string {
  return typeof value === 'string' && SEED_PATTERN.test(value)
}

function browserStorage(): SaveStorage {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage is not available')
  }
  return localStorage
}

function resolveStorage(storage: SaveStorage | undefined): SaveStorage {
  return storage ?? browserStorage()
}

function isPlain(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && isPlain(value)
}

function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value)
  if (present.length !== keys.length) return false
  const allowed = new Set(keys)
  return present.every((key) => allowed.has(key))
}

function keysWithin(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const present = new Set(Object.keys(value))
  for (const key of required) {
    if (!present.has(key)) return false
    present.delete(key)
  }
  for (const key of optional) present.delete(key)
  return present.size === 0
}

function finiteNumber(value: unknown, path: string): string | null {
  if (typeof value !== 'number') return `shape:${path}`
  if (!Number.isFinite(value)) return `non-finite:${path}`
  return null
}

function walk(value: unknown, path: string): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : `non-finite:${path}`
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = walk(value[index], `${path}[${index}]`)
      if (found !== null) return found
    }
    return null
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const found = walk(child, `${path}.${key}`)
      if (found !== null) return found
    }
    return null
  }
  return `shape:${path}`
}

function checkStream(value: unknown, path: string): string | null {
  if (!isRecord(value) || !keysWithin(value, STREAM_KEYS, ['spare'])) return `shape:${path}`
  for (const key of STREAM_KEYS) {
    const found = finiteNumber(value[key], `${path}.${key}`)
    if (found !== null) return found
  }
  if (value.spare !== undefined) return finiteNumber(value.spare, `${path}.spare`)
  return null
}

function checkMarket(value: unknown): string | null {
  if (!isRecord(value) || !sameKeys(value, MARKET_KEYS)) return 'shape:state.market'
  const day = finiteNumber(value.day, 'state.market.day')
  if (day !== null) return day
  if (!Number.isSafeInteger(value.day) || (value.day as number) < 0) return 'shape:state.market.day'
  if (!isRecord(value.streams) || !sameKeys(value.streams, STREAM_NAMES)) return 'shape:state.market.streams'
  for (const name of STREAM_NAMES) {
    const found = checkStream(value.streams[name], `state.market.streams.${name}`)
    if (found !== null) return found
  }
  if (!isRecord(value.assets)) return 'shape:state.market.assets'
  if (!Array.isArray(value.environment)) return 'shape:state.market.environment'
  if (!isRecord(value.calendarRules)) return 'shape:state.market.calendarRules'
  const month = finiteNumber(value.calendarRules.daysPerMonth, 'state.market.calendarRules.daysPerMonth')
  if (month !== null) return month
  if (!Array.isArray(value.calendarRules.schedule)) return 'shape:state.market.calendarRules.schedule'
  if (!Array.isArray(value.calendarRolls)) return 'shape:state.market.calendarRolls'
  if (!Array.isArray(value.scheduled)) return 'shape:state.market.scheduled'
  if (!Array.isArray(value.active)) return 'shape:state.market.active'
  if (!Array.isArray(value.log)) return 'shape:state.market.log'
  if (!isRecord(value.feed) || !Array.isArray(value.feed.items)) return 'shape:state.market.feed'
  return finiteNumber(value.feed.day, 'state.market.feed.day')
}

function checkAccounts(value: unknown): string | null {
  if (!isRecord(value) || !sameKeys(value, ACCOUNT_KEYS)) return 'shape:state.accounts'
  for (const key of ACCOUNT_KEYS) {
    const found = finiteNumber(value[key], `state.accounts.${key}`)
    if (found !== null) return found
  }
  return null
}

function checkJob(value: unknown): string | null {
  if (!isRecord(value) || !sameKeys(value, JOB_KEYS)) return 'shape:state.job'
  if (!Array.isArray(value.catalog)) return 'shape:state.job.catalog'
  if (typeof value.jobId !== 'string') return 'shape:state.job.jobId'
  if (value.pending !== null && !isRecord(value.pending)) return 'shape:state.job.pending'
  if (!Array.isArray(value.worked) || !Array.isArray(value.courses)) return 'shape:state.job.worked'
  return null
}

function checkRunEnd(value: unknown): string | null {
  if (value === null) return null
  if (!isRecord(value) || !sameKeys(value, RUN_END_KEYS)) return 'shape:state.runEnd'
  if (!(OUTCOMES as readonly string[]).includes(String(value.outcome))) return 'shape:state.runEnd.outcome'
  const day = finiteNumber(value.day, 'state.runEnd.day')
  if (day !== null) return day
  if (typeof value.reason !== 'string') return 'shape:state.runEnd.reason'
  const worth = finiteNumber(value.netWorthCents, 'state.runEnd.netWorthCents')
  if (worth !== null) return worth
  return finiteNumber(value.score, 'state.runEnd.score')
}

function checkState(value: unknown): string | null {
  if (!isRecord(value) || !sameKeys(value, STATE_KEYS)) return 'shape:state'
  const market = checkMarket(value.market)
  if (market !== null) return market
  const accounts = checkAccounts(value.accounts)
  if (accounts !== null) return accounts
  if (!(SECTIONS as readonly string[]).includes(String(value.section))) return 'shape:state.section'
  const sleep = finiteNumber(value.sleepHours, 'state.sleepHours')
  if (sleep !== null) return sleep
  const job = checkJob(value.job)
  if (job !== null) return job
  if (!isRecord(value.positions)) return 'shape:state.positions'
  if (!Array.isArray(value.realized) || !Array.isArray(value.pending) || !Array.isArray(value.log)) {
    return 'shape:state.log'
  }
  if (value.bill !== null && !isRecord(value.bill)) return 'shape:state.bill'
  const ended = checkRunEnd(value.runEnd)
  if (ended !== null) return ended
  if (!isRecord(value.fi) || !sameKeys(value.fi, FI_KEYS)) return 'shape:state.fi'
  const streak = finiteNumber(value.fi.streak, 'state.fi.streak')
  if (streak !== null) return streak
  if (!Array.isArray(value.fi.interest)) return 'shape:state.fi.interest'
  if (value.fi.status !== null && !isRecord(value.fi.status)) return 'shape:state.fi.status'
  if (!isRecord(value.stats) || !sameKeys(value.stats, STAT_KEYS)) return 'shape:state.stats'
  const energy = finiteNumber(value.stats.energy, 'state.stats.energy')
  if (energy !== null) return energy
  const stress = finiteNumber(value.stats.stress, 'state.stats.stress')
  if (stress !== null) return stress
  if (!Array.isArray(value.stats.consumed)) return 'shape:state.stats.consumed'
  const reads = finiteNumber(value.stats.newsReads, 'state.stats.newsReads')
  if (reads !== null) return reads
  if (!Array.isArray(value.consumables) || !Array.isArray(value.socialPosts)) return 'shape:state.consumables'
  if (!isRecord(value.perception) || !sameKeys(value.perception, PERCEPTION_KEYS)) return 'shape:state.perception'
  const perceptionDay = finiteNumber(value.perception.day, 'state.perception.day')
  if (perceptionDay !== null) return perceptionDay
  if (!isRecord(value.perception.shown) || !Array.isArray(value.perception.shown.items)) {
    return 'shape:state.perception.shown'
  }
  if (!Array.isArray(value.perception.events) || typeof value.perception.verified !== 'boolean') {
    return 'shape:state.perception.events'
  }
  if (!isRecord(value.lifestyle) || !sameKeys(value.lifestyle, LIFESTYLE_KEYS)) return 'shape:state.lifestyle'
  const home = finiteNumber(value.lifestyle.home, 'state.lifestyle.home')
  if (home !== null) return home
  const info = finiteNumber(value.lifestyle.infoFeed, 'state.lifestyle.infoFeed')
  if (info !== null) return info
  if (!isRecord(value.loan) || !sameKeys(value.loan, LOAN_KEYS)) return 'shape:state.loan'
  const balance = finiteNumber(value.loan.balanceCents, 'state.loan.balanceCents')
  if (balance !== null) return balance
  const due = finiteNumber(value.loan.interestDueCents, 'state.loan.interestDueCents')
  if (due !== null) return due
  if (value.loan.interestDay !== null) {
    const interestDay = finiteNumber(value.loan.interestDay, 'state.loan.interestDay')
    if (interestDay !== null) return interestDay
  }
  return walk(value, 'state')
}

function fail(reason: string, cause: unknown = null): SaveFailure {
  return { ok: false, reason, cause }
}

/** Validate a parsed save. Numbers anywhere in the tree must be finite. */
export function inspectSave(value: unknown): SaveResult {
  if (!isRecord(value) || !sameKeys(value, ENVELOPE_KEYS)) return fail('shape:envelope')
  if (typeof value.version !== 'number' || value.version !== SAVE_VERSION) return fail('version')
  if (typeof value.savedAt !== 'string' || !SAVED_AT_PATTERN.test(value.savedAt)) return fail('saved-at')
  if (!Number.isFinite(Date.parse(value.savedAt))) return fail('saved-at')
  if (!isRunMode(value.mode)) return fail('mode')
  if (!isSeed(value.seed)) return fail('seed')
  const stateProblem = checkState(value.state)
  if (stateProblem !== null) return fail(stateProblem)
  const save: SaveFile = {
    version: SAVE_VERSION,
    savedAt: value.savedAt,
    mode: value.mode,
    seed: value.seed,
    state: value.state as GameState,
  }
  return { ok: true, save }
}

export function loadSave(storage?: SaveStorage): SaveResult {
  let raw: string | null
  try {
    raw = resolveStorage(storage).getItem(SAVE_KEY)
  } catch (error) {
    return fail('storage', error)
  }
  if (raw === null) return fail('empty')
  if (typeof raw !== 'string' || raw.length === 0) return fail('invalid-json')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return fail('invalid-json', error)
  }
  return inspectSave(parsed)
}

export function writeSave(
  input: { mode: RunMode; seed: string; state: GameState },
  storage?: SaveStorage,
): { day: number; bytes: number } {
  if (!isRunMode(input.mode)) {
    throw new Error(`save mode must be seeded or normal, received ${JSON.stringify(input.mode)}`)
  }
  if (!isSeed(input.seed)) {
    throw new Error(`save seed is invalid, received ${JSON.stringify(input.seed)}`)
  }
  const envelope = {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    mode: input.mode,
    seed: input.seed,
    state: input.state,
  }
  const checked = inspectSave(envelope)
  if (!checked.ok) {
    throw new Error(`refusing to save: ${checked.reason}`)
  }
  const json = JSON.stringify(envelope)
  if (typeof json !== 'string' || json.length === 0) {
    throw new Error('save could not be serialized')
  }
  const bytes = new TextEncoder().encode(json).length
  resolveStorage(storage).setItem(SAVE_KEY, json)
  return { day: checked.save.state.market.day, bytes }
}

export function isRunOutcome(value: unknown): value is RunOutcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value)
}
