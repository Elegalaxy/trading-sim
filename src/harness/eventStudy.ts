// Event study for the batch report (market-depth plan, Step M0). It reads only
// the market log, the stored feed and the closes after each End day, so it is
// the same whatever strategy the batch runs, and it never touches a stream.
//
// Day N is the market step whose effects first move fair value (effectApplied
// with dayIndex 0). Its headline is in the feed the player reads during the next
// session, so the close of N is the first price a headline reader can trade at.
// Moves are signed by the effect's direction on that asset (positive = the way
// the news points) and are percent of a close:
//   d<k>     close N+k against close N-1, k = -3, -2, 0 … 5 (pre-news drift and the run-up)
//   after<k> close N+k against close N, the part left after the headline is readable
// Rumours are measured from the close of the day they were generated (they are
// read in the next session) to the close of the day they claim, and two days on.

import type { DayFeed, LogEvent, MarketDefinitions, MarketState, SourceTier } from '../sim/types.ts'

const PRE_OFFSETS = [-3, -2] as const
const POST_OFFSETS = [0, 1, 2, 3, 4, 5] as const
const AFTER_OFFSETS = [1, 3, 5] as const
const FIRST_OFFSET = -3
const LAST_OFFSET = 5
const CLAIM_LATER = 2

type EffectSample = {
  groups: string[]
  asset: string
  day: number
  sign: 1 | -1
}

type RumourSample = {
  group: string
  asset: string
  day: number
  claimDay: number
  sign: 1 | -1
}

type Series = {
  count: number
  sums: Map<string, number>
  squares: Map<string, number>
}

export type EventStudy = {
  stockIds: Set<string>
  scopeByType: Map<string, string>
  series: Map<string, Series>
  // Per run. Cleared by finishStudyRun.
  closes: Map<number, Record<string, number>>
  effects: EffectSample[]
  rumours: RumourSample[]
  trueRumoured: Set<string>
  cappedStockDays: number
  /** Largest gap between a stock's price and its fair value after a step, in percent of fair value. */
  maxGapPercent: number
  /** Largest move that order-flow parties added to one stock in one step, in percent of its price. */
  maxFlowPercent: number
  stockDays: number
}

export function createEventStudy(defs: MarketDefinitions): EventStudy {
  const stockIds = new Set(defs.assets.filter((asset) => asset.kind === 'stock').map((asset) => asset.id))
  const scopeByType = new Map(defs.events.map((eventType) => [eventType.id, eventType.scope]))
  return {
    stockIds,
    scopeByType,
    series: new Map(),
    closes: new Map(),
    effects: [],
    rumours: [],
    trueRumoured: new Set(),
    cappedStockDays: 0,
    maxGapPercent: 0,
    maxFlowPercent: 0,
    stockDays: 0,
  }
}

function recordCloses(study: EventStudy, market: MarketState): void {
  const closes: Record<string, number> = {}
  for (const id of study.stockIds) {
    const price = market.assets[id]?.priceCents
    if (!Number.isSafeInteger(price) || price === undefined || price <= 0) {
      throw new Error(`[DEBUG study] close for ${id} on day ${market.day} is ${String(price)}`)
    }
    closes[id] = price
  }
  study.closes.set(market.day, closes)
}

function effectGroups(study: EventStudy, effectId: string): string[] {
  const parts = effectId.split(':')
  const head = parts[0] ?? ''
  if (head === 'calendar') return [`calendar:${parts[1] ?? '?'}`]
  const scope = study.scopeByType.get(head)
  if (scope === undefined) throw new Error(`[DEBUG study] effect ${effectId} has an unknown event type`)
  if (scope !== 'stock') return [`scope:${scope}`]
  const rumoured = study.trueRumoured.has(effectId) ? 'stock:rumoured' : 'stock:unrumoured'
  return ['stock', rumoured, `type:${head}`]
}

function readEffects(study: EventStudy, log: readonly LogEvent[]): void {
  for (const event of log) {
    if (event.kind === 'priceStep' && study.stockIds.has(event.asset)) {
      study.stockDays += 1
      if (event.capped) study.cappedStockDays += 1
      study.maxGapPercent = Math.max(study.maxGapPercent, (Math.abs(event.gapAfter) / event.fair) * 100)
      if (event.flow !== undefined) study.maxFlowPercent = Math.max(study.maxFlowPercent, (Math.abs(event.flow) / event.previous) * 100)
    }
    if (event.kind !== 'effectApplied' || event.dayIndex !== 0 || event.delta === 0) continue
    study.effects.push({
      groups: effectGroups(study, event.effect),
      asset: event.asset,
      day: event.day,
      sign: event.delta > 0 ? 1 : -1,
    })
  }
}

function rumourGroup(tier: SourceTier, truth: boolean): string {
  return `rumour:${truth ? 'true' : 'false'}:${tier}`
}

