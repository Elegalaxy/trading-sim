// Batch risk report. Every measure is read from log events the simulation
// already emits. Final equity is trading-account equity in cents, the same
// equity the margin check uses. Cash and savings are not included.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type RunRecord = {
  run: number
  seed: string
  finalEquityCents: number
  liquidations: number
  wipeOuts: number
  backstopWriteOffCents: number
}

export type LargestMove = {
  absCents: number
  previousCents: number
  asset: string
  day: number
  run: number
}

export type BatchStats = {
  runs: number
  days: number
  strategy: string
  baseSeed: string
  largestMove: LargestMove | null
  cappedDays: number
  runDays: number
  endedEarly: number
  gapAbsPercentSum: number
  gapSamples: number
  largestGapAbsPercent: number
  fairValueClips: number
  records: readonly RunRecord[]
}

function requireFinite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`[DEBUG batch] ${label} must be a finite number, received ${String(value)}`)
  }
  return value
}

function requireCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`[DEBUG batch] ${label} must be a safe integer >= 0, received ${String(value)}`)
  }
  return value
}

/** Floor to 6 decimal places. The 8% cap is an integer ratio, so this cannot round up through 8. */
export function formatMovePercent(absCents: number, previousCents: number): string {
  requireCount(absCents, 'absolute move')
  if (!Number.isSafeInteger(previousCents) || previousCents <= 0) {
    throw new Error(`[DEBUG batch] move previous price must be a positive safe integer, received ${String(previousCents)}`)
  }
  if (BigInt(absCents) * 100n > BigInt(previousCents) * 8n) {
    throw new Error(`[DEBUG batch] daily move ${absCents} cents on ${previousCents} exceeds 8%`)
  }
  const micro = (BigInt(absCents) * 100_000_000n) / BigInt(previousCents)
  const whole = micro / 1_000_000n
  const frac = (micro % 1_000_000n).toString().padStart(6, '0')
  return `${whole.toString()}.${frac}`
}

function formatFixed(value: number, digits: number, label: string): string {
  const finite = requireFinite(value, label)
  return finite.toFixed(digits)
}

/** Nearest rank: the value at ceil(p / 100 * n), 1-based, in an ascending sort. */
export function percentileNearestRank(sortedAsc: readonly number[], percent: number): number {
  const count = sortedAsc.length
  if (count === 0) throw new Error('[DEBUG batch] percentile needs at least one run')
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    throw new Error(`[DEBUG batch] percentile must be in (0, 100], received ${String(percent)}`)
  }
  const rank = Math.ceil((percent / 100) * count)
  const index = Math.min(count, Math.max(1, rank)) - 1
  const value = sortedAsc[index]
  if (value === undefined || !Number.isSafeInteger(value)) {
    throw new Error(`[DEBUG batch] percentile ${percent} is missing at index ${index}`)
  }
  return value
}

function reportLine(body: string): string {
  return `[sim] report ${body}`
}

