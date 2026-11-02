import { formatUsd } from './money.ts'
import type { EquityPoint } from './store.ts'

const W = 1000
const H = 220
const PAD = 8

/**
 * Trading account equity (balance plus open positions at the quote) at every step you acted on.
 * It includes floating P&L, so it moves with the price. Kept for this browser session only.
 */
export function EquityChart({ points }: { points: readonly EquityPoint[] }) {
  if (points.length < 2) {
    return (
      <section className="panel">
        <h2>Equity</h2>
        <p>The equity line starts once you trade, step the clock or end a day.</p>
      </section>
    )
  }
  const values = points.map((point) => point.equityCents)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const flat = max === min
  const span = flat ? Math.max(2, Math.round(min * 0.02)) : max - min
  const low = flat ? min - span / 2 : min
  const x = (index: number): number => PAD + (index / (points.length - 1)) * (W - PAD * 2)
  const y = (value: number): number => H - PAD - ((value - low) / span) * (H - PAD * 2)
  const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.equityCents).toFixed(1)}`).join(' ')
  const first = values[0] ?? 0
  const last = values[values.length - 1] ?? 0
  const color = last >= first ? '#0ecb81' : '#f6465d'
  const dayStarts: number[] = []
  for (let i = 1; i < points.length; i += 1) if (points[i]?.day !== points[i - 1]?.day) dayStarts.push(i)
  return (
    <section className="panel equity-panel">
      <h2>Equity</h2>
      <p className="equity-legend">
        Now {formatUsd(last, 'equity')} · start {formatUsd(first, 'equity start')} · high {formatUsd(max, 'equity high')} · low{' '}
        {formatUsd(min, 'equity low')}
      </p>
      <svg className="equity-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Trading equity over time">
        <line x1={PAD} x2={W - PAD} y1={y(first)} y2={y(first)} stroke="#3a424d" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        {dayStarts.map((index) => (
          <line key={index} x1={x(index)} x2={x(index)} y1={PAD} y2={H - PAD} stroke="#1e2329" vectorEffect="non-scaling-stroke" />
        ))}
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="equity-legend">
        Day {points[0]?.day} to day {points[points.length - 1]?.day}. The dashed line is where you started.
      </p>
    </section>
  )
}
