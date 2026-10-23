// Batch runner. Each run gets a seed derived from the base seed and the run
// index, still valid as a --seed. Strategies act, then endDay. Prices are not
// moved from here. The per-day market log is not printed.

import { MARKET_DEFINITIONS } from '../content/index.ts'
import { createGame, endDay } from '../sim/game.ts'
import { tradingEquity } from '../sim/trading.ts'
import { RNG_STREAM_NAMES, type GameState, type LogEvent, type MarketDefinitions } from '../sim/types.ts'
import { csvRelativePath, reportLines, writeCsv, type BatchStats, type LargestMove, type RunRecord } from './report.ts'
import { actDay, createRandomStream, type StrategyName } from './strategies.ts'

const SEED_PATTERN = /^[A-Za-z0-9-]{1,32}$/
const INDEX_ID = 'M4X'

export type BatchRequest = {
  seed: string
  days: number
  batch: number
  strategy: StrategyName
}

type RunTotals = {
  orders: number
  rejections: number
  lastQuantity: number
  liquidations: number
  wipeOuts: number
  backstopWriteOffCents: number
}

function assertRunSeed(seed: string): string {
  if (!SEED_PATTERN.test(seed)) {
    throw new Error(`[DEBUG batch] derived seed is not a valid --seed, received ${JSON.stringify(seed)}`)
  }
  return seed
}

/**
 * `${base}-${run}` when that still fits the 1 to 32 character seed rule.
 * Otherwise a 16-character mix of the base seed and the run index.
 */
export function runSeed(base: string, run: number): string {
  if (!SEED_PATTERN.test(base)) {
    throw new Error(`[DEBUG batch] base seed is not a valid --seed, received ${JSON.stringify(base)}`)
  }
  if (!Number.isSafeInteger(run) || run < 1) {
    throw new Error(`[DEBUG batch] run index must be a positive safe integer, received ${String(run)}`)
  }
  const tagged = `${base}-${run}`
  if (SEED_PATTERN.test(tagged)) return tagged
  return assertRunSeed(hashedSeed(base, run))
}

function hashedSeed(base: string, run: number): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let state = 0x811c9dc5
  const text = `${base}#${run}`
  for (let i = 0; i < text.length; i += 1) {
    state ^= text.charCodeAt(i)
    state = Math.imul(state, 0x01000193)
  }
  state >>>= 0
  let out = ''
  for (let i = 0; i < 16; i += 1) {
    state = Math.imul(state ^ (state >>> 16), 0x7feb352d) >>> 0
    state = Math.imul(state ^ (state >>> 15), 0x846ca68b) >>> 0
    state = (state ^ (state >>> 16)) >>> 0
    const index = state % alphabet.length
    const char = alphabet[index]
    if (char === undefined) throw new Error('[DEBUG batch] seed alphabet index is missing')
    out += char
  }
  return out
}

function marketPicture(game: GameState, defs: MarketDefinitions): string {
  const parts: string[] = [String(game.market.day)]
  for (const asset of defs.assets) {
    const price = game.market.assets[asset.id]?.priceCents
    if (!Number.isSafeInteger(price)) {
      throw new Error(`[DEBUG batch] asset ${asset.id} price is missing`)
    }
    parts.push(`${asset.id}=${price}`)
  }
  for (const name of RNG_STREAM_NAMES) {
    const stream = game.market.streams[name]
    const spare = stream.spare === undefined ? '' : String(stream.spare)
    parts.push(`${name}:${stream.a},${stream.b},${stream.c},${stream.d},${spare}`)
  }
  return parts.join('|')
}

function requireSafeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`[DEBUG batch] ${label} must be a safe integer, received ${String(value)}`)
  }
  return value
}

function greaterMove(absCents: number, previous: number, best: LargestMove): boolean {
  return BigInt(absCents) * BigInt(best.previousCents) > BigInt(best.absCents) * BigInt(previous)
}

function readPriceMove(
  event: LogEvent,
  run: number,
  stats: BatchStats,
  dayCapped: { value: boolean },
): void {
  if (event.kind !== 'priceStep' && event.kind !== 'indexStep') return
  const previous = requireSafeInt(event.previous, 'previous price')
  const move = requireSafeInt(event.cappedMove, 'capped move')
  if (previous <= 0) throw new Error(`[DEBUG batch] previous price must be positive, received ${previous}`)
  if (typeof event.capped !== 'boolean') throw new Error('[DEBUG batch] capped flag is not a boolean')
  if (!Number.isSafeInteger(event.newPrice) || event.newPrice <= 0) {
    throw new Error(`[DEBUG batch] new price must be a positive safe integer, received ${String(event.newPrice)}`)
  }
  if (!Number.isFinite(event.gapAfter)) {
    throw new Error(`[DEBUG batch] gapAfter is not finite, received ${String(event.gapAfter)}`)
  }
  const absCents = Math.abs(move)
  if (stats.largestMove === null || greaterMove(absCents, previous, stats.largestMove)) {
    stats.largestMove = {
      absCents,
      previousCents: previous,
      asset: event.asset,
      day: event.day,
      run,
    }
  }
  if (event.capped) dayCapped.value = true
  const gapPercent = (Math.abs(event.gapAfter) * 100) / event.newPrice
  if (!Number.isFinite(gapPercent) || gapPercent < 0) {
    throw new Error(`[DEBUG batch] price-to-fair gap percent is ${gapPercent}`)
  }
  stats.gapAbsPercentSum += gapPercent
  stats.gapSamples += 1
  if (gapPercent > stats.largestGapAbsPercent) stats.largestGapAbsPercent = gapPercent
}

