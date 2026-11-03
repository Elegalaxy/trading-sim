import { describe, expect, it } from 'vitest'

import { stateHash } from './hash.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { depthCents, informedFlow } from './participants.ts'
import type { AssetDefinition, EventTypeDefinition, MarketDefinitions, MarketState, ParticipantFlowEvent } from './types.ts'

// Static `node:fs` is forbidden in src/sim, including tests, so load it at runtime.
const io = (await import(['node', 'fs'].join(':'))) as { readFileSync: (path: string, encoding: 'utf8') => string }
const pathMod = (await import(['node', 'path'].join(':'))) as {
  dirname: (path: string) => string
  join: (...parts: string[]) => string
}
const urlMod = (await import(['node', 'url'].join(':'))) as { fileURLToPath: (url: string) => string }

const NOVA: AssetDefinition = {
  id: 'NOVA',
  kind: 'stock',
  sector: 'A',
  startPriceCents: 4800,
  dailyVolatility: 0.022,
  spreadPpm: 4000,
  borrowFeePpm: 300,
  liquidityNotionalCents: 100_000_000,
}
const DEEP: AssetDefinition = { ...NOVA, id: 'HRBU', sector: 'B', startPriceCents: 4800, liquidityNotionalCents: 400_000_000 }
const INDEX: AssetDefinition = { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 }

function news(id: string, leak: number | undefined): EventTypeDefinition {
  return {
    id,
    scope: 'market',
    targets: ['market'],
    chance: 0.12,
    direction: { up: 1, down: 0, none: 0 },
    magnitudeMin: 5,
    magnitudeMax: 5,
    duration: 2,
    decay: 'linear',
    headline: '{target} news',
    ...(leak === undefined ? {} : { leak }),
    modifiers: [],
  }
}

function market(leak: number | undefined, participants = true): MarketDefinitions {
  return {
    assets: [NOVA, DEEP, INDEX],
    environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
    events: [news('news', leak)],
    ...(participants
      ? { participants: { depthDays: 10, informed: { capitalCents: 15_000_000, regimeMin: 1, regimeMax: 1, magnitudeRefPercent: 5 } } }
      : {}),
  }
}

function flows(state: MarketState): ParticipantFlowEvent[] {
  return state.log.filter((event): event is ParticipantFlowEvent => event.kind === 'participantFlow')
}

function run(defs: MarketDefinitions, seed: string, days: number): { state: MarketState; flows: ParticipantFlowEvent[] } {
  const state = createMarket(defs, seed)
  const found: ParticipantFlowEvent[] = []
  for (let day = 0; day < days; day += 1) {
    stepMarketDay(state, defs)
    found.push(...flows(state))
  }
  return { state, flows: found }
}

describe('informed money', () => {
  it('trades ahead of a leaked event for two days, in its direction, more on the second, and stops when it fires', () => {
    const { flows: found } = run(market(1), 'leak', 60)
    expect(found.length).toBeGreaterThan(0)
    for (const flow of found) expect(flow.demandCents).toBeGreaterThan(0)
    const byEvent = new Map<string, ParticipantFlowEvent[]>()
    for (const flow of found.filter((item) => item.asset === 'NOVA' && item.events.length === 1)) {
      const list = byEvent.get(flow.events[0]) ?? []
      list.push(flow)
      byEvent.set(flow.events[0], list)
    }
    const days = [...byEvent.values()].find((list) => list.length === 2)
    if (days === undefined) throw new Error('no event was traded alone for its two days')
    expect(days[0].demandCents).toBeLessThan(days[1].demandCents)
    const eventDay = Number(days[0].events[0].split(':')[2])
    expect(days[1].day).toBe(eventDay - 1)
    expect(days[0].day).toBe(eventDay - 2)
    expect(days[1].demandCents / days[0].demandCents).toBeCloseTo(1.5)
  })

  it('does not trade types without a leak, and adds nothing without participants', () => {
    expect(run(market(undefined), 'quiet', 12).flows).toEqual([])
    expect(run(market(0), 'quiet', 12).flows).toEqual([])
    const plain = market(1, false)
    const result = run(plain, 'plain', 12)
    expect(result.flows).toEqual([])
    expect(result.state.participants).toBeUndefined()
  })

  it('moves a thin stock more than a deep one for the same demand', () => {
    const defs = market(1)
    const state = createMarket(defs, 'size')
    for (let i = 0; i < 20 && flows(state).length === 0; i += 1) stepMarketDay(state, defs)
    const thin = informedFlow(state, defs, NOVA)
    const deep = informedFlow(state, defs, DEEP)
    if (thin === null || deep === null) throw new Error('market-wide news should flow into both stocks')
    expect(thin.demandCents).toBeCloseTo(deep.demandCents)
    expect(depthCents(DEEP, defs.participants!)).toBe(4 * depthCents(NOVA, defs.participants!))
    expect(thin.moveCents / thin.depthCents).toBeCloseTo(deep.moveCents / deep.depthCents, 6)
    expect(Math.abs(thin.moveCents)).toBeGreaterThan(Math.abs(deep.moveCents))
  })

  it('keeps the same four streams and fair values as the plain market', () => {
    const withParties = run(market(1), 'same', 25).state
    const without = run(market(1, false), 'same', 25).state
    expect(withParties.streams).toEqual(without.streams)
    expect(withParties.scheduled).toEqual(without.scheduled)
    for (const id of ['NOVA', 'HRBU']) expect(withParties.assets[id].fairValue).toBe(without.assets[id].fairValue)
    expect(withParties.assets.NOVA.priceCents).not.toBe(without.assets.NOVA.priceCents)
  })

  it('is the same for the same seed and different for another', () => {
    const a = run(market(1), 'abc', 20).state
    const b = run(market(1), 'abc', 20).state
    const c = run(market(1), 'abd', 20).state
    expect(stateHash(a)).toBe(stateHash(b))
    expect(stateHash(a)).not.toBe(stateHash(c))
  })

  it('forgets an event once it has fired', () => {
    const { state } = run(market(1), 'prune', 30)
    const waiting = new Set(state.scheduled.map((event) => event.id))
    for (const id of state.participants?.leaked ?? []) expect(waiting.has(id)).toBe(true)
  })

  it('never reads player state', () => {
    const file = pathMod.join(pathMod.dirname(urlMod.fileURLToPath(import.meta.url)), 'participants.ts')
    const source = io.readFileSync(file, 'utf8')
    for (const word of ['GameState', 'positions', 'resting', 'perception', 'accounts']) {
      expect(source.includes(word)).toBe(false)
    }
  })
})
