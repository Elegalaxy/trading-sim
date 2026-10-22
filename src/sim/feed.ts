// Day-ahead feed. Draws only the info stream, and only when generating rumours.
// Headlines are copied from events that already fired. They do not draw.
// `visibleFeed` does not draw and does not mutate the stored feed.

import {
  EVENT_LOOKAHEAD_DAYS,
  RUMOUR_LEAD_MAX_DAYS,
  RUMOUR_LEAD_MIN_DAYS,
  RUMOURS_PER_SOURCE_PER_DAY,
} from './constants.ts'
import { nextFloat, nextInt } from './rng.ts'
import {
  SOURCE_TIERS,
  VISIBILITY_REQUIREMENTS,
  type DayFeed,
  type EventDirection,
  type HeadlineEvent,
  type HeadlineItem,
  type MarketDefinitions,
  type MarketState,
  type RumourGeneratedEvent,
  type RumourItem,
  type ScheduledEvent,
  type SourceDefinition,
  type SourceTier,
  type VisibilityRequirement,
} from './types.ts'

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/
const EVENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?::[A-Za-z][A-Za-z0-9]*)+:[1-9][0-9]*$/

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

function isTier(value: string): value is SourceTier {
  return (SOURCE_TIERS as readonly string[]).includes(value)
}

function isRequirement(value: string): value is VisibilityRequirement {
  return (VISIBILITY_REQUIREMENTS as readonly string[]).includes(value)
}

/** An event that fired today and should become a headline. Direction `none` is not one of these. */
export type FiredHeadline = {
  eventId: string
  text: string
  magnitude: number
}

type FalseSlot = {
  eventId: string
  eventDay: number
  claim: string
}

function assertHeadline(fired: FiredHeadline, index: number): void {
  if (typeof fired !== 'object' || fired === null || Array.isArray(fired)) {
    throw new Error(`fired headline[${index}] must be an object, received ${describeValue(fired)}`)
  }
  if (typeof fired.eventId !== 'string' || !EVENT_ID_PATTERN.test(fired.eventId)) {
    throw new Error(
      `fired headline[${index}] eventId must be type:target:day, received ${describeValue(fired.eventId)}`,
    )
  }
  if (typeof fired.text !== 'string' || fired.text.length === 0 || /[\r\n]/.test(fired.text)) {
    throw new Error(`fired headline[${index}] text must be one non-empty line, received ${describeValue(fired.text)}`)
  }
  if (typeof fired.magnitude !== 'number' || !Number.isFinite(fired.magnitude) || fired.magnitude < 0) {
    throw new Error(
      `fired headline[${index}] magnitude must be a finite number >= 0, received ${describeValue(fired.magnitude)}`,
    )
  }
}

/** Headlines in input order. The first largest magnitude is the top headline. */
export function buildHeadlines(fired: readonly FiredHeadline[]): HeadlineItem[] {
  if (!Array.isArray(fired)) {
    throw new Error(`fired headlines must be an array, received ${describeValue(fired)}`)
  }
  let topIndex = -1
  let topMagnitude = -1
  for (let i = 0; i < fired.length; i += 1) {
    const item = fired[i]
    if (item === undefined) throw new Error(`fired headline[${i}] is missing`)
    assertHeadline(item, i)
    if (topIndex === -1 || item.magnitude > topMagnitude) {
      topIndex = i
      topMagnitude = item.magnitude
    }
  }
  return fired.map((item, index) => ({
    kind: 'headline',
    eventId: item.eventId,
    text: item.text,
    magnitude: item.magnitude,
    top: index === topIndex,
  }))
}

export function assertFeedDefinitions(defs: MarketDefinitions): void {
  if (defs.sources === undefined) return
  if (!Array.isArray(defs.sources)) {
    throw new Error(`source definitions must be an array, received ${describeValue(defs.sources)}`)
  }
  const seen = new Set<string>()
  for (let i = 0; i < defs.sources.length; i += 1) {
    const source = defs.sources[i]
    if (typeof source !== 'object' || source === null || Array.isArray(source)) {
      throw new Error(`source definitions[${i}] must be an object, received ${describeValue(source)}`)
    }
    if (typeof source.id !== 'string' || !ID_PATTERN.test(source.id)) {
      throw new Error(
        `source definitions[${i}].id must be a letter followed by letters or digits, received ${describeValue(source.id)}`,
      )
    }
    if (seen.has(source.id)) throw new Error(`source id ${source.id} is duplicated`)
    seen.add(source.id)
    if (typeof source.tier !== 'string' || !isTier(source.tier)) {
      throw new Error(`source ${source.id} tier must be high, medium, or low, received ${describeValue(source.tier)}`)
    }
    if (typeof source.hitRate !== 'number' || !Number.isFinite(source.hitRate) || source.hitRate < 0 || source.hitRate > 1) {
      throw new Error(`source ${source.id} hitRate must be a finite number from 0 to 1, received ${describeValue(source.hitRate)}`)
    }
    if (!Array.isArray(source.visibility) || source.visibility.length === 0) {
      throw new Error(
        `source ${source.id} visibility must be a non-empty list, received ${describeValue(source.visibility)}`,
      )
    }
    const requirements = new Set<string>()
    for (let j = 0; j < source.visibility.length; j += 1) {
      const requirement = source.visibility[j]
      if (typeof requirement !== 'string' || !isRequirement(requirement)) {
        throw new Error(
          `source ${source.id} visibility[${j}] must be a requirement name, received ${describeValue(requirement)}`,
        )
      }
      if (requirements.has(requirement)) throw new Error(`source ${source.id} repeats visibility ${requirement}`)
      requirements.add(requirement)
    }
  }
}

