import { formatSummary, type DaySummary } from '../sim/summary.ts'

function formatMove(percent: number): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    throw new Error(`summary move must be a finite number, received ${String(percent)}`)
  }
  const text = percent.toFixed(2)
  if (percent > 0) return `+${text}%`
  return `${text}%`
}

export function DaySummaryPanel({ summary }: { summary: DaySummary | null }) {
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
        </>
      )}
    </section>
  )
}