function readRumours(study: EventStudy, feed: DayFeed, day: number): void {
  for (const item of feed.items) {
    if (item.kind !== 'rumour') continue
    if (item.truth) study.trueRumoured.add(item.targetEventId)
    const asset = item.targetEventId.split(':')[1]
    if (asset === undefined || !study.stockIds.has(asset) || item.direction === undefined) continue
    study.rumours.push({
      group: rumourGroup(item.tier, item.truth),
      asset,
      day,
      claimDay: day + item.leadDays,
      sign: item.direction === 'up' ? 1 : -1,
    })
  }
}

/** Call once with the day-0 market before any End day. */
export function startStudyRun(study: EventStudy, market: MarketState): void {
  study.closes.clear()
  study.effects = []
  study.rumours = []
  study.trueRumoured.clear()
  recordCloses(study, market)
  readRumours(study, market.feed, market.day)
}

/** Call after every End day with the stepped market. */
export function recordStudyDay(study: EventStudy, market: MarketState): void {
  recordCloses(study, market)
  readEffects(study, market.log)
  readRumours(study, market.feed, market.day)
}

function add(study: EventStudy, group: string, values: ReadonlyMap<string, number>): void {
  let series = study.series.get(group)
  if (series === undefined) {
    series = { count: 0, sums: new Map(), squares: new Map() }
    study.series.set(group, series)
  }
  series.count += 1
  for (const [key, value] of values) {
    series.sums.set(key, (series.sums.get(key) ?? 0) + value)
    series.squares.set(key, (series.squares.get(key) ?? 0) + value * value)
  }
}

function signedPercent(sign: 1 | -1, to: number, from: number): number {
  return (sign * (to - from) * 100) / from
}

/** Fold this run's samples into the totals. Samples too close to the run's edges are skipped. */
export function finishStudyRun(study: EventStudy): void {
  const close = (day: number, asset: string): number | undefined => study.closes.get(day)?.[asset]
  for (const sample of study.effects) {
    const base = close(sample.day - 1, sample.asset)
    const headline = close(sample.day, sample.asset)
    if (base === undefined || headline === undefined) continue
    if (close(sample.day + FIRST_OFFSET, sample.asset) === undefined) continue
    if (close(sample.day + LAST_OFFSET, sample.asset) === undefined) continue
    const values = new Map<string, number>()
    for (const k of [...PRE_OFFSETS, ...POST_OFFSETS]) {
      const price = close(sample.day + k, sample.asset)
      if (price === undefined) throw new Error(`[DEBUG study] missing close day ${sample.day + k}`)
      values.set(`d${k}`, signedPercent(sample.sign, price, base))
    }
    for (const k of AFTER_OFFSETS) {
      const price = close(sample.day + k, sample.asset)
      if (price === undefined) throw new Error(`[DEBUG study] missing close day ${sample.day + k}`)
      values.set(`after${k}`, signedPercent(sample.sign, price, headline))
    }
    for (const group of sample.groups) add(study, group, values)
  }
  for (const sample of study.rumours) {
    const base = close(sample.day, sample.asset)
    const claim = close(sample.claimDay, sample.asset)
    const later = close(sample.claimDay + CLAIM_LATER, sample.asset)
    if (base === undefined || claim === undefined || later === undefined) continue
    add(
      study,
      sample.group,
      new Map([
        ['toClaim', signedPercent(sample.sign, claim, base)],
        [`claim+${CLAIM_LATER}`, signedPercent(sample.sign, later, base)],
      ]),
    )
  }
}

function mean(series: Series, key: string): number {
  return (series.sums.get(key) ?? 0) / series.count
}

/** Standard error of the mean. */
function standardError(series: Series, key: string): number {
  if (series.count < 2) return 0
  const average = mean(series, key)
  const variance = ((series.squares.get(key) ?? 0) - series.count * average * average) / (series.count - 1)
  return Math.sqrt(Math.max(0, variance) / series.count)
}

function groupOrder(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export function studyLines(study: EventStudy): string[] {
  const lines: string[] = []
  const share = study.stockDays === 0 ? 0 : study.cappedStockDays / study.stockDays
  lines.push(
    `[sim] study cappedStockDayShare=${share.toFixed(6)} cappedStockDays=${study.cappedStockDays} stockDays=${study.stockDays}`,
    `[sim] study maxGapPercent=${study.maxGapPercent.toFixed(2)} maxFlowPercent=${study.maxFlowPercent.toFixed(2)}`,
  )
  const groups = [...study.series.keys()].sort(groupOrder)
  for (const group of groups) {
    const series = study.series.get(group)
    if (series === undefined) continue
    const fields = [...series.sums.keys()].map((key) => `${key}=${mean(series, key).toFixed(3)}`)
    const spread = series.sums.has('d3') ? ` se.d3=${standardError(series, 'd3').toFixed(3)}` : ''
    lines.push(`[sim] study group=${group} n=${series.count} ${fields.join(' ')}${spread}`)
  }
  return lines
}
