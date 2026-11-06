import { useState } from 'react'
import { INFO_FREE_READ_TIER, INFO_FREE_VERIFY_TIER, VERIFY_ENERGY_COST, VERIFY_RESEARCH_COST } from '../sim/constants.ts'
import { shownPosts } from '../sim/social.ts'
import { NEWS_READ_ENERGY_COST } from '../sim/stats.ts'
import type { HeadlineItem, JobDefinition, ShownFeed, ShownItem } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { blurFilter, useCosmeticFx, useDelayedValue } from './effects.ts'
import { jobNameOf, openNotice } from './employer.ts'
import { dispatch, useTradingStore } from './store.ts'

/** A headline is a fact about today. A report or post is a rumour with a source and a reliability tier. */
function tagText(item: ShownItem): string {
  if (item.kind === 'headline') return 'Headline'
  return item.kind === 'social' ? `Post · ${item.tier}` : `Rumour · ${item.tier}`
}

function bodyText(item: ShownItem): string {
  if (item.kind === 'headline') return item.text
  if (item.kind === 'social') return `${item.text} (${item.sourceId})`
  return `${item.claim} (${item.sourceId})`
}

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
  const game = useTradingStore().run?.game ?? null
  const energy = game?.stats.energy ?? null
  const points = game?.study.points ?? 0
  const fx = useCosmeticFx(energy, game?.lifestyle.equipment ?? 0)
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
  // Pinned and unbent: the employer notice is not part of the market feed, so stress never touches it.
  const notice = game === null ? null : openNotice(game)
  const employerText =
    game === null || notice === null
      ? null
      : notice.stage === 'confirmed'
        ? `${jobNameOf(game, notice.jobId)} confirmed job cuts. Last day: day ${notice.layoffDay}.`
        : `Rumour of job cuts at ${jobNameOf(game, notice.jobId)}. Decision on day ${notice.decisionDay}.`
  const posts = game === null ? [] : shownPosts(game)
  // The feed is fixed for the day, so one read shows all of it. A read already paid for stays open.
  const readToday = newsReads > 0
  const listOpen = open || readToday
  const feedTier = game?.lifestyle.infoFeed ?? 0
  const free = (job?.perk === 'quietBreaks' || feedTier >= INFO_FREE_READ_TIER) && newsReads === 0
  const verifyEnergy = feedTier >= INFO_FREE_VERIFY_TIER ? 0 : VERIFY_ENERGY_COST
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
      setError(
        reason === 'runEnded'
          ? 'The run has ended.'
          : reason === 'noResearch'
            ? 'No research points. Research in your free time to earn them.'
            : reason,
      )
      return
    }
    setError(null)
    setOpen(true)
  }

  return (
    <section className="panel">
      <h2>News</h2>
      {employerText === null ? null : (
        <p className={notice?.stage === 'confirmed' ? 'employer-news employer-news-confirmed' : 'employer-news'} role="status">
          <span className="feed-tag feed-employer">Employer</span> {employerText}
        </p>
      )}
      <div style={blurStyle}>
        <p>Day {shownFeed.day} headline</p>
        {/* Stress-bent items carry no mark (user decision 2026-11-03). The screen edge and the
            meters show the state, Verify shows the true feed, and the day report counts them. */}
        <p>{top === undefined ? 'No headline' : itemText(top)}</p>
      </div>
      <p>
        {free ? 'The first read is free.' : `Reading costs ${NEWS_READ_ENERGY_COST} energy.`}{' '}
        {verifyEnergy === 0
          ? `Verifying costs ${VERIFY_RESEARCH_COST} research point and no energy.`
          : `Verifying costs ${verifyEnergy} energy and ${VERIFY_RESEARCH_COST} research point.`}
      </p>
      <div className="news-actions">
        <button type="button" onClick={onRead} disabled={readToday}>
          {readToday ? 'Read' : 'Read news'}
        </button>
        <button
          type="button"
          onClick={onVerify}
          disabled={verified || points < VERIFY_RESEARCH_COST}
          title={points < VERIFY_RESEARCH_COST ? 'No research points. Research in your free time to earn them.' : undefined}
        >
          {verified ? 'Verified' : `Verify (${points} pts)`}
        </button>
      </div>
      {error !== null ? <p role="alert">{error}</p> : null}
      <div style={blurStyle}>
        {shownVerified ? <p>Showing today&apos;s true feed.</p> : null}
        {listOpen ? (
          shownFeed.items.length === 0 ? (
            <p>The visible feed is empty.</p>
          ) : (
            <ul>
              {shownFeed.items.map((item, index) => (
                <li key={`${item.kind}-${index}`}>
                  <span className={`feed-tag feed-${item.kind}`}>{tagText(item)}</span> {bodyText(item)}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
      {posts.length === 0 ? null : (
        <div className="social-feed" style={blurStyle}>
          <h3>Posts</h3>
          <ul>
            {posts.map((item) => (
              <li key={item.post.id}>
                <span className="feed-tag feed-social">{item.post.time === null ? 'Post' : `Post ${item.post.time}`}</span> {item.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
