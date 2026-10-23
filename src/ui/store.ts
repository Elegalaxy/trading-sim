// UI session. Market rules stay in src/sim. Daily closes are kept here because
// MarketState.log is replaced on every endDay.

import { useSyncExternalStore } from 'react'
import { JOB_DEFINITIONS, MARKET_DEFINITIONS } from '../content/index.ts'
import { applyCommand, createGame, endDay as simEndDay, endDayBlockReason } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { daySummary, type DaySummary } from '../sim/summary.ts'
import type { GameState, LiquidationEvent } from '../sim/types.ts'
import { debugLog } from './debug.ts'

const SEED_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'
const SEED_PATTERN = /^[A-Za-z0-9-]{1,32}$/
const DEFAULT_SEED_LENGTH = 8
const definitions = MARKET_DEFINITIONS

export type CloseRow = {
  day: number
  prices: Readonly<Record<string, number>>
}

export type TradingRun = {
  seed: string
  game: GameState
  closes: readonly CloseRow[]
  summary: DaySummary | null
  /** Liquidations from the game log for the summary day. The next command replaces that log. */
  liquidations: readonly LiquidationEvent[]
}

export type DispatchResult = {
  accepted: boolean
  reason: string | null
}

export type ParsedInteger = { ok: true; value: number } | { ok: false; reason: string }

export type TradingSnapshot = {
  run: TradingRun | null
}

type Listener = () => void

const listeners = new Set<Listener>()
let run: TradingRun | null = null
let snapshot: TradingSnapshot = { run: null }

function publish(): void {
  snapshot = { run }
  for (const listener of listeners) listener()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): TradingSnapshot {
  return snapshot
}

export function useTradingStore(): TradingSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 8 characters from the harness seed alphabet. Rejects bytes that would bias the draw. */
export function randomSeed(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available')
  }
  const chars: string[] = []
  const bytes = new Uint8Array(32)
  const limit = SEED_ALPHABET.length * 4
  while (chars.length < DEFAULT_SEED_LENGTH) {
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= limit) continue
      const index = byte % SEED_ALPHABET.length
      const char = SEED_ALPHABET[index]
      if (char === undefined) throw new Error(`seed alphabet missing index ${index}`)
      chars.push(char)
      if (chars.length === DEFAULT_SEED_LENGTH) break
    }
  }
  const seed = chars.join('')
  if (!SEED_PATTERN.test(seed)) throw new Error(`generated seed failed validation, received ${JSON.stringify(seed)}`)
  return seed
}

export const defaultSeed = randomSeed()

function commandLabel(cmd: unknown): string {
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return 'invalid'
  if (!Object.hasOwn(cmd, 'type')) return 'invalid'
  const type = (cmd as { type?: unknown }).type
  if (typeof type !== 'string' || type.length === 0 || /[\r\n]/.test(type)) return 'invalid'
  return type
}

function readPrices(game: GameState): Record<string, number> {
  const prices: Record<string, number> = {}
  for (const def of definitions.assets) {
    const asset = game.market.assets[def.id]
    if (asset === undefined) {
      throw new Error(`missing close for ${def.id} on day ${game.market.day}`)
    }
    if (!Number.isSafeInteger(asset.priceCents) || asset.priceCents <= 0) {
      throw new Error(
        `close for ${def.id} on day ${game.market.day} must be a positive safe integer, received ${asset.priceCents}`,
      )
    }
    prices[def.id] = asset.priceCents
  }
  return prices
}

