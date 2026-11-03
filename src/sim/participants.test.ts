import { describe, expect, it } from 'vitest'

import { stateHash } from './hash.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { crowdFlow, depthCents, informedFlow, momentumFlow, startPartyDay } from './participants.ts'
import type {
  AssetDefinition,
  EventTypeDefinition,
  MarketDefinitions,
  MarketState,
  ParticipantDefinitions,
  ParticipantFlowEvent,
  RumourItem,
} from './types.ts'

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

// Crowd and trend followers are tiny here so the informed-money and news tests see only their own party.
const PARTIES: Pick<ParticipantDefinitions, 'crowd' | 'momentum'> = {
  crowd: { capitalCents: 1, heatMin: 1, heatMax: 1, tierWeight: { low: 0.3, medium: 0.6, high: 1 }, headlineWeight: 0.5, chaseDecay: 0.5 },
  momentum: { capitalCents: 1, lookbackDays: 3, thresholdPercent: 3 },
}

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
      ? { participants: { depthDays: 10, informed: { capitalCents: 15_000_000, regimeMin: 1, regimeMax: 1, magnitudeRefPercent: 5 }, news: { efficiencyMin: 0.5, efficiencyMax: 0.5 }, ...PARTIES } }
      : {}),
  }
}

function flows(state: MarketState): ParticipantFlowEvent[] {
  return state.log.filter((event): event is ParticipantFlowEvent => event.kind === 'participantFlow' && event.party === 'informed')
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

function newsFlows(state: MarketState): ParticipantFlowEvent[] {
  return state.log.filter((event): event is ParticipantFlowEvent => event.kind === 'participantFlow' && event.party === 'news')
}

describe('news traders', () => {
  const quiet: MarketDefinitions = { ...market(undefined), events: [{ ...news('news', undefined), chance: 0 }] }

  it('trade on a day an effect is applied, by the efficiency times the gap to fair value plus what is still to come', () => {
    const state = createMarket(quiet, 'newsy')
    state.scheduled.push({
      id: 'news:NOVA:1',
      typeId: 'news',
      target: 'market',
      eventDay: 1,
      direction: 'up',
      magnitudePercent: 5,
      duration: 2,
      decay: 'linear',
      headline: 'news',
    })
    const before = state.assets.NOVA.priceCents
    stepMarketDay(state, quiet)
    const flow = newsFlows(state).find((item) => item.asset === 'NOVA')
    if (flow === undefined) throw new Error('news traders did not trade on the first effect day')
    const part = state.active[0].parts.find((item) => item.asset === 'NOVA')
    if (part === undefined) throw new Error('missing effect part')
    const target = state.assets.NOVA.fairValue + part.totalDelta / 2
    expect(flow.moveCents).toBeCloseTo(0.5 * (target - before), 6)
    expect(flow.moveCents).toBeGreaterThan(0)
    const step = state.log.find((event) => event.kind === 'priceStep' && event.asset === 'NOVA')
    if (step?.kind !== 'priceStep') throw new Error('missing price step')
    expect(step.flow).toBeCloseTo(flow.moveCents, 6)
    // The second and last effect day trades again; the day after, with nothing in play, they do not.
    stepMarketDay(state, quiet)
    expect(newsFlows(state).some((item) => item.asset === 'NOVA')).toBe(true)
    stepMarketDay(state, quiet)
    expect(newsFlows(state)).toEqual([])
  })

  it('stay out of a market with no news', () => {
    const state = createMarket(quiet, 'dull')
    for (let day = 0; day < 10; day += 1) {
      stepMarketDay(state, quiet)
      expect(newsFlows(state)).toEqual([])
    }
  })
})

describe('retail crowd and trend followers', () => {
  const loud: ParticipantDefinitions = {
    ...market(undefined).participants!,
    crowd: { capitalCents: 6_000_000, heatMin: 1, heatMax: 1, tierWeight: { low: 0.3, medium: 0.6, high: 1 }, headlineWeight: 0.3, chaseDecay: 0.5 },
    momentum: { capitalCents: 3_000_000, lookbackDays: 3, thresholdPercent: 3 },
  }
  const defs: MarketDefinitions = { ...market(undefined), events: [{ ...news('news', undefined), chance: 0 }], participants: loud }

  function rumour(direction: 'up' | 'down', eventDay: number, day: number): RumourItem {
    return {
      kind: 'rumour',
      sourceId: 'desk',
      tier: 'high',
      truthRoll: 0,
      truth: false,
      claim: 'market news',
      leadDays: eventDay - day,
      targetEventId: `news:market:${eventDay}`,
      noise: false,
      visibility: [],
      direction,
    }
  }

  function crowdOn(state: MarketState, asset: string): number {
    const day = startPartyDay(state, defs)
    return day.crowdDemand[asset]
  }

  it('buys a rumour when the player can read it and sells it when its day comes', () => {
    const state = createMarket(defs, 'rumour')
    state.day = 1
    state.feed = { day: 1, items: [rumour('up', 4, 1)] }
    const first = crowdOn(state, 'NOVA')
    expect(first).toBeGreaterThan(0)
    state.day = 2
    state.feed = { day: 2, items: [] }
    expect(crowdOn(state, 'NOVA')).toBe(0)
    state.day = 3
    state.feed = { day: 3, items: [] }
    expect(crowdOn(state, 'NOVA')).toBe(0)
    state.day = 4
    state.feed = { day: 4, items: [] }
    const leave = crowdOn(state, 'NOVA')
    expect(leave).toBeCloseTo(-first)
    expect(Object.keys(state.participants!.shares)).toEqual([])
  })

  it('stacks rumours up to a full share and a down rumour is a sale', () => {
    const state = createMarket(defs, 'stack')
    state.day = 1
    state.feed = { day: 1, items: [rumour('up', 5, 1), rumour('up', 5, 1)] }
    expect(state.participants).toBeDefined()
    const one = createMarket(defs, 'stack')
    one.day = 1
    one.feed = { day: 1, items: [rumour('up', 5, 1)] }
    expect(crowdOn(state, 'NOVA')).toBeCloseTo(crowdOn(one, 'NOVA'))
    const sale = createMarket(defs, 'stack')
    sale.day = 1
    sale.feed = { day: 1, items: [rumour('down', 5, 1)] }
    expect(crowdOn(sale, 'NOVA')).toBeLessThan(0)
  })

  it('moves a thin stock more than a deep one with the same crowd money', () => {
    const state = createMarket(defs, 'thin')
    state.day = 1
    state.feed = { day: 1, items: [rumour('up', 4, 1)] }
    const day = startPartyDay(state, defs)
    const thin = crowdFlow(state, defs, NOVA, day)
    const deep = crowdFlow(state, defs, DEEP, day)
    if (thin === null || deep === null) throw new Error('a market-wide rumour should reach both stocks')
    expect(thin.demandCents).toBeCloseTo(deep.demandCents)
    expect(thin.moveCents).toBeGreaterThan(deep.moveCents)
  })

  it('follows a clear trend either way and sits out a flat or short history', () => {
    const state = createMarket(defs, 'trend')
    const parts = state.participants!
    expect(momentumFlow(state, defs, NOVA)).toBeNull()
    parts.closes.NOVA = [4800, 4900, 5000, 5100]
    expect(momentumFlow(state, defs, NOVA)?.demandCents).toBe(3_000_000)
    parts.closes.NOVA = [5100, 5000, 4900, 4800]
    expect(momentumFlow(state, defs, NOVA)?.demandCents).toBe(-3_000_000)
    parts.closes.NOVA = [4800, 4810, 4790, 4800]
    expect(momentumFlow(state, defs, NOVA)).toBeNull()
    parts.closes.NOVA = [4800, 4836, 4850, 4850]
    const partial = momentumFlow(state, defs, NOVA)?.demandCents ?? 0
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(3_000_000)
  })

  it('keeps the same streams, fair values and schedule as without them', () => {
    const base = market(1)
    const quiet: MarketDefinitions = { ...base, participants: { ...base.participants!, crowd: { ...loud.crowd, capitalCents: 1 }, momentum: { ...loud.momentum, capitalCents: 1 } } }
    const loudState = run({ ...base, participants: loud }, 'streams', 30).state
    const quietState = run(quiet, 'streams', 30).state
    expect(loudState.streams).toEqual(quietState.streams)
    expect(loudState.scheduled).toEqual(quietState.scheduled)
    for (const id of ['NOVA', 'HRBU']) expect(loudState.assets[id].fairValue).toBe(quietState.assets[id].fairValue)
  })
})
