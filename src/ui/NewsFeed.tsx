import { useState } from 'react'
import { playerVisibleFeed } from '../sim/lifestyle.ts'
import { NEWS_READ_ENERGY_COST } from '../sim/stats.ts'
import type { DayFeed, FeedItem, HeadlineItem, JobDefinition, LifestyleState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { dispatch } from './store.ts'

function itemText(item: FeedItem): string {
  if (item.kind === 'headline') return item.text
  return `${item.claim} (${item.sourceId}, ${item.tier})`
}

export function NewsFeed({
  feed,
  job,
  lifestyle,
  newsReads,
}: {
  feed: DayFeed | null
  job: JobDefinition | null
  lifestyle: LifestyleState | null
  newsReads: number
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (feed === null) {
    return (
      <section className="panel">
        <h2>News</h2>
        <p>Start a game to read the feed.</p>
      </section>
    )
  }

  const visible = playerVisibleFeed(feed, job, lifestyle ?? { home: 0, infoFeed: 0 })
  const top = visible.items.find((item): item is HeadlineItem => item.kind === 'headline' && item.top)
  const free = job?.perk === 'quietBreaks' && newsReads === 0

  function onRead(): void {
    debugLog('[ui]', 'readNews')
    const outcome = dispatch({ type: 'readNews' })
    if (!outcome.accepted) {
      const reason = outcome.reason ?? 'rejected'
      console.error(`[ui] rejected readNews: ${reason}`)
      setError(reason === 'runEnded' ? 'The run has ended.' : reason)
      return
    }
    setError(null)
    setOpen(true)
  }

  return (
    <section className="panel">
      <h2>News</h2>
      <p>Day {visible.day} headline</p>
      <p>{top === undefined ? 'No headline' : top.text}</p>
      <p>{free ? 'The first read today is free.' : `Reading costs ${NEWS_READ_ENERGY_COST} energy.`}</p>
      <button type="button" onClick={onRead}>
        Read news
      </button>
      {error !== null ? <p role="alert">{error}</p> : null}
      {open ? (
        visible.items.length === 0 ? (
          <p>The visible feed is empty.</p>
        ) : (
          <ul>
            {visible.items.map((item, index) => (
              <li key={`${item.kind}-${index}`}>{itemText(item)}</li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  )
}
