import { useState } from 'react'
import { formatEvent } from '../sim/log.ts'
import type { AccountLogEvent, LogEvent } from '../sim/types.ts'

type LoggedEvent = LogEvent | AccountLogEvent

export function AdminLog({ events }: { events: readonly LoggedEvent[] }) {
  const [kind, setKind] = useState('all')
  if (!import.meta.env.DEV) return null

  const kinds: string[] = Array.from(new Set(events.map((event) => event.kind))).sort((a, b) =>
    a.localeCompare(b),
  )
  const selected = kind === 'all' || kinds.includes(kind) ? kind : 'all'
  const shown = events.filter((event) => selected === 'all' || event.kind === selected)

  function onKind(value: string): void {
    if (value !== 'all' && !kinds.includes(value)) {
      console.error(`[ui] rejected log filter ${JSON.stringify(value)}`)
      return
    }
    setKind(value)
  }

  return (
    <section className="panel admin-log" data-marker="trading-sim-dev-admin-panel-k7q2m">
      <h2>Admin log</h2>
      <p>Today&apos;s log. Market events, then account events.</p>
      <label htmlFor="log-kind">
        Event kind{' '}
        <select id="log-kind" value={selected} onChange={(event) => onKind(event.target.value)}>
          <option value="all">all</option>
          {kinds.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {shown.length === 0 ? (
        <p>No log lines.</p>
      ) : (
        <ul className="log-lines">
          {shown.map((event, index) => (
            <li key={`${event.kind}-${event.day}-${index}`}>{formatEvent(event)}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