export function assertFeedState(state: MarketState): void {
  const feed = state.feed
  if (typeof feed !== 'object' || feed === null || Array.isArray(feed)) {
    throw new Error(`market feed must be an object, received ${describeValue(feed)}`)
  }
  if (!Number.isSafeInteger(feed.day) || feed.day !== state.day + 1) {
    throw new Error(`feed day must be ${state.day + 1}, received ${describeValue(feed.day)}`)
  }
  if (!Array.isArray(feed.items)) {
    throw new Error(`feed items must be an array, received ${describeValue(feed.items)}`)
  }
  for (let i = 0; i < feed.items.length; i += 1) {
    const item = feed.items[i]
    if (typeof item !== 'object' || item === null) {
      throw new Error(`feed items[${i}] must be an object, received ${describeValue(item)}`)
    }
    const kind = (item as { kind?: unknown }).kind
    if (kind !== 'headline' && kind !== 'rumour') {
      throw new Error(`feed items[${i}] kind must be headline or rumour, received ${describeValue(kind)}`)
    }
  }
}

function leadMax(): number {
  return Math.min(RUMOUR_LEAD_MAX_DAYS, EVENT_LOOKAHEAD_DAYS)
}

function claimText(template: string, target: string, direction: EventDirection): string {
  const text = template
    .replaceAll('{target}', target)
    .replaceAll('{direction}', direction)
    .replaceAll('{magnitude}', '')
  if (text.length === 0 || /[\r\n]/.test(text)) {
    throw new Error(`rumour claim must be one non-empty line, received ${describeValue(text)}`)
  }
  return text
}

function scheduledWindow(state: MarketState): ScheduledEvent[] {
  const last = state.day + leadMax()
  const first = state.day + RUMOUR_LEAD_MIN_DAYS
  return state.scheduled.filter((event) => event.eventDay >= first && event.eventDay <= last)
}

/**
 * Slots in the lead window that are not scheduled. A false rumour must name one of
 * these, so its event id cannot later match a headline.
 */
function falseSlots(defs: MarketDefinitions, taken: ReadonlySet<string>, day: number): FalseSlot[] {
  const slots: FalseSlot[] = []
  const lastLead = leadMax()
  for (const eventType of defs.events) {
    for (const target of eventType.targets) {
      for (let lead = RUMOUR_LEAD_MIN_DAYS; lead <= lastLead; lead += 1) {
        const eventDay = day + lead
        const eventId = `${eventType.id}:${target}:${eventDay}`
        if (taken.has(eventId)) continue
        for (const direction of ['up', 'down'] as const) {
          slots.push({
            eventId,
            eventDay,
            claim: claimText(eventType.headline, target, direction),
          })
        }
      }
    }
  }
  return slots
}

function rumourFromSource(
  state: MarketState,
  source: SourceDefinition,
  scheduled: readonly ScheduledEvent[],
  openSlots: readonly FalseSlot[],
): RumourItem | null {
  const truthRoll = nextFloat(state.streams.info)
  const wantsTrue = truthRoll < source.hitRate
  // Hit-rate rule: count only emitted rumours. A truth roll that succeeds when no
  // scheduled event is 1 to 3 days ahead does not emit a true rumour, and it is
  // not rewritten as a false one. A failed roll emits a false rumour only when an
  // unscheduled claim exists in that same window. Skipped rolls are not counted.
  if (wantsTrue) {
    if (scheduled.length === 0) return null
    const event = scheduled[nextInt(state.streams.info, 0, scheduled.length - 1)]
    if (event === undefined) throw new Error('true rumour lost its scheduled event')
    if (event.headline.length === 0) throw new Error(`scheduled event ${event.id} has an empty headline`)
    return {
      kind: 'rumour',
      sourceId: source.id,
      tier: source.tier,
      truthRoll,
      truth: true,
      claim: event.headline,
      leadDays: event.eventDay - state.day,
      targetEventId: event.id,
      noise: false,
      visibility: [...source.visibility],
    }
  }
  if (openSlots.length === 0) return null
  const slot = openSlots[nextInt(state.streams.info, 0, openSlots.length - 1)]
  if (slot === undefined) throw new Error('false rumour lost its claim')
  return {
    kind: 'rumour',
    sourceId: source.id,
    tier: source.tier,
    truthRoll,
    truth: false,
    claim: slot.claim,
    leadDays: slot.eventDay - state.day,
    targetEventId: slot.eventId,
    noise: source.tier === 'low',
    visibility: [...source.visibility],
  }
}

