// Layoffs (plan layoffs, loans and deposits, Steps Y1 to Y3). A job with an employer can be cut,
// with warning. Three paydays a run, the growth-release day of a month (day 10, 40, 70) is a roll
// day: the employer may start a rumour of cuts. Ten days later it is confirmed or dropped. Ten days
// after that, on the payday, a confirmed cut ends the job.
//
// Randomness: the employer has its own stream (`createRng(seed + '#layoffs')`), never the market's.
// Every roll day draws exactly two floats, `warnRoll` and `truthRoll`, even when the player is
// jobless or in an exempt job, so a job choice never shifts a later roll and an old save can be
// fast-forwarded exactly. No other day draws. The market, its streams and the fixtures never see it.
//
// The chance per roll day is the job's base chance, plus the growth print of the day (below adds,
// above takes away), plus the move of the job's sector over 20 days (a fall adds, a rise takes
// away), clamped to 0 .. maxChance. A freelance analyst has no employer and is not listed.
//
// A real cut pays severance (half a month of pay), ends the job, and bars that employer for the
// rest of the run. A player who left before the last day keeps nothing and loses nothing.
// Stress rises when a notice is confirmed. Notices are never bent by stress and are not part of
// the market feed.

import {
  LAYOFF_DAY_DELAY_DAYS,
  LAYOFF_DECISION_DELAY_DAYS,
  LAYOFF_NOTICE_STRESS,
  LAYOFF_ROLL_DAY_OF_MONTH,
  LAYOFF_SECTOR_LOOKBACK_DAYS,
  LAYOFF_SEVERANCE_PERCENT,
  RUN_LENGTH_DAYS,
  SAVINGS_PAY_INTERVAL_DAYS,
} from './constants.ts'
import { activeJob } from './jobs.ts'
import { createRng, nextFloat } from './rng.ts'
import { applyDelta } from './stats.ts'
import type {
  AccountLogEvent,
  EmployerState,
  GameState,
  JobChangedEvent,
  LayoffDefinitions,
  LayoffNotice,
  MarketDefinitions,
} from './types.ts'

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

export function createEmployer(seed: string): EmployerState {
  return { stream: createRng(`${seed}#layoffs`).market, notice: null, barred: [] }
}

/**
 * A roll day is a growth-release day (day 10 of a month) whose last day still falls before the
 * run is sealed. That is day 10, 40 and 70. Day 100 is not one: its cut would land on day 120.
 */
export function isLayoffRollDay(day: number): boolean {
  if (!Number.isSafeInteger(day) || day < 1) return false
  return day % SAVINGS_PAY_INTERVAL_DAYS === LAYOFF_ROLL_DAY_OF_MONTH && day + LAYOFF_DAY_DELAY_DAYS < RUN_LENGTH_DAYS
}

/** How many roll days fall on or before `day`. Each one costs two draws of the employer stream. */
export function rollDaysUpTo(day: number): number {
  let count = 0
  for (let d = 1; d <= day; d += 1) if (isLayoffRollDay(d)) count += 1
  return count
}

/** Draw the two floats of every roll day up to `day`, as a run that had them all along would have. */
export function fastForwardEmployer(employer: EmployerState, day: number): void {
  for (let n = rollDaysUpTo(day); n > 0; n -= 1) {
    nextFloat(employer.stream)
    nextFloat(employer.stream)
  }
}

/** Average 20-day move of a sector's stocks, as a fraction. 0 when any reference close is missing. */
function sectorMove(state: GameState, defs: MarketDefinitions, sector: string, day: number): number {
  const stocks = defs.assets.filter((asset) => asset.kind === 'stock' && asset.sector === sector)
  if (stocks.length === 0) return 0
  const refDay = day - LAYOFF_SECTOR_LOOKBACK_DAYS
  const past = refDay > 0 ? state.past.find((row) => row.day === refDay) : undefined
  let total = 0
  for (const asset of stocks) {
    const now = state.market.assets[asset.id]?.priceCents
    const before = refDay > 0 ? past?.prices[asset.id] : asset.startPriceCents
    if (now === undefined || before === undefined || before <= 0) return 0
    total += now / before - 1
  }
  return total / stocks.length
}