export function reportLines(stats: BatchStats): string[] {
  requireCount(stats.runs, 'runs')
  requireCount(stats.days, 'days')
  requireCount(stats.cappedDays, 'capped days')
  requireCount(stats.runDays, 'run days')
  requireCount(stats.gapSamples, 'gap samples')
  requireCount(stats.fairValueClips, 'fair value clips')
  if (stats.records.length !== stats.runs) {
    throw new Error(`[DEBUG batch] expected ${stats.runs} records, received ${stats.records.length}`)
  }
  requireCount(stats.endedEarly, 'ended early')
  if (stats.runDays > stats.runs * stats.days) {
    throw new Error(`[DEBUG batch] run days ${stats.runDays} are above ${stats.runs} * ${stats.days}`)
  }
  if (stats.endedEarly > stats.runs) {
    throw new Error(`[DEBUG batch] ended early ${stats.endedEarly} is above runs ${stats.runs}`)
  }
  if (stats.largestMove === null) throw new Error('[DEBUG batch] the batch log has no price step')
  if (stats.gapSamples === 0) throw new Error('[DEBUG batch] the batch log has no price-to-fair gap')

  let liquidationTotal = 0
  let wipeOutTotal = 0
  let writeOffTotal = 0
  let runsWithLiquidation = 0
  const equities: number[] = []
  for (const record of stats.records) {
    requireCount(record.liquidations, 'liquidations')
    requireCount(record.wipeOuts, 'wipe-outs')
    requireCount(record.backstopWriteOffCents, 'backstop write-off')
    if (!Number.isSafeInteger(record.finalEquityCents)) {
      throw new Error(`[DEBUG batch] final equity is not a safe integer, received ${String(record.finalEquityCents)}`)
    }
    liquidationTotal += record.liquidations
    wipeOutTotal += record.wipeOuts
    writeOffTotal += record.backstopWriteOffCents
    if (record.liquidations > 0) runsWithLiquidation += 1
    equities.push(record.finalEquityCents)
  }
  if (!Number.isSafeInteger(liquidationTotal) || !Number.isSafeInteger(wipeOutTotal) || !Number.isSafeInteger(writeOffTotal)) {
    throw new Error('[DEBUG batch] report totals overflowed a safe integer')
  }
  equities.sort((left, right) => left - right)
  const p10 = percentileNearestRank(equities, 10)
  const p50 = percentileNearestRank(equities, 50)
  const p90 = percentileNearestRank(equities, 90)
  const move = stats.largestMove
  const averageGap = stats.gapAbsPercentSum / stats.gapSamples
  const lines = [
    reportLine(`runs=${stats.runs} days=${stats.days} strategy=${stats.strategy} seed=${stats.baseSeed}`),
    reportLine(
      `largestDailyMovePercent=${formatMovePercent(move.absCents, move.previousCents)} asset=${move.asset} day=${move.day} run=${move.run}`,
    ),
    reportLine(
      `cappedDayShare=${formatFixed(stats.cappedDays / stats.runDays, 6, 'capped day share')} cappedDays=${stats.cappedDays} runDays=${stats.runDays} endedEarly=${stats.endedEarly}`,
    ),
    reportLine(
      `priceToFairGapAbsPercent average=${formatFixed(averageGap, 6, 'average gap')} largest=${formatFixed(stats.largestGapAbsPercent, 6, 'largest gap')} samples=${stats.gapSamples}`,
    ),
    reportLine(`fairValueClipCount total=${stats.fairValueClips}`),
    reportLine(
      `liquidations total=${liquidationTotal} meanPerRun=${formatFixed(liquidationTotal / stats.runs, 6, 'liquidation mean')}`,
    ),
    reportLine(
      `wipeOuts total=${wipeOutTotal} meanPerRun=${formatFixed(wipeOutTotal / stats.runs, 6, 'wipe-out mean')}`,
    ),
    reportLine(
      `liquidationRate=${formatFixed(runsWithLiquidation / stats.runs, 6, 'liquidation rate')} runsWithLiquidation=${runsWithLiquidation} runs=${stats.runs}`,
    ),
    reportLine(`backstopWriteOffCents total=${writeOffTotal}`),
    reportLine(`finalEquityCents p10=${p10} p50=${p50} p90=${p90} percentile=nearestRank`),
    reportLine(`csv=${csvRelativePath(stats)}`),
  ]
  for (const line of lines) {
    if (!line.startsWith('[sim] report')) throw new Error(`[DEBUG batch] report line is missing its prefix: ${line}`)
  }
  return lines
}

function csvFileName(stats: BatchStats): string {
  return `batch-${stats.strategy}-${stats.baseSeed}-n${stats.runs}-d${stats.days}.csv`
}

export function csvRelativePath(stats: BatchStats): string {
  return `reports/${csvFileName(stats)}`
}

function csvSeed(seed: string): string {
  if (!/^[A-Za-z0-9-]{1,32}$/.test(seed)) {
    throw new Error(`[DEBUG batch] csv seed is not a harness seed, received ${JSON.stringify(seed)}`)
  }
  return `"${seed}"`
}

export function csvText(stats: BatchStats): string {
  const header = 'seed,finalEquityCents,liquidations,wipeOuts,backstopWriteOffCents'
  const rows = [header]
  for (const record of stats.records) {
    requireCount(record.liquidations, 'liquidations')
    requireCount(record.wipeOuts, 'wipe-outs')
    requireCount(record.backstopWriteOffCents, 'backstop write-off')
    if (!Number.isSafeInteger(record.finalEquityCents)) {
      throw new Error(`[DEBUG batch] csv equity is not a safe integer, received ${String(record.finalEquityCents)}`)
    }
    rows.push(
      [
        csvSeed(record.seed),
        String(record.finalEquityCents),
        String(record.liquidations),
        String(record.wipeOuts),
        String(record.backstopWriteOffCents),
      ].join(','),
    )
  }
  return `${rows.join('\r\n')}\r\n`
}

/** Write the spreadsheet next to the trading-sim package. `reports/` is gitignored. */
export function writeCsv(stats: BatchStats): string {
  const relative = csvRelativePath(stats)
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const directory = join(root, 'reports')
  const file = join(directory, csvFileName(stats))
  const text = csvText(stats)
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(file, text, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[DEBUG batch] could not write ${relative}: ${message}`)
  }
  return relative
}
