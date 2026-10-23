import { useState, type FormEvent } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { CalendarPanel } from './CalendarPanel.tsx'
import { DaySummaryPanel } from './DaySummary.tsx'
import { NewsFeed } from './NewsFeed.tsx'
import { PriceChart, type ChartPoint } from './PriceChart.tsx'
import { defaultSeed, endDay, startGame, useTradingStore } from './store.ts'

export function Dashboard() {
  const snapshot = useTradingStore()
  const run = snapshot.run
  const assets = MARKET_DEFINITIONS.assets
  const [seed, setSeed] = useState(defaultSeed)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [asset, setAsset] = useState(assets[0]?.id ?? 'NOVA')

  function onStart(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setSeedError(startGame(seed))
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
        {seedError !== null ? <p role="alert">{seedError}</p> : null}
      </form>

      <section className="panel">
        <button type="button" onClick={() => endDay()} disabled={run === null}>
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
      <NewsFeed key={market?.feed.day ?? 0} feed={market?.feed ?? null} />
      <DaySummaryPanel summary={run?.summary ?? null} />
    </main>
  )
}
