const CHART_DAYS = 60
const WIDTH = 640
const HEIGHT = 220
const PAD_LEFT = 16
const PAD_RIGHT = 16
const PAD_TOP = 16
const PAD_BOTTOM = 28

export type ChartPoint = {
  day: number
  priceCents: number
}

function assertPoint(point: ChartPoint, index: number): void {
  if (!Number.isSafeInteger(point.day) || point.day < 1) {
    throw new Error(`chart point ${index} day must be a safe integer >= 1, received ${String(point.day)}`)
  }
  if (!Number.isSafeInteger(point.priceCents) || point.priceCents <= 0) {
    throw new Error(
      `chart point ${index} price must be a positive safe integer, received ${String(point.priceCents)}`,
    )
  }
}

function position(index: number, count: number, price: number, min: number, span: number): { x: number; y: number } {
  const innerW = WIDTH - PAD_LEFT - PAD_RIGHT
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM
  const x = count === 1 ? PAD_LEFT + innerW / 2 : PAD_LEFT + (index / (count - 1)) * innerW
  const y = PAD_TOP + (1 - (price - min) / span) * innerH
  return { x, y }
}

export function PriceChart({ asset, points }: { asset: string; points: readonly ChartPoint[] }) {
  const shown = points.slice(-CHART_DAYS)
  for (let i = 0; i < shown.length; i += 1) {
    const point = shown[i]
    if (point === undefined) throw new Error(`chart point ${i} is missing`)
    assertPoint(point, i)
  }

  const latest = shown[shown.length - 1]
  const caption =
    latest === undefined
      ? `${asset}: no daily closes yet`
      : `${asset}: ${shown.length} daily close${shown.length === 1 ? '' : 's'} in the last ${CHART_DAYS} days, latest ${latest.priceCents} cents (${(latest.priceCents / 100).toFixed(2)})`

  if (shown.length === 0) {
    return (
      <div className="chart-wrap">
        <p>{`${caption}. End the day to plot prices.`}</p>
      </div>
    )
  }

  let min = shown[0]?.priceCents ?? 0
  let max = min
  for (const point of shown) {
    if (point.priceCents < min) min = point.priceCents
    if (point.priceCents > max) max = point.priceCents
  }
  const span = max === min ? 1 : max - min
  const coords = shown.map((point, index) => position(index, shown.length, point.priceCents, min, span))
  const line = coords.map((coord) => `${coord.x},${coord.y}`).join(' ')
  const first = shown[0]
  const last = shown[shown.length - 1]
  if (first === undefined || last === undefined) throw new Error('chart window is empty')

  return (
    <div className="chart-wrap">
      <p>{caption}</p>
      <svg
        className="chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${asset} daily closes, ${shown.length} days`}
      >
        <polyline points={line} fill="none" stroke="#9ec1ff" strokeWidth="2" />
        {coords.map((coord, index) => (
          <circle key={shown[index]?.day ?? index} cx={coord.x} cy={coord.y} r="3" fill="#d6e4ff" />
        ))}
        <text x={PAD_LEFT} y={HEIGHT - 8} fill="#c5cad6" fontSize="12">
          {first.day}
        </text>
        <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 8} fill="#c5cad6" fontSize="12" textAnchor="end">
          {last.day}
        </text>
      </svg>
    </div>
  )
}