function readFairValueClip(event: LogEvent, stats: BatchStats): void {
  if (event.kind !== 'fairValueChange') return
  if (!Number.isFinite(event.total) || !Number.isFinite(event.clipped)) {
    throw new Error(`[DEBUG batch] fair value change is not finite for ${event.asset}`)
  }
  if (event.total !== event.clipped) stats.fairValueClips += 1
}

function readAccountDay(game: GameState, totals: RunTotals): void {
  for (const event of game.log) {
    if (event.kind === 'liquidation') {
      totals.liquidations += 1
      if (!Number.isSafeInteger(event.quantity) || event.quantity <= 0) {
        throw new Error(`[DEBUG batch] liquidation quantity is ${String(event.quantity)}`)
      }
    } else if (event.kind === 'wipeOut') {
      totals.wipeOuts += 1
    } else if (event.kind === 'backstopWriteOff') {
      if (!Number.isSafeInteger(event.amount) || event.amount < 0) {
        throw new Error(`[DEBUG batch] backstop write-off is ${String(event.amount)}`)
      }
      totals.backstopWriteOffCents += event.amount
    }
  }
}

function runOne(defs: MarketDefinitions, seed: string, days: number, strategy: StrategyName, run: number, stats: BatchStats): RunRecord & RunTotals {
  const game = createGame(defs, seed)
  const randomStream = strategy === 'random' ? createRandomStream(seed) : null
  const totals: RunTotals = {
    orders: 0,
    rejections: 0,
    lastQuantity: 0,
    liquidations: 0,
    wipeOuts: 0,
    backstopWriteOffCents: 0,
  }
  for (let step = 0; step < days; step += 1) {
    const before = marketPicture(game, defs)
    const action = actDay(strategy, game, defs, randomStream)
    const after = marketPicture(game, defs)
    if (after !== before) {
      throw new Error(`[DEBUG batch] strategy changed the market seed=${seed} day=${game.market.day} asset=${INDEX_ID}`)
    }
    totals.orders += action.orders
    totals.rejections += action.rejections
    if (action.orders > 0) totals.lastQuantity = action.lastQuantity
    endDay(game, defs)
    const dayCapped = { value: false }
    let sawMove = false
    for (const event of game.market.log) {
      if (event.kind === 'priceStep' || event.kind === 'indexStep') sawMove = true
      readPriceMove(event, run, stats, dayCapped)
      readFairValueClip(event, stats)
    }
    if (!sawMove) throw new Error(`[DEBUG batch] day ${game.market.day} seed=${seed} has no price step`)
    if (dayCapped.value) stats.cappedDays += 1
    stats.runDays += 1
    readAccountDay(game, totals)
  }
  const equity = tradingEquity(game, defs).equity
  if (!Number.isSafeInteger(equity)) {
    throw new Error(`[DEBUG batch] final equity is not a safe integer, received ${String(equity)}`)
  }
  return {
    run,
    seed,
    finalEquityCents: equity,
    liquidations: totals.liquidations,
    wipeOuts: totals.wipeOuts,
    backstopWriteOffCents: totals.backstopWriteOffCents,
    orders: totals.orders,
    rejections: totals.rejections,
    lastQuantity: totals.lastQuantity,
  }
}

export function runBatch(request: BatchRequest): void {
  if (!Number.isSafeInteger(request.batch) || request.batch < 1) {
    throw new Error(`[DEBUG batch] batch count must be a positive safe integer, received ${String(request.batch)}`)
  }
  if (!Number.isSafeInteger(request.days) || request.days < 1) {
    throw new Error(`[DEBUG batch] days must be a positive safe integer, received ${String(request.days)}`)
  }
  const defs = MARKET_DEFINITIONS
  console.log(
    `[DEBUG batch] seed=${request.seed} runs=${request.batch} days=${request.days} strategy=${request.strategy} index=${INDEX_ID}`,
  )
  const stats: BatchStats = {
    runs: request.batch,
    days: request.days,
    strategy: request.strategy,
    baseSeed: request.seed,
    largestMove: null,
    cappedDays: 0,
    runDays: 0,
    gapAbsPercentSum: 0,
    gapSamples: 0,
    largestGapAbsPercent: 0,
    fairValueClips: 0,
    records: [],
  }
  const records: RunRecord[] = []
  for (let run = 1; run <= request.batch; run += 1) {
    const seed = runSeed(request.seed, run)
    const row = runOne(defs, seed, request.days, request.strategy, run, stats)
    records.push({
      run: row.run,
      seed: row.seed,
      finalEquityCents: row.finalEquityCents,
      liquidations: row.liquidations,
      wipeOuts: row.wipeOuts,
      backstopWriteOffCents: row.backstopWriteOffCents,
    })
    console.log(
      `[sim] batch run=${run} seed=${seed} strategy=${request.strategy} finalEquity=${row.finalEquityCents} liquidations=${row.liquidations}`,
    )
    console.log(
      `[DEBUG batch] run=${run} seed=${seed} strategy=${request.strategy} orders=${row.orders} rejections=${row.rejections} lastQuantity=${row.lastQuantity} wipeOuts=${row.wipeOuts} backstopWriteOff=${row.backstopWriteOffCents}`,
    )
  }
  stats.records = records
  const relative = csvRelativePath(stats)
  writeCsv(stats)
  console.log(`[DEBUG batch] wrote csv=${relative} runs=${records.length}`)
  for (const line of reportLines(stats)) console.log(line)
}
