import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { blurFilter, useCosmeticFx, useDelayedValue } from './effects.ts'
import { buildCandles, candleRangeLabel, formatVolume, type Candle, type DaySource, type TimeframeId } from './candles.ts'
import { debugLog } from './debug.ts'
import { formatUsd } from './money.ts'
import type { FillRecord } from '../sim/types.ts'
import { useTradingStore } from './store.ts'

/** Fewest and most candles one view can hold when zooming. */
const MIN_VISIBLE = 10
const MAX_VISIBLE = 400
const ZOOM_STEP = 1.15

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

/** A resting order or an exit, drawn as a dashed line across the chart. */
export type ChartLevel = {
  kind: 'entry' | 'limit' | 'takeProfit' | 'stopLoss'
  label: string
  cents: number
}

const LEVEL_COLOR: Record<ChartLevel['kind'], string> = {
  entry: '#4c9aff',
  limit: '#f7a600',
  takeProfit: UP,
  stopLoss: DOWN,
}

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

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

/** The candle a fill belongs to: its day, and for 15m and 1H candles its time window. */
function markIndex(bars: readonly Candle[], mark: FillRecord, timeframe: TimeframeId): number {
  const width = timeframe === '15m' ? 15 : 60
  return bars.findIndex((bar) => {
    if (mark.day < bar.startDay || mark.day > bar.endDay) return false
    if (bar.time === null) return true
    const start = minutesOf(bar.time)
    const at = minutesOf(mark.time)
    return at >= start && at < start + width
  })
}

function priceY(price: number, low: number, span: number, top: number, height: number): number {
  return top + (1 - (price - low) / span) * height
}

/** `TP 100 @ $50.00` for an exit, `Buy 100 @ $48.00` for an order or a limit fill. */
function markLabel(mark: FillRecord): string {
  const head =
    mark.via === 'takeProfit'
      ? 'TP'
      : mark.via === 'stopLoss'
        ? 'SL'
        : mark.via === 'liquidation'
          ? 'Liquidated'
          : mark.via === 'forcedSale'
            ? 'Forced sale'
            : `${mark.side === 'buy' ? 'Buy' : 'Sell'}${mark.via === 'limit' ? ' limit' : ''}`
  return `${head} ${mark.quantity} @ ${formatUsd(mark.fillCents, 'mark')}`
}

function markColor(mark: FillRecord): string {
  if (mark.via === 'takeProfit') return LEVEL_COLOR.takeProfit
  if (mark.via === 'stopLoss') return LEVEL_COLOR.stopLoss
  if (mark.via === 'liquidation') return '#b7324a'
  if (mark.via === 'forcedSale') return LEVEL_COLOR.limit
  return mark.side === 'buy' ? UP : DOWN
}

/**
 * Which candles are on screen: `count` slots, the last one `offset` candles before the newest.
 * A negative offset leaves empty slots past the newest candle.
 */
type Span = { count: number; offset: number }

/** Candles that stay on screen however far back the chart is dragged. */
const MIN_KEPT = 5

function clampSpan(span: Span, total: number): Span {
  const count = Math.round(Math.min(Math.max(span.count, MIN_VISIBLE), Math.max(MIN_VISIBLE, Math.min(MAX_VISIBLE, total))))
  // Up to half a screen of empty space past the newest candle, and back until a few candles remain.
  const least = -Math.floor(count / 2)
  const most = Math.max(0, total - MIN_KEPT)
  const offset = Math.round(Math.min(Math.max(span.offset, least), most))
  return count === span.count && offset === span.offset ? span : { count, offset }
}

type ZoomView = { span: Span; total: number; low: number; range: number; top: number; height: number; right: number }

/** A price range set by dragging. Null fits the range to the candles on screen. */
type Scale = { low: number; span: number }

/** Smallest price range, in cents, the price scale can be stretched to. */
const MIN_SCALE_SPAN = 4

type Drag = {
  /** `pan` moves the chart, `axis` stretches the price scale. */
  mode: 'pan' | 'axis'
  x: number
  y: number
  offset: number
  low: number
  span: number
  /** True once the pan also moves the price range. */
  free: boolean
}

