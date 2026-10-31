import { useState } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { activeJob } from '../sim/jobs.ts'
import { viewedFeed } from '../sim/game.ts'
import { Accounts } from './Accounts.tsx'
import { AdminLog } from './AdminLog.tsx'
import { Consumables } from './Consumables.tsx'
import { BillBanner } from './BillBanner.tsx'
import { CalendarPanel } from './CalendarPanel.tsx'
import { DaySummaryPanel } from './DaySummary.tsx'
import { DayTimeline } from './DayTimeline.tsx'
import { FiMeter } from './FiMeter.tsx'
import { MarginMeter } from './MarginMeter.tsx'
import { NewsFeed } from './NewsFeed.tsx'
import { OrderPanel } from './OrderPanel.tsx'
import { Positions } from './Positions.tsx'
import { PriceChart, type ChartPoint } from './PriceChart.tsx'
import { RunEnd } from './RunEnd.tsx'
import { StatMeters } from './StatMeters.tsx'
import { JobPanel } from './JobPanel.tsx'
import { LifestylePanel } from './LifestylePanel.tsx'
import { LoanPanel } from './LoanPanel.tsx'
import { formatUsd } from './money.ts'
import { useTradingStore } from './store.ts'

type Desk = 'positions' | 'life' | 'news' | 'book' | 'log'

export function Dashboard() {
  const snapshot = useTradingStore()
  const run = snapshot.run
  const assets = MARKET_DEFINITIONS.assets
  const [asset, setAsset] = useState(assets[0]?.id ?? 'NOVA')
  const [desk, setDesk] = useState<Desk>('positions')

  function onAsset(value: string): void {
    if (!assets.some((item) => item.id === value)) {
      console.error(`[ui] rejected asset ${JSON.stringify(value)}`)
      return
    }
    setAsset(value)
  }

  const market = run?.game.market ?? null
  const points: ChartPoint[] = []
  if (run !== null) {
    for (const row of run.closes) {
      const priceCents = row.prices[asset]
      if (priceCents === undefined) throw new Error(`chart is missing ${asset} on day ${row.day}`)
      points.push({ day: row.day, priceCents })
    }
  }
  const events = run === null ? [] : [...run.game.market.log, ...run.game.log, ...run.game.perception.events]
  const cash = run?.game.accounts.cashCents
  const trading = run?.game.accounts.tradingCents
  const savings = run?.game.accounts.savingsCents
  const lastPoint = points[points.length - 1]
  const prevPoint = points.length > 1 ? points[points.length - 2] : undefined
  const lastPrice = lastPoint?.priceCents
  const dayHigh =
    lastPrice === undefined ? undefined : prevPoint === undefined ? lastPrice : Math.max(lastPrice, prevPoint.priceCents)
  const dayLow =
    lastPrice === undefined ? undefined : prevPoint === undefined ? lastPrice : Math.min(lastPrice, prevPoint.priceCents)
  let changeText = '0.00%'
  let changeUp = true
  if (lastPrice !== undefined && prevPoint !== undefined && prevPoint.priceCents > 0) {
    const pct = ((lastPrice - prevPoint.priceCents) / prevPoint.priceCents) * 100
    if (!Number.isFinite(pct)) throw new Error(`price change is not finite for ${asset}`)
    changeUp = pct >= 0
    changeText = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
  }

  return (
    <main className="dashboard exchange">
      <header className="symbol-bar">
        <div className="symbol-id">
          <label htmlFor="asset">
            <select id="asset" value={asset} onChange={(event) => onAsset(event.target.value)}>
              {assets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          </label>
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
          <div>
            <dt>Cash</dt>
            <dd>{cash === undefined ? '—' : formatUsd(cash, 'cash')}</dd>
          </div>
          <div>
            <dt>Trading</dt>
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
              : `${run.mode === 'seeded' ? 'Seeded' : 'Normal'} · ${run.seed} · Day ${run.game.market.day}`}
          </p>
          <StatMeters game={run?.game ?? null} compact />
        </div>
      </header>

      <div className="session-bar">
        <DayTimeline game={run?.game ?? null} />
      </div>
      {run !== null ? <RunEnd seed={run.seed} mode={run.mode} game={run.game} /> : null}
      <BillBanner game={run?.game ?? null} />

      <div className="exchange-body">
        <div className="chart-column">
          <PriceChart asset={asset} points={points} />
          <section className="subpanel" aria-label="Subpanel">
            <nav className="subpanel-tabs" aria-label="Subpanel sections">
              <button type="button" aria-pressed={desk === 'positions'} onClick={() => setDesk('positions')}>
                Positions
              </button>
              <button type="button" aria-pressed={desk === 'life'} onClick={() => setDesk('life')}>
                Life
              </button>
              <button type="button" aria-pressed={desk === 'news'} onClick={() => setDesk('news')}>
                News
              </button>
              <button type="button" aria-pressed={desk === 'book'} onClick={() => setDesk('book')}>
                Day book
              </button>
              {import.meta.env.DEV ? (
                <button type="button" aria-pressed={desk === 'log'} onClick={() => setDesk('log')}>
                  Log
                </button>
              ) : null}
            </nav>
            <div className="subpanel-body">
              {desk === 'positions' ? <Positions game={run?.game ?? null} /> : null}
              {desk === 'life' ? (
                <div className="desk">
                  <JobPanel game={run?.game ?? null} />
                  <LifestylePanel game={run?.game ?? null} />
                  <LoanPanel game={run?.game ?? null} />
                  <Consumables game={run?.game ?? null} />
                  <FiMeter game={run?.game ?? null} />
                  <Accounts game={run?.game ?? null} />
                </div>
              ) : null}
              {desk === 'news' ? (
                <div className="desk">
                  <NewsFeed
                    key={`${market?.day ?? 'none'}-${market?.feed.day ?? 0}`}
                    feed={run === null ? null : viewedFeed(run.game)}
                    verified={run?.game.perception.verified ?? false}
                    job={run === null ? null : activeJob(run.game.job)}
                    newsReads={run?.game.stats.newsReads ?? 0}
                  />
                  <CalendarPanel market={market} />
                </div>
              ) : null}
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
        <aside className="ticket-rail">
          <OrderPanel game={run?.game ?? null} />
          <MarginMeter game={run?.game ?? null} />
        </aside>
      </div>
    </main>
  )
}
