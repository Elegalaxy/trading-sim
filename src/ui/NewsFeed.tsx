import { useState } from 'react'
import { visibleFeed } from '../sim/feed.ts'
import { jobVisibleFeed } from '../sim/jobs.ts'
import type { DayFeed, FeedItem, HeadlineItem, JobDefinition } from '../sim/types.ts'

function itemText(item: FeedItem): string {
  if (item.kind === 'headline') return item.text
  return `${item.claim} (${item.sourceId}, ${item.tier})`
}

export function NewsFeed({ feed, job }: { feed: DayFeed | null; job: JobDefinition | null }) {
  const [open, setOpen] = useState(false)
  if (feed === null) {
    return (
      <section className="panel">
        <h2>News</h2>
        <p>Start a game to read the feed.</p>
      </section>
    )
  }

  const visible = job === null ? visibleFeed(feed, ['base']) : jobVisibleFeed(feed, job)
  const top = visible.items.find((item): item is HeadlineItem => item.kind === 'headline' && item.top)

  return (
    <section className="panel">
      <h2>News</h2>
      <p>Day {visible.day} headline</p>
      <p>{top === undefined ? 'No headline' : top.text}</p>
      <button type="button" onClick={() => setOpen(true)}>
        Read news
      </button>
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