/** Reset to day 0. Does not advance the market. Returns a reason when the seed or starting job is rejected. */
export function startGame(seed: string, jobId = 'jobless'): string | null {
  if (typeof seed !== 'string' || !SEED_PATTERN.test(seed)) {
    const reason = 'Seed must be 1 to 32 characters from A-Z, a-z, 0-9, and hyphen.'
    console.error(`[ui] rejected seed ${JSON.stringify(seed)}: ${reason}`)
    return reason
  }
  if (typeof jobId !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(jobId)) {
    const reason = 'That job is not on the menu.'
    console.error(`[store] job start rejected ${JSON.stringify(jobId)}: ${reason}`)
    debugLog('[store]', 'job start invalid rejected unknownJob')
    return reason
  }
  const chosen = JOB_DEFINITIONS.find((job) => job.id === jobId)
  if (chosen === undefined) {
    const reason = 'That job is not on the menu.'
    console.error(`[store] job start ${jobId} rejected: ${reason}`)
    debugLog('[store]', `job start ${jobId} rejected unknownJob`)
    return reason
  }
  if (chosen.requirement !== 'none') {
    const reason = 'That job needs a course.'
    console.error(`[store] job start ${jobId} rejected: ${reason}`)
    debugLog('[store]', `job start ${jobId} rejected jobLocked`)
    return reason
  }
  let game: GameState
  try {
    game = createGame(definitions, seed, { jobs: JOB_DEFINITIONS, jobId })
  } catch (error) {
    console.error('[store] createGame failed', error)
    throw error
  }
  run = { seed, game, closes: [], summary: null, liquidations: [] }
  debugLog('[ui]', `seed=${seed}`)
  debugLog(
    '[store]',
    `job start ${jobId} slots=${chosen.slots} sleepHours=${chosen.sleepHours} pay=${chosen.payCents}`,
  )
  publish()
  return null
}

function commandToken(value: unknown): string {
  if (typeof value === 'string' && value.length > 0 && !/[\r\n]/.test(value)) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return 'invalid'
}

function isSkipCommand(cmd: unknown): boolean {
  return typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) && (cmd as { type?: unknown }).type === 'skip'
}

/** `[store] skip from=... to=...` with accepted or rejected. */
function logSkip(cmd: unknown, from: string, to: string, accepted: boolean, reason: string): void {
  if (!isSkipCommand(cmd)) return
  const status = accepted ? 'accepted' : `rejected ${reason}`
  debugLog('[store]', `skip from=${commandToken(from)} to=${commandToken(to)} ${status}`)
}

/** `[store] order ...` and `[store] transfer ...` with accepted or rejected. */
function logOrderOrTransfer(cmd: unknown, accepted: boolean, reason: string): void {
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return
  const record = cmd as {
    type?: unknown
    asset?: unknown
    side?: unknown
    quantity?: unknown
    from?: unknown
    to?: unknown
    amountCents?: unknown
  }
  const status = accepted ? 'accepted' : `rejected ${reason}`
  if (record.type === 'order') {
    debugLog(
      '[store]',
      `order ${commandToken(record.asset)} ${commandToken(record.side)} ${commandToken(record.quantity)} ${status}`,
    )
    return
  }
  if (record.type === 'transfer') {
    debugLog(
      '[store]',
      `transfer ${commandToken(record.from)} ${commandToken(record.to)} ${commandToken(record.amountCents)} ${status}`,
    )
  }
}

/** `[store] runEnded outcome=... reason=... day=... netWorth=... score=...` */
function logRunEnd(game: GameState): void {
  const end = game.runEnd
  if (end === null) return
  debugLog(
    '[store]',
    `runEnded outcome=${end.outcome} reason=${end.reason} day=${end.day} netWorth=${end.netWorthCents} score=${end.score}`,
  )
}

function isSetJobCommand(cmd: unknown): boolean {
  return typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) && (cmd as { type?: unknown }).type === 'setJob'
}

/** `[store] job setJob ... accepted|rejected`. */
function logJobCommand(cmd: unknown, accepted: boolean, reason: string, effectiveDay: number | null): void {
  if (!isSetJobCommand(cmd)) return
  const record = cmd as { jobId?: unknown }
  const id = commandToken(record.jobId)
  if (accepted) {
    const day = effectiveDay === null ? 'none' : String(effectiveDay)
    debugLog('[store]', `job setJob ${id} accepted effectiveDay=${day}`)
    return
  }
  debugLog('[store]', `job setJob ${id} rejected ${reason}`)
}

