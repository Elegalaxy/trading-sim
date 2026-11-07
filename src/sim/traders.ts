// Trader definitions check, per-run trader book (price-model plan, Step P1) and the core engine
// (Step P2, at the end of this file). The mix is drawn once from the market stream of
// `${seed}#traders` (one float per type in fixed order, then one for news efficiency), so the
// four main streams keep their draw order. Mix is clamped to each type's range and scaled so
// the sum of base x mix equals the sum of base (the same every run), found by bisection.

import { expectedDrift } from './drift.ts'
import { depthCents } from './participants.ts'
import { createRng, nextFloat } from './rng.ts'
import { TRADER_TYPES, type AssetDefinition, type MarketDefinitions, type MarketState, type TraderBook, type TraderDefinitions, type TraderType } from './types.ts'

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

// ---------------------------------------------------------------------------------------------
// Core engine (price-model plan, Step P2). Only the value and noise types trade here; informed,
// news, consensus, crowd and trend stay at zero until P3 and P4. `planTraderStock` works out one
// stock's wanted trades and the raw move, `market.ts` applies the cap, and `commitTraderStock`
// books what filled. Positions are dimensionless, in depth units: a trade of dq moves the price by
// about dq x price. Nothing here draws: the one normal per stock comes from the market stream.

/** True when the traders model prices today's step. `state.day` is the day being computed. */
export function traderModelOn(state: MarketState, defs: MarketDefinitions): boolean {
  const book = state.participants?.book
  return defs.traders !== undefined && defs.participants !== undefined && book !== undefined && state.day >= book.activeFromDay
}

/** One stock's day before the cap: the wanted trade per type and the raw move in cents. */
export type TraderPlan = {
  anchor: number
  depthScale: number
  depthCents: number
  previous: number
  /** Wanted trade per type, in depth units. Types that are not active yet are 0. */
  dq: Record<TraderType, number>
  /** The player's order flow in depth units (not a position). */
  playerDq: number
  rawMove: number
}

function clampNumber(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** Value traders' full-rate demand for a gap (in depth units per day): dead band, linear to full weight, steeper beyond the deep gap, capped. */
export function valueTarget(t: TraderDefinitions, weight: number, price: number, seenAnchor: number): number {
  const gap = seenAnchor / price - 1
  const size = Math.abs(gap)
  if (size <= t.valueDeadBand) return 0
  let multiple = Math.min(1, (size - t.valueDeadBand) / t.valueFullGap)
  if (size > t.valueDeepGap) multiple += (t.valueDeepSlope * (size - t.valueDeepGap)) / t.valueFullGap
  multiple = Math.min(multiple, t.valueMaxMultiple)
  return weight * Math.sign(gap) * multiple
}

/** Market makers' depth scale from the volatility EWMA: thinner when a stock has been moving more than usual. */
export function depthScaleFor(t: TraderDefinitions, vol: number, dailyVolatility: number): number {
  if (!(dailyVolatility > 0)) return 1
  const excess = Math.max(0, vol / dailyVolatility - 1)
  return clampNumber(1 / (1 + t.volSens * excess), t.depthScaleMin, 1)
}

/**
 * Advance the anchor (carry, lagged anchor) and work out the wanted trades. Mutates the book's
 * `carry` and `seenAnchor`. `z` is the stock's single market-stream normal. Call once per stock
 * per step; the caller must be inside `traderModelOn`.
 */
export function planTraderStock(
  state: MarketState,
  defs: MarketDefinitions,
  def: AssetDefinition,
  z: number,
  playerCents: number,
): TraderPlan {
  const t = defs.traders
  const p = defs.participants
  const book = state.participants?.book
  if (t === undefined || p === undefined || book === undefined) fail('traders model is not on')
  const asset = state.assets[def.id]
  const previous = asset.priceCents
  const carry = (book.carry[def.id] ?? 1) * (1 - expectedDrift(defs, def, state.environment) + t.premiumPerDay + (t.carryCorrectionPerDay ?? 0))
  book.carry[def.id] = carry
  const anchor = asset.fairValue * carry
  const lag = 1 - 0.5 ** (1 / t.anchorHalfLifeDays)
  const seen = (book.seenAnchor[def.id] ?? asset.fairValue) + lag * (anchor - (book.seenAnchor[def.id] ?? asset.fairValue))
  book.seenAnchor[def.id] = seen
  const pos = book.pos[def.id]
  if (pos === undefined) fail(`book has no positions for ${def.id}`)

  const dq = zeroPositions()
  const weight = (type: TraderType): number => t.types[type].base * book.mix[type]
  // Value traders trade the gap, not a target position: demand each day is rate x the gap response, so a
  // move by another type is corrected over the following days instead of only partly offset. `pos.value`
  // only books the running total (what the value traders have bought less sold).
  dq.value = t.types.value.rate * valueTarget(t, weight('value'), previous, seen)
  // The noise size is the stock's volatility share times the run's noise mix, not a weight in depth units.
  const sigma = def.dailyVolatility * t.noiseShare * book.mix.noise
  dq.noise = t.types.noise.rate * (t.noiseAr * pos.noise + sigma * z - pos.noise)

  const depth = depthCents(def, p)
  const playerDq = playerCents / depth
  let demand = playerDq
  for (const type of TRADER_TYPES) demand += dq[type]
  const depthScale = depthScaleFor(t, book.vol[def.id] ?? 0, def.dailyVolatility)
  return { anchor, depthScale, depthCents: depth, previous, dq, playerDq, rawMove: (previous * demand) / depthScale }
}

/**
 * Book what filled. `fillScale` is the share of the wanted move that the cap let through (1 when
 * the cap did not bind); the unfilled part stays wanted because the position only moves by what
 * filled. Also updates the volatility EWMA and yesterday's net non-noise flow.
 */
export function commitTraderStock(
  state: MarketState,
  defs: MarketDefinitions,
  def: AssetDefinition,
  plan: TraderPlan,
  fillScale: number,
  newPrice: number,
): void {
  const t = defs.traders
  const book = state.participants?.book
  if (t === undefined || book === undefined) fail('traders model is not on')
  const pos = book.pos[def.id]
  let others = 0
  for (const type of TRADER_TYPES) {
    pos[type] += fillScale * plan.dq[type]
    if (type !== 'noise') others += plan.dq[type]
  }
  book.lastFlow[def.id] = fillScale * others
  const move = Math.abs(newPrice / plan.previous - 1)
  const vol = book.vol[def.id] ?? 0
  book.vol[def.id] = vol + t.volEwma * (move - vol)
}
