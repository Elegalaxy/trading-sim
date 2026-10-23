import { describe, expect, it } from 'vitest'

import { upcomingCalendar } from './calendar.ts'
import { distortionCap, shownFeed } from './distortion.ts'
import { applyCommand, createGame, endDay, refreshPerception, viewedFeed } from './game.ts'
import { activeJob } from './jobs.ts'
import { formatEvent } from './log.ts'
import { createRng } from './rng.ts'
import { daySummary } from './summary.ts'
import type {
  CalendarDefinitions,
  CalendarEffectCell,
  CalendarItemKind,
  CalendarOutcome,
  HeadlineItem,
  JobDefinition,
  MarketDefinitions,
  OpenPosition,
  PolicyChanceCell,
  ReleaseChanceCell,
  RngStream,
  SocialPostDefinition,
} from './types.ts'
import { playerVisibleFeed } from './lifestyle.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugDistortion(message: string): void {
  io.writeSync(1, `[DEBUG distortion] ${message}\n`)
}

const POSTS: readonly SocialPostDefinition[] = [
  { id: 'runItUp', sourceId: 'streetFeed', direction: 'up', text: '{asset} is going up. Everyone on here is buying.' },
  { id: 'cantLose', sourceId: 'streetFeed', direction: 'up', text: 'Still long {asset}. The timeline says it only goes up.' },
  { id: 'getOut', sourceId: 'streetFeed', direction: 'down', text: '{asset} is going down. I am short and staying short.' },
  { id: 'dumpIt', sourceId: 'streetFeed', direction: 'down', text: 'Dump {asset}. The posts all say it is going down.' },
]

const JOBS: readonly JobDefinition[] = [
  {
    id: 'jobless',
    name: 'Jobless',
    slots: 0,
    payCents: 0,
    requirement: 'none',
    perk: 'none',
    energyCost: 0,
    stressCost: 0,
    sleepHours: 8,
  },
  {
    id: 'nightWarehouse',
    name: 'Night-shift warehouse',
    slots: 2,
    payCents: 130_000,
    requirement: 'none',
    perk: 'quietBreaks',
    energyCost: 20,
    stressCost: 12,
    sleepHours: 6,
  },
]

const BANDS = ['low', 'mid', 'high'] as const

function policyTable(): PolicyChanceCell[] {
  const rows: PolicyChanceCell[] = []
  for (const inflationBand of BANDS) {
    for (const growthBand of BANDS) rows.push({ inflationBand, growthBand, hold: 0.5, up: 0.25, down: 0.25 })
  }
  return rows
}

function releaseTable(): ReleaseChanceCell[] {
  return BANDS.map((band) => ({ band, above: 0.25, inline: 0.5, below: 0.25 }))
}

function effectRows(): CalendarEffectCell[] {
  const rows: CalendarEffectCell[] = []
  const add = (kind: CalendarItemKind, outcome: CalendarOutcome, sectorA: number, sectorB: number): void => {
    rows.push({ kind, outcome, sector: 'A', percent: sectorA })
    rows.push({ kind, outcome, sector: 'B', percent: sectorB })
  }
  add('policyDecision', 'up', -1.5, -4)
  add('policyDecision', 'down', 1, 3)
  add('policyDecision', 'hold', 0.25, -0.25)
  for (const kind of ['growthRelease', 'inflationRelease'] as const) {
    add(kind, 'above', 1, 0.4)
    add(kind, 'inline', 0.2, 0.1)
    add(kind, 'below', -1, -0.4)
  }
  return rows
}

function calendarDefs(): CalendarDefinitions {
  return {
    daysPerMonth: 30,
    schedule: [
      { kind: 'growthRelease', dayOfMonth: 10, entryId: 'growth' },
      { kind: 'inflationRelease', dayOfMonth: 20, entryId: 'inflation' },
      { kind: 'policyDecision', dayOfMonth: 25, entryId: 'policyRate' },
    ],
    growthEntryId: 'growth',
    inflationEntryId: 'inflation',
    policyEntryId: 'policyRate',
    inflationLowBelow: 2,
    inflationHighAt: 4,
    growthLowBelow: 1,
    growthHighAt: 3,
    rateStep: 0.25,
    policy: policyTable(),
    growthRelease: releaseTable(),
    inflationRelease: releaseTable(),
    effects: effectRows(),
  }
}

