// Care report (plan items and lifestyle, Step L0 and L6). A bot that never trades and only looks
// after energy and stress: each day it buys the best-value items until it is clear of the warning
// state, pays any bill from cash, and ends the day. For each job and Home tier it prints the item
// spend a month, the share of pay that is, the days spent in the warning state and how long the run
// lasted. It measures whether the item menu and the Home tiers make care a real choice.
// It writes the game only through applyCommand and endDay and reads no market stream.

import { CONSUMABLE_DEFINITIONS } from '../content/consumables.ts'
import { JOB_DEFINITIONS } from '../content/jobs.ts'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { applyCommand, createGame, endDay } from '../sim/game.ts'
import { ENERGY_WARNING_BELOW, STRESS_WARNING_ABOVE } from '../sim/stats.ts'
import type { ConsumableDefinition, GameState, JobDefinition, MarketDefinitions } from '../sim/types.ts'
import { runSeed } from './batch.ts'

/** The bot buys until energy is at least this and stress at most the other, clear of the warning line. */
const TARGET_ENERGY = ENERGY_WARNING_BELOW + 10
const TARGET_STRESS = STRESS_WARNING_ABOVE - 10
const HOME_TIERS = [0, 1, 2, 3] as const

export type CareRow = {
  job: string
  home: number
  runs: number
  days: number
  spendPerMonthCents: number
  payPerMonthCents: number
  warningShare: number
  survivedDays: number
}

/** Stat points the item would add toward the target, clipped to the gap, per cent of cost. */
function value(game: GameState, item: ConsumableDefinition): number {
  const needEnergy = Math.max(0, TARGET_ENERGY - game.stats.energy)
  const needStress = Math.max(0, game.stats.stress - TARGET_STRESS)
  const gainEnergy = Math.min(needEnergy, Math.max(0, item.energy))
  const gainStress = Math.min(needStress, Math.max(0, -item.stress))
  const gain = gainEnergy + gainStress
  return gain <= 0 ? 0 : gain / Math.max(1, item.costCents)
}

/** Buy the best-value usable item. Returns false when nothing helps or nothing is affordable. */
function buyOne(game: GameState, defs: MarketDefinitions): boolean {
  let best: ConsumableDefinition | null = null
  let bestValue = 0
  for (const item of game.consumables) {
    if (game.stats.consumed.includes(item.id)) continue
    if (game.accounts.cashCents < item.costCents) continue
    const worth = value(game, item)
    if (worth > bestValue) {
      best = item
      bestValue = worth
    }
  }
  if (best === null) return false
  const before = game.stats.consumed.length
  applyCommand(game, defs, { type: 'consume', item: best.id })
  return game.stats.consumed.length > before
}

function careDay(game: GameState, defs: MarketDefinitions): number {
  const cashBefore = game.accounts.cashCents
  for (let guard = 0; guard < 16; guard += 1) {
    if (game.stats.energy >= TARGET_ENERGY && game.stats.stress <= TARGET_STRESS) break
    if (!buyOne(game, defs)) break
  }
  return cashBefore - game.accounts.cashCents
}

function inWarning(game: GameState): boolean {
  return game.stats.energy < ENERGY_WARNING_BELOW || game.stats.stress > STRESS_WARNING_ABOVE
}

type Totals = { spend: number; warningDays: number; days: number; survived: number }

function runOne(job: JobDefinition, home: number, seed: string, days: number, totals: Totals): void {
  // Layoffs are left out so this report stays comparable to the item numbers (plan items and lifestyle, Step L6).
  const defs = { ...MARKET_DEFINITIONS, layoffs: undefined }
  // Every job is tried as if its course were done, so the report covers the whole menu.
  const jobs = JOB_DEFINITIONS.map((row) => ({ ...row, requirement: 'none' as const }))
  const game = createGame(defs, seed, { jobs, jobId: job.id, consumables: CONSUMABLE_DEFINITIONS })
  game.lifestyle.home = home
  for (let day = 0; day < days; day += 1) {
    if (game.runEnd !== null) break
    if (game.bill !== null) {
      applyCommand(game, defs, { type: 'payBill' })
      if (game.bill !== null) break
    }
    totals.spend += careDay(game, defs)
    if (inWarning(game)) totals.warningDays += 1
    totals.days += 1
    endDay(game, defs)
    totals.survived += 1
  }
}

function startableJobs(): JobDefinition[] {
  return [...JOB_DEFINITIONS]
}

export function careRows(baseSeed: string, runs: number, days: number): CareRow[] {
  const rows: CareRow[] = []
  for (const job of startableJobs()) {
    for (const home of HOME_TIERS) {
      const totals: Totals = { spend: 0, warningDays: 0, days: 0, survived: 0 }
      for (let run = 1; run <= runs; run += 1) runOne(job, home, runSeed(baseSeed, run), days, totals)
      const months = Math.max(1, totals.days) / 30
      rows.push({
        job: job.id,
        home,
        runs,
        days,
        spendPerMonthCents: Math.round(totals.spend / months),
        payPerMonthCents: job.payCents,
        warningShare: totals.days === 0 ? 0 : totals.warningDays / totals.days,
        survivedDays: Math.round(totals.survived / runs),
      })
    }
  }
  return rows
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}

export function careLines(rows: readonly CareRow[]): string[] {
  const lines = ['[sim] care job home spendPerMonth pay share warningDays survivedDays']
  for (const row of rows) {
    const share = row.payPerMonthCents === 0 ? 'n/a' : `${Math.round((row.spendPerMonthCents / row.payPerMonthCents) * 100)}%`
    lines.push(
      `[sim] care ${row.job} home=${row.home} spend=${dollars(row.spendPerMonthCents)}/mo pay=${dollars(row.payPerMonthCents)}/mo share=${share} warning=${(row.warningShare * 100).toFixed(0)}% survived=${row.survivedDays}d`,
    )
  }
  return lines
}
