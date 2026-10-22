import { describe, expect, it } from 'vitest'

import { EVENT_LOOKAHEAD_DAYS, FAIR_VALUE_CHANGE_LIMIT_NUMERATOR } from './constants.ts'
import { clipFairValueDelta, decayShare } from './events.ts'
import { formatEvent } from './log.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { createRng, nextNormal } from './rng.ts'
import type {
  AssetDefinition,
  EventTypeDefinition,
  FairValueChangeEvent,
  LogEvent,
  MarketDefinitions,
  MarketState,
} from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  readFileSync: (path: string, encoding: 'utf8') => string
  writeSync: (fd: number, data: string) => number
}
const pathMod = (await import(['node', 'path'].join(':'))) as {
  dirname: (path: string) => string
  join: (...parts: string[]) => string
}
const urlMod = (await import(['node', 'url'].join(':'))) as {
  fileURLToPath: (url: string) => string
}

function debugEvents(message: string): void {
  io.writeSync(1, `[DEBUG events] ${message}\n`)
}

const NOISE_FIXTURE = pathMod.join(
  pathMod.dirname(urlMod.fileURLToPath(import.meta.url)),
  '..',
  '..',
  'tests',
  'fixtures',
  'demo-30-noise-roll.txt',
)

const DEMO_ASSETS: readonly AssetDefinition[] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022 },
  { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018 },
  { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01 },
  { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0 },
]

const ONE_STOCK: readonly AssetDefinition[] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0 },
]

function readFixture(file: string): string {
  let text: string
  try {
    text = io.readFileSync(file, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`could not read ${file}: ${message}`)
  }
  return text.replaceAll('\r\n', '\n')
}

function noiseBody(line: string): string {
  const marker = 'day='
  const index = line.indexOf(marker)
  if (index < 0 || !line.includes('kind=noiseRoll')) return ''
  return line.slice(index)
}

function shock(
  id: string,
  magnitude: number,
  duration: number,
  decay: EventTypeDefinition['decay'],
): EventTypeDefinition {
  return {
    id,
    scope: 'stock',
    targets: ['NOVA'],
    chance: 0,
    direction: { up: 1, down: 0, none: 0 },
    magnitudeMin: magnitude,
    magnitudeMax: magnitude,
    duration,
    decay,
    headline: '{target} shock',
    modifiers: [],
  }
}

function scheduledShock(id: string, magnitude: number, duration: number, decay: EventTypeDefinition['decay']) {
  return {
    id: `${id}:NOVA:1`,
    typeId: id,
    target: 'NOVA',
    eventDay: 1,
    direction: 'up' as const,
    magnitudePercent: magnitude,
    duration,
    decay,
    headline: 'NOVA shock',
  }
}

function fairChanges(log: readonly LogEvent[]): FairValueChangeEvent[] {
  const changes: FairValueChangeEvent[] = []
  for (const event of log) {
    if (event.kind === 'fairValueChange') changes.push(event)
  }
  return changes
}

function countDirections(state: MarketState, defs: MarketDefinitions, days: number): { down: number; fired: number } {
  let down = 0
  let fired = 0
  const count = (log: readonly LogEvent[]): void => {
    for (const event of log) {
      if (event.kind !== 'eventDirection') continue
      fired += 1
      if (event.result === 'down') down += 1
    }
  }
  count(state.log)
  for (let i = 0; i < days; i += 1) {
    stepMarketDay(state, defs)
    count(state.log)
  }
  return { down, fired }
}

