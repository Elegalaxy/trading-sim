// UI session. Market rules stay in src/sim. Daily closes are kept here because
// MarketState.log is replaced on every endDay.

import { useSyncExternalStore } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { applyCommand, createGame, endDay as simEndDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { daySummary, type DaySummary } from '../sim/summary.ts'
import type { GameState } from '../sim/types.ts'
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
}

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

/** Reset to day 0. Does not advance the market. Returns a reason when the seed is rejected. */
export function startGame(seed: string): string | null {
  if (typeof seed !== 'string' || !SEED_PATTERN.test(seed)) {
    const reason = 'Seed must be 1 to 32 characters from A-Z, a-z, 0-9, and hyphen.'
    console.error(`[ui] rejected seed ${JSON.stringify(seed)}: ${reason}`)
    return reason
  }
  let game: GameState
  try {
    game = createGame(definitions, seed)
  } catch (error) {
    console.error('[store] createGame failed', error)
    throw error
  }
  run = { seed, game, closes: [], summary: null }
  debugLog('[ui]', `seed=${seed}`)
  publish()
  return null
}

/** One player command. Acceptance comes from the simulation log, not from a second set of rules. */
export function dispatch(cmd: unknown): void {
  const label = commandLabel(cmd)
  if (run === null) {
    console.error(`[store] dispatch ${label} rejected: game has not started`)
    debugLog('[store]', `dispatch ${label} -> rejected notStarted`)
    return
  }
  const before = run.game.pending.length
  try {
    applyCommand(run.game, definitions, cmd)
  } catch (error) {
    console.error('[store] dispatch failed', error)
    throw error
  }
  const added = run.game.pending.slice(before)
  const rejection = added.find((event) => event.kind === 'commandRejected')
  if (rejection !== undefined) {
    debugLog('[store]', `dispatch ${label} -> rejected ${rejection.reason}`)
  } else {
    debugLog('[store]', `dispatch ${label} -> accepted`)
  }
  publish()
}

/** Advance one day. Records that day's closes because the market log will be replaced tomorrow. */
export function endDay(): void {
  if (run === null) {
    console.error('[store] endDay rejected: game has not started')
    debugLog('[store]', 'endDay -> rejected notStarted')
    return
  }
  try {
    simEndDay(run.game, definitions)
  } catch (error) {
    console.error('[store] endDay failed', error)
    throw error
  }
  const prices = readPrices(run.game)
  const summary = daySummary(run.game.market.log)
  const day = run.game.market.day
  const events = run.game.market.log.length
  const hash = stateHash(run.game.market)
  run = {
    seed: run.seed,
    game: run.game,
    closes: [...run.closes, { day, prices }],
    summary,
  }
  debugLog('[store]', `endDay day=${day} events=${events} hash=${hash}`)
  publish()
}
