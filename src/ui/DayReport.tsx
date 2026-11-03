// End-of-day popup. It opens after End day with what the close did to the account: the
// trading equity change, money in and out (salary, bills, interest, funding, fees), each
// asset's move since the clock, energy and stress, and anything to act on. Payday, a bill,
// a liquidation or a job change always opens it. Quiet days open it only while
// "Show after every day" is on.

import { useState } from 'react'
import { formatUsd } from './money.ts'
import { useStoredFlag } from './storedFlag.ts'
import type { DayReport as Report } from './store.ts'

function signedUsd(cents: number, label: string): string {
  const text = formatUsd(Math.abs(cents), label)
  if (cents > 0) return `+${text}`
  if (cents < 0) return `-${text}`
  return text
}

function tone(cents: number): string {
  if (cents > 0) return 'pnl-gain'
  if (cents < 0) return 'pnl-loss'
  return ''
}

function delta(before: number, after: number): string {
  const change = after - before
  if (change === 0) return `${after}, no change`
  return `${after} (${change > 0 ? '+' : ''}${change})`
}

/** True when the report has something the player should see even on a quiet day. */
function important(report: Report): boolean {
  return report.payday || report.notes.length > 0 || report.money.some((line) => line.label !== 'Funding on open positions')
}

export function DayReport({ report }: { report: Report | null }) {
  const [everyDay, setEveryDay] = useStoredFlag('day-report', true)
  const [closed, setClosed] = useState<Report | null>(null)
  if (report === null || closed === report) return null
  if (!everyDay && !important(report)) return null

  const equityChange = report.equityAfter - report.equityBefore
  const cashChange = report.cashAfter - report.cashBefore
  const held = report.moves.filter((move) => move.held !== null)
  const others = report.moves.filter((move) => move.held === null)

  return (
    <div className="report-backdrop" onClick={() => setClosed(report)}>
      <section
        className="report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setClosed(report)
        }}
      >
        <h2 id="report-title">
          Day {report.day} closed{report.payday ? ' · Payday and bills' : ''}
        </h2>
        <dl className="report-totals">
          <div>
            <dt>Trading equity</dt>
            <dd>
              {formatUsd(report.equityAfter, 'equity after')}{' '}
              {equityChange === 0 ? null : <span className={tone(equityChange)}>{signedUsd(equityChange, 'equity change')}</span>}
            </dd>
          </div>
          <div>
            <dt>Cash</dt>
            <dd>
              {formatUsd(report.cashAfter, 'cash after')}{' '}
              {cashChange === 0 ? null : <span className={tone(cashChange)}>{signedUsd(cashChange, 'cash change')}</span>}
            </dd>
          </div>
          <div>
            <dt>Energy</dt>
            <dd>{delta(report.energyBefore, report.energyAfter)}</dd>
          </div>
          <div>
            <dt>Stress</dt>
            <dd>{delta(report.stressBefore, report.stressAfter)}</dd>
          </div>
        </dl>

        {report.notes.length > 0 ? (
          <ul className="report-notes" role="alert">
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}

        {report.money.length > 0 ? (
          <table className="report-money">
            <tbody>
              {report.money.map((line, index) => (
                <tr key={`${line.label}-${index}`}>
                  <td>{line.label}</td>
                  <td className={tone(line.cents)}>{signedUsd(line.cents, line.label)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <p className="report-moves">
          {held.length > 0 ? (
            <>
              Your positions:{' '}
              {held.map((move, index) => (
                <span key={move.asset}>
                  {index > 0 ? ', ' : ''}
                  {move.asset} {move.held}{' '}
                  <span className={move.percent >= 0 ? 'pnl-gain' : 'pnl-loss'}>
                    {move.percent > 0 ? '+' : ''}
                    {move.percent.toFixed(2)}%
                  </span>
                </span>
              ))}
              .{' '}
            </>
          ) : null}
          {others.length > 0 ? (
            <span className="report-muted">
              {held.length > 0 ? 'Others: ' : 'Moves since the clock: '}
              {others.map((move) => `${move.asset} ${move.percent > 0 ? '+' : ''}${move.percent.toFixed(2)}%`).join(', ')}.
            </span>
          ) : null}
        </p>

        <div className="report-actions">
          <label>
            <input type="checkbox" checked={everyDay} onChange={(event) => setEveryDay(event.target.checked)} /> Show after
            every day
          </label>
          <button type="button" className="primary" autoFocus onClick={() => setClosed(report)}>
            Continue
          </button>
        </div>
        {!everyDay ? <p className="report-muted">Paydays, bills, liquidations and job changes still open this window.</p> : null}
      </section>
    </div>
  )
}
