// Layoff report (plan layoffs, loans and deposits, Step Y4). A passive bot that never trades,
// pays its bills and holds one job for the whole run, once for each job on the menu, over N seeds.
// For each job it prints how many runs saw a warning, how many were cut, the average layoff day
// among the cut runs, and how many of the warnings came on a weak growth print. It checks the
// odds in plan section 4.3 against the real calendar and sectors.
// It writes the game only through applyCommand and endDay and reads no market stream.

import { JOB_DEFINITIONS } from '../content/jobs.ts'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { applyCommand, createGame, endDay } from '../sim/game.ts'
import type { JobDefinition } from '../sim/types.ts'
import { runSeed } from './batch.ts'

export type LayoffRow = {
  job: string
  runs: number
  days: number
  /** Runs with at least one warning. */
  warnedRuns: number
  warnings: number
  /** Runs that ended with the job cut. */
  cutRuns: number
  /** Sum of the layoff days of the cut runs. */
  cutDaySum: number
  /** Warnings that came on a weak (below) growth print. */
  weakWarnings: number
}

function runOne(job: JobDefinition, seed: string, days: number, row: LayoffRow): void {
  const defs = MARKET_DEFINITIONS
  // Every job is tried as if its course were done, so the report covers the whole menu.
  const jobs = JOB_DEFINITIONS.map((item) => ({ ...item, requirement: 'none' as const }))
  const game = createGame(defs, seed, { jobs, jobId: job.id })
  let warned = false
  for (let day = 0; day < days; day += 1) {
    if (game.runEnd !== null) break
    if (game.bill !== null) {
      applyCommand(game, defs, { type: 'payBill' })
      if (game.bill !== null) break
    }
    endDay(game, defs)
    for (const event of game.log) {
      if (event.kind === 'layoffWarning') {
        warned = true
        row.warnings += 1
        const print = game.market.calendarRolls.find((roll) => roll.kind === 'growthRelease' && roll.day === event.day)
        if (print?.outcome === 'below') row.weakWarnings += 1
      } else if (event.kind === 'laidOff') {
        row.cutRuns += 1
        row.cutDaySum += event.day
      }
    }
  }
  if (warned) row.warnedRuns += 1
}

export function layoffRows(baseSeed: string, runs: number, days: number): LayoffRow[] {
  const rows: LayoffRow[] = []
  for (const job of JOB_DEFINITIONS) {
    if (job.id === 'jobless') continue
    const row: LayoffRow = { job: job.id, runs, days, warnedRuns: 0, warnings: 0, cutRuns: 0, cutDaySum: 0, weakWarnings: 0 }
    for (let run = 1; run <= runs; run += 1) runOne(job, runSeed(baseSeed, run), days, row)
    rows.push(row)
  }
  return rows
}

function percent(part: number, whole: number): string {
  return whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`
}

export function layoffLines(rows: readonly LayoffRow[]): string[] {
  const lines = ['[sim] layoffs job warnedRuns cutRuns avgLayoffDay weakPrintShareOfWarnings']
  for (const row of rows) {
    const average = row.cutRuns === 0 ? 'n/a' : (row.cutDaySum / row.cutRuns).toFixed(1)
    lines.push(
      `[sim] layoffs ${row.job} runs=${row.runs} warned=${percent(row.warnedRuns, row.runs)} warnings=${row.warnings} cut=${percent(row.cutRuns, row.runs)} avgLayoffDay=${average} weakPrint=${percent(row.weakWarnings, row.warnings)}`,
    )
  }
  return lines
}
