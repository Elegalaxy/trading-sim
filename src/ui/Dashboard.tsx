import { useState, type FormEvent } from 'react'
import { JOB_DEFINITIONS, MARKET_DEFINITIONS } from '../content/index.ts'
import { activeJob } from '../sim/jobs.ts'
import type { JobDefinition } from '../sim/types.ts'
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
import { defaultSeed, endDay, startGame, useTradingStore } from './store.ts'

function startingJobLabel(job: JobDefinition): string {
  if (job.requirement === 'none') return job.name
  const course = job.requirement === 'basic' ? 'Basic' : 'Finance'
  return `${job.name} (locked, needs ${course})`
}

export function Dashboard() {
  const snapshot = useTradingStore()
  const run = snapshot.run
  const assets = MARKET_DEFINITIONS.assets
  const [seed, setSeed] = useState(defaultSeed)
  const [jobId, setJobId] = useState('jobless')
  const [seedError, setSeedError] = useState<string | null>(null)
  const [asset, setAsset] = useState(assets[0]?.id ?? 'NOVA')

  function onStart(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setSeedError(startGame(seed, jobId))
  }

  function onStartingJob(value: string): void {
    const job = JOB_DEFINITIONS.find((item) => item.id === value)
    if (job === undefined) {
      console.error(`[ui] rejected starting job ${JSON.stringify(value)}`)
      return
    }
    if (job.requirement !== 'none') {
      console.error(`[ui] rejected starting job ${job.id}: locked`)
      return
    }
    setJobId(value)
  }

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
        <p>
          {run === null
            ? 'Choose a seed and press Start. Days do not advance until then.'
            : `Seed ${run.seed}. Day ${run.game.market.day}.`}
        </p>
      </header>

      <form className="panel seed-form" onSubmit={onStart}>
        <label htmlFor="seed">
          Seed{' '}
          <input
            id="seed"
            value={seed}
            maxLength={32}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setSeed(event.target.value)}
          />
        </label>
        <button type="submit">Start</button>
        <label htmlFor="starting-job">
          Starting job{' '}
          <select id="starting-job" value={jobId} onChange={(event) => onStartingJob(event.target.value)}>
            {JOB_DEFINITIONS.map((job) => (
              <option key={job.id} value={job.id} disabled={job.requirement !== 'none'}>
                {startingJobLabel(job)}
              </option>
            ))}
          </select>
        </label>
        {seedError !== null ? <p role="alert">{seedError}</p> : null}
      </form>

      <StatMeters game={run?.game ?? null} />
      <DayTimeline game={run?.game ?? null} />
      <JobPanel game={run?.game ?? null} />
      {run !== null ? <RunEnd seed={run.seed} game={run.game} /> : null}
      <BillBanner game={run?.game ?? null} />
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
        key={market?.feed.day ?? 0}
        feed={market?.feed ?? null}
        job={run === null ? null : activeJob(run.game.job)}
        newsReads={run?.game.stats.newsReads ?? 0}
      />
      <DaySummaryPanel summary={run?.summary ?? null} liquidations={run?.liquidations ?? []} />
    </main>
  )
}
