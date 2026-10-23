import { useState } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { activeJob } from '../sim/jobs.ts'
import { viewedFeed } from '../sim/game.ts'
import { Accounts } from './Accounts.tsx'
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
import { endDay, useTradingStore } from './store.ts'

export function Dashboard() {
  const snapshot = useTradingStore()
  const run = snapshot.run
  const assets = MARKET_DEFINITIONS.assets
  const [asset, setAsset] = useState(assets[0]?.id ?? 'NOVA')

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
  const latest = run?.closes[run.closes.length - 1]

  return (
    <main className="dashboard">
      <header>
        <h1>Trading Sim</h1>
        <p>{run === null ? 'No run yet.' : `Seed ${run.seed}. Day ${run.game.market.day}.`}</p>
      </header>

      <StatMeters game={run?.game ?? null} />
      <DayTimeline game={run?.game ?? null} />
      <JobPanel game={run?.game ?? null} />
      <LifestylePanel game={run?.game ?? null} />
      {run !== null ? <RunEnd seed={run.seed} game={run.game} /> : null}
      <BillBanner game={run?.game ?? null} />
      <LoanPanel game={run?.game ?? null} />
      <FiMeter game={run?.game ?? null} />

      <section className="panel">
        <button
          type="button"
          onClick={() => endDay()}
          disabled={run === null || run.game.bill !== null || run.game.runEnd !== null}
          title={
            run?.game.runEnd !== null
              ? 'The run has ended.'
              : run?.game.bill !== null
                ? 'Pay the bill before ending the day.'
                : undefined
          }
        >
          End day
        </button>
        {latest === undefined ? (
          <p>No closes yet.</p>
        ) : (
          <p>
            Day {latest.day}:{' '}
            {assets
              .map((item) => {
                const price = latest.prices[item.id]
                return `${item.id}=${price ?? 'missing'}`
              })
              .join(' ')}
          </p>
        )}
      </section>

      <Accounts game={run?.game ?? null} />
      <Consumables game={run?.game ?? null} />
      <MarginMeter game={run?.game ?? null} />
      <OrderPanel game={run?.game ?? null} />
      <Positions game={run?.game ?? null} />

      <section className="panel">
        <label htmlFor="asset">
          Asset{' '}
          <select id="asset" value={asset} onChange={(event) => onAsset(event.target.value)}>
            {assets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
        </label>
        <PriceChart asset={asset} points={points} />
      </section>

      <CalendarPanel market={market} />
      <NewsFeed
        key={`${market?.day ?? 'none'}-${market?.feed.day ?? 0}`}
        feed={run === null ? null : viewedFeed(run.game)}
        verified={run?.game.perception.verified ?? false}
        job={run === null ? null : activeJob(run.game.job)}
        newsReads={run?.game.stats.newsReads ?? 0}
      />
      <DaySummaryPanel
        summary={run?.summary ?? null}
        liquidations={run?.liquidations ?? []}
        forcedSales={run?.forcedSales ?? []}
      />
    </main>
  )
}
