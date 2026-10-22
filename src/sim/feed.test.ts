import { describe, expect, it } from 'vitest'

import { RUMOURS_PER_SOURCE_PER_DAY } from './constants.ts'
import { buildHeadlines, visibleFeed } from './feed.ts'
import { stateHash } from './hash.ts'
import { formatEvent } from './log.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { createRng, nextFloat } from './rng.ts'
import type { EventTypeDefinition, LogEvent, MarketDefinitions, RumourGeneratedEvent, SourceDefinition } from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugFeed(message: string): void {
  io.writeSync(1, `[DEBUG feed] ${message}\n`)
}

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022 },
  { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018 },
  { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01 },
  { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0 },
]

/** Same six sources and hidden rates as src/content/sources.ts. */
const SOURCES: readonly SourceDefinition[] = [
  { id: 'cityDesk', tier: 'high', hitRate: 0.85, visibility: ['infoFeed2'] },
  { id: 'floorWire', tier: 'high', hitRate: 0.85, visibility: ['jobContacts'] },
  { id: 'sectorNote', tier: 'medium', hitRate: 0.6, visibility: ['infoFeed1'] },
  { id: 'marketBrief', tier: 'medium', hitRate: 0.6, visibility: ['base'] },
  { id: 'streetTalk', tier: 'low', hitRate: 0.35, visibility: ['base', 'infoFeed1'] },
  { id: 'openChatter', tier: 'low', hitRate: 0.35, visibility: ['base', 'jobContacts'] },
]

const HIT_RATE: Record<SourceDefinition['tier'], number> = { high: 0.85, medium: 0.6, low: 0.35 }

function eventType(
  id: string,
  chance: number,
  magnitude: number,
  targets: readonly string[] = ['NOVA', 'BLSW', 'HRBU', 'KSR'],
): EventTypeDefinition {
  return {
    id,
    scope: targets.length === 1 && targets[0] === 'market' ? 'market' : 'stock',
    targets,
    chance,
    direction: { up: 0.5, down: 0.4, none: 0.1 },
    magnitudeMin: magnitude,
    magnitudeMax: magnitude,
    duration: 1,
    decay: 'linear',
    headline: '{target} {direction}',
    modifiers: [],
  }
}

function sourcesAt(hitRate: number): SourceDefinition[] {
  return SOURCES.map((source) => ({ ...source, hitRate, visibility: [...source.visibility] }))
}

function rumourLines(log: readonly LogEvent[]): RumourGeneratedEvent[] {
  const rumours: RumourGeneratedEvent[] = []
  for (const event of log) {
    if (event.kind === 'rumourGenerated') rumours.push(event)
  }
  return rumours
}

