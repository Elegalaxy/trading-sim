import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { activeJob } from '../sim/jobs.ts'
import { viewedFeed } from '../sim/game.ts'
import { Accounts } from './Accounts.tsx'
import { AdminLog } from './AdminLog.tsx'
import { Consumables } from './Consumables.tsx'
import { BillBanner } from './BillBanner.tsx'
import { CalendarPanel } from './CalendarPanel.tsx'
import { DaySummaryPanel } from './DaySummary.tsx'
import { DayReport } from './DayReport.tsx'
import { nextPayday, tradingDay } from './days.ts'
import { Guide } from './Guide.tsx'
import { RUN_LENGTH_DAYS } from '../sim/constants.ts'
import { EquityChart } from './EquityChart.tsx'
import { Fold } from './Fold.tsx'
import { History } from './History.tsx'
import { PnlSummary } from './PnlSummary.tsx'
import { DayTimeline } from './DayTimeline.tsx'
import { FiMeter } from './FiMeter.tsx'
import { MarginMeter } from './MarginMeter.tsx'
import { MarketList } from './MarketList.tsx'
import { NewsFeed } from './NewsFeed.tsx'
import { OrderPanel } from './OrderPanel.tsx'
import { Positions } from './Positions.tsx'
import { PriceChart, type ChartLevel, type ChartPoint } from './PriceChart.tsx'
import { RunEnd } from './RunEnd.tsx'
import { StatMeters } from './StatMeters.tsx'
import { JobPanel } from './JobPanel.tsx'
import { LifestylePanel } from './LifestylePanel.tsx'
import { LoanDueBanner } from './LoanDueBanner.tsx'
import { NoticeStrip } from './NoticeStrip.tsx'
import { Ticker } from './Ticker.tsx'
import type { TickerTarget } from './ticker.ts'
import { LoanPanel } from './LoanPanel.tsx'
import { sessionPrice } from '../sim/session.ts'
import { tradingEquity } from '../sim/trading.ts'
import { buildHistory } from './history.ts'
import { formatUsd } from './money.ts'
import { useStoredFlag, useStoredNumber } from './storedFlag.ts'
import { useTradingStore } from './store.ts'

const WATCH_MIN = 240
const WATCH_MAX = 520
const RAIL_MIN = 300
const RAIL_MAX = 560
/** The chart column never gets narrower than this when a side column is dragged. */
const MIDDLE_MIN = 420

type Desk = 'positions' | 'history' | 'pnl' | 'equity' | 'book' | 'log'
type View = 'chart' | 'life'

/** Market cap in whole dollars, as `$1.9B` or `$640M`. */
function formatCap(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`market cap must be a non-negative safe integer, received ${String(cents)}`)
  const dollars = cents / 100
  if (dollars >= 1e9) return `$${(dollars / 1e9).toFixed(1)}B`
  return `$${Math.round(dollars / 1e6)}M`
}

