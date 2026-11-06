// What the player may read about layoffs. A notice's `real` flag is hidden information while the
// stage is 'rumour', so nothing here reads it. Employer days are close days: the layoff on day 30
// happens at the close of the day shown as day 30 (the payday), so they are shown as they are,
// with no playerDay() shift (that shift is for orders and notices logged while trading).

import { MARKET_DEFINITIONS } from '../content/index.ts'
import { activeJob } from '../sim/jobs.ts'
import { severanceCents } from '../sim/layoffs.ts'
import type { GameState, LayoffNotice } from '../sim/types.ts'
import { tradingDay } from './days.ts'

export type RiskLevel = 'low' | 'medium'

export type JobRisk = { level: RiskLevel; sector: string }

/** Layoff risk of a job from its base chance. Null for freelance and jobless (no employer). */
export function jobRisk(jobId: string): JobRisk | null {
  const row = MARKET_DEFINITIONS.layoffs?.jobs.find((item) => item.jobId === jobId)
  if (row === undefined) return null
  return { level: row.baseChance >= 0.08 ? 'medium' : 'low', sector: row.sector }
}

/** The open notice, if any. */
export function openNotice(game: GameState): LayoffNotice | null {
  return game.employer?.notice ?? null
}

/** Days from the day being traded to a close day. 0 means at today's close. */
export function daysUntil(game: GameState, day: number): number {
  return day - tradingDay(game)
}

export function countdownText(days: number): string {
  if (days <= 0) return 'at today’s close'
  return days === 1 ? 'in 1 day' : `in ${days} days`
}

/** Severance the held job would pay now, or null when the notice is for a job already left. */
export function noticeSeverance(game: GameState, notice: LayoffNotice): number | null {
  const job = activeJob(game.job)
  return job.id === notice.jobId ? severanceCents(job.payCents) : null
}

export function jobNameOf(game: GameState, id: string): string {
  return game.job.catalog.find((job) => job.id === id)?.name ?? id
}
