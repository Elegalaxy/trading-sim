// Scores are separate from the run save. Seeded and normal never share a list.
// Seeded keeps the best score for each seed. Normal keeps a top 10.

import type { RunOutcome } from '../sim/types.ts'
import { isRunOutcome, isSeed, type RunMode, type SaveStorage } from './save.ts'

export const SCORES_KEY = 'trading-sim.scores.v1'
export const SCORES_VERSION = 1
export const NORMAL_TOP = 10
export const DAMAGED_SCORES_MESSAGE = 'The score list is damaged and was not used.'

const FILE_KEYS = ['version', 'seeded', 'normal'] as const
const ROW_KEYS = ['seed', 'score', 'day', 'outcome'] as const

export type ScoreRow = {
  seed: string
  score: number
  day: number
  outcome: RunOutcome
}

export type ScoreFile = {
  version: 1
  seeded: Record<string, ScoreRow>
  normal: ScoreRow[]
}

export type ScoreFailure = {
  ok: false
  reason: string
  cause: unknown
}

export type ScoreResult = { ok: true; scores: ScoreFile } | ScoreFailure

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

function fail(reason: string, cause: unknown = null): ScoreFailure {
  return { ok: false, reason, cause }
}

function emptyScores(): ScoreFile {
  return { version: SCORES_VERSION, seeded: {}, normal: [] }
}

function integerField(value: unknown, path: string, min: number): string | null {
  if (typeof value !== 'number') return `scores-shape:${path}`
  if (!Number.isFinite(value)) return `scores-non-finite:${path}`
  if (!Number.isSafeInteger(value) || value < min) return `scores-shape:${path}`
  return null
}

function checkRow(value: unknown, path: string): ScoreRow | string {
  if (!isRecord(value) || !sameKeys(value, ROW_KEYS)) return `scores-shape:${path}`
  if (!isSeed(value.seed)) return `scores-shape:${path}.seed`
  const scoreProblem = integerField(value.score, `${path}.score`, Number.MIN_SAFE_INTEGER)
  if (scoreProblem !== null) return scoreProblem
  const dayProblem = integerField(value.day, `${path}.day`, 1)
  if (dayProblem !== null) return dayProblem
  if (!isRunOutcome(value.outcome)) return `scores-shape:${path}.outcome`
  return {
    seed: value.seed,
    score: value.score as number,
    day: value.day as number,
    outcome: value.outcome,
  }
}

export function inspectScores(value: unknown): ScoreResult {
  if (!isRecord(value) || !sameKeys(value, FILE_KEYS)) return fail('scores-shape')
  if (typeof value.version !== 'number' || value.version !== SCORES_VERSION) return fail('scores-version')
  if (!isRecord(value.seeded) || !Array.isArray(value.normal)) return fail('scores-shape')
  if (value.normal.length > NORMAL_TOP) return fail('scores-shape:normal')
  const seeded: Record<string, ScoreRow> = {}
  for (const [key, row] of Object.entries(value.seeded)) {
    const checked = checkRow(row, `seeded.${key}`)
    if (typeof checked === 'string') return fail(checked)
    if (checked.seed !== key || !isSeed(key)) return fail(`scores-shape:seeded.${key}`)
    seeded[key] = checked
  }
  const normal: ScoreRow[] = []
  for (let index = 0; index < value.normal.length; index += 1) {
    const checked = checkRow(value.normal[index], `normal[${index}]`)
    if (typeof checked === 'string') return fail(checked)
    normal.push(checked)
  }
  return { ok: true, scores: { version: SCORES_VERSION, seeded, normal } }
}

export function loadScores(storage?: SaveStorage): ScoreResult {
  let raw: string | null
  try {
    raw = resolveStorage(storage).getItem(SCORES_KEY)
  } catch (error) {
    return fail('scores-storage', error)
  }
  if (raw === null) return { ok: true, scores: emptyScores() }
  if (typeof raw !== 'string' || raw.length === 0) return fail('scores-invalid-json')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return fail('scores-invalid-json', error)
  }
  return inspectScores(parsed)
}

function assertRow(row: ScoreRow): void {
  const checked = checkRow(row, 'entry')
  if (typeof checked === 'string') {
    throw new Error(`score entry is invalid: ${checked}`)
  }
}

function byBest(left: ScoreRow, right: ScoreRow): number {
  if (right.score !== left.score) return right.score - left.score
  if (left.day !== right.day) return left.day - right.day
  return left.seed.localeCompare(right.seed)
}

function writeScores(scores: ScoreFile, storage: SaveStorage): void {
  const json = JSON.stringify(scores)
  if (typeof json !== 'string' || json.length === 0) {
    throw new Error('scores could not be serialized')
  }
  storage.setItem(SCORES_KEY, json)
}

/**
 * Record one finished run. A worse seeded retry keeps the previous best.
 * Returns `rejectedReason` when the previous file was damaged and was not merged.
 */
export function recordScore(
  mode: RunMode,
  row: ScoreRow,
  storage?: SaveStorage,
): { scores: ScoreFile; rejectedReason: string | null } {
  if (mode !== 'seeded' && mode !== 'normal') {
    throw new Error(`score mode must be seeded or normal, received ${JSON.stringify(mode)}`)
  }
  assertRow(row)
  const target = resolveStorage(storage)
  const existing = loadScores(target)
  const rejectedReason = existing.ok ? null : existing.reason
  const base = existing.ok ? existing.scores : emptyScores()
  if (mode === 'seeded') {
    const previous = base.seeded[row.seed]
    if (previous === undefined || row.score > previous.score) base.seeded[row.seed] = row
  } else {
    base.normal = [...base.normal, row].sort(byBest).slice(0, NORMAL_TOP)
  }
  writeScores(base, target)
  return { scores: base, rejectedReason }
}
