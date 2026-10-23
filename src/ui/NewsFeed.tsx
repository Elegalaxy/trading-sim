import { useState } from 'react'
import { VERIFY_ENERGY_COST } from '../sim/constants.ts'
import { NEWS_READ_ENERGY_COST } from '../sim/stats.ts'
import type { HeadlineItem, JobDefinition, ShownFeed, ShownItem } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { blurFilter, useCosmeticFx, useDelayedValue } from './effects.ts'
import { dispatch, useTradingStore } from './store.ts'
import { Tell } from './Tell.tsx'

function itemText(item: ShownItem): string {
  if (item.kind === 'headline') return item.text
  if (item.kind === 'social') return `${item.text} (${item.sourceId}, ${item.tier})`
  return `${item.claim} (${item.sourceId}, ${item.tier})`
}

type FeedSnapshot = {
  feed: ShownFeed
  verified: boolean
}

function feedSignature(feed: ShownFeed, verified: boolean): string {
  const items = feed.items.map((item, index) => {
    if (item.kind === 'headline') {
      return `h${index}:${item.distorted ? 1 : 0}:${item.top ? 1 : 0}:${item.eventId}:${item.text}`
    }
    if (item.kind === 'social') return `s${index}:${item.id}:${item.asset}:${item.text}`
    return `r${index}:${item.distorted ? 1 : 0}:${item.noise ? 1 : 0}:${item.sourceId}:${item.claim}`
  })
  return `${verified ? 'v' : 's'}:${feed.day}:${items.join('\n')}`
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
  const energy = useTradingStore().run?.game.stats.energy ?? null
  const fx = useCosmeticFx(energy)
  const live = feed === null ? null : { feed, verified }
  const signature = live === null ? 'none' : feedSignature(live.feed, live.verified)
  const delayed = useDelayedValue<FeedSnapshot | null>('news-feed', live, fx.delayMs, signature)
  const shownFeed = delayed === null ? feed : delayed.feed
  const shownVerified = delayed === null ? verified : delayed.verified
  if (feed === null || shownFeed === null) {
    return (
      <section className="panel">
        <h2>News</h2>
        <p>Start a game to read the feed.</p>
      </section>
    )
  }

  const top = topHeadline(shownFeed.items)
  const free = job?.perk === 'quietBreaks' && newsReads === 0
  const filter = blurFilter(fx.blurPx)
  const blurStyle = filter === undefined ? undefined : { filter }

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
      <h2>
        {fx.tell ? <Tell /> : null}
        News
      </h2>
      <div style={blurStyle}>
        <p>Day {shownFeed.day} headline</p>
        <p className={top?.distorted === true ? 'distorted' : undefined}>
          {top?.distorted === true ? <Tell /> : null}
          {top === undefined ? 'No headline' : itemText(top)}
        </p>
      </div>
      <p>{free ? 'The first read today is free.' : `Reading costs ${NEWS_READ_ENERGY_COST} energy.`}</p>
      <p>{`Verifying costs ${VERIFY_ENERGY_COST} energy.`}</p>
      <button type="button" onClick={onRead}>
        Read news
      </button>
      <button type="button" onClick={onVerify} disabled={verified}>
        {verified ? 'Verified' : 'Verify'}
      </button>
      {error !== null ? <p role="alert">{error}</p> : null}
      <div style={blurStyle}>
        {shownVerified ? <p>Showing today&apos;s true feed.</p> : null}
        {open ? (
          shownFeed.items.length === 0 ? (
            <p>The visible feed is empty.</p>
          ) : (
            <ul>
              {shownFeed.items.map((item, index) => (
                <li key={`${item.kind}-${index}`} className={item.distorted ? 'distorted' : undefined}>
                  {item.distorted ? <Tell /> : null}
                  {itemText(item)}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </section>
  )
}