function buildRumours(state: MarketState, defs: MarketDefinitions): RumourItem[] {
  const sources = defs.sources ?? []
  if (sources.length === 0) return []
  const scheduled = scheduledWindow(state)
  const taken = new Set(scheduled.map((event) => event.id))
  const openSlots = falseSlots(defs, taken, state.day)
  const rumours: RumourItem[] = []
  for (const source of sources) {
    for (let attempt = 0; attempt < RUMOURS_PER_SOURCE_PER_DAY; attempt += 1) {
      const rumour = rumourFromSource(state, source, scheduled, openSlots)
      if (rumour !== null) rumours.push(rumour)
    }
  }
  return rumours
}

function headlineLog(day: number, feedDay: number, item: HeadlineItem): HeadlineEvent {
  return {
    kind: 'headline',
    day,
    feedDay,
    eventId: item.eventId,
    text: item.text,
    magnitude: item.magnitude,
    top: item.top,
  }
}

function rumourLog(day: number, feedDay: number, item: RumourItem): RumourGeneratedEvent {
  return {
    kind: 'rumourGenerated',
    day,
    feedDay,
    source: item.sourceId,
    tier: item.tier,
    truthRoll: item.truthRoll,
    truth: item.truth,
    claim: item.claim,
    leadDays: item.leadDays,
    targetEventId: item.targetEventId,
    noise: item.noise,
  }
}

/**
 * Store the feed for `state.day + 1` and append its log lines.
 * Call this after day+3 has been pre-rolled. Lead is event day minus `state.day`,
 * so 1, 2, and 3 are the events already on the schedule. Day 0 passes an empty
 * `fired` list: nothing has fired, so the day-1 feed is rumours only.
 * Rumour attempts run in source order, `RUMOURS_PER_SOURCE_PER_DAY` times each.
 */
export function publishFeed(state: MarketState, defs: MarketDefinitions, fired: readonly FiredHeadline[]): void {
  assertFeedDefinitions(defs)
  const headlines = buildHeadlines(fired)
  const rumours = buildRumours(state, defs)
  const feedDay = state.day + 1
  if (!Number.isSafeInteger(feedDay)) {
    throw new Error(`feed day is not a safe integer, received ${describeValue(feedDay)}`)
  }
  state.feed = { day: feedDay, items: [...headlines, ...rumours] }
  for (const item of headlines) state.log.push(headlineLog(state.day, feedDay, item))
  for (const item of rumours) state.log.push(rumourLog(state.day, feedDay, item))
}

function copyHeadline(item: HeadlineItem): HeadlineItem {
  return {
    kind: 'headline',
    eventId: item.eventId,
    text: item.text,
    magnitude: item.magnitude,
    top: item.top,
  }
}

function copyRumour(item: RumourItem): RumourItem {
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
  }
}

/**
 * Filter a feed by requirement names. Headlines stay. A rumour stays when one of
 * its source requirements is in `visibility`. This does not draw and does not
 * write to `feed` or to any RNG stream. `visibility` is a list of names, not a player.
 */
export function visibleFeed(feed: DayFeed, visibility: readonly VisibilityRequirement[]): DayFeed {
  if (typeof feed !== 'object' || feed === null || Array.isArray(feed)) {
    throw new Error(`visibleFeed expected a feed object, received ${describeValue(feed)}`)
  }
  if (!Number.isSafeInteger(feed.day) || feed.day < 1) {
    throw new Error(`visibleFeed day must be a safe integer >= 1, received ${describeValue(feed.day)}`)
  }
  if (!Array.isArray(feed.items)) {
    throw new Error(`visibleFeed items must be an array, received ${describeValue(feed.items)}`)
  }
  if (!Array.isArray(visibility)) {
    throw new Error(`visibility must be a list of requirement names, received ${describeValue(visibility)}`)
  }
  const allowed = new Set<VisibilityRequirement>()
  for (let i = 0; i < visibility.length; i += 1) {
    const name = visibility[i]
    if (typeof name !== 'string' || !isRequirement(name)) {
      throw new Error(`visibility[${i}] must be a requirement name, received ${describeValue(name)}`)
    }
    allowed.add(name)
  }
  const items: DayFeed['items'] = []
  for (let i = 0; i < feed.items.length; i += 1) {
    const item = feed.items[i]
    if (item === undefined) throw new Error(`feed items[${i}] is missing`)
    if (item.kind === 'headline') {
      items.push(copyHeadline(item))
      continue
    }
    if (!Array.isArray(item.visibility)) {
      throw new Error(`rumour ${item.sourceId} visibility must be a list, received ${describeValue(item.visibility)}`)
    }
    let shown = false
    for (const requirement of item.visibility) {
      if (allowed.has(requirement)) shown = true
    }
    if (shown) items.push(copyRumour(item))
  }
  return { day: feed.day, items }
}