/** `[store] job changed|salary|perk` from the day log. */
function logJobDay(game: GameState): void {
  for (const event of game.log) {
    if (event.kind === 'jobChanged') {
      debugLog(
        '[store]',
        `job changed from=${event.from} to=${event.to} day=${event.day} slots=${event.slots} sleepHours=${event.sleepHours}`,
      )
    } else if (event.kind === 'salaryPaid') {
      debugLog(
        '[store]',
        `job salary job=${event.job} days=${event.days} amount=${event.amountCents} day=${event.day}`,
      )
    } else if (event.kind === 'perkApplied') {
      debugLog('[store]', `job perk perk=${event.perk} job=${event.job} day=${event.day}`)
    }
  }
}

/** `[store] bill pending|paid|runEnded ...` when a bill or a lost run is in view. */
function logBill(game: GameState): void {
  if (game.runEnd !== null) {
    debugLog('[store]', `bill runEnded day=${game.runEnd.day} reason=${game.runEnd.reason}`)
    return
  }
  if (game.bill !== null) {
    const shortfall = game.bill.amountCents - game.accounts.cashCents
    debugLog(
      '[store]',
      `bill pending day=${game.bill.day} amount=${game.bill.amountCents} cash=${game.accounts.cashCents} shortfall=${shortfall}`,
    )
    return
  }
  for (let index = game.log.length - 1; index >= 0; index -= 1) {
    const event = game.log[index]
    if (event?.kind !== 'billPaid') continue
    debugLog('[store]', `bill paid day=${event.day} amount=${event.amountCents} cash=${event.cashCents}`)
    return
  }
}

/** One player command. Acceptance comes from the simulation log, not from a second set of rules. */
export function dispatch(cmd: unknown): DispatchResult {
  const label = commandLabel(cmd)
  if (run === null) {
    console.error(`[store] dispatch ${label} rejected: game has not started`)
    debugLog('[store]', `dispatch ${label} -> rejected notStarted`)
    logOrderOrTransfer(cmd, false, 'notStarted')
    if (isSkipCommand(cmd)) debugLog('[store]', 'skip rejected notStarted')
    logJobCommand(cmd, false, 'notStarted', null)
    return { accepted: false, reason: 'notStarted' }
  }
  if (run.game.runEnd !== null) {
    logRunEnd(run.game)
    debugLog('[store]', `dispatch ${label} -> rejected runEnded`)
    logOrderOrTransfer(cmd, false, 'runEnded')
    if (isSkipCommand(cmd)) debugLog('[store]', 'skip rejected runEnded')
    logJobCommand(cmd, false, 'runEnded', null)
    return { accepted: false, reason: 'runEnded' }
  }
  const from = run.game.section
  const before = run.game.pending.length
  try {
    applyCommand(run.game, definitions, cmd)
  } catch (error) {
    console.error('[store] dispatch failed', error)
    throw error
  }
  const added = run.game.pending.slice(before)
  const rejection = added.find((event) => event.kind === 'commandRejected')
  const to = run.game.section
  if (rejection !== undefined) {
    debugLog('[store]', `dispatch ${label} -> rejected ${rejection.reason}`)
    logOrderOrTransfer(cmd, false, rejection.reason)
    logSkip(cmd, from, to, false, rejection.reason)
    logJobCommand(cmd, false, rejection.reason, null)
    logBill(run.game)
    logRunEnd(run.game)
    publish()
    return { accepted: false, reason: rejection.reason }
  }
  debugLog('[store]', `dispatch ${label} -> accepted`)
  logOrderOrTransfer(cmd, true, '')
  logSkip(cmd, from, to, true, '')
  logJobCommand(cmd, true, '', run.game.job.pending?.effectiveDay ?? null)
  logBill(run.game)
  logRunEnd(run.game)
  publish()
  return { accepted: true, reason: null }
}

