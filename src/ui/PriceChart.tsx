import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { blurFilter, useCosmeticFx, useDelayedValue } from './effects.ts'
import { buildCandles, candleRangeLabel, formatVolume, type Candle, type DaySource, type TimeframeId } from './candles.ts'
import { debugLog } from './debug.ts'
import { formatUsd } from './money.ts'
import { useTradingStore } from './store.ts'
import { Tell } from './Tell.tsx'

const VISIBLE: Record<TimeframeId, number> = {
  '15m': 64,
  '1H': 48,
  '1D': 80,
  '1W': 26,
  '1M': 12,
}

const TIMEFRAMES: readonly TimeframeId[] = ['15m', '1H', '1D', '1W', '1M']

/** Share of the plot height under the price area that is kept for the volume bars. */
const VOLUME_SHARE = 0.16

const AXIS_RIGHT = 76
const AXIS_BOTTOM = 22
const PAD_LEFT = 8
const PAD_TOP = 16
const UP = '#0ecb81'
const DOWN = '#f6465d'
const FLAT = '#848e9c'
const GRID = '#1e2329'
const CROSS = '#758696'

export type ChartPoint = DaySource

type Hover = {
  index: number
  y: number
}

function chartSignature(asset: string, points: readonly ChartPoint[]): string {
  const parts = [asset, String(points.length)]
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]
    parts.push(
      point === undefined ? 'missing' : `${point.day}:${point.open}:${point.close}:${point.bars === null ? 'x' : point.bars.length}`,
    )
  }
  return parts.join('|')
}

function toneOf(candle: Candle): 'up' | 'down' | 'flat' {
  if (candle.close > candle.open) return 'up'
  if (candle.close < candle.open) return 'down'
  return 'flat'
}

function toneColor(tone: 'up' | 'down' | 'flat'): string {
  if (tone === 'up') return UP
  if (tone === 'down') return DOWN
  return FLAT
}

function nearestCent(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`chart price is not finite, received ${String(value)}`)
  return Math.round(value)
}

function priceY(price: number, low: number, span: number, top: number, height: number): number {
  return top + (1 - (price - low) / span) * height
}

