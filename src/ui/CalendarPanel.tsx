import { outcomeWord } from '../sim/calendar.ts'
import type { CalendarItemKind, EmployerState, MarketState } from '../sim/types.ts'
import { playerCalendar } from './days.ts'

const CALENDAR_HORIZON_DAYS = 30

const LABELS: Record<CalendarItemKind, string> = {
  growthRelease: 'Growth release',
  inflationRelease: 'Inflation release',
  policyDecision: 'Policy rate',
}

/** Employer dates inside the horizon, as close days (no shift). The decision is dropped once confirmed. */
function employerRows(market: MarketState | null, employer: EmployerState | null | undefined): { key: string; text: string }[] {
  const notice = employer?.notice ?? null
  if (market === null || notice === null) return []
  const today = market.day + 1
  const rows: { key: string; text: string }[] = []
  if (notice.stage === 'rumour' && notice.decisionDay >= today && notice.decisionDay - today <= CALENDAR_HORIZON_DAYS) {
    rows.push({ key: 'decision', text: `Day ${notice.decisionDay}: Restructuring decision` })
  }
  if (notice.layoffDay >= today && notice.layoffDay - today <= CALENDAR_HORIZON_DAYS) {
    rows.push({ key: 'last', text: `Day ${notice.layoffDay}: Last day if cuts are confirmed` })
  }
  return rows
}

export function CalendarPanel({ market, employer }: { market: MarketState | null; employer?: EmployerState | null }) {
  const items = market === null ? [] : playerCalendar(market, CALENDAR_HORIZON_DAYS)
  const extra = employerRows(market, employer)

  return (
    <section className="panel">
      <h2>Calendar</h2>
      {market === null ? (
        <p>Start a game to see upcoming dates.</p>
      ) : items.length === 0 && extra.length === 0 ? (
        <p>No macro dates in the next {CALENDAR_HORIZON_DAYS} days.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={`${item.kind}-${item.day}`}>
              {`Day ${item.day}: ${LABELS[item.kind]}`}
              {item.expected === undefined ? '' : ` — expected: ${outcomeWord(item.kind, item.expected)}`}
              {item.outcome === undefined ? '' : ` — result: ${outcomeWord(item.kind, item.outcome)}`}
            </li>
          ))}
          {extra.map((row) => (
            <li key={`employer-${row.key}`}>{row.text}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
