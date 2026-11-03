// Closed-day record. After each End day the sim keeps the session that led into the close
// (one list of 15-minute bars per asset), the closing prices and the closing trading equity,
// on `GameState.past`. The save keeps it, so a reloaded chart still has candles for past days
// (and the fill marks that sit on them) and the equity tab keeps its daily line.
// A record only: nothing in the sim reads it back, and it draws no random stream.

import { RUN_LENGTH_DAYS } from './constants.ts'
import type { GameState, PastDay, SessionBar } from './types.ts'

function copyBars(bars: Record<string, SessionBar[]>): Record<string, SessionBar[]> {
  const out: Record<string, SessionBar[]> = {}
  for (const [id, list] of Object.entries(bars)) out[id] = list.map((bar) => ({ ...bar }))
  return out
}

/** Add the day that just closed. Call after the market step, with the session it replaced. */
export function recordPastDay(state: GameState, bars: Record<string, SessionBar[]>, equityCents: number): void {
  const prices: Record<string, number> = {}
  for (const [id, asset] of Object.entries(state.market.assets)) prices[id] = asset.priceCents
  state.past.push({ day: state.market.day, prices, bars: copyBars(bars), equityCents })
}

/**
 * A copy for a preview (an order that is only being tried). The records of past days and
 * fills are left out: a preview never reads them, and copying them on every try would
 * grow with the run.
 */
export function previewCopy(state: GameState): GameState {
  return structuredClone({ ...state, past: [], fills: [] })
}

function describeValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Shape of the record: one row per day in order, whole-cent amounts, no more rows than the run has days. */
export function assertPast(past: unknown): asserts past is PastDay[] {
  if (!Array.isArray(past)) throw new Error(`game past must be an array, received ${describeValue(past)}`)
  if (past.length > RUN_LENGTH_DAYS) throw new Error(`game past holds ${past.length} days, over the run length of ${RUN_LENGTH_DAYS}`)
  let before = 0
  past.forEach((row: unknown, index) => {
    const at = `past row ${index + 1}`
    if (!isObject(row)) throw new Error(`${at} must be an object`)
    if (typeof row.day !== 'number' || !Number.isSafeInteger(row.day) || row.day <= before) {
      throw new Error(`${at} day must rise, received ${describeValue(row.day)}`)
    }
    before = row.day
    if (typeof row.equityCents !== 'number' || !Number.isSafeInteger(row.equityCents)) {
      throw new Error(`${at} equityCents must be a safe integer`)
    }
    if (!isObject(row.prices)) throw new Error(`${at} needs prices`)
    for (const [id, price] of Object.entries(row.prices)) {
      if (typeof price !== 'number' || !Number.isSafeInteger(price) || price <= 0) {
        throw new Error(`${at} price of ${id} must be a positive safe integer`)
      }
    }
    if (!isObject(row.bars)) throw new Error(`${at} needs bars`)
    for (const [id, list] of Object.entries(row.bars)) {
      if (!Array.isArray(list)) throw new Error(`${at} bars of ${id} must be a list`)
      for (const bar of list as unknown[]) {
        if (!isObject(bar)) throw new Error(`${at} bar of ${id} must be an object`)
        for (const key of ['open', 'high', 'low', 'close', 'volume']) {
          const value = bar[key]
          if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${at} bar of ${id} needs a whole ${key}`)
        }
      }
    }
  })
}
