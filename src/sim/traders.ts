// Trader definitions check and per-run trader book (price-model plan, Step P1).
// No behaviour yet: nothing reads the book. The mix is drawn once from the market stream of
// `${seed}#traders` (one float per type in fixed order, then one for news efficiency), so the
// four main streams keep their draw order. Mix is clamped to each type's range and scaled so
// the sum of base x mix equals the sum of base (the same every run), found by bisection.

import { createRng, nextFloat } from './rng.ts'
import { TRADER_TYPES, type MarketDefinitions, type MarketState, type TraderBook, type TraderDefinitions, type TraderType } from './types.ts'

function fail(message: string): never {
  throw new Error(`[DEBUG traders] ${message}`)
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) fail(`${name} must be a finite number above 0, received ${value}`)
}

/** Throws a `[DEBUG traders]` error when the numbers cannot give a valid book. */
export function assertTraderDefinitions(defs: TraderDefinitions): void {
  let baseSum = 0
  let minSum = 0
  let maxSum = 0
  for (const type of TRADER_TYPES) {
    const row = defs.types[type]
    if (row === undefined) fail(`missing type ${type}`)
    positive(row.base, `${type}.base`)
    positive(row.mixMin, `${type}.mixMin`)
    positive(row.mixMax, `${type}.mixMax`)
    if (row.mixMin > row.mixMax) fail(`${type} mixMin ${row.mixMin} is above mixMax ${row.mixMax}`)
    if (!Number.isFinite(row.rate) || row.rate <= 0 || row.rate > 1) fail(`${type}.rate must be in (0, 1], received ${row.rate}`)
    baseSum += row.base
    minSum += row.base * row.mixMin
    maxSum += row.base * row.mixMax
  }
  if (minSum > baseSum || maxSum < baseSum) {
    fail(`mix ranges cannot reach the constant weight ${baseSum} (reachable ${minSum} to ${maxSum})`)
  }
  positive(defs.efficiencyMin, 'efficiencyMin')
  if (!Number.isFinite(defs.efficiencyMax) || defs.efficiencyMax < defs.efficiencyMin) fail('efficiencyMax must be at least efficiencyMin')
  if (!Number.isFinite(defs.premiumPerDay)) fail('premiumPerDay must be finite')
  positive(defs.anchorHalfLifeDays, 'anchorHalfLifeDays')
  positive(defs.volSens, 'volSens')
  if (!Number.isFinite(defs.depthScaleMin) || defs.depthScaleMin <= 0 || defs.depthScaleMin > 1) fail('depthScaleMin must be in (0, 1]')
  if (!Number.isFinite(defs.volEwma) || defs.volEwma <= 0 || defs.volEwma > 1) fail('volEwma must be in (0, 1]')
}

/** Mix per type, each inside its range, with sum(base x mix) equal to sum(base). */
function normalisedMix(defs: TraderDefinitions, draws: readonly number[]): Record<TraderType, number> {
  const raw = TRADER_TYPES.map((type, index) => {
    const row = defs.types[type]
    return row.mixMin + draws[index] * (row.mixMax - row.mixMin)
  })
  const target = TRADER_TYPES.reduce((sum, type) => sum + defs.types[type].base, 0)
  const clamped = (type: TraderType, index: number, scale: number): number => {
    const row = defs.types[type]
    return Math.min(row.mixMax, Math.max(row.mixMin, raw[index] * scale))
  }
  const total = (scale: number): number =>
    TRADER_TYPES.reduce((sum, type, index) => sum + defs.types[type].base * clamped(type, index, scale), 0)
  let low = 0
  let high = 1
  while (total(high) < target) high *= 2
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2
    if (total(mid) < target) low = mid
    else high = mid
  }
  const scale = (low + high) / 2
  const mix = {} as Record<TraderType, number>
  TRADER_TYPES.forEach((type, index) => {
    mix[type] = clamped(type, index, scale)
  })
  return mix
}

function zeroPositions(): Record<TraderType, number> {
  const pos = {} as Record<TraderType, number>
  for (const type of TRADER_TYPES) pos[type] = 0
  return pos
}

/**
 * A fresh book for a run. Stocks only, in definition order. Carry starts at 1, the lagged
 * anchor at the stock's current fair value, positions at 0. Active from the market's current day.
 */
export function createTraderBook(defs: MarketDefinitions, seed: string, market: MarketState): TraderBook {
  const traders = defs.traders
  if (traders === undefined) fail('definitions have no traders')
  assertTraderDefinitions(traders)
  const stream = createRng(`${seed}#traders`).market
  const draws = TRADER_TYPES.map(() => nextFloat(stream))
  const efficiency = traders.efficiencyMin + nextFloat(stream) * (traders.efficiencyMax - traders.efficiencyMin)
  const book: TraderBook = {
    activeFromDay: market.day,
    mix: normalisedMix(traders, draws),
    efficiency,
    carry: {},
    seenAnchor: {},
    pos: {},
    eventPos: {},
    vol: {},
    lastFlow: {},
  }
  for (const asset of defs.assets) {
    if (asset.kind !== 'stock') continue
    const state = market.assets[asset.id]
    if (state === undefined) fail(`market has no asset ${asset.id}`)
    book.carry[asset.id] = 1
    book.seenAnchor[asset.id] = state.fairValue
    book.pos[asset.id] = zeroPositions()
    book.vol[asset.id] = 0
    book.lastFlow[asset.id] = 0
  }
  return book
}