function marketDefs(): MarketDefinitions {
  return {
    assets: [
      { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
      { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018, spreadPpm: 3000, borrowFeePpm: 200 },
      { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100 },
      { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014, spreadPpm: 2000, borrowFeePpm: 150 },
      { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
    ],
    environment: [
      { id: 'growth', start: 2, driftSpeed: 0 },
      { id: 'inflation', start: 3, driftSpeed: 0 },
      { id: 'policyRate', start: 4, driftSpeed: 0 },
    ],
    events: [
      {
        id: 'earningsBeat',
        scope: 'stock',
        targets: ['NOVA', 'BLSW', 'HRBU', 'KSR'],
        chance: 0.08,
        direction: { up: 0.45, down: 0.45, none: 0.1 },
        magnitudeMin: 2,
        magnitudeMax: 6,
        duration: 2,
        decay: 'frontLoaded',
        headline: '{target} earnings {direction}',
        modifiers: [],
      },
    ],
    calendar: calendarDefs(),
    sources: [
      { id: 'marketBrief', tier: 'medium', hitRate: 0.6, visibility: ['base'] },
      { id: 'streetTalk', tier: 'low', hitRate: 0.35, visibility: ['base'] },
    ],
  }
}

function headline(asset: string, direction: 'up' | 'down' | 'note', index: number): HeadlineItem {
  const text = direction === 'note' ? `${asset} note ${index}` : `${asset} earnings ${direction}`
  return {
    kind: 'headline',
    eventId: `earningsBeat:${asset}:${index + 1}`,
    text,
    magnitude: 1,
    top: index === 0,
  }
}

function mixedFeed() {
  return {
    day: 4,
    items: [
      headline('NOVA', 'note', 0),
      headline('NOVA', 'down', 1),
      headline('BLSW', 'note', 2),
      headline('NOVA', 'up', 3),
      headline('HRBU', 'note', 4),
      headline('KSR', 'note', 5),
      headline('BLSW', 'note', 6),
      headline('HRBU', 'note', 7),
    ],
  }
}

function position(asset: string, signedShares: number): Record<string, OpenPosition> {
  return { [asset]: { asset, signedShares, costCents: 1000 } }
}

function texts(items: readonly { kind: string; text?: string; claim?: string }[]): string[] {
  return items.map((item) => (item.kind === 'headline' || item.kind === 'social' ? item.text ?? '' : item.claim ?? ''))
}

function streamCopy(stream: RngStream): RngStream {
  return JSON.parse(JSON.stringify(stream)) as RngStream
}

describe('biased news', () => {
  it('distorts nothing at stress 60 or below and never passes the cap', () => {
    const feed = mixedFeed()
    const before = JSON.stringify(feed)
    const held = feed.items[1]
    const stream = createRng('cap').distortion
    const frozen = streamCopy(stream)
    const calm = shownFeed(feed, position('NOVA', 5), 60, stream, POSTS, 3)
    expect(calm.events).toEqual([])
    expect(calm.feed.items.every((item) => item.distorted === false)).toBe(true)
    expect(texts(calm.feed.items)).toEqual(texts(feed.items))
    expect(stream).toEqual(frozen)
    expect(JSON.stringify(feed)).toBe(before)
    expect(feed.items[1]).toBe(held)
    expect(shownFeed(feed, position('NOVA', 5), 0, stream, POSTS, 3).events).toEqual([])
    expect(distortionCap(8, 60)).toBe(0)
    expect(distortionCap(8, 100)).toBe(2)
    expect(distortionCap(3, 100)).toBe(0)
    expect(distortionCap(4, 100)).toBe(1)
    expect(distortionCap(8, 80)).toBe(1)
    expect(distortionCap(160, 61)).toBe(1)

    for (const stress of [0, 60, 61, 80, 100]) {
      for (const count of [0, 1, 3, 4, 7, 8, 20]) {
        const items = Array.from({ length: count }, (_, index) => headline('NOVA', index % 2 === 0 ? 'down' : 'up', index))
        const sample = shownFeed({ day: 2, items }, position('NOVA', 8), stress, createRng(`cap-${stress}-${count}`).distortion, POSTS, 1)
        const cap = distortionCap(count, stress)
        expect(sample.events.length).toBeLessThanOrEqual(cap)
        if (stress <= 60) expect(sample.events).toEqual([])
        debugDistortion(`stress=${stress} items=${count} cap=${cap} distorted=${sample.events.length}`)
      }
    }
  })

  it('promotes bullish news for a long, bearish news for a short, and can hide the other', () => {
    const feed = mixedFeed()
    const long = shownFeed(feed, position('NOVA', 4), 100, createRng('long').distortion, POSTS, 6)
    expect(long.events.map((event) => event.action)).toEqual(['reweight', 'hide'])
    expect(long.feed.items.some((item) => item.kind === 'headline' && item.text === 'NOVA earnings down')).toBe(false)
    expect(long.feed.items[0]).toMatchObject({ kind: 'headline', text: 'NOVA earnings up', distorted: true })
    expect(long.feed.items.filter((item) => item.kind === 'social')).toEqual([])
    expect(long.events.length).toBeLessThanOrEqual(distortionCap(feed.items.length, 100))

    const short = shownFeed(feed, position('NOVA', -4), 100, createRng('short').distortion, POSTS, 6)
    expect(short.events.map((event) => event.action)).toEqual(['reweight', 'hide'])
    expect(short.feed.items.some((item) => item.kind === 'headline' && item.text === 'NOVA earnings up')).toBe(false)
    expect(short.feed.items[0]).toMatchObject({ kind: 'headline', text: 'NOVA earnings down', distorted: true })

    for (const event of [...long.events, ...short.events]) debugDistortion(formatEvent(event))
  })

  it('generates a low-reliability social post and leaves the other streams alone', () => {
    const feed = {
      day: 5,
      items: [0, 1, 2, 3].map((index) => headline('BLSW', 'note', index)),
    }
    const rng = createRng('posts')
    const market = streamCopy(rng.market)
    const events = streamCopy(rng.events)
    const info = streamCopy(rng.info)
    const mirror = streamCopy(rng.distortion)
    const shown = shownFeed(feed, position('NOVA', 2), 100, rng.distortion, POSTS, 5)
    const again = shownFeed(feed, position('NOVA', 2), 100, mirror, POSTS, 5)
    expect(again).toEqual(shown)
    expect(rng.distortion).toEqual(mirror)
    expect(rng.market).toEqual(market)
    expect(rng.events).toEqual(events)
    expect(rng.info).toEqual(info)
    expect(shown.events).toHaveLength(1)
    expect(shown.events[0]).toMatchObject({ action: 'generate', trueValue: 'absent' })
    const post = shown.feed.items.find((item) => item.kind === 'social')
    if (post === undefined || post.kind !== 'social') throw new Error('[DEBUG distortion] missing social post')
    expect(post.tier).toBe('low')
    expect(post.sourceId).toBe('streetFeed')
    expect(post.distorted).toBe(true)
    expect(post.direction).toBe('up')
    expect(post.text).toContain('NOVA')
    expect(feed.items.some((item) => item.kind === 'headline' && item.text === post.text)).toBe(false)
    debugDistortion(formatEvent(shown.events[0]))
  })

  it('keeps the calendar, prices, and market logs identical when stress is forced to 0 and to 100', () => {
    const defs = marketDefs()
    const play = (stress: number) => {
      const game = createGame(defs, 'bias-seed', { socialPosts: POSTS })
      const logs: string[] = []
      const prices: string[] = []
      const feeds: string[] = []
      const calendars: string[] = []
      const summaries: string[] = []
      for (let step = 0; step < 12; step += 1) {
        game.stats.stress = stress
        if (step === 0) {
          applyCommand(game, defs, { type: 'skip' })
          applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
        }
        endDay(game, defs)
        logs.push(game.market.log.map((event) => formatEvent(event)).join('\n'))
        prices.push(
          defs.assets.map((asset) => `${asset.id}=${game.market.assets[asset.id]?.priceCents ?? 'missing'}`).join(' '),
        )
        feeds.push(JSON.stringify(game.market.feed))
        calendars.push(JSON.stringify(game.market.calendarRolls))
        summaries.push(JSON.stringify(daySummary(game.market.log)))
      }
      return {
        game,
        logs,
        prices,
        feeds,
        calendars,
        summaries,
        streams: JSON.stringify({
          market: game.market.streams.market,
          events: game.market.streams.events,
          info: game.market.streams.info,
        }),
        upcoming: JSON.stringify(upcomingCalendar(game.market, 30)),
      }
    }

    const calm = play(0)
    const stressed = play(100)
    expect(stressed.logs).toEqual(calm.logs)
    expect(stressed.prices).toEqual(calm.prices)
    expect(stressed.feeds).toEqual(calm.feeds)
    expect(stressed.calendars).toEqual(calm.calendars)
    expect(stressed.summaries).toEqual(calm.summaries)
    expect(stressed.streams).toEqual(calm.streams)
    expect(stressed.upcoming).toEqual(calm.upcoming)
    expect(stressed.feeds.some((feed) => feed.includes('"social"'))).toBe(false)
    expect(calm.logs.some((log) => log.includes('kind=calendarItem'))).toBe(true)
    debugDistortion(
      `days=12 logsMatch pricesMatch feedMatch calendarMatch summaryMatch stress0=${calm.game.stats.stress} stress100=${stressed.game.stats.stress}`,
    )
  })

  it('verify shows the true visible feed, costs 2 energy, and does not change the market', () => {
    const defs = marketDefs()
    const game = createGame(defs, 'verify', { socialPosts: POSTS })
    const feed = mixedFeed()
    feed.day = game.market.day + 1
    game.market.feed = feed
    game.stats.stress = 100
    game.positions = position('NOVA', 6)
    refreshPerception(game)
    expect(game.perception.events.length).toBeGreaterThan(0)
    const truth = playerVisibleFeed(game.market.feed, activeJob(game.job), game.lifestyle)
    const marketBefore = JSON.stringify(game.market)
    const shownBefore = JSON.stringify(game.perception.shown)
    applyCommand(game, defs, { type: 'verify' })
    expect(game.stats.energy).toBe(78)
    expect(game.section).toBe('sleep')
    expect(game.perception.verified).toBe(true)
    expect(game.log.find((event) => event.kind === 'newsVerified')).toMatchObject({ cost: 2 })
    const viewed = viewedFeed(game)
    expect(texts(viewed.items)).toEqual(texts(truth.items))
    expect(viewed.items.every((item) => item.kind !== 'social' && item.distorted === false)).toBe(true)
    expect(JSON.stringify(game.perception.shown)).toBe(shownBefore)
    const after = JSON.parse(marketBefore) as { streams: { distortion: RngStream } }
    after.streams.distortion = game.market.streams.distortion
    expect(JSON.stringify(game.market)).toBe(JSON.stringify(after))

    const quiet = createGame(defs, 'quiet', { jobs: JOBS, jobId: 'nightWarehouse', socialPosts: POSTS })
    applyCommand(quiet, defs, { type: 'verify' })
    expect(quiet.stats.energy).toBe(78)
    expect(quiet.log.find((event) => event.kind === 'newsVerified')).toMatchObject({ cost: 2 })
    applyCommand(quiet, defs, { type: 'readNews' })
    expect(quiet.stats.energy).toBe(78)
    expect(quiet.log.find((event) => event.kind === 'newsRead')).toMatchObject({ cost: 0 })
    debugDistortion(`verify cost=2 energy=${game.stats.energy} trueItems=${truth.items.length}`)
  })

  it('does not rebuild the shown feed when the position changes during the day', () => {
    const defs = marketDefs()
    const game = createGame(defs, 'hold', { socialPosts: POSTS })
    const feed = mixedFeed()
    feed.day = game.market.day + 1
    game.market.feed = feed
    game.stats.stress = 100
    game.positions = position('NOVA', 3)
    refreshPerception(game)
    const shown = JSON.stringify(game.perception.shown)
    const stream = JSON.stringify(game.market.streams.distortion)
    game.positions = {}
    game.stats.stress = 20
    applyCommand(game, defs, { type: 'skip' })
    expect(JSON.stringify(game.perception.shown)).toBe(shown)
    expect(JSON.stringify(game.market.streams.distortion)).toBe(stream)
    expect(game.perception.events.length).toBeGreaterThan(0)
    debugDistortion(`held events=${game.perception.events.length} after a later flat position`)
  })
})
