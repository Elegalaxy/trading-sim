import { formatSummary, type DaySummary } from '../sim/summary.ts'
import type { ForcedSaleEvent, LiquidationEvent } from '../sim/types.ts'

function formatMove(percent: number): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    throw new Error(`summary move must be a finite number, received ${String(percent)}`)
  }
  const text = percent.toFixed(2)
  if (percent > 0) return `+${text}%`
  return `${text}%`
}

export function DaySummaryPanel({
  summary,
  liquidations,
  forcedSales,
}: {
  summary: DaySummary | null
  liquidations: readonly LiquidationEvent[]
  forcedSales: readonly ForcedSaleEvent[]
}) {
  return (
    <section className="panel" aria-live="polite">
      <h2>Day summary</h2>
      {summary === null ? (
        <p>End the day to see the summary.</p>
      ) : (
        <>
          <p>{formatSummary(summary)}</p>
          <p>Events: {summary.events.length === 0 ? 'none' : summary.events.join(', ')}</p>
          <p>
            Calendar:{' '}
            {summary.calendar.length === 0
              ? 'none'
              : summary.calendar.map((item) => `${item.item} ${item.outcome}`).join(', ')}
          </p>
          <ul>
            {summary.moves.map((move) => (
              <li key={move.asset}>
                {move.asset} {formatMove(move.percent)}
              </li>
            ))}
          </ul>
          {liquidations.length === 0 ? null : (
            <ul>
              {liquidations.map((event, index) => (
                <li key={`${event.day}-${event.asset}-${index}`}>
                  Liquidated {event.asset}: {event.quantity} shares.
                </li>
              ))}
            </ul>
          )}
          {forcedSales.length === 0 ? null : (
            <ul>
              {forcedSales.map((event, index) => (
                <li key={`${event.day}-${event.source}-${index}`}>
                  Forced sale {event.source}: {event.amountCents} cents.
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
