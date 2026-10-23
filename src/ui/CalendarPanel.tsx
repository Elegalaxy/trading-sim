import { upcomingCalendar } from '../sim/calendar.ts'
import type { CalendarItemKind, MarketState } from '../sim/types.ts'

const CALENDAR_HORIZON_DAYS = 30

const LABELS: Record<CalendarItemKind, string> = {
  growthRelease: 'Growth release',
  inflationRelease: 'Inflation release',
  policyDecision: 'Policy rate',
}

export function CalendarPanel({ market }: { market: MarketState | null }) {
  const items = market === null ? [] : upcomingCalendar(market, CALENDAR_HORIZON_DAYS)

  return (
    <section className="panel">
      <h2>Calendar</h2>
      {market === null ? (
        <p>Start a game to see upcoming dates.</p>
      ) : items.length === 0 ? (
        <p>No macro dates in the next {CALENDAR_HORIZON_DAYS} days.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={`${item.kind}-${item.day}`}>
              {`Day ${item.day}: ${LABELS[item.kind]}${item.outcome === undefined ? '' : ` — ${item.outcome}`}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
