import { describe, expect, it } from 'vitest'

import {
  CENTS_PER_UNIT,
  DAILY_MOVE_CAP_DENOMINATOR,
  DAILY_MOVE_CAP_NUMERATOR,
  FAIR_VALUE_PULL_DENOMINATOR,
  FAIR_VALUE_PULL_NUMERATOR,
  INDEX_LEVEL_SCALE,
} from './constants.ts'
import { stateHash } from './hash.ts'
import { formatEvent } from './log.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { createRng, nextNormal } from './rng.ts'
import type { IndexStepEvent, MarketDefinitions, MarketState, PriceStepEvent } from './types.ts'

// Static `node:fs` is forbidden in src/sim, including tests. Load writeSync at
// runtime so [DEBUG market] still reaches fd 1 when the reporter hides console.
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

function debugMarket(message: string): void {
  io.writeSync(1, `[DEBUG market] ${message}\n`)
}

const NOISE_FIXTURE = pathMod.join(
  pathMod.dirname(urlMod.fileURLToPath(import.meta.url)),
  '..',
  '..',
  'tests',
  'fixtures',
  'demo-30-noise-roll.txt',
)

// Same provisional list as src/content/assets.ts. Sim tests cannot import content.
const DEMO_DEFS: MarketDefinitions = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022 },
    { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018 },
    { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01 },
    { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0 },
  ],
  environment: [],
  events: [],
}

const SWEEP_SEEDS = ['demo', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'] as const
const GOLDEN_DAYS = 30
const SWEEP_DAYS = 120

function readFixture(file: string): string {
  let text: string
  try {
    text = io.readFileSync(file, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`could not read golden log ${file}: ${message}`)
  }
  return text.replaceAll('\r\n', '\n')
}

function copyState(state: MarketState): MarketState {
  const parsed: unknown = JSON.parse(JSON.stringify(state))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('[DEBUG market] JSON copy did not produce an object')
  }
  return parsed as MarketState
}

function priceSteps(state: MarketState): PriceStepEvent[] {
  const steps: PriceStepEvent[] = []
  for (const event of state.log) {
    if (event.kind === 'priceStep') steps.push(event)
  }
  return steps
}

function findIndexStep(state: MarketState): IndexStepEvent {
  for (const event of state.log) {
    if (event.kind === 'indexStep') return event
  }
  throw new Error('[DEBUG market] missing indexStep')
}

function noiseBody(line: string): string {
  const marker = 'day='
  const index = line.indexOf(marker)
  if (index < 0 || !line.includes('kind=noiseRoll')) return ''
  return line.slice(index)
}

function withinCap(previous: number, next: number): boolean {
  return Math.abs(next - previous) * DAILY_MOVE_CAP_DENOMINATOR <= previous * DAILY_MOVE_CAP_NUMERATOR
}

