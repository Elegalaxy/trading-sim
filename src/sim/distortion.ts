// Biased news for one day. Draws the distortion stream only when more candidates
// remain than the cap allows. It does not write the stored feed, the calendar,
// prices, events, or any other stream. The game calls it once at day start.

import { BIAS_CAP_PERCENT, BIAS_STRESS_CEILING, BIAS_STRESS_FLOOR } from './constants.ts'
import { nextInt } from './rng.ts'
import {
  DISTORTION_ACTIONS,
  type DayFeed,
  type DistortionAction,
  type DistortionEvent,
  type FeedItem,
  type HeadlineItem,
  type OpenPosition,
  type PerceptionState,
  type RngStream,
  type RumourItem,
  type ShownFeed,
  type ShownItem,
  type ShownNewsItem,
  type SocialPostDefinition,
  type SocialPostItem,
} from './types.ts'

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/
const EVENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*:([A-Za-z][A-Za-z0-9]*):[1-9][0-9]*$/
const UINT32_MAX = 0xffffffff

type Side = 'long' | 'short'
type Stance = 'favor' | 'oppose' | 'neutral'

type Row = {
  id: string
  text: string
  originalIndex: number
  stance: Stance
  item: FeedItem
}

type GenerateCandidate = {
  id: string
  asset: string
  direction: 'up' | 'down'
  post: SocialPostDefinition
  text: string
}

type BuiltRow = {
  id: string
  item: ShownItem
}

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`${label} must be an id token, received ${describeValue(value)}`)
  }
  return value
}

