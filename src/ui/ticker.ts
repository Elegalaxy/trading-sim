// The headline ticker's content and rotation rules. Pure: no React, no clock.
// Market items come from the same shown feed the News panel reads (`viewedFeed`), so stress
// distortion reaches the ticker exactly as it reaches the panel: there is no second truth path.
// Calendar rows use the same data as the Calendar panel. The employer notice is pinned first and
// reads the stage only, never `notice.real`. Employer and calendar items are never distorted.

import { outcomeWord } from '../sim/calendar.ts'
import { viewedFeed } from '../sim/game.ts'
import type { CalendarItemKind, GameState, ShownFeed, ShownItem } from '../sim/types.ts'
import { playerCalendar } from './days.ts'
import { noticeLine, openNotice } from './employer.ts'

export type TickerSource = 'news' | 'calendar' | 'employer'
export type TickerTarget = 'news' | 'calendar' | 'job'

export type TickerItem = {
  id: string
  source: TickerSource
  /** Chip text. Source is always named, never colour alone. */
  label: string
  text: string
  target: TickerTarget
  /** Employer items only: rumour is amber, confirmed is red. */
  tone: 'rumour' | 'confirmed' | null
}

export const TICKER_CALENDAR_DAYS = 14
export const TICKER_INTERVAL_MS = 5000

const CALENDAR_LABELS: Record<CalendarItemKind, string> = {
  growthRelease: 'Growth release',
  inflationRelease: 'Inflation release',
  policyDecision: 'Policy rate',
}

/** The text the News panel shows for one feed item (same wording as NewsFeed's list). */
export function newsItemText(item: ShownItem): string {
  if (item.kind === 'headline') return item.text
  if (item.kind === 'social') return `${item.text} (${item.sourceId})`
  return `${item.claim} (${item.sourceId})`
}

/**
 * The feed items the News panel shows: its list when the day's news was read, else only the top
 * headline (the flagged one, or the first headline).
 */
export function visibleNewsItems(feed: ShownFeed, newsReads: number): ShownItem[] {
  if (newsReads > 0) return feed.items
  const top =
    feed.items.find((item) => item.kind === 'headline' && item.top) ?? feed.items.find((item) => item.kind === 'headline')
  return top === undefined ? [] : [top]
}

/** Ticker headlines in order: employer notice, market news, calendar. */
export function buildTicker(game: GameState | null): TickerItem[] {
  if (game === null || game.runEnd !== null) return []
  const items: TickerItem[] = []
  const notice = openNotice(game)
  if (notice !== null) {
    items.push({
      id: `employer-${notice.stage}-${notice.jobId}`,
      source: 'employer',
      label: 'Employer',
      text: noticeLine(game, notice),
      target: 'job',
      tone: notice.stage === 'confirmed' ? 'confirmed' : 'rumour',
    })
  }
  const feed = viewedFeed(game)
  visibleNewsItems(feed, game.stats.newsReads).forEach((item, index) => {
    items.push({ id: `news-${feed.day}-${index}`, source: 'news', label: 'News', text: newsItemText(item), target: 'news', tone: null })
  })
  for (const row of playerCalendar(game.market, TICKER_CALENDAR_DAYS)) {
    const expected = row.expected === undefined ? '' : ` — expected: ${outcomeWord(row.kind, row.expected)}`
    const result = row.outcome === undefined ? '' : ` — result: ${outcomeWord(row.kind, row.outcome)}`
    items.push({
      id: `calendar-${row.kind}-${row.day}`,
      source: 'calendar',
      label: 'Calendar',
      text: `Day ${row.day}: ${CALENDAR_LABELS[row.kind]}${expected}${result}`,
      target: 'calendar',
      tone: null,
    })
  }
  return items
}

/** Step the index with wrap-around. An empty list always gives 0. */
export function stepIndex(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0
  return (((index + direction) % count) + count) % count
}

/** Keep an index valid after the list changed length. */
export function clampIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isInteger(index) || index < 0) return 0
  return Math.min(index, count - 1)
}