export function PriceChart({ asset, points }: { asset: string; points: readonly ChartPoint[] }) {
  const energy = useTradingStore().run?.game.stats.energy ?? null
  const fx = useCosmeticFx(energy)
  const view = useDelayedValue('price-chart', { asset, points }, fx.delayMs, chartSignature(asset, points))
  const [timeframe, setTimeframe] = useState<TimeframeId>('1D')
  const [hover, setHover] = useState<Hover | null>(null)
  const [size, setSize] = useState({ w: 640, h: 420 })
  const stageRef = useRef<HTMLDivElement>(null)

  const bars = buildCandles(view.points, timeframe).slice(-VISIBLE[timeframe])
  const drawnAsset = view.asset
  const active = hover !== null && bars[hover.index] !== undefined ? bars[hover.index] : bars[bars.length - 1]
  const activeTone = active === undefined ? 'flat' : toneOf(active)
  const lastBar = bars[bars.length - 1]
  const chartLog =
    lastBar === undefined
      ? `chart asset=${drawnAsset} timeframe=${timeframe} bars=0 last=none`
      : `chart asset=${drawnAsset} timeframe=${timeframe} bars=${bars.length} last=O=${lastBar.open} H=${lastBar.high} L=${lastBar.low} C=${lastBar.close} vol=${lastBar.volume === null ? 'none' : lastBar.volume}`

  useEffect(() => {
    const node = stageRef.current
    if (node === null) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box === undefined) return
      const w = Math.max(1, Math.floor(box.width))
      const h = Math.max(1, Math.floor(box.height))
      setSize((current) => (current.w === w && current.h === h ? current : { w, h }))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    debugLog('[ui]', chartLog)
  }, [chartLog])

  function onTimeframe(next: TimeframeId): void {
    setHover(null)
    setTimeframe(next)
  }

  const filter = blurFilter(fx.blurPx)
  const blurStyle = filter === undefined ? undefined : { filter }
  const plotLeft = PAD_LEFT
  const plotRight = Math.max(plotLeft + 1, size.w - AXIS_RIGHT)
  const plotTop = PAD_TOP
  const plotBottom = Math.max(plotTop + 1, size.h - AXIS_BOTTOM)
  const plotW = plotRight - plotLeft
  const plotH = plotBottom - plotTop
  const volumeH = Math.round(plotH * VOLUME_SHARE)
  const priceH = plotH - volumeH
  let maxVolume = 0
  for (const bar of bars) if (bar.volume !== null && bar.volume > maxVolume) maxVolume = bar.volume

  let yLow = 0
  let ySpan = 1
  if (bars.length > 0) {
    let min = bars[0]?.low ?? 0
    let max = bars[0]?.high ?? 0
    for (const bar of bars) {
      if (bar.low < min) min = bar.low
      if (bar.high > max) max = bar.high
    }
    const pad = max === min ? Math.max(1, Math.round(min * 0.01)) : Math.max(1, Math.round((max - min) * 0.08))
    yLow = min - pad
    ySpan = max + pad - yLow
    if (ySpan <= 0) ySpan = 1
  }

  const slot = bars.length === 0 ? plotW : plotW / bars.length
  const ticks = [0, 1, 2, 3, 4].map((step) => yLow + (ySpan * step) / 4)

  function onMove(event: PointerEvent<SVGSVGElement>): void {
    if (bars.length === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = ((event.clientX - rect.left) / rect.width) * size.w
    const y = ((event.clientY - rect.top) / rect.height) * size.h
    if (x < plotLeft || x >= plotRight) {
      setHover(null)
      return
    }
    const index = Math.min(bars.length - 1, Math.max(0, Math.floor((x - plotLeft) / slot)))
    setHover({ index, y })
  }

  const crossPrice =
    hover === null || hover.y > plotTop + priceH ? null : nearestCent(yLow + (1 - (hover.y - plotTop) / priceH) * ySpan)

  return (
    <div className="tv-chart">
      <div className="tv-toolbar" role="toolbar" aria-label="Chart timeframe">
        {TIMEFRAMES.map((id) => (
          <button key={id} type="button" aria-pressed={timeframe === id} onClick={() => onTimeframe(id)}>
            {id}
          </button>
        ))}
      </div>
      <div className="tv-stage" ref={stageRef} style={blurStyle}>
        {fx.tell ? <Tell /> : null}
        {bars.length === 0 || active === undefined ? (
          <p className="tv-empty">{drawnAsset}: no candles yet. Open the market and step the clock, or end the day.</p>
        ) : (
          <>
            <p className={`tv-legend ohlc-${activeTone}`}>
              <span className="tv-symbol">{drawnAsset}</span> {timeframe} {candleRangeLabel(active)} O{' '}
              {formatUsd(active.open, 'open')} H {formatUsd(active.high, 'high')} L {formatUsd(active.low, 'low')} C{' '}
              {formatUsd(active.close, 'close')} <span className="tv-vol">Vol {formatVolume(active.volume)}</span>
            </p>
            <svg
              className="chart"
              width={size.w}
              height={size.h}
              viewBox={`0 0 ${size.w} ${size.h}`}
              role="img"
              aria-label={`${drawnAsset} ${timeframe} candles, ${bars.length} bars`}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            >
              {ticks.map((tick) => {
                const y = priceY(tick, yLow, ySpan, plotTop, priceH)
                return (
                  <g key={tick}>
                    <line x1={plotLeft} x2={plotRight} y1={y} y2={y} stroke={GRID} />
                    <text x={plotRight + 8} y={y + 4} fill="#848e9c" fontSize="11">
                      {formatUsd(nearestCent(tick), 'axis')}
                    </text>
                  </g>
                )
              })}
              {bars.map((bar, index) => {
                const color = toneColor(toneOf(bar))
                const cx = plotLeft + (index + 0.5) * slot
                const bodyWidth = Math.max(1, Math.min(10, slot * 0.62))
                const yOpen = priceY(bar.open, yLow, ySpan, plotTop, priceH)
                const yClose = priceY(bar.close, yLow, ySpan, plotTop, priceH)
                const yHigh = priceY(bar.high, yLow, ySpan, plotTop, priceH)
                const yLowPx = priceY(bar.low, yLow, ySpan, plotTop, priceH)
                const top = Math.min(yOpen, yClose)
                const height = Math.max(1, Math.abs(yClose - yOpen))
                return (
                  <g key={`${bar.startDay}-${bar.endDay}-${bar.time ?? ''}`}>
                    {bar.volume !== null && maxVolume > 0 ? (
                      <rect
                        x={cx - bodyWidth / 2}
                        y={plotBottom - (bar.volume / maxVolume) * (volumeH - 4)}
                        width={bodyWidth}
                        height={(bar.volume / maxVolume) * (volumeH - 4)}
                        fill={color}
                        opacity="0.35"
                      />
                    ) : null}
                    <line x1={cx} x2={cx} y1={yHigh} y2={yLowPx} stroke={color} strokeWidth="1" />
                    <rect x={cx - bodyWidth / 2} y={top} width={bodyWidth} height={height} fill={color} />
                  </g>
                )
              })}
              {bars.length > 0 ? (
                <>
                  <text x={plotLeft} y={size.h - 6} fill="#848e9c" fontSize="11">
                    {candleRangeLabel(bars[0]!)}
                  </text>
                  <text x={plotRight} y={size.h - 6} fill="#848e9c" fontSize="11" textAnchor="end">
                    {candleRangeLabel(bars[bars.length - 1]!)}
                  </text>
                </>
              ) : null}
              {hover !== null && bars[hover.index] !== undefined ? (
                <g>
                  <line
                    x1={plotLeft + (hover.index + 0.5) * slot}
                    x2={plotLeft + (hover.index + 0.5) * slot}
                    y1={plotTop}
                    y2={plotBottom}
                    stroke={CROSS}
                  />
                  <line x1={plotLeft} x2={plotRight} y1={hover.y} y2={hover.y} stroke={CROSS} />
                  {crossPrice !== null ? (
                    <text x={plotRight + 8} y={hover.y + 4} fill="#eaecef" fontSize="11">
                      {formatUsd(crossPrice, 'crosshair')}
                    </text>
                  ) : null}
                </g>
              ) : null}
            </svg>
          </>
        )}
      </div>
    </div>
  )
}