export function PriceChart({
  asset,
  points,
  levels = [],
  marks = [],
}: {
  asset: string
  points: readonly ChartPoint[]
  levels?: readonly ChartLevel[]
  marks?: readonly FillRecord[]
}) {
  const energy = useTradingStore().run?.game.stats.energy ?? null
  const fx = useCosmeticFx(energy)
  const view = useDelayedValue('price-chart', { asset, points }, fx.delayMs, chartSignature(asset, points))
  const [timeframe, setTimeframe] = useState<TimeframeId>('1D')
  const [hover, setHover] = useState<Hover | null>(null)
  const [size, setSize] = useState({ w: 640, h: 420 })
  const [rawSpan, setSpan] = useState<Span>({ count: VISIBLE['1D'], offset: 0 })
  const [scale, setScale] = useState<Scale | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const clipId = `tv-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const drawnAsset = view.asset
  // Another asset has its own prices, so a stretched scale does not carry over.
  const [scaleAsset, setScaleAsset] = useState(drawnAsset)
  if (scaleAsset !== drawnAsset) {
    setScaleAsset(drawnAsset)
    setScale(null)
  }

  const allBars = buildCandles(view.points, timeframe)
  const span = clampSpan(rawSpan, allBars.length)
  const end = allBars.length - span.offset
  const start = end - span.count
  const bars = allBars.slice(Math.max(0, start), Math.max(0, end))
  // Empty slots left of the first drawn candle, when the view starts before the oldest one.
  const lead = Math.max(0, start) - start
  const live = allBars[allBars.length - 1]
  // What the wheel listener, which is attached once, needs from the last render.
  const zoomRef = useRef<ZoomView | null>(null)
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

  // Wheel zoom keeps the candle (or, over the price scale, the price) under the pointer in place.
  // React's wheel handler is passive, so it is attached here to be able to stop the page from scrolling.
  useEffect(() => {
    const node = stageRef.current
    if (node === null) return
    function onWheel(event: WheelEvent): void {
      const view = zoomRef.current
      const svg = node?.querySelector('svg')
      if (view === null || view.total === 0 || svg === null || svg === undefined) return
      const { span: current, total, low, range, top, height, right } = view
      event.preventDefault()
      const rect = svg.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const x = ((event.clientX - rect.left) / rect.width) * svg.width.baseVal.value
      const factor = event.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      if (x >= right) {
        const y = ((event.clientY - rect.top) / rect.height) * svg.height.baseVal.value
        const fraction = Math.min(1, Math.max(0, (y - top) / height))
        const price = low + (1 - fraction) * range
        const next = Math.max(MIN_SCALE_SPAN, range * factor)
        setScale({ low: price - (1 - fraction) * next, span: next })
        return
      }
      const fraction = Math.min(1, Math.max(0, (x - PAD_LEFT) / Math.max(1, right - PAD_LEFT)))
      const next = clampSpan({ count: current.count * factor, offset: current.offset }, total)
      // The slot under the pointer, counted back from the newest.
      const fromEnd = current.offset + (1 - fraction) * current.count
      setSpan(clampSpan({ count: next.count, offset: fromEnd - (1 - fraction) * next.count }, total))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  function onTimeframe(next: TimeframeId): void {
    setHover(null)
    setTimeframe(next)
    setSpan({ count: VISIBLE[next], offset: 0 })
    setScale(null)
  }

  const following = span.offset === 0 && span.count === Math.min(VISIBLE[timeframe], Math.max(MIN_VISIBLE, allBars.length))

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
  if (scale !== null) {
    yLow = scale.low
    ySpan = scale.span
  } else if (bars.length > 0) {
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

  useEffect(() => {
    zoomRef.current = { span, total: allBars.length, low: yLow, range: ySpan, top: plotTop, height: priceH, right: plotRight }
  })

  const slot = plotW / span.count
  const centerX = (index: number) => plotLeft + (lead + index + 0.5) * slot
  const ticks = [0, 1, 2, 3, 4].map((step) => yLow + (ySpan * step) / 4)

  /** The pointer in chart units. */
  function pointAt(event: MouseEvent<SVGSVGElement>): { x: number; y: number } | null {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return { x: ((event.clientX - rect.left) / rect.width) * size.w, y: ((event.clientY - rect.top) / rect.height) * size.h }
  }

  function onDown(event: PointerEvent<SVGSVGElement>): void {
    if (event.button !== 0) return
    const point = pointAt(event)
    if (point === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      mode: point.x >= plotRight ? 'axis' : 'pan',
      x: point.x,
      y: point.y,
      offset: span.offset,
      low: yLow,
      span: ySpan,
      free: scale !== null,
    })
  }

  function onUp(event: PointerEvent<SVGSVGElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDrag(null)
  }

  function onMove(event: PointerEvent<SVGSVGElement>): void {
    const point = pointAt(event)
    if (point === null) return
    const { x, y } = point
    if (drag !== null && drag.mode === 'axis') {
      // Dragging down squeezes the prices together, dragging up spreads them out.
      const next = Math.max(MIN_SCALE_SPAN, drag.span * Math.exp((y - drag.y) * 0.006))
      setScale({ low: drag.low + drag.span / 2 - next / 2, span: next })
      return
    }
    if (drag !== null) {
      // Dragging right shows older candles.
      const moved = Math.round((x - drag.x) / slot)
      setSpan(clampSpan({ count: span.count, offset: drag.offset + moved }, allBars.length))
      // A clear vertical drag frees the price range, as on a trading terminal.
      const dy = y - drag.y
      if (drag.free || Math.abs(dy) > 6) {
        if (!drag.free) setDrag({ ...drag, free: true })
        setScale({ low: drag.low + (dy / priceH) * drag.span, span: drag.span })
      }
    }
    if (bars.length === 0 || x < plotLeft || x >= plotRight) {
      setHover(null)
      return
    }
    setHover({ index: Math.floor((x - plotLeft) / slot) - lead, y })
  }

  function onDoubleClick(event: MouseEvent<SVGSVGElement>): void {
    const point = pointAt(event)
    if (point !== null && point.x >= plotRight) setScale(null)
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
        <span className="tv-hint">Drag to move · scroll to zoom · drag the price scale to stretch it</span>
        <button
          type="button"
          className="tv-auto"
          aria-pressed={scale === null}
          onClick={() => setScale(null)}
          title="Fit the price scale to the candles on screen. Double-clicking the price scale does the same."
        >
          Auto
        </button>
        {following ? null : (
          <button type="button" className="tv-now" onClick={() => setSpan({ count: VISIBLE[timeframe], offset: 0 })}>
            Back to now
          </button>
        )}
      </div>
      <div className="tv-stage" ref={stageRef} style={blurStyle}>
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
              onPointerDown={onDown}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={() => setHover(null)}
              onDoubleClick={onDoubleClick}
              style={{ cursor: drag?.mode === 'axis' ? 'ns-resize' : drag !== null ? 'grabbing' : 'crosshair', touchAction: 'none' }}
            >
              <defs>
                {/* Candles stay in the price area when the scale is moved; marks may reach into the volume. */}
                <clipPath id={`${clipId}-price`}>
                  <rect x={plotLeft} y={0} width={plotW} height={plotTop + priceH} />
                </clipPath>
                <clipPath id={`${clipId}-plot`}>
                  <rect x={plotLeft} y={0} width={plotW} height={plotBottom} />
                </clipPath>
              </defs>
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
                if (bar.volume === null || maxVolume <= 0) return null
                const bodyWidth = Math.max(1, Math.min(10, slot * 0.62))
                const height = (bar.volume / maxVolume) * Math.max(0, volumeH - 4)
                return (
                  <rect
                    key={`vol-${bar.startDay}-${bar.endDay}-${bar.time ?? ''}`}
                    x={centerX(index) - bodyWidth / 2}
                    y={plotBottom - height}
                    width={bodyWidth}
                    height={height}
                    fill={toneColor(toneOf(bar))}
                    opacity="0.35"
                  />
                )
              })}
              <g clipPath={`url(#${clipId}-price)`}>
                {bars.map((bar, index) => {
                  const color = toneColor(toneOf(bar))
                  const cx = centerX(index)
                  const bodyWidth = Math.max(1, Math.min(10, slot * 0.62))
                  const yOpen = priceY(bar.open, yLow, ySpan, plotTop, priceH)
                  const yClose = priceY(bar.close, yLow, ySpan, plotTop, priceH)
                  const yHigh = priceY(bar.high, yLow, ySpan, plotTop, priceH)
                  const yLowPx = priceY(bar.low, yLow, ySpan, plotTop, priceH)
                  const top = Math.min(yOpen, yClose)
                  const height = Math.max(1, Math.abs(yClose - yOpen))
                  return (
                    <g key={`${bar.startDay}-${bar.endDay}-${bar.time ?? ''}`}>
                      <line x1={cx} x2={cx} y1={yHigh} y2={yLowPx} stroke={color} strokeWidth="1" />
                      <rect x={cx - bodyWidth / 2} y={top} width={bodyWidth} height={height} fill={color} />
                    </g>
                  )
                })}
              </g>
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
              {levels.map((level) => {
                const raw = priceY(level.cents, yLow, ySpan, plotTop, priceH)
                const y = Math.min(plotTop + priceH, Math.max(plotTop, raw))
                const arrow = raw < plotTop ? '▲ ' : raw > plotTop + priceH ? '▼ ' : ''
                const color = LEVEL_COLOR[level.kind]
                return (
                  <g key={`${level.kind}-${level.cents}-${level.label}`}>
                    <line x1={plotLeft} x2={plotRight} y1={y} y2={y} stroke={color} strokeDasharray="5 4" opacity="0.9" />
                    <rect x={plotRight} y={y - 8} width={AXIS_RIGHT - 2} height={16} fill={color} rx="2" />
                    <text x={plotRight + 4} y={y + 4} fill="#0b0e11" fontSize="10" fontWeight="650">
                      {arrow}
                      {level.label} {formatUsd(level.cents, 'level')}
                    </text>
                  </g>
                )
              })}
              {live !== undefined ? (
                (() => {
                  // The last price, drawn like the order lines so a level near it is easy to compare.
                  const raw = priceY(live.close, yLow, ySpan, plotTop, priceH)
                  const y = Math.min(plotTop + priceH, Math.max(plotTop, raw))
                  const arrow = raw < plotTop ? '▲ ' : raw > plotTop + priceH ? '▼ ' : ''
                  const color = toneColor(toneOf(live))
                  return (
                    <g>
                      <line x1={plotLeft} x2={plotRight} y1={y} y2={y} stroke={color} strokeDasharray="2 3" opacity="0.8" />
                      <rect x={plotRight} y={y - 8} width={AXIS_RIGHT - 2} height={16} fill={color} rx="2" />
                      <text x={plotRight + 4} y={y + 4} fill="#0b0e11" fontSize="10" fontWeight="650">
                        {arrow}
                        {formatUsd(live.close, 'last price')}
                      </text>
                    </g>
                  )
                })()
              ) : null}
              {(() => {
                const placed = marks
                  .map((mark) => ({ mark, index: markIndex(bars, mark, timeframe) }))
                  .filter((item) => bars[item.index] !== undefined)
                // Labels only while they fit; the arrows stay and carry a tooltip.
                const labelled = placed.length <= 12 || slot >= 14
                const stack = new Map<string, number>()
                const drawn = placed.map(({ mark, index }) => {
                  const bar = bars[index]!
                  const cx = centerX(index)
                  const buy = mark.side === 'buy'
                  const color = markColor(mark)
                  const dir = buy ? 1 : -1
                  const key = `${index}:${dir}`
                  const nth = stack.get(key) ?? 0
                  stack.set(key, nth + 1)
                  const base = buy ? priceY(bar.low, yLow, ySpan, plotTop, priceH) + 5 : priceY(bar.high, yLow, ySpan, plotTop, priceH) - 5
                  const tipY = base + dir * nth * (labelled ? 24 : 13)
                  const label = markLabel(mark)
                  return (
                    <g key={`${mark.n}`}>
                      <title>{`${label} · ${candleRangeLabel(bar)}`}</title>
                      <polygon
                        points={`${cx},${tipY} ${cx - 6},${tipY + dir * 11} ${cx + 6},${tipY + dir * 11}`}
                        fill={color}
                        stroke="#0b0e11"
                      />
                      {labelled ? (
                        <text x={cx} y={tipY + dir * 21 + (buy ? 2 : 0)} fill={color} fontSize="10" fontWeight="650" textAnchor="middle">
                          {label}
                        </text>
                      ) : null}
                    </g>
                  )
                })
                return <g clipPath={`url(#${clipId}-plot)`}>{drawn}</g>
              })()}
              {hover !== null && bars[hover.index] !== undefined ? (
                <g>
                  <line
                    x1={centerX(hover.index)}
                    x2={centerX(hover.index)}
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
              <rect
                x={plotRight}
                y={0}
                width={AXIS_RIGHT}
                height={plotBottom}
                fill="transparent"
                style={{ cursor: drag?.mode === 'pan' ? 'grabbing' : 'ns-resize' }}
              >
                <title>Drag to stretch the prices. Double-click to fit them again.</title>
              </rect>
            </svg>
          </>
        )}
      </div>
    </div>
  )
}