/**
 * The chance that `jobId` gets a warning on this roll day. A job that is not listed is exempt (0).
 * Reads today's growth print from `calendarRolls` and the sector's move from `past`.
 */
export function layoffChance(state: GameState, defs: MarketDefinitions, jobId: string, day: number): number {
  const layoffs: LayoffDefinitions | undefined = defs.layoffs
  if (layoffs === undefined) return 0
  const risk = layoffs.jobs.find((item) => item.jobId === jobId)
  if (risk === undefined) return 0
  let chance = risk.baseChance
  const print = state.market.calendarRolls.find((roll) => roll.kind === 'growthRelease' && roll.day === day)
  if (print?.outcome === 'below') chance += layoffs.growthBelow
  else if (print?.outcome === 'above') chance += layoffs.growthAbove
  const move = sectorMove(state, defs, risk.sector, day) * 100
  if (move <= -layoffs.sectorMovePercent) chance += layoffs.sectorFall
  else if (move >= layoffs.sectorMovePercent) chance += layoffs.sectorRise
  return Math.min(layoffs.maxChance, Math.max(0, chance))
}

/** Severance: a share of one month of pay, rounded half up (pay is whole cents, so never negative). */
export function severanceCents(payCents: number): number {
  return Math.round((payCents * LAYOFF_SEVERANCE_PERCENT) / 100)
}

function endJob(state: GameState, notice: LayoffNotice, events: AccountLogEvent[]): void {
  const day = state.market.day
  const from = activeJob(state.job)
  const jobless = state.job.catalog.find((item) => item.slots === 0)
  if (jobless === undefined) throw new Error('job catalog must include jobless')
  const amountCents = severanceCents(from.payCents)
  const nextCash = state.accounts.cashCents + amountCents
  if (!Number.isSafeInteger(nextCash)) throw new Error(`severance left cash outside a safe integer, received ${describeValue(nextCash)}`)
  state.accounts.cashCents = nextCash
  state.job.jobId = jobless.id
  state.sleepHours = jobless.sleepHours
  if (state.employer !== undefined && !state.employer.barred.includes(notice.jobId)) state.employer.barred.push(notice.jobId)
  events.push({ kind: 'laidOff', day, job: notice.jobId })
  events.push({ kind: 'severancePaid', day, job: notice.jobId, amountCents, cashCents: nextCash })
  const changed: JobChangedEvent = {
    kind: 'jobChanged',
    day,
    from: from.id,
    to: jobless.id,
    slots: jobless.slots,
    sleepHours: jobless.sleepHours,
  }
  events.push(changed)
}

/**
 * One employer day, called from `endDay` after the market has stepped and before a due job
 * change. Roll day: two draws, then maybe a notice. Decision day: confirm (stress up) or drop.
 * Layoff day: severance, jobless, barred; or `layoffAvoided` when the player already left.
 * Does nothing when the definitions have no layoffs or the game has no employer.
 */