export function Dashboard() {
  const snapshot = useTradingStore()
  const run = snapshot.run
  const assets = MARKET_DEFINITIONS.assets
  const [asset, setAsset] = useState(assets[0]?.id ?? 'NOVA')
  const [desk, setDesk] = useState<Desk>('positions')
  const [view, setView] = useState<View>('chart')
  const [watchOpen, setWatchOpen] = useStoredFlag('watch', true)
  const [watchWidth, setWatchWidth] = useStoredNumber('watch-width', 300, WATCH_MIN, WATCH_MAX)
  const [railWidth, setRailWidth] = useStoredNumber('rail-width', 320, RAIL_MIN, RAIL_MAX)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [railOpen, setRailOpen] = useStoredFlag('rail', true)
  const [deskSize, setDeskSize] = useState<'normal' | 'tall' | 'folded'>('normal')
  const [guideOpen, setGuideOpen] = useState(false)

  function onAsset(value: string): void {
    if (!assets.some((item) => item.id === value)) {
      console.error(`[ui] rejected asset ${JSON.stringify(value)}`)
      return
    }
    setAsset(value)
  }

  /** The widest a side column may get while the middle keeps its minimum. */
  function widthLimit(side: 'left' | 'right', max: number): number {
    const box = bodyRef.current?.getBoundingClientRect()
    if (box === undefined) return max
    const other = side === 'left' ? (railOpen ? railWidth : 32) : watchOpen ? watchWidth : 32
    return Math.max(side === 'left' ? WATCH_MIN : RAIL_MIN, Math.min(max, box.width - other - MIDDLE_MIN - 12))
  }

  function setSide(side: 'left' | 'right', width: number): void {
    const limit = widthLimit(side, side === 'left' ? WATCH_MAX : RAIL_MAX)
    if (side === 'left') setWatchWidth(Math.min(width, limit))
    else setRailWidth(Math.min(width, limit))
  }

  function startDrag(event: PointerEvent<HTMLDivElement>, side: 'left' | 'right'): void {
    const box = bodyRef.current?.getBoundingClientRect()
    if (box === undefined) return
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const move = (next: globalThis.PointerEvent): void => {
      setSide(side, side === 'left' ? next.clientX - box.left : box.right - next.clientX)
    }
    const stop = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', stop)
      target.removeEventListener('pointercancel', stop)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', stop)
    target.addEventListener('pointercancel', stop)
  }

  function nudge(event: KeyboardEvent<HTMLDivElement>, side: 'left' | 'right'): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const grow = (event.key === 'ArrowRight') === (side === 'left') ? 16 : -16
    setSide(side, (side === 'left' ? watchWidth : railWidth) + grow)
  }

  /** A ticker click: the Job card for an employer item, else the watchlist column (News and Calendar panels). */
  function onTicker(target: TickerTarget): void {
    if (target === 'job') {
      setView('life')
      return
    }
    setWatchOpen(true)
    window.setTimeout(() => document.querySelector('.side-news')?.scrollIntoView({ block: 'nearest' }), 0)
  }

  const market = run?.game.market ?? null
  const points: ChartPoint[] = []
  let lastPrice: number | undefined
  let dayHigh: number | undefined
  let dayLow: number | undefined
  let dayOpen: number | undefined
  let shares: number | undefined
  if (run !== null) {
    const def = assets.find((item) => item.id === asset)
    if (def === undefined) throw new Error(`unknown asset ${asset}`)
    shares = def.sharesOutstanding
    points.push(...buildHistory(run.seed, asset, def.startPriceCents, Math.max(def.dailyVolatility, 0.006)))
    const rows = run.game.past
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      const before = i === 0 ? undefined : rows[i - 1]
      const close = row?.prices[asset]
      const open = before?.prices[asset] ?? row?.bars[asset]?.[0]?.open ?? close
      if (row === undefined || close === undefined || open === undefined) {
        throw new Error(`chart is missing ${asset} on day ${row?.day ?? i}`)
      }
      points.push({ day: row.day - 1, open, close, bars: row.bars[asset] ?? null })
    }
    const session = run.game.session
    const sessionBars = session.bars[asset]
    if (sessionBars === undefined) throw new Error(`session is missing ${asset} on day ${session.day}`)
    const played = sessionBars.slice(0, session.clock)
    const open = sessionBars[0]?.open
    if (open === undefined) throw new Error(`session has no bars for ${asset}`)
    lastPrice = sessionPrice(run.game, asset)
    dayOpen = open
    dayHigh = played.reduce((best, bar) => Math.max(best, bar.high), open)
    dayLow = played.reduce((best, bar) => Math.min(best, bar.low), open)
    if (played.length > 0) points.push({ day: session.day, open, close: lastPrice, bars: played })
  }
  const levels: ChartLevel[] = []
  if (run !== null) {
    for (const order of run.game.resting.orders) {
      if (order.asset === asset) {
        levels.push({ kind: 'limit', label: order.side === 'buy' ? 'Buy' : 'Sell', cents: order.limitCents })
      }
    }
    const held = run.game.positions[asset]
    if (held !== undefined && held.signedShares !== 0) {
      const entry = Math.round(held.costCents / Math.abs(held.signedShares))
      levels.push({ kind: 'entry', label: 'Entry', cents: entry })
    }
    // One dashed line per exit level. Partial levels show the shares they close.
    const exit = run.game.resting.exits[asset]
    for (const kind of ['takeProfit', 'stopLoss'] as const) {
      // Numbered from the price outwards: a long's targets rise, its stops fall.
      const up = (kind === 'takeProfit') === (exit?.side === 'long')
      const own = (exit?.levels ?? [])
        .filter((level) => level.kind === kind)
        .sort((a, b) => (up ? a.priceCents - b.priceCents : b.priceCents - a.priceCents))
      own.forEach((level, index) => {
        const name = `${kind === 'takeProfit' ? 'TP' : 'SL'}${own.length > 1 ? index + 1 : ''}`
        levels.push({ kind, label: level.quantity === null ? name : `${name} ×${level.quantity}`, cents: level.priceCents })
      })
    }
  }
  const events = run === null ? [] : [...run.game.market.log, ...run.game.log, ...run.game.perception.events]
  const payday = run === null ? null : nextPayday(run.game, MARKET_DEFINITIONS)
  const cash = run?.game.accounts.cashCents
  // Equity, not the cash balance: a leveraged buy borrows, so the balance alone can be far below zero.
  const trading = run === null ? undefined : tradingEquity(run.game, MARKET_DEFINITIONS).equity
  const tradingBalance = run?.game.accounts.tradingCents
  const savings = run?.game.accounts.savingsCents
  let changeText = '0.00%'
  let changeUp = true
  if (lastPrice !== undefined && dayOpen !== undefined && dayOpen > 0) {
    const pct = ((lastPrice - dayOpen) / dayOpen) * 100
    if (!Number.isFinite(pct)) throw new Error(`price change is not finite for ${asset}`)
    changeUp = pct >= 0
    changeText = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
  }

  const capText = shares === undefined || lastPrice === undefined ? null : formatCap(shares * lastPrice)

  return (
    <main className="dashboard exchange">
      <header className="symbol-bar">
        <div className="symbol-left">
          <div className="symbol-id">
            <strong className="symbol-name">{asset}</strong>
            {lastPrice === undefined ? (
              <strong className="last-price">—</strong>
            ) : (
              <strong className={changeUp ? 'last-price up' : 'last-price down'}>{formatUsd(lastPrice, asset)}</strong>
            )}
            <span className={changeUp ? 'change up' : 'change down'}>{changeText}</span>
          </div>
          <dl className="symbol-stats">
            <div>
              <dt>High</dt>
              <dd>{dayHigh === undefined ? '—' : formatUsd(dayHigh, 'high')}</dd>
            </div>
            <div>
              <dt>Low</dt>
              <dd>{dayLow === undefined ? '—' : formatUsd(dayLow, 'low')}</dd>
            </div>
            {capText === null ? null : (
              <div>
                <dt>Mkt cap</dt>
                <dd>{capText}</dd>
              </div>
            )}
          </dl>
        </div>
        <dl className="symbol-stats symbol-accounts">
          <div>
            <dt>Cash</dt>
            <dd>{cash === undefined ? '—' : formatUsd(cash, 'cash')}</dd>
          </div>
          <div
            title={
              tradingBalance === undefined
                ? undefined
                : `Trading equity: balance ${formatUsd(tradingBalance, 'trading balance')} plus open positions at the current price.`
            }
          >
            <dt>Trading equity</dt>
            <dd>{trading === undefined ? '—' : formatUsd(trading, 'trading')}</dd>
          </div>
          <div>
            <dt>Savings</dt>
            <dd>{savings === undefined ? '—' : formatUsd(savings, 'savings')}</dd>
          </div>
        </dl>
        <div className="symbol-meta">
          <p>
            {run === null
              ? 'No run yet.'
              : `${run.mode === 'seeded' ? 'Seeded' : 'Normal'} · ${run.seed} · Day ${run.game.runEnd?.day ?? tradingDay(run.game)} of ${RUN_LENGTH_DAYS}`}
          </p>
          {payday === null ? null : (
            <span
              className={payday.inDays <= 2 ? 'payday-chip soon' : 'payday-chip'}
              title={`At the close of day ${payday.day}: salary about ${formatUsd(payday.salaryCents, 'salary')}, bill ${formatUsd(payday.billCents, 'bill')}${
                payday.loanPaymentCents > 0 ? `, loan payment about ${formatUsd(payday.loanPaymentCents, 'loan payment')}` : ''
              }.`}
            >
              {payday.inDays === 0 ? 'Payday and bills at today’s close' : `Payday and bills in ${payday.inDays} day${payday.inDays === 1 ? '' : 's'}`}
            </span>
          )}
          <button type="button" className="guide-open" onClick={() => setGuideOpen(true)}>
            Guide
          </button>
          <StatMeters game={run?.game ?? null} compact />
        </div>
      </header>

      <div className="session-bar">
        <DayTimeline game={run?.game ?? null} />
      </div>
      {run !== null ? <RunEnd seed={run.seed} mode={run.mode} game={run.game} /> : null}
      <DayReport report={run?.report ?? null} />
      {guideOpen ? <Guide onClose={() => setGuideOpen(false)} /> : null}
      <Ticker game={run?.game ?? null} onOpen={onTicker} />
      <NoticeStrip game={run?.game ?? null} onOpen={() => setView('life')} />
      <BillBanner game={run?.game ?? null} />
      <LoanDueBanner game={run?.game ?? null} />

      <div
        ref={bodyRef}
        className="exchange-body"
        style={
          {
            '--watch-w': watchOpen ? `${watchWidth}px` : '32px',
            '--rail-w': railOpen ? `${railWidth}px` : '32px',
            '--grip-l': watchOpen ? '6px' : '0px',
            '--grip-r': railOpen ? '6px' : '0px',
          } as CSSProperties
        }
      >
        <div className={watchOpen ? 'side-col' : 'side-col closed'}>
          <button
            type="button"
            className="side-toggle"
            aria-expanded={watchOpen}
            aria-label={watchOpen ? 'Hide the watchlist' : 'Show the watchlist'}
            title={watchOpen ? 'Hide the watchlist' : 'Show the watchlist'}
            onClick={() => setWatchOpen(!watchOpen)}
          >
            {watchOpen ? '◂ Watchlist' : '▸'}
          </button>
          {watchOpen ? (
            <>
              <MarketList asset={asset} game={run?.game ?? null} onSelect={onAsset} />
              <div className="side-news">
                <Fold id="news" title="News">
                  <NewsFeed
                    key={`${market?.day ?? 'none'}-${market?.feed.day ?? 0}`}
                    feed={run === null ? null : viewedFeed(run.game)}
                    verified={run?.game.perception.verified ?? false}
                    job={run === null ? null : activeJob(run.game.job)}
                    newsReads={run?.game.stats.newsReads ?? 0}
                  />
                </Fold>
                <Fold id="calendar" title="Calendar" startFolded>
                  <CalendarPanel market={market} employer={run?.game.employer ?? null} />
                </Fold>
              </div>
            </>
          ) : null}
        </div>
        <div
          className="resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the watchlist"
          aria-valuenow={watchWidth}
          aria-valuemin={WATCH_MIN}
          aria-valuemax={WATCH_MAX}
          tabIndex={0}
          hidden={!watchOpen}
          onPointerDown={(event) => startDrag(event, 'left')}
          onKeyDown={(event) => nudge(event, 'left')}
        />
        <div className={`chart-column desk-${deskSize}`}>
          <div className="main-view">
            <nav className="main-tabs" aria-label="Main view">
              <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
                Chart
              </button>
              <button type="button" aria-pressed={view === 'life'} onClick={() => setView('life')}>
                Life
              </button>
            </nav>
            <div className={view === 'chart' ? 'main-pane' : 'main-pane hidden'}>
              <PriceChart asset={asset} points={points} levels={levels} marks={run?.game.fills.filter((fill) => fill.asset === asset)} />
            </div>
            {view === 'life' ? (
              <div className="main-pane main-scroll desk life-grid">
                <div className="life-col">
                  <Fold id="food" title="Food and drink">
                    <Consumables game={run?.game ?? null} />
                  </Fold>
                  <Fold id="job" title="Job">
                    <JobPanel game={run?.game ?? null} />
                  </Fold>
                </div>
                <div className="life-col">
                  <Fold id="lifestyle" title="Lifestyle">
                    <LifestylePanel game={run?.game ?? null} />
                  </Fold>
                  <Fold id="loan" title="Bank loan">
                    <LoanPanel game={run?.game ?? null} />
                  </Fold>
                </div>
              </div>
            ) : null}
          </div>
          <section className="subpanel" aria-label="Subpanel">
            <nav className="subpanel-tabs" aria-label="Subpanel sections">
              <button type="button" aria-pressed={desk === 'positions'} onClick={() => setDesk('positions')}>
                Positions
              </button>
              <button type="button" aria-pressed={desk === 'history'} onClick={() => setDesk('history')}>
                History
              </button>
              <button type="button" aria-pressed={desk === 'pnl'} onClick={() => setDesk('pnl')}>
                P&amp;L
              </button>
              <button type="button" aria-pressed={desk === 'equity'} onClick={() => setDesk('equity')}>
                Equity
              </button>
              <button type="button" aria-pressed={desk === 'book'} onClick={() => setDesk('book')}>
                Day book
              </button>
              {import.meta.env.DEV ? (
                <button type="button" aria-pressed={desk === 'log'} onClick={() => setDesk('log')}>
                  Log
                </button>
              ) : null}
              <span className="subpanel-size">
                <button
                  type="button"
                  aria-label={deskSize === 'tall' ? 'Shrink the panel' : 'Enlarge the panel'}
                  title={deskSize === 'tall' ? 'Shrink' : 'Enlarge'}
                  onClick={() => setDeskSize(deskSize === 'tall' ? 'normal' : 'tall')}
                >
                  {deskSize === 'tall' ? '⤓' : '⤒'}
                </button>
                <button
                  type="button"
                  aria-label={deskSize === 'folded' ? 'Show the panel' : 'Hide the panel'}
                  title={deskSize === 'folded' ? 'Show' : 'Hide'}
                  onClick={() => setDeskSize(deskSize === 'folded' ? 'normal' : 'folded')}
                >
                  {deskSize === 'folded' ? '▴' : '▾'}
                </button>
              </span>
            </nav>
            <div className="subpanel-body">
              {desk === 'positions' ? <Positions game={run?.game ?? null} onSelect={onAsset} selected={asset} /> : null}
              {desk === 'history' ? <History history={run?.game.fills ?? []} /> : null}
              {desk === 'pnl' ? <PnlSummary game={run?.game ?? null} history={run?.game.fills ?? []} /> : null}
              {desk === 'equity' ? <EquityChart points={run?.equity ?? []} /> : null}
              {desk === 'book' ? (
                <DaySummaryPanel
                  summary={run?.summary ?? null}
                  liquidations={run?.liquidations ?? []}
                  forcedSales={run?.forcedSales ?? []}
                />
              ) : null}
              {desk === 'log' && import.meta.env.DEV ? <AdminLog events={events} /> : null}
            </div>
          </section>
        </div>
        <div
          className="resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the order panel"
          aria-valuenow={railWidth}
          aria-valuemin={RAIL_MIN}
          aria-valuemax={RAIL_MAX}
          tabIndex={0}
          hidden={!railOpen}
          onPointerDown={(event) => startDrag(event, 'right')}
          onKeyDown={(event) => nudge(event, 'right')}
        />
        <aside className={railOpen ? 'ticket-rail side-col' : 'ticket-rail side-col closed'}>
          <button
            type="button"
            className="side-toggle"
            aria-expanded={railOpen}
            aria-label={railOpen ? 'Hide the order panel' : 'Show the order panel'}
            title={railOpen ? 'Hide the order panel' : 'Show the order panel'}
            onClick={() => setRailOpen(!railOpen)}
          >
            {railOpen ? 'Order ▸' : '◂'}
          </button>
          {railOpen ? (
            <>
              <Fold id="order" title="Order">
                <OrderPanel game={run?.game ?? null} asset={asset} />
              </Fold>
              <Fold id="margin" title="Margin">
                <MarginMeter game={run?.game ?? null} />
              </Fold>
              <Fold id="accounts" title="Accounts" startFolded>
                <Accounts game={run?.game ?? null} />
              </Fold>
              <Fold id="fi" title="Financial independence" startFolded>
                <FiMeter game={run?.game ?? null} />
              </Fold>
            </>
          ) : null}
        </aside>
      </div>
    </main>
  )
}
