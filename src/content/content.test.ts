import { describe, expect, it } from 'vitest'

import { lookupPolicyChances } from '../sim/calendar.ts'
import { createMarket, stepMarketDay } from '../sim/market.ts'
import { formatEvent } from '../sim/log.ts'
import type { FairValueChangeEvent, LogEvent } from '../sim/types.ts'
import { CALENDAR_DEFINITIONS } from './calendar.ts'
import { ENVIRONMENT_DEFINITIONS } from './environment.ts'
import { EVENT_DEFINITIONS } from './events.ts'
import { MARKET_DEFINITIONS } from './index.ts'

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

function debugContent(message: string): void {
  io.writeSync(1, `[DEBUG content] ${message}\n`)
}

const FIXTURE_DIR = pathMod.join(pathMod.dirname(urlMod.fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures')
const PRICE_LOG = pathMod.join(FIXTURE_DIR, 'demo-30-price-log.txt')
const NOISE_LOG = pathMod.join(FIXTURE_DIR, 'demo-30-noise-roll.txt')

const STOCKS = ['NOVA', 'BLSW', 'HRBU', 'KSR']
const RATE_DAYS = 10000

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

type Tally = { fires: number; rolls: number; chanceSum: number }

describe('provisional content', () => {
  it('keeps chances, directions, magnitudes, and durations in range', () => {
    expect(ENVIRONMENT_DEFINITIONS.map((entry) => entry.id)).toEqual(['growth', 'inflation', 'policyRate'])
    const policy = ENVIRONMENT_DEFINITIONS.find((entry) => entry.id === 'policyRate')
    expect(policy?.driftSpeed).toBe(0)
    expect(EVENT_DEFINITIONS).toHaveLength(8)
    const environmentIds = new Set(ENVIRONMENT_DEFINITIONS.map((entry) => entry.id))
    for (const eventType of EVENT_DEFINITIONS) {
      expect(eventType.chance).toBeGreaterThanOrEqual(0)
      expect(eventType.chance).toBeLessThanOrEqual(1)
      expect(eventType.direction.up).toBeGreaterThanOrEqual(0)
      expect(eventType.direction.up).toBeLessThanOrEqual(1)
      expect(eventType.direction.down).toBeGreaterThanOrEqual(0)
      expect(eventType.direction.down).toBeLessThanOrEqual(1)
      expect(eventType.direction.none).toBeGreaterThanOrEqual(0)
      expect(eventType.direction.none).toBeLessThanOrEqual(1)
      const sum = eventType.direction.up + eventType.direction.down + eventType.direction.none
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
      expect(eventType.magnitudeMin).toBeGreaterThan(0)
      expect(eventType.magnitudeMax).toBeGreaterThan(0)
      expect(eventType.duration).toBeGreaterThan(0)
      if (eventType.scope === 'stock') expect([...eventType.targets]).toEqual(STOCKS)
      if (eventType.scope === 'sector') expect([...eventType.targets]).toEqual(['A', 'B'])
      if (eventType.scope === 'market') expect([...eventType.targets]).toEqual(['market'])
      for (const modifier of eventType.modifiers) expect(environmentIds.has(modifier.entryId)).toBe(true)
      debugContent(
        `type=${eventType.id} scope=${eventType.scope} chance=${eventType.chance} up=${eventType.direction.up} down=${eventType.direction.down} none=${eventType.direction.none} magnitude=${eventType.magnitudeMin}-${eventType.magnitudeMax} duration=${eventType.duration}`,
      )
    }

    expect(CALENDAR_DEFINITIONS.daysPerMonth).toBe(30)
    expect(CALENDAR_DEFINITIONS.rateStep).toBe(0.25)
    expect(CALENDAR_DEFINITIONS.schedule).toEqual([
      { kind: 'growthRelease', dayOfMonth: 10, entryId: 'growth' },
      { kind: 'inflationRelease', dayOfMonth: 20, entryId: 'inflation' },
      { kind: 'policyDecision', dayOfMonth: 25, entryId: 'policyRate' },
    ])
    for (const cell of CALENDAR_DEFINITIONS.policy) {
      expect(cell.hold + cell.up + cell.down).toBeCloseTo(1)
      expect(cell.up).toBeGreaterThanOrEqual(0)
      expect(cell.down).toBeGreaterThanOrEqual(0)
      expect(cell.hold).toBeGreaterThanOrEqual(0)
    }
    for (const growth of [0, 2, 5]) {
      const high = lookupPolicyChances(CALENDAR_DEFINITIONS, 6, growth)
      const low = lookupPolicyChances(CALENDAR_DEFINITIONS, 0, growth)
      expect(high.up).toBeGreaterThan(low.up)
      debugContent(`policy growth=${growth} highInflationUp=${high.up} lowInflationUp=${low.up}`)
    }
    expect(lookupPolicyChances(CALENDAR_DEFINITIONS, 6, 2)).toEqual({ hold: 0.2, up: 0.7, down: 0.1 })
    expect(lookupPolicyChances(CALENDAR_DEFINITIONS, 0, 2)).toEqual({ hold: 0.65, up: 0.1, down: 0.25 })
    const hike = (sector: 'A' | 'B'): number => {
      const row = CALENDAR_DEFINITIONS.effects.find(
        (cell) => cell.kind === 'policyDecision' && cell.outcome === 'up' && cell.sector === sector,
      )
      if (row === undefined) throw new Error(`[DEBUG content] missing hike effect for sector ${sector}`)
      return row.percent
    }
    expect(hike('A')).toBe(-1.5)
    expect(hike('B')).toBe(-4)
    expect(hike('B')).toBeLessThan(hike('A'))
    debugContent(`hike percent A=${hike('A')} B=${hike('B')}`)
  })

  it('fires each event type within 10 percent of the chance it rolled', { timeout: 20000 }, () => {
    const state = createMarket(MARKET_DEFINITIONS, 'rate')
    const tallies = new Map<string, Tally>()
    let maxRatio = 0
    let clips = 0
    const absorb = (log: readonly LogEvent[]): void => {
      for (const event of log) {
        if (event.kind === 'fairValueChange') {
          const ratio = Math.abs(event.after - event.before) / Math.abs(event.before)
          if (ratio > maxRatio) maxRatio = ratio
          if (event.clipped !== event.total) clips += 1
          continue
        }
        if (event.kind !== 'eventRoll') continue
        let tally = tallies.get(event.type)
        if (tally === undefined) {
          tally = { fires: 0, rolls: 0, chanceSum: 0 }
          tallies.set(event.type, tally)
        }
        tally.rolls += 1
        tally.chanceSum += event.chance
        if (event.fired) tally.fires += 1
      }
    }
    absorb(state.log)
    for (let day = 0; day < RATE_DAYS; day += 1) {
      stepMarketDay(state, MARKET_DEFINITIONS)
      absorb(state.log)
    }
    expect(maxRatio).toBeLessThanOrEqual(0.12 + 1e-9)
    debugContent(`fairValue maxRatio=${maxRatio} clips=${clips} days=${RATE_DAYS}`)
    for (const eventType of EVENT_DEFINITIONS) {
      const tally = tallies.get(eventType.id)
      if (tally === undefined) throw new Error(`[DEBUG content] missing rolls for ${eventType.id}`)
      const expected = tally.chanceSum / tally.rolls
      const rate = tally.fires / tally.rolls
      const relative = Math.abs(rate - expected) / expected
      debugContent(
        `rate type=${eventType.id} rolls=${tally.rolls} fires=${tally.fires} rate=${rate} expected=${expected} base=${eventType.chance} relative=${relative}`,
      )
      expect(relative).toBeLessThanOrEqual(0.1)
    }
  })

  it('matches the demo 30-day log and the Step 4 noiseRoll lines', () => {
    const state = createMarket(MARKET_DEFINITIONS, 'demo')
    const events: LogEvent[] = [...state.log]
    for (let day = 0; day < 30; day += 1) {
      stepMarketDay(state, MARKET_DEFINITIONS)
      for (const event of state.log) events.push(event)
    }
    const lines = events.map((event) => formatEvent(event))
    const output = lines.map((line) => `[DEBUG market] ${line}`).join('\n') + '\n'
    expect(output).toBe(readFixture(PRICE_LOG))
    const noise = lines.filter((line) => line.includes('kind=noiseRoll'))
    const step4 = readFixture(NOISE_LOG)
      .split('\n')
      .map(noiseBody)
      .filter((line) => line.length > 0)
    expect(noise).toEqual(step4)
    debugContent(`golden lines=${lines.length} noiseRoll=${noise.length}`)

    let traced = false
    for (const fired of events) {
      if (fired.kind !== 'eventRoll' || !fired.fired) continue
      const direction = events.find(
        (event) =>
          event.kind === 'eventDirection' &&
          event.type === fired.type &&
          event.target === fired.target &&
          event.eventDay === fired.eventDay,
      )
      if (direction?.kind !== 'eventDirection' || direction.result === 'none') continue
      const effectId = `${fired.type}:${fired.target}:${fired.eventDay}`
      const applied = events.find((event) => event.kind === 'effectApplied' && event.effect === effectId)
      if (applied?.kind !== 'effectApplied') throw new Error(`[DEBUG content] missing effect ${effectId}`)
      const fair = events.find(
        (event): event is FairValueChangeEvent =>
          event.kind === 'fairValueChange' && event.day === fired.eventDay && event.asset === applied.asset,
      )
      if (fair === undefined) throw new Error('[DEBUG content] missing fairValueChange for the fired event')
      debugContent(formatEvent(fired))
      debugContent(formatEvent(direction))
      debugContent(formatEvent(fair))
      traced = true
      break
    }
    expect(traced).toBe(true)
  })
})