/** Advance one day. Records that day's closes because the market log will be replaced tomorrow. */
export function endDay(): void {
  if (run === null) {
    console.error('[store] endDay rejected: game has not started')
    debugLog('[store]', 'endDay -> rejected notStarted')
    return
  }
  const block = endDayBlockReason(run.game)
  if (block !== null) {
    debugLog('[store]', `bill endDay blocked ${block} day=${run.game.market.day}`)
    if (block === 'runEnded') logRunEnd(run.game)
    return
  }
  const dayBefore = run.game.market.day
  try {
    simEndDay(run.game, definitions)
  } catch (error) {
    console.error('[store] endDay failed', error)
    throw error
  }
  logBill(run.game)
  logRunEnd(run.game)
  logJobDay(run.game)
  if (run.game.market.day === dayBefore) {
    const day = run.game.market.day
    const events = run.game.market.log.length
    const hash = stateHash(run.game.market)
    debugLog('[store]', `endDay day=${day} events=${events} hash=${hash}`)
    publish()
    return
  }
  const prices = readPrices(run.game)
  const summary = daySummary(run.game.market.log)
  const liquidations = readLiquidations(run.game)
  const day = run.game.market.day
  const events = run.game.market.log.length
  const hash = stateHash(run.game.market)
  run = {
    seed: run.seed,
    game: run.game,
    closes: [...run.closes, { day, prices }],
    summary,
    liquidations,
  }
  debugLog('[store]', `endDay day=${day} events=${events} hash=${hash}`)
  debugLog(
    '[store]',
    `liquidations ${
      liquidations.length === 0
        ? 'none'
        : liquidations.map((event) => `${event.asset} quantity=${event.quantity}`).join(', ')
    }`,
  )
  publish()
}

/**
 * Positive whole number in the safe-integer range.
 * Empty, fractional, negative, and huge text are reasons and are not parsed.
 */
export function parsePositiveInteger(raw: string, label: string): ParsedInteger {
  if (typeof raw !== 'string') return { ok: false, reason: `${label} must be a positive whole number.` }
  if (label.length === 0 || /[\r\n]/.test(label)) {
    throw new Error(`integer label must be a single line, received ${JSON.stringify(label)}`)
  }
  const text = raw.trim()
  if (text.length === 0) return { ok: false, reason: `${label} is empty.` }
  if (text.includes('.')) return { ok: false, reason: `${label} must be a whole number.` }
  if (text.startsWith('-')) return { ok: false, reason: `${label} must be positive.` }
  if (!/^[0-9]+$/.test(text)) return { ok: false, reason: `${label} must be a positive whole number.` }
  if (/^0+$/.test(text)) return { ok: false, reason: `${label} must be positive.` }
  if (text.length > 1 && text.startsWith('0')) {
    return { ok: false, reason: `${label} must be a positive whole number.` }
  }
  const max = String(Number.MAX_SAFE_INTEGER)
  if (text.length > max.length || (text.length === max.length && text > max)) {
    return { ok: false, reason: `${label} is too large.` }
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value <= 0) return { ok: false, reason: `${label} is too large.` }
  return { ok: true, value }
}

/** Copy liquidation rows off the game log before the next command replaces it. */
function readLiquidations(game: GameState): LiquidationEvent[] {
  const found: LiquidationEvent[] = []
  for (const event of game.log) {
    if (event.kind !== 'liquidation') continue
    if (!Number.isSafeInteger(event.day) || event.day < 0) {
      throw new Error(`liquidation day must be a safe integer >= 0, received ${String(event.day)}`)
    }
    if (typeof event.asset !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(event.asset)) {
      throw new Error(`liquidation asset is invalid, received ${JSON.stringify(event.asset)}`)
    }
    if (!Number.isSafeInteger(event.quantity) || event.quantity <= 0) {
      throw new Error(
        `liquidation quantity for ${event.asset} must be a positive safe integer, received ${String(event.quantity)}`,
      )
    }
    if (!Number.isSafeInteger(event.fill) || event.fill <= 0) {
      throw new Error(
        `liquidation fill for ${event.asset} must be a positive safe integer, received ${String(event.fill)}`,
      )
    }
    if (event.ratioAfter !== null && (typeof event.ratioAfter !== 'number' || !Number.isFinite(event.ratioAfter))) {
      throw new Error(
        `liquidation ratio for ${event.asset} must be a finite number or null, received ${String(event.ratioAfter)}`,
      )
    }
    found.push({
      kind: 'liquidation',
      day: event.day,
      asset: event.asset,
      quantity: event.quantity,
      fill: event.fill,
      ratioAfter: event.ratioAfter,
    })
  }
  return found
}