describe('news feed', () => {
  it('marks the first largest magnitude as the top headline', () => {
    const headlines = buildHeadlines([
      { eventId: 'earningsBeat:NOVA:1', text: 'NOVA up', magnitude: 3 },
      { eventId: 'scandal:BLSW:1', text: 'BLSW down', magnitude: 3 },
      { eventId: 'calendar:policyDecision:1', text: 'Policy rate up', magnitude: 1 },
    ])
    debugFeed(`top=${headlines.find((item) => item.top)?.eventId} magnitudes=${headlines.map((item) => item.magnitude).join(',')}`)
    expect(headlines.map((item) => item.top)).toEqual([true, false, false])
    const larger = buildHeadlines([
      { eventId: 'earningsBeat:NOVA:1', text: 'NOVA up', magnitude: 2 },
      { eventId: 'scandal:NOVA:1', text: 'NOVA down', magnitude: 9 },
    ])
    expect(larger.find((item) => item.top)?.eventId).toBe('scandal:NOVA:1')
    expect(buildHeadlines([])).toEqual([])
    expect(() => buildHeadlines([{ eventId: 'earningsBeat:NOVA:1', text: 'NOVA up', magnitude: -1 }])).toThrow(
      'magnitude must be a finite number >= 0',
    )
  })

  it('skips a true roll when nothing is scheduled and does not call it false', () => {
    expect(RUMOURS_PER_SOURCE_PER_DAY).toBe(1)
    const defs: MarketDefinitions = {
      assets: ASSETS,
      environment: [],
      events: [eventType('scandal', 0, 2, ['NOVA'])],
      sources: sourcesAt(1),
    }
    const info = createRng('empty').info
    const state = createMarket(defs, 'empty')
    for (let i = 0; i < SOURCES.length; i += 1) nextFloat(info)
    expect(state.streams.info).toEqual(info)
    expect(rumourLines(state.log)).toEqual([])
    expect(state.feed.items).toEqual([])
    expect(state.log.some((event) => event.kind === 'headline')).toBe(false)
    debugFeed('empty lead emitted=0 infoDraws=6')
  })

  it('flags only low-tier false rumours as noise and lets visibleFeed filter without drawing', () => {
    const defs: MarketDefinitions = {
      assets: ASSETS,
      environment: [],
      events: [eventType('scandal', 0, 2, ['NOVA'])],
      sources: sourcesAt(0),
    }
    const bare: MarketDefinitions = { assets: ASSETS, environment: [], events: defs.events }
    const state = createMarket(defs, 'filter')
    const other = createMarket(bare, 'filter')
    expect(state.streams.market).toEqual(other.streams.market)
    expect(state.streams.events).toEqual(other.streams.events)
    const rumours = state.feed.items.filter((item) => item.kind === 'rumour')
    expect(rumours).toHaveLength(SOURCES.length)
    for (const item of rumours) {
      if (item.kind !== 'rumour') continue
      expect(item.truth).toBe(false)
      expect(item.noise).toBe(item.tier === 'low')
      expect(state.scheduled.some((event) => event.id === item.targetEventId)).toBe(false)
      const logged = rumourLines(state.log).find((event) => event.source === item.sourceId)
      if (logged === undefined) throw new Error(`[DEBUG feed] missing log line for ${item.sourceId}`)
      debugFeed(formatEvent(logged))
    }
    const lowNoise = rumours.filter((item) => item.kind === 'rumour' && item.noise).map((item) => item.sourceId)
    expect(lowNoise.sort()).toEqual(['openChatter', 'streetTalk'])

    const beforeHash = stateHash(state)
    const infoA = state.streams.info.a
    const infoB = state.streams.info.b
    const infoC = state.streams.info.c
    const infoD = state.streams.info.d
    const stored = JSON.stringify(state.feed)
    const base = visibleFeed(state.feed, ['base'])
    const locked = visibleFeed(state.feed, ['infoFeed2'])
    const everyone = visibleFeed(state.feed, ['base', 'infoFeed1', 'infoFeed2', 'jobContacts'])
    const none = visibleFeed(state.feed, [])
    const baseIds = base.items.map((item) => (item.kind === 'rumour' ? item.sourceId : item.eventId)).sort()
    base.items.pop()
    expect(stateHash(state)).toBe(beforeHash)
    expect(state.streams.info.a).toBe(infoA)
    expect(state.streams.info.b).toBe(infoB)
    expect(state.streams.info.c).toBe(infoC)
    expect(state.streams.info.d).toBe(infoD)
    expect(JSON.stringify(state.feed)).toBe(stored)
    expect(base.items).not.toBe(state.feed.items)
    expect(base.items).toHaveLength(baseIds.length - 1)
    expect(baseIds).toEqual(['marketBrief', 'openChatter', 'streetTalk'])
    expect(locked.items.map((item) => (item.kind === 'rumour' ? item.sourceId : ''))).toEqual(['cityDesk'])
    expect(everyone.items).toHaveLength(SOURCES.length)
    expect(none.items).toEqual([])
    debugFeed(
      `visibleFeed base=${base.items.length} locked=${locked.items.length} hash=${beforeHash} info=${infoA},${infoB},${infoC},${infoD}`,
    )
  })

  it('makes every true rumour fire on the claimed day', () => {
    const certain = eventType('earningsBeat', 1, 4, ['NOVA'])
    certain.direction = { up: 1, down: 0, none: 0 }
    const defs: MarketDefinitions = {
      assets: ASSETS,
      environment: [],
      events: [certain],
      sources: [{ id: 'cityDesk', tier: 'high', hitRate: 1, visibility: ['infoFeed2'] }],
    }
    const state = createMarket(defs, 'true1')
    const rumour = rumourLines(state.log)[0]
    if (rumour === undefined) throw new Error('[DEBUG feed] missing day-0 rumour')
    debugFeed(formatEvent(rumour))
    expect(rumour.truth).toBe(true)
    expect(rumour.leadDays).toBeGreaterThanOrEqual(1)
    expect(rumour.leadDays).toBeLessThanOrEqual(3)
    while (state.day < rumour.day + rumour.leadDays) stepMarketDay(state, defs)
    const headline = state.log.find((event) => event.kind === 'headline' && event.eventId === rumour.targetEventId)
    if (headline?.kind !== 'headline') throw new Error(`[DEBUG feed] missing headline ${rumour.targetEventId}`)
    expect(headline.day).toBe(rumour.day + rumour.leadDays)
    debugFeed(`fired day=${headline.day} event=${headline.eventId} top=${headline.top}`)
  })

  it('keeps each tier within 5 points of its hidden hit rate over 20 seeds and 120 days', { timeout: 30000 }, () => {
    const defs: MarketDefinitions = {
      assets: ASSETS,
      environment: [],
      events: [
        eventType('earningsBeat', 0.2, 4),
        eventType('scandal', 0.15, 6),
        eventType('sentimentSwing', 0.25, 2, ['market']),
      ],
      sources: SOURCES,
    }
    const tally = {
      high: { truth: 0, false: 0 },
      medium: { truth: 0, false: 0 },
      low: { truth: 0, false: 0 },
    }
    let sample: RumourGeneratedEvent | undefined
    const seeds = Array.from({ length: 20 }, (_, index) => `s${index}`)

    for (const seed of seeds) {
      const fired = new Map<string, number>()
      const claims: RumourGeneratedEvent[] = []
      const absorb = (log: readonly LogEvent[], count: boolean): void => {
        for (const event of log) {
          if (event.kind === 'headline') fired.set(event.eventId, event.day)
          if (event.kind === 'rumourGenerated' && count) claims.push(event)
        }
      }
      const state = createMarket(defs, seed)
      absorb(state.log, true)
      for (let step = 0; step < 122; step += 1) {
        stepMarketDay(state, defs)
        absorb(state.log, state.day <= 119)
      }
      for (const rumour of claims) {
        const bucket = tally[rumour.tier]
        expect(rumour.truthRoll < HIT_RATE[rumour.tier]).toBe(rumour.truth)
        expect(rumour.leadDays).toBeGreaterThanOrEqual(1)
        expect(rumour.leadDays).toBeLessThanOrEqual(3)
        expect(rumour.noise).toBe(rumour.tier === 'low' && !rumour.truth)
        if (rumour.truth) {
          bucket.truth += 1
          expect(fired.get(rumour.targetEventId)).toBe(rumour.day + rumour.leadDays)
        } else {
          bucket.false += 1
          expect(fired.has(rumour.targetEventId)).toBe(false)
        }
        sample ??= rumour
      }
    }

    for (const tier of ['high', 'medium', 'low'] as const) {
      const bucket = tally[tier]
      const emitted = bucket.truth + bucket.false
      const rate = bucket.truth / emitted
      debugFeed(
        `tier=${tier} true=${bucket.truth} false=${bucket.false} rate=${rate.toFixed(4)} expected=${HIT_RATE[tier]}`,
      )
      expect(emitted).toBeGreaterThan(4000)
      expect(Math.abs(rate - HIT_RATE[tier])).toBeLessThanOrEqual(0.05)
    }
    if (sample !== undefined) debugFeed(`sample ${formatEvent(sample)}`)
  })
})