export function applyEmployerDay(state: GameState, defs: MarketDefinitions): AccountLogEvent[] {
  const employer = state.employer
  if (defs.layoffs === undefined || employer === undefined) return []
  const day = state.market.day
  const events: AccountLogEvent[] = []

  if (isLayoffRollDay(day)) {
    const warnRoll = nextFloat(employer.stream)
    const truthRoll = nextFloat(employer.stream)
    const jobId = activeJob(state.job).id
    if (employer.notice === null) {
      const chance = layoffChance(state, defs, jobId, day)
      if (warnRoll < chance) {
        employer.notice = {
          jobId,
          warnedDay: day,
          decisionDay: day + LAYOFF_DECISION_DELAY_DAYS,
          layoffDay: day + LAYOFF_DAY_DELAY_DAYS,
          real: truthRoll < defs.layoffs.trueChance,
          stage: 'rumour',
        }
        events.push({
          kind: 'layoffWarning',
          day,
          job: jobId,
          chance,
          warnRoll,
          decisionDay: employer.notice.decisionDay,
          layoffDay: employer.notice.layoffDay,
        })
      }
    }
  }

  const notice = employer.notice
  if (notice !== null && notice.stage === 'rumour' && notice.decisionDay === day) {
    if (notice.real) {
      notice.stage = 'confirmed'
      events.push({ kind: 'layoffConfirmed', day, job: notice.jobId, layoffDay: notice.layoffDay })
      // Stress only reaches the player who still holds the job.
      if (state.job.jobId === notice.jobId) {
        const stress = applyDelta(state, day, 'stress', 'layoffNotice', LAYOFF_NOTICE_STRESS)
        if (stress !== null) events.push(stress)
      }
    } else {
      employer.notice = null
      events.push({ kind: 'layoffDropped', day, job: notice.jobId })
    }
  }

  const due = employer.notice
  if (due !== null && due.layoffDay === day) {
    if (activeJob(state.job).id === due.jobId) endJob(state, due, events)
    else events.push({ kind: 'layoffAvoided', day, job: due.jobId })
    employer.notice = null
  }
  return events
}

function assertNotice(notice: unknown): asserts notice is LayoffNotice {
  if (typeof notice !== 'object' || notice === null || Array.isArray(notice)) {
    throw new Error(`employer notice must be an object, received ${describeValue(notice)}`)
  }
  const item = notice as Record<string, unknown>
  if (typeof item.jobId !== 'string' || !ID_PATTERN.test(item.jobId)) {
    throw new Error(`employer notice job must be an id token, received ${describeValue(item.jobId)}`)
  }
  for (const key of ['warnedDay', 'decisionDay', 'layoffDay'] as const) {
    const value = item[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(`employer notice ${key} must be a safe integer >= 1, received ${describeValue(value)}`)
    }
  }
  const warned = item.warnedDay as number
  if (item.decisionDay !== warned + LAYOFF_DECISION_DELAY_DAYS || item.layoffDay !== warned + LAYOFF_DAY_DELAY_DAYS) {
    throw new Error('employer notice days must follow the warning day')
  }
  if (typeof item.real !== 'boolean') throw new Error(`employer notice real must be boolean, received ${describeValue(item.real)}`)
  if (item.stage !== 'rumour' && item.stage !== 'confirmed') {
    throw new Error(`employer notice stage must be rumour or confirmed, received ${describeValue(item.stage)}`)
  }
}

/** Reject an employer block that could not have come from `createEmployer` and `applyEmployerDay`. */
export function assertEmployer(employer: EmployerState): void {
  if (typeof employer !== 'object' || employer === null || Array.isArray(employer)) {
    throw new Error(`employer must be an object, received ${describeValue(employer)}`)
  }
  const stream = employer.stream as unknown as Record<string, unknown> | null
  if (typeof stream !== 'object' || stream === null) {
    throw new Error(`employer stream must be an object, received ${describeValue(stream)}`)
  }
  for (const key of ['a', 'b', 'c', 'd']) {
    if (typeof stream[key] !== 'number' || !Number.isFinite(stream[key])) {
      throw new Error(`employer stream ${key} must be a finite number, received ${describeValue(stream[key])}`)
    }
  }
  if (employer.notice !== null) assertNotice(employer.notice)
  if (!Array.isArray(employer.barred)) throw new Error(`employer barred must be a list, received ${describeValue(employer.barred)}`)
  const seen = new Set<string>()
  for (const id of employer.barred) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new Error(`employer barred job must be an id token, received ${describeValue(id)}`)
    }
    if (seen.has(id)) throw new Error(`employer barred repeats ${id}`)
    seen.add(id)
  }
}