describe('events and environment', () => {
  it('pre-rolls three days and keeps the market stream for prices only', () => {
    expect(EVENT_LOOKAHEAD_DAYS).toBe(3)
    expect(FAIR_VALUE_CHANGE_LIMIT_NUMERATOR).toBe(12)
    const defs: MarketDefinitions = {
      assets: DEMO_ASSETS,
      environment: [
        { id: 'growth', start: 2, driftSpeed: 0.01 },
        { id: 'inflation', start: 3, driftSpeed: 0.01 },
        { id: 'policyRate', start: 4, driftSpeed: 0 },
      ],
      events: [
        {
          id: 'sentimentSwing',
          scope: 'market',
          targets: ['market'],
          chance: 1,
          direction: { up: 1, down: 0, none: 0 },
          magnitudeMin: 1,
          magnitudeMax: 1,
          duration: 2,
          decay: 'linear',
          headline: 'Market sentiment {direction}',
          modifiers: [],
        },
      ],
    }
    const state = createMarket(defs, 'demo')
    expect(state.scheduled.map((event) => event.eventDay)).toEqual([1, 2, 3])
    expect(state.log.some((event) => event.kind === 'noiseRoll')).toBe(false)
    debugEvents(`create scheduled=${state.scheduled.map((event) => event.eventDay).join(',')}`)

    const parallel = createRng('demo').market
    stepMarketDay(state, defs)
    const kinds = state.log.map((event) => event.kind)
    const fairAt = kinds.indexOf('fairValueChange')
    const noiseAt = kinds.indexOf('noiseRoll')
    const futureAt = state.log.findIndex((event) => event.kind === 'eventRoll' && event.eventDay === 4)
    expect(fairAt).toBeGreaterThanOrEqual(0)
    expect(noiseAt).toBeGreaterThan(fairAt)
    expect(futureAt).toBeGreaterThan(noiseAt)
    expect(state.scheduled.map((event) => event.eventDay).sort((a, b) => a - b)).toEqual([2, 3, 4])
    expect(state.active.map((effect) => effect.eventDay)).toEqual([1])
    for (const event of state.log) {
      if (event.kind === 'noiseRoll') expect(event.z).toBe(nextNormal(parallel))
    }
    expect(state.streams.market).toEqual(parallel)
    debugEvents(`day 1 order fairAt=${fairAt} noiseAt=${noiseAt} eventDay4At=${futureAt}`)
  })

  it('drifts growth and inflation and leaves the policy rate undrawn', () => {
    const defs: MarketDefinitions = {
      assets: ONE_STOCK,
      environment: [
        { id: 'growth', start: 2, driftSpeed: 0.01 },
        { id: 'inflation', start: 3, driftSpeed: 0.01 },
        { id: 'policyRate', start: 4, driftSpeed: 0 },
      ],
      events: [],
    }
    const events = createRng('demo').events
    const growthShock = nextNormal(events)
    const inflationShock = nextNormal(events)
    const state = createMarket(defs, 'demo')
    expect(state.streams.events).toEqual(createRng('demo').events)
    stepMarketDay(state, defs)
    const drifts = state.log.filter((event) => event.kind === 'envDrift')
    expect(drifts.map((event) => (event.kind === 'envDrift' ? event.entry : ''))).toEqual([
      'growth',
      'inflation',
      'policyRate',
    ])
    const growth = drifts[0]
    const inflation = drifts[1]
    const policy = drifts[2]
    if (growth?.kind !== 'envDrift' || inflation?.kind !== 'envDrift' || policy?.kind !== 'envDrift') {
      throw new Error('[DEBUG events] missing envDrift lines')
    }
    expect(growth.shock).toBe(growthShock)
    expect(inflation.shock).toBe(inflationShock)
    expect(policy.shock).toBe(0)
    expect(policy.delta).toBe(0)
    expect(policy.after).toBe(4)
    expect(state.environment.find((entry) => entry.id === 'policyRate')?.value).toBe(4)
    expect(state.streams.events).toEqual(events)
    for (const event of drifts) debugEvents(formatEvent(event))
  })

  it('raises the down share when a fixed environment favors down', () => {
    const eventType: EventTypeDefinition = {
      id: 'sentimentSwing',
      scope: 'market',
      targets: ['market'],
      chance: 1,
      direction: { up: 0.4, down: 0.4, none: 0.2 },
      magnitudeMin: 1,
      magnitudeMax: 1,
      duration: 1,
      decay: 'linear',
      headline: 'Market sentiment {direction}',
      modifiers: [
        {
          entryId: 'inflation',
          center: 3,
          chancePerUnit: 0,
          upPerUnit: -0.04,
          downPerUnit: 0.04,
          nonePerUnit: 0,
        },
      ],
    }
    const defsFor = (inflation: number): MarketDefinitions => ({
      assets: ONE_STOCK,
      environment: [
        { id: 'growth', start: 2, driftSpeed: 0 },
        { id: 'inflation', start: inflation, driftSpeed: 0 },
        { id: 'policyRate', start: 4, driftSpeed: 0 },
      ],
      events: [eventType],
    })
    const days = 2500
    const neutralState = createMarket(defsFor(3), 'favor')
    const favoredState = createMarket(defsFor(13), 'favor')
    const favoredDirection = favoredState.log.find((event) => event.kind === 'eventDirection')
    if (favoredDirection?.kind !== 'eventDirection') throw new Error('[DEBUG events] missing favored direction')
    expect(favoredDirection.shiftDown).toBeGreaterThan(0)
    expect(favoredDirection.down).toBeGreaterThan(0.7)
    debugEvents(formatEvent(favoredDirection))

    const neutral = countDirections(neutralState, defsFor(3), days)
    const favored = countDirections(favoredState, defsFor(13), days)
    const neutralShare = neutral.down / neutral.fired
    const favoredShare = favored.down / favored.fired
    debugEvents(
      `downShare neutral=${neutralShare} favored=${favoredShare} fired=${neutral.fired}/${favored.fired}`,
    )
    expect(neutral.fired).toBeGreaterThan(500)
    expect(favored.fired).toBeGreaterThan(500)
    expect(favoredShare).toBeGreaterThan(neutralShare + 0.15)
  })

  it('shifts the fire chance when the environment is away from center', () => {
    const eventType: EventTypeDefinition = {
      id: 'scandal',
      scope: 'stock',
      targets: ['NOVA'],
      chance: 0.1,
      direction: { up: 0.2, down: 0.5, none: 0.3 },
      magnitudeMin: 1,
      magnitudeMax: 2,
      duration: 1,
      decay: 'linear',
      headline: '{target} scandal',
      modifiers: [
        { entryId: 'inflation', center: 3, chancePerUnit: 0.02, upPerUnit: 0, downPerUnit: 0, nonePerUnit: 0 },
      ],
    }
    const defs: MarketDefinitions = {
      assets: ONE_STOCK,
      environment: [
        { id: 'growth', start: 2, driftSpeed: 0 },
        { id: 'inflation', start: 8, driftSpeed: 0 },
        { id: 'policyRate', start: 4, driftSpeed: 0 },
      ],
      events: [eventType],
    }
    const state = createMarket(defs, 'chance')
    const rolls = state.log.filter((event) => event.kind === 'eventRoll')
    expect(rolls.length).toBeGreaterThan(0)
    for (const event of rolls) {
      if (event.kind !== 'eventRoll') continue
      expect(event.chance).toBeCloseTo(0.2, 8)
      debugEvents(formatEvent(event))
    }
  })

  it('drops fair-value excess and does not carry it to the next day', () => {
    const defs: MarketDefinitions = {
      assets: ONE_STOCK,
      environment: [],
      events: [shock('shock', 50, 2, 'linear')],
    }
    const state = createMarket(defs, 'clip')
    state.scheduled = [scheduledShock('shock', 50, 2, 'linear')]
    stepMarketDay(state, defs)
    const day1 = fairChanges(state.log)[0]
    if (day1 === undefined) throw new Error('[DEBUG events] missing day 1 fairValueChange')
    const totalDelta = (50 / 100) * 4800
    expect(day1.total).toBe(totalDelta * decayShare('linear', 2, 0))
    expect(day1.total).toBe(1200)
    expect(day1.clipped).toBe(clipFairValueDelta(4800, 1200))
    expect(day1.clipped).toBe((4800 * 12) / 100)
    expect(day1.after).toBe(day1.before + day1.clipped)
    expect(Math.abs(day1.after - day1.before)).toBeLessThanOrEqual((Math.abs(day1.before) * 12) / 100)
    debugEvents(formatEvent(day1))

    stepMarketDay(state, defs)
    const day2 = fairChanges(state.log)[0]
    if (day2 === undefined) throw new Error('[DEBUG events] missing day 2 fairValueChange')
    expect(day2.before).toBe(day1.after)
    expect(day2.total).toBe(totalDelta * decayShare('linear', 2, 1))
    expect(day2.total).toBe(1200)
    expect(day2.clipped).toBe(clipFairValueDelta(day2.before, day2.total))
    expect(Math.abs(day2.after - day2.before)).toBeLessThanOrEqual((Math.abs(day2.before) * 12) / 100)
    debugEvents(formatEvent(day2))
  })

  it('stacks effects and still caps the day at 12 percent', () => {
    const defs: MarketDefinitions = {
      assets: ONE_STOCK,
      environment: [],
      events: [shock('shockA', 10, 1, 'linear'), shock('shockB', 10, 1, 'linear')],
    }
    const state = createMarket(defs, 'stack')
    state.scheduled = [scheduledShock('shockA', 10, 1, 'linear'), scheduledShock('shockB', 10, 1, 'linear')]
    stepMarketDay(state, defs)
    const day1 = fairChanges(state.log)[0]
    if (day1 === undefined) throw new Error('[DEBUG events] missing stacked fairValueChange')
    expect(day1.total).toBe(960)
    expect(day1.clipped).toBe(576)
    expect(day1.after).toBe(4800 + 576)
    debugEvents(formatEvent(day1))
    const held = day1.after
    stepMarketDay(state, defs)
    expect(fairChanges(state.log)).toEqual([])
    expect(state.assets.NOVA?.fairValue).toBe(held)
    expect(state.active).toEqual([])
  })

  it('applies a front-loaded effect as shares of the original delta', () => {
    const defs: MarketDefinitions = {
      assets: ONE_STOCK,
      environment: [],
      events: [shock('shock', 3, 3, 'frontLoaded')],
    }
    const state = createMarket(defs, 'decay')
    state.scheduled = [scheduledShock('shock', 3, 3, 'frontLoaded')]
    const totalDelta = (3 / 100) * 4800
    const deltas: number[] = []
    for (let day = 0; day < 3; day += 1) {
      stepMarketDay(state, defs)
      const applied = state.log.find((event) => event.kind === 'effectApplied')
      if (applied?.kind !== 'effectApplied') throw new Error(`[DEBUG events] missing effect on day ${day + 1}`)
      expect(applied.dayIndex).toBe(day)
      expect(applied.delta).toBe(totalDelta * decayShare('frontLoaded', 3, day))
      deltas.push(applied.delta)
      debugEvents(formatEvent(applied))
    }
    expect(state.assets.NOVA?.fairValue).toBe(4800 + deltas[0] + deltas[1] + deltas[2])
    expect(state.active).toEqual([])
  })

  it('matches Step 4 noiseRoll lines while events and drift draw the events stream', () => {
    const defs: MarketDefinitions = {
      assets: DEMO_ASSETS,
      environment: [
        { id: 'growth', start: 2, driftSpeed: 0.01 },
        { id: 'inflation', start: 3, driftSpeed: 0.01 },
        { id: 'policyRate', start: 4, driftSpeed: 0 },
      ],
      events: [
        {
          id: 'earningsBeat',
          scope: 'stock',
          targets: ['NOVA', 'BLSW', 'HRBU', 'KSR'],
          chance: 0.2,
          direction: { up: 0.5, down: 0.4, none: 0.1 },
          magnitudeMin: 1,
          magnitudeMax: 3,
          duration: 2,
          decay: 'linear',
          headline: '{target} earnings {direction}',
          modifiers: [
            { entryId: 'growth', center: 2, chancePerUnit: 0.001, upPerUnit: 0.02, downPerUnit: -0.02, nonePerUnit: 0 },
          ],
        },
        {
          id: 'sentimentSwing',
          scope: 'market',
          targets: ['market'],
          chance: 0.3,
          direction: { up: 0.4, down: 0.4, none: 0.2 },
          magnitudeMin: 1,
          magnitudeMax: 2,
          duration: 2,
          decay: 'frontLoaded',
          headline: 'Market sentiment {direction}',
          modifiers: [],
        },
      ],
    }
    const fresh = createRng('demo')
    const parallel = createRng('demo').market
    const state = createMarket(defs, 'demo')
    const lines: string[] = []
    for (let day = 0; day < 30; day += 1) {
      stepMarketDay(state, defs)
      for (const event of state.log) {
        if (event.kind !== 'noiseRoll') continue
        expect(event.z).toBe(nextNormal(parallel))
        lines.push(formatEvent(event))
      }
    }
    expect(state.streams.market).toEqual(parallel)
    expect(state.streams.info).toEqual(fresh.info)
    expect(state.streams.distortion).toEqual(fresh.distortion)
    expect(state.streams.events).not.toEqual(fresh.events)
    const step4 = readFixture(NOISE_FIXTURE)
      .split('\n')
      .map(noiseBody)
      .filter((line) => line.length > 0)
    expect(lines).toEqual(step4)
    debugEvents(`noiseRoll lines=${lines.length} match Step 4`)
  })

  it('rejects a broken event type before drawing', () => {
    const eventType = shock('shock', 1, 1, 'linear')
    const defs: MarketDefinitions = { assets: ONE_STOCK, environment: [], events: [eventType] }
    const state = createMarket(defs, 'demo')
    const market = { ...state.streams.market }
    const events = { ...state.streams.events }
    const broken: MarketDefinitions = {
      ...defs,
      events: [{ ...eventType, chance: 1.5 }],
    }
    expect(() => stepMarketDay(state, broken)).toThrow('chance must be from 0 to 1')
    expect(state.day).toBe(0)
    expect(state.streams.market).toEqual(market)
    expect(state.streams.events).toEqual(events)
    expect(() =>
      createMarket(
        { ...defs, events: [{ ...eventType, direction: { up: 0.5, down: 0.5, none: 0.5 } }] },
        'demo',
      ),
    ).toThrow('direction chances must sum to 1')
    expect(() => createMarket({ ...defs, events: [{ ...eventType, targets: ['NOPE'] }] }, 'demo')).toThrow(
      'is not a stock',
    )
  })
})