describe('market price step', () => {
  it('keeps seed demo noiseRoll lines identical to the Step 4 fixture', () => {
    expect(FAIR_VALUE_PULL_NUMERATOR).toBe(35)
    expect(FAIR_VALUE_PULL_DENOMINATOR).toBe(100)
    expect(DAILY_MOVE_CAP_NUMERATOR).toBe(8)
    expect(DAILY_MOVE_CAP_DENOMINATOR).toBe(100)
    expect(INDEX_LEVEL_SCALE).toBe(1000)
    expect(CENTS_PER_UNIT).toBe(100)

    const state = createMarket(DEMO_DEFS, 'demo')
    const fresh = createRng('demo')
    expect(state.day).toBe(0)
    expect(state.log).toEqual([])
    expect(state.streams).toEqual(fresh)
    const opened = DEMO_DEFS.assets.map((def) => `${def.id}:${state.assets[def.id].priceCents}`).join(',')
    debugMarket(`createMarket seed=demo day=0 assets=${opened}`)
    for (const def of DEMO_DEFS.assets) {
      const asset = state.assets[def.id]
      expect(asset.priceCents).toBe(def.startPriceCents)
      expect(asset.fairValue).toBe(def.startPriceCents)
    }

    const parallel = createRng('demo').market
    const lines: string[] = []
    for (let i = 0; i < GOLDEN_DAYS; i += 1) {
      stepMarketDay(state, DEMO_DEFS)
      expect(state.day).toBe(i + 1)
      expect(state.log).toHaveLength(9)
      for (const event of state.log) {
        if (event.kind === 'noiseRoll') expect(event.z).toBe(nextNormal(parallel))
        expect(event.day).toBe(state.day)
        const line = formatEvent(event)
        lines.push(line)
        debugMarket(line)
      }
      for (const name of ['events', 'info', 'distortion'] as const) {
        expect(state.streams[name]).toEqual(fresh[name])
      }
    }

    expect(state.day).toBe(GOLDEN_DAYS)
    expect(state.streams.market).toEqual(parallel)
    for (const def of DEMO_DEFS.assets) {
      if (def.kind !== 'stock') continue
      expect(state.assets[def.id].fairValue).toBe(def.startPriceCents)
    }
    const noise = lines.filter((line) => line.includes('kind=noiseRoll'))
    const step4 = readFixture(NOISE_FIXTURE)
      .split('\n')
      .map(noiseBody)
      .filter((line) => line.length > 0)
    expect(noise).toEqual(step4)
  })

  it('keeps every daily stock and index move within 8 percent', () => {
    expect(SWEEP_SEEDS).toHaveLength(10)
    let minSlack = Number.POSITIVE_INFINITY
    let minLabel = ''
    for (const seed of SWEEP_SEEDS) {
      const state = createMarket(DEMO_DEFS, seed)
      for (let day = 1; day <= SWEEP_DAYS; day += 1) {
        stepMarketDay(state, DEMO_DEFS)
        expect(state.day).toBe(day)
        for (const event of state.log) {
          if (event.kind !== 'priceStep' && event.kind !== 'indexStep') continue
          expect(withinCap(event.previous, event.newPrice)).toBe(true)
          const slack =
            event.previous * DAILY_MOVE_CAP_NUMERATOR -
            Math.abs(event.newPrice - event.previous) * DAILY_MOVE_CAP_DENOMINATOR
          if (slack < minSlack) {
            minSlack = slack
            minLabel = `seed=${seed} day=${day} asset=${event.asset}`
          }
          if (event.kind === 'priceStep') {
            const start = DEMO_DEFS.assets.find((def) => def.id === event.asset)?.startPriceCents
            expect(event.fair).toBe(start)
            expect(state.assets[event.asset].fairValue).toBe(start)
          }
        }
      }
    }
    debugMarket(`sweep seeds=${SWEEP_SEEDS.length} days=${SWEEP_DAYS} minCapSlack=${minSlack} ${minLabel}`)
    expect(minSlack).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(minSlack)).toBe(true)
  })

  it('moves exactly 8 percent on day 1 when fair value is 30 percent above price', () => {
    // Rounding: raw move is rounded half away from zero to integer cents, then clamped
    // to floor(price × 8 / 100) via integer arithmetic. These start prices are whole
    // currency units, so the bound is exactly 8% (price × 8 / 100 cents).
    // Pull is (fair − price) × 35 / 100. Noise is z × daily volatility × price.
    // Seed demo day 1 still clears that bound on all four stocks. Fair value is left
    // alone, so day 2's pull is 35% of the gap the cap did not close.
    const state = createMarket(DEMO_DEFS, 'demo')
    for (const def of DEMO_DEFS.assets) {
      if (def.kind !== 'stock') continue
      const lifted = (def.startPriceCents * 130) / 100
      expect(Number.isInteger(lifted)).toBe(true)
      state.assets[def.id].fairValue = lifted
    }
    stepMarketDay(state, DEMO_DEFS)
    debugMarket('fair=+30% day 1')
    for (const event of state.log) debugMarket(formatEvent(event))

    const day1 = priceSteps(state)
    expect(day1).toHaveLength(4)
    for (const step of day1) {
      const start = DEMO_DEFS.assets.find((def) => def.id === step.asset)?.startPriceCents
      if (start === undefined) throw new Error(`missing start price for ${step.asset}`)
      const fair = (start * 130) / 100
      const move = (start * 8) / 100
      expect(step.fair).toBe(fair)
      expect(step.capped).toBe(true)
      expect(step.cappedMove).toBe(move)
      expect(step.newPrice).toBe(start + move)
      expect(step.gapAfter).toBe(fair - step.newPrice)
      expect(step.gapAfter).toBe((start * 22) / 100)
      expect(withinCap(step.previous, step.newPrice)).toBe(true)
      expect((step.newPrice - step.previous) * 100).toBe(step.previous * 8)
    }
    const index = findIndexStep(state)
    expect(index.newPrice).toBe(108000)
    expect(index.cappedMove).toBe(8000)
    expect((index.newPrice - index.previous) * 100).toBe(index.previous * 8)

    const day1Prices = Object.fromEntries(day1.map((step) => [step.asset, step.newPrice]))
    stepMarketDay(state, DEMO_DEFS)
    debugMarket('fair=+30% day 2')
    for (const event of state.log) debugMarket(formatEvent(event))
    for (const step of priceSteps(state)) {
      const start = DEMO_DEFS.assets.find((def) => def.id === step.asset)?.startPriceCents
      if (start === undefined) throw new Error(`missing start price for ${step.asset}`)
      const fair = (start * 130) / 100
      expect(step.day).toBe(2)
      expect(step.previous).toBe(day1Prices[step.asset])
      expect(step.fair).toBe(fair)
      expect(state.assets[step.asset].fairValue).toBe(fair)
      expect(step.pull).toBe(((fair - step.previous) * FAIR_VALUE_PULL_NUMERATOR) / FAIR_VALUE_PULL_DENOMINATOR)
      expect(step.gapAfter).toBeGreaterThan(0)
      expect(state.assets[step.asset].priceCents).toBeLessThan(fair)
    }
  })

  it('does not add a cent that would push a 7-cent price past 8 percent', () => {
    // 7 × 1.08 = 7.56, which rounds to 8 cents and a 14% move. The cap allows
    // floor(7 × 8 / 100) = 0 cents, so the published price stays 7.
    const defs: MarketDefinitions = {
      assets: [
        { id: 'TINY', kind: 'stock', sector: 'A', startPriceCents: 7, dailyVolatility: 0 },
        { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0 },
      ],
      environment: [],
      events: [],
    }
    const state = createMarket(defs, 'demo')
    state.assets.TINY.fairValue = 100
    stepMarketDay(state, defs)
    const step = priceSteps(state)[0]
    if (step === undefined) throw new Error('missing priceStep')
    debugMarket(formatEvent(step))
    expect(step.rawMove).toBeGreaterThan(0)
    expect(step.capped).toBe(true)
    expect(step.cappedMove).toBe(0)
    expect(step.newPrice).toBe(7)
    expect(step.gapAfter).toBe(93)
    expect(withinCap(7, step.newPrice)).toBe(true)
  })

  it('hashes a seed stably and a different seed differently', () => {
    const left = createMarket(DEMO_DEFS, 'demo')
    for (let day = 0; day < 10; day += 1) stepMarketDay(left, DEMO_DEFS)
    const cloned = copyState(left)
    for (let day = 0; day < SWEEP_DAYS - 10; day += 1) {
      stepMarketDay(left, DEMO_DEFS)
      stepMarketDay(cloned, DEMO_DEFS)
    }
    const again = createMarket(DEMO_DEFS, 'demo')
    for (let day = 0; day < SWEEP_DAYS; day += 1) stepMarketDay(again, DEMO_DEFS)
    const other = createMarket(DEMO_DEFS, 'other')
    for (let day = 0; day < SWEEP_DAYS; day += 1) stepMarketDay(other, DEMO_DEFS)

    const demoHash = stateHash(left)
    const otherHash = stateHash(other)
    debugMarket(`seed=demo days=${SWEEP_DAYS} stateHash=${demoHash}`)
    debugMarket(`seed=other days=${SWEEP_DAYS} stateHash=${otherHash}`)
    expect(demoHash).toMatch(/^[0-9a-f]{16}$/)
    expect(otherHash).toMatch(/^[0-9a-f]{16}$/)
    expect(stateHash(cloned)).toBe(demoHash)
    expect(stateHash(again)).toBe(demoHash)
    expect(otherHash).not.toBe(demoHash)
    expect(left.day).toBe(SWEEP_DAYS)
  })

  it('rejects broken definitions and state before drawing', () => {
    expect(() => createMarket(undefined as never, 'demo')).toThrow('market definitions must be an object')
    expect(() => createMarket({ assets: [], environment: [], events: [] }, 'demo')).toThrow(
      'market definitions assets must be a non-empty array',
    )
    expect(() => createMarket(DEMO_DEFS, 1 as never)).toThrow('seed must be a string')
    const state = createMarket(DEMO_DEFS, 'demo')
    const market = { ...state.streams.market }
    state.day = -1
    expect(() => stepMarketDay(state, DEMO_DEFS)).toThrow('market day must be a safe integer >= 0')
    state.day = 0
    state.assets.NOVA.fairValue = Number.NaN
    expect(() => stepMarketDay(state, DEMO_DEFS)).toThrow('fairValue must be a finite number')
    expect(state.day).toBe(0)
    expect(state.streams.market).toEqual(market)
    expect(state.log).toEqual([])
  })
})
