// The end of a run, as a window over the board. It names the outcome in plain words, shows
// how the win (or loss) was reached against the rule, and splits the score into its parts.
// "View the board" folds it into a slim banner so the chart and positions stay readable.

import { useState } from 'react'
import type { RunMode } from '../persist/save.ts'
import {
  FI_HOLD_DAYS,
  FI_WINDOW_DAYS,
  RUN_LENGTH_DAYS,
  SCORE_PER_DAY_LEFT,
  STARTING_CASH_CENTS,
  STARTING_SAVINGS_CENTS,
  STARTING_TRADING_CENTS,
} from '../sim/constants.ts'
import type { GameState, RunOutcome } from '../sim/types.ts'
import { leaveRun } from './store.ts'
import { formatUsd } from './money.ts'

const START_WORTH = STARTING_CASH_CENTS + STARTING_TRADING_CENTS + STARTING_SAVINGS_CENTS

function outcomeTitle(outcome: RunOutcome): string {
  if (outcome === 'won') return 'Financially independent'
  if (outcome === 'lost') return 'Out of money'
  if (outcome === 'finished') return 'Run finished'
  const unknown: never = outcome
  throw new Error(`run outcome is invalid, received ${String(unknown)}`)
}

function reasonText(reason: string): string {
  if (reason === 'financialIndependence') {
    return `Over the last ${FI_WINDOW_DAYS} days, your closed trades and savings interest, minus any loss on open positions, covered your monthly expenses for ${FI_HOLD_DAYS} days in a row.`
  }
  if (reason === 'cannotCoverBill') return 'The bill came due and cash, savings, trading equity and the loan limit could not cover it.'
  if (reason === 'day120') return `Day ${RUN_LENGTH_DAYS} closed before passive income covered expenses.`
  return reason
}

function signedUsd(cents: number, label: string): string {
  const text = formatUsd(Math.abs(cents), label)
  return cents > 0 ? `+${text}` : cents < 0 ? `-${text}` : text
}

export function RunEnd({ seed, mode, game }: { seed: string; mode: RunMode; game: GameState }) {
  const [folded, setFolded] = useState(false)
  const end = game.runEnd
  if (end === null) return null
  if (typeof seed !== 'string' || seed.length === 0 || /[\r\n]/.test(seed)) {
    throw new Error(`run end seed must be one non-empty line, received ${JSON.stringify(seed)}`)
  }
  if (mode !== 'seeded' && mode !== 'normal') {
    throw new Error(`run end mode is invalid, received ${JSON.stringify(mode)}`)
  }
  const tone = end.outcome === 'won' ? 'run-won' : end.outcome === 'lost' ? 'run-lost' : 'run-finished'
  const modeLabel = mode === 'seeded' ? 'Seeded' : 'Normal'
  const worthChange = end.netWorthCents - START_WORTH
  const bonus = end.outcome === 'won' ? Math.max(0, RUN_LENGTH_DAYS - end.day) * SCORE_PER_DAY_LEFT : 0
  const status = game.fi.status

  if (folded) {
    return (
      <div className={`run-end-banner ${tone}`} role="status">
        <strong>{outcomeTitle(end.outcome)}</strong> on day {end.day} · Score {end.score}
        <button type="button" onClick={() => setFolded(false)}>
          Show result
        </button>
        <button type="button" onClick={() => leaveRun()}>
          New run
        </button>
      </div>
    )
  }

  return (
    <div className="report-backdrop">
      <section className={`report run-end ${tone}`} role="dialog" aria-modal="true" aria-labelledby="run-end-title">
        <h2 id="run-end-title">
          {outcomeTitle(end.outcome)} · day {end.day} of {RUN_LENGTH_DAYS}
        </h2>
        <p>{reasonText(end.reason)}</p>
        <dl className="report-totals">
          <div>
            <dt>Net worth</dt>
            <dd>
              {formatUsd(end.netWorthCents, 'net worth')}{' '}
              <span className={worthChange >= 0 ? 'pnl-gain' : 'pnl-loss'}>{signedUsd(worthChange, 'net worth change')}</span>
            </dd>
          </div>
          <div>
            <dt>Started with</dt>
            <dd>{formatUsd(START_WORTH, 'start worth')}</dd>
          </div>
          {status !== null ? (
            <>
              <div>
                <dt>Passive income ({status.windowDays} days)</dt>
                <dd>{formatUsd(status.passiveCents, 'passive income')}</dd>
              </div>
              <div>
                <dt>Monthly expenses</dt>
                <dd>{formatUsd(status.expensesCents, 'expenses')}</dd>
              </div>
              {status.openLossCents < 0 ? (
                <div>
                  <dt>Open losses counted</dt>
                  <dd className="pnl-loss">{signedUsd(status.openLossCents, 'open loss')}</dd>
                </div>
              ) : null}
            </>
          ) : null}
        </dl>
        <table className="report-money">
          <tbody>
            <tr>
              <td>Score from net worth</td>
              <td>{end.score - bonus}</td>
            </tr>
            {end.outcome === 'won' ? (
              <tr>
                <td>
                  Early finish ({RUN_LENGTH_DAYS - end.day} days left × {SCORE_PER_DAY_LEFT})
                </td>
                <td>{bonus}</td>
              </tr>
            ) : null}
            <tr>
              <td>
                <strong>Score</strong>
              </td>
              <td>
                <strong>{end.score}</strong>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="report-muted">
          {modeLabel} run · seed {seed}
        </p>
        <div className="report-actions">
          <button type="button" onClick={() => setFolded(true)}>
            View the board
          </button>
          <button type="button" className="primary" autoFocus onClick={() => leaveRun()}>
            New run
          </button>
        </div>
      </section>
    </div>
  )
}
