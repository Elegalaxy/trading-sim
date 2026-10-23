import { useState } from 'react'
import { VERIFY_ENERGY_COST } from '../sim/constants.ts'
import { NEWS_READ_ENERGY_COST } from '../sim/stats.ts'
import type { HeadlineItem, JobDefinition, ShownFeed, ShownItem } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { dispatch } from './store.ts'
import { Tell } from './Tell.tsx'

function itemText(item: ShownItem): string {
  if (item.kind === 'headline') return item.text
  if (item.kind === 'social') return `${item.text} (${item.sourceId}, ${item.tier})`
  return `${item.claim} (${item.sourceId}, ${item.tier})`
}

function topHeadline(items: readonly ShownItem[]): ShownItem | undefined {
  const flagged = items.find((item): item is HeadlineItem & { distorted: boolean } => item.kind === 'headline' && item.top)
  if (flagged !== undefined) return flagged
  return items.find((item) => item.kind === 'headline')
}

export function NewsFeed({
  feed,
  verified,
  job,
  newsReads,
}: {
  feed: ShownFeed | null
  verified: boolean
  job: JobDefinition | null
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

  const top = topHeadline(feed.items)
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

  function onVerify(): void {
    debugLog('[ui]', 'verify')
    const outcome = dispatch({ type: 'verify' })
    if (!outcome.accepted) {
      const reason = outcome.reason ?? 'rejected'
      console.error(`[ui] rejected verify: ${reason}`)
      setError(reason === 'runEnded' ? 'The run has ended.' : reason)
      return
    }
    setError(null)
    setOpen(true)
  }

  return (
    <section className="panel">
      <h2>News</h2>
      <p>Day {feed.day} headline</p>
      <p className={top?.distorted === true ? 'distorted' : undefined}>
        {top?.distorted === true ? <Tell /> : null}
        {top === undefined ? 'No headline' : itemText(top)}
      </p>
      <p>{free ? 'The first read today is free.' : `Reading costs ${NEWS_READ_ENERGY_COST} energy.`}</p>
      <p>{`Verifying costs ${VERIFY_ENERGY_COST} energy.`}</p>
      <button type="button" onClick={onRead}>
        Read news
      </button>
      <button type="button" onClick={onVerify} disabled={verified}>
        {verified ? 'Verified' : 'Verify'}
      </button>
      {verified ? <p>Showing today&apos;s true feed.</p> : null}
      {error !== null ? <p role="alert">{error}</p> : null}
      {open ? (
        feed.items.length === 0 ? (
          <p>The visible feed is empty.</p>
        ) : (
          <ul>
            {feed.items.map((item, index) => (
              <li key={`${item.kind}-${index}`} className={item.distorted ? 'distorted' : undefined}>
                {item.distorted ? <Tell /> : null}
                {itemText(item)}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  )
}