function assertLine(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be one non-empty line, received ${describeValue(value)}`)
  }
  return value
}

function assertStream(stream: RngStream): void {
  if (typeof stream !== 'object' || stream === null) {
    throw new Error(`distortion stream must be an object, received ${describeValue(stream)}`)
  }
  for (const key of ['a', 'b', 'c', 'd'] as const) {
    const value = stream[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
      throw new Error(`distortion stream ${key} must be an unsigned 32-bit integer, received ${describeValue(value)}`)
    }
  }
}

function copyHeadline(item: HeadlineItem, distorted: boolean): ShownNewsItem {
  return {
    kind: 'headline',
    eventId: item.eventId,
    text: item.text,
    magnitude: item.magnitude,
    top: item.top,
    distorted,
  }
}

function copyRumour(item: RumourItem, distorted: boolean): ShownNewsItem {
  return {
    kind: 'rumour',
    sourceId: item.sourceId,
    tier: item.tier,
    truthRoll: item.truthRoll,
    truth: item.truth,
    claim: item.claim,
    leadDays: item.leadDays,
    targetEventId: item.targetEventId,
    noise: item.noise,
    visibility: [...item.visibility],
    distorted,
  }
}

function copyNews(item: FeedItem, distorted: boolean): ShownNewsItem {
  if (item.kind === 'headline') return copyHeadline(item, distorted)
  return copyRumour(item, distorted)
}

/** The visible feed with nothing marked. Does not draw. */
export function undistortedFeed(feed: DayFeed): ShownFeed {
  assertVisibleFeed(feed)
  return {
    day: feed.day,
    items: feed.items.map((item) => copyNews(item, false)),
  }
}

function assertVisibleFeed(feed: DayFeed): void {
  if (typeof feed !== 'object' || feed === null || Array.isArray(feed)) {
    throw new Error(`shown feed expected a feed object, received ${describeValue(feed)}`)
  }
  if (!Number.isSafeInteger(feed.day) || feed.day < 1) {
    throw new Error(`shown feed day must be a safe integer >= 1, received ${describeValue(feed.day)}`)
  }
  if (!Array.isArray(feed.items)) {
    throw new Error(`shown feed items must be an array, received ${describeValue(feed.items)}`)
  }
  for (let index = 0; index < feed.items.length; index += 1) {
    const item = feed.items[index]
    if (typeof item !== 'object' || item === null) {
      throw new Error(`shown feed items[${index}] must be an object, received ${describeValue(item)}`)
    }
    const kind = item.kind
    if (kind === 'headline') {
      assertLine(item.text, `shown feed items[${index}] text`)
      assertLine(item.eventId, `shown feed items[${index}] eventId`)
      continue
    }
    if (kind === 'rumour') {
      assertLine(item.claim, `shown feed items[${index}] claim`)
      assertId(item.sourceId, `shown feed items[${index}] source`)
      assertLine(item.targetEventId, `shown feed items[${index}] target`)
      if (!Array.isArray(item.visibility)) {
        throw new Error(`shown feed items[${index}] visibility must be a list, received ${describeValue(item.visibility)}`)
      }
      continue
    }
    throw new Error(`shown feed items[${index}] kind must be headline or rumour, received ${describeValue(kind)}`)
  }
}

function copyPost(item: SocialPostDefinition, index: number): SocialPostDefinition {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    throw new Error(`social post[${index}] must be an object, received ${describeValue(item)}`)
  }
  const id = assertId(item.id, `social post[${index}] id`)
  const sourceId = assertId(item.sourceId, `social post ${id} source`)
  if (item.direction !== 'up' && item.direction !== 'down') {
    throw new Error(`social post ${id} direction must be up or down, received ${describeValue(item.direction)}`)
  }
  const text = assertLine(item.text, `social post ${id} text`)
  if (!text.includes('{asset}')) {
    throw new Error(`social post ${id} text must name {asset}, received ${JSON.stringify(text)}`)
  }
  return { id, sourceId, direction: item.direction, text }
}

/** Copy the post menu. Omitted means no generated posts. */
export function copySocialPosts(posts: readonly SocialPostDefinition[] | undefined): SocialPostDefinition[] {
  if (posts === undefined) return []
  if (!Array.isArray(posts)) {
    throw new Error(`social posts must be a list, received ${describeValue(posts)}`)
  }
  const catalog: SocialPostDefinition[] = []
  const seen = new Set<string>()
  for (let index = 0; index < posts.length; index += 1) {
    const post = copyPost(posts[index] as SocialPostDefinition, index)
    if (seen.has(post.id)) throw new Error(`social posts repeat ${post.id}`)
    seen.add(post.id)
    catalog.push(post)
  }
  return catalog
}

/**
 * How many visible items may be reweighted, hidden, or generated.
 * At or below stress 60 the cap is 0. At stress 100 it is 25% of the visible
 * items, rounded down. Between those, the share scales with stress.
 */
export function distortionCap(itemCount: number, stress: number): number {
  if (!Number.isSafeInteger(itemCount) || itemCount < 0) {
    throw new Error(`distortion item count must be a safe integer >= 0, received ${describeValue(itemCount)}`)
  }
  if (!Number.isSafeInteger(stress) || stress < 0 || stress > BIAS_STRESS_CEILING) {
    throw new Error(
      `distortion stress must be an integer from 0 to ${BIAS_STRESS_CEILING}, received ${describeValue(stress)}`,
    )
  }
  if (stress <= BIAS_STRESS_FLOOR) return 0
  const above = stress - BIAS_STRESS_FLOOR
  const span = BIAS_STRESS_CEILING - BIAS_STRESS_FLOOR
  const product = itemCount * BIAS_CAP_PERCENT * above
  if (!Number.isSafeInteger(product)) {
    throw new Error(`distortion cap overflowed, received count=${itemCount} stress=${stress}`)
  }
  return Math.floor(product / (span * 100))
}

function itemText(item: FeedItem): string {
  return item.kind === 'headline' ? item.text : item.claim
}

function itemTarget(item: FeedItem): string | null {
  const id = item.kind === 'headline' ? item.eventId : item.targetEventId
  const match = EVENT_ID_PATTERN.exec(id)
  return match?.[1] ?? null
}

function itemDirection(text: string): 'up' | 'down' | null {
  const up = /(?:^|[^A-Za-z])up(?:[^A-Za-z]|$)/.test(text)
  const down = /(?:^|[^A-Za-z])down(?:[^A-Za-z]|$)/.test(text)
  if (up === down) return null
  return up ? 'up' : 'down'
}

function openSides(positions: Readonly<Record<string, OpenPosition>>): Map<string, Side> {
  if (typeof positions !== 'object' || positions === null || Array.isArray(positions)) {
    throw new Error(`distortion positions must be an object, received ${describeValue(positions)}`)
  }
  const sides = new Map<string, Side>()
  const assets = Object.keys(positions).sort((left, right) => {
    if (left < right) return -1
    if (left > right) return 1
    return 0
  })
  for (const asset of assets) {
    const position = positions[asset]
    if (typeof position !== 'object' || position === null) {
      throw new Error(`position ${asset} must be an object, received ${describeValue(position)}`)
    }
    if (position.asset !== asset) {
      throw new Error(`position ${asset} asset must match its key, received ${describeValue(position.asset)}`)
    }
    if (!Number.isSafeInteger(position.signedShares) || position.signedShares === 0) {
      throw new Error(
        `position ${asset} shares must be a non-zero safe integer, received ${describeValue(position.signedShares)}`,
      )
    }
    sides.set(asset, position.signedShares > 0 ? 'long' : 'short')
  }
  return sides
}

function stanceFor(item: FeedItem, sides: ReadonlyMap<string, Side>): Stance {
  const asset = itemTarget(item)
  const direction = itemDirection(itemText(item))
  if (asset === null || direction === null) return 'neutral'
  const side = sides.get(asset)
  if (side === undefined) return 'neutral'
  const agrees = (side === 'long' && direction === 'up') || (side === 'short' && direction === 'down')
  return agrees ? 'favor' : 'oppose'
}

function renderPost(post: SocialPostDefinition, asset: string): string {
  const text = post.text.replaceAll('{asset}', asset)
  if (text.length === 0 || /[\r\n]/.test(text) || text.includes('{asset}')) {
    throw new Error(`social post ${post.id} did not render for ${asset}, received ${JSON.stringify(text)}`)
  }
  return text
}

/**
 * Keep `count` candidates. When every candidate fits, the stream is not drawn.
 * A smaller cap draws the distortion stream and then restores definition order.
 */
function takeSome<T>(stream: RngStream, items: readonly T[], count: number, key: (item: T) => string): T[] {
  if (count <= 0 || items.length === 0) return []
  if (count >= items.length) return items.slice()
  const bag = items.slice()
  for (let index = 0; index < count; index += 1) {
    const pick = nextInt(stream, index, bag.length - 1)
    const chosen = bag[pick]
    const current = bag[index]
    if (chosen === undefined || current === undefined) throw new Error('distortion pick lost a candidate')
    bag[index] = chosen
    bag[pick] = current
  }
  const picked = new Set(bag.slice(0, count).map(key))
  return items.filter((item) => picked.has(key(item)))
}

function socialItem(candidate: GenerateCandidate): SocialPostItem {
  return {
    kind: 'social',
    id: candidate.id,
    sourceId: candidate.post.sourceId,
    tier: 'low',
    text: candidate.text,
    asset: candidate.asset,
    direction: candidate.direction,
    distorted: true,
  }
}

export type ShownFeedResult = {
  feed: ShownFeed
  events: DistortionEvent[]
}

/**
 * Build the feed the player sees.
 * A long promotes bullish items on that asset and hides bearish ones. A short does the reverse.
 * Slots are spent on promotion, then hiding, then a generated post, and never past the cap.
 * `day` is the played day stamped on each log line. The visible feed itself is not changed.
 */
export function shownFeed(
  visibleFeed: DayFeed,
  positions: Readonly<Record<string, OpenPosition>>,
  stress: number,
  distortionStream: RngStream,
  posts: readonly SocialPostDefinition[] = [],
  day = visibleFeed.day,
): ShownFeedResult {
  assertVisibleFeed(visibleFeed)
  assertStream(distortionStream)
  const catalog = copySocialPosts(posts)
  const sides = openSides(positions)
  if (!Number.isSafeInteger(day) || day < 0) {
    throw new Error(`distortion day must be a safe integer >= 0, received ${describeValue(day)}`)
  }
  const cap = distortionCap(visibleFeed.items.length, stress)
  const plain = undistortedFeed(visibleFeed)
  if (cap === 0 || sides.size === 0) return { feed: plain, events: [] }

  const rows: Row[] = visibleFeed.items.map((item, index) => ({
    id: item.kind === 'headline' ? `headline:${index}:${item.eventId}` : `rumour:${index}:${item.sourceId}:${item.targetEventId}`,
    text: itemText(item),
    originalIndex: index,
    stance: stanceFor(item, sides),
    item,
  }))
  const reweightCandidates = rows.filter((row) => row.stance === 'favor' && row.originalIndex > 0)
  const hideCandidates = rows.filter((row) => row.stance === 'oppose')
  const generateCandidates: GenerateCandidate[] = []
  for (const [asset, side] of sides) {
    const direction = side === 'long' ? 'up' : 'down'
    for (const post of catalog) {
      if (post.direction !== direction) continue
      generateCandidates.push({
        id: `social:${post.id}:${asset}`,
        asset,
        direction,
        post,
        text: renderPost(post, asset),
      })
    }
  }

  let remaining = cap
  const reweights = takeSome(distortionStream, reweightCandidates, remaining, (row) => row.id)
  remaining -= reweights.length
  const hides = takeSome(distortionStream, hideCandidates, remaining, (row) => row.id)
  remaining -= hides.length
  const generated = takeSome(distortionStream, generateCandidates, remaining, (row) => row.id)

  const hidden = new Set(hides.map((row) => row.id))
  const promoted = new Set(reweights.map((row) => row.id))
  const built: BuiltRow[] = []
  for (const row of rows) {
    if (hidden.has(row.id)) continue
    built.push({ id: row.id, item: copyNews(row.item, promoted.has(row.id)) })
  }
  const moveOrder = [...reweights].sort((left, right) => right.originalIndex - left.originalIndex)
  for (const row of moveOrder) {
    const index = built.findIndex((entry) => entry.id === row.id)
    if (index <= 0) continue
    const [entry] = built.splice(index, 1)
    if (entry === undefined) throw new Error(`distortion lost promoted item ${row.id}`)
    built.unshift(entry)
  }
  for (const candidate of generated) {
    built.push({ id: candidate.id, item: socialItem(candidate) })
  }

  const shownIndex = new Map(built.map((entry, index) => [entry.id, index]))
  const events: DistortionEvent[] = []
  for (const row of reweights) {
    const index = shownIndex.get(row.id)
    if (index === undefined) throw new Error(`distortion lost the shown index for ${row.id}`)
    events.push({
      kind: 'distortion',
      day,
      item: row.id,
      action: 'reweight',
      trueValue: `${row.originalIndex}:${row.text}`,
      shownValue: `${index}:${row.text}`,
    })
  }
  for (const row of hides) {
    events.push({
      kind: 'distortion',
      day,
      item: row.id,
      action: 'hide',
      trueValue: row.text,
      shownValue: 'hidden',
    })
  }
  for (const candidate of generated) {
    events.push({
      kind: 'distortion',
      day,
      item: candidate.id,
      action: 'generate',
      trueValue: 'absent',
      shownValue: candidate.text,
    })
  }
  if (events.length > cap) {
    throw new Error(`distortion used ${events.length} items and the cap is ${cap}`)
  }
  return { feed: { day: visibleFeed.day, items: built.map((entry) => entry.item) }, events }
}

function isAction(value: unknown): value is DistortionAction {
  return typeof value === 'string' && (DISTORTION_ACTIONS as readonly string[]).includes(value)
}

/** A broken perception is a broken day. The market feed is checked separately. */
export function assertPerception(perception: PerceptionState, marketDay: number, feedDay: number): void {
  if (typeof perception !== 'object' || perception === null || Array.isArray(perception)) {
    throw new Error(`perception must be an object, received ${describeValue(perception)}`)
  }
  if (perception.day !== marketDay) {
    throw new Error(`perception day must be ${marketDay}, received ${describeValue(perception.day)}`)
  }
  if (perception.verified !== true && perception.verified !== false) {
    throw new Error(`perception verified must be boolean, received ${describeValue(perception.verified)}`)
  }
  const shown = perception.shown
  if (typeof shown !== 'object' || shown === null || shown.day !== feedDay || !Array.isArray(shown.items)) {
    throw new Error(`perception shown feed must be day ${feedDay}, received ${describeValue(shown)}`)
  }
  if (!Array.isArray(perception.events)) {
    throw new Error(`perception events must be a list, received ${describeValue(perception.events)}`)
  }
  for (let index = 0; index < perception.events.length; index += 1) {
    const event = perception.events[index]
    if (typeof event !== 'object' || event === null || event.kind !== 'distortion') {
      throw new Error(`perception events[${index}] must be a distortion, received ${describeValue(event)}`)
    }
    if (event.day !== marketDay) {
      throw new Error(`perception events[${index}] day must be ${marketDay}, received ${describeValue(event.day)}`)
    }
    assertLine(event.item, `perception events[${index}] item`)
    if (!isAction(event.action)) {
      throw new Error(
        `perception events[${index}] action must be reweight, hide, or generate, received ${describeValue(event.action)}`,
      )
    }
    if (typeof event.trueValue !== 'string' || /[\r\n]/.test(event.trueValue)) {
      throw new Error(`perception events[${index}] true value must be one line, received ${describeValue(event.trueValue)}`)
    }
    assertLine(event.shownValue, `perception events[${index}] shown value`)
  }
}
