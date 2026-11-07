import { describe, expect, it } from 'vitest'

import { MARKET_DEFINITIONS } from './index.ts'
import { expectedDrift } from '../sim/drift.ts'
import { initialEnvironment } from '../sim/environment.ts'
import type { EventTypeDefinition, MarketDefinitions } from '../sim/types.ts'

// The analytic drift is compared with a sum written out by hand for NOVA (sector A).

const env = initialEnvironment(MARKET_DEFINITIONS.environment)
const nova = MARKET_DEFINITIONS.assets.find((asset) => asset.id === 'NOVA')
const index = MARKET_DEFINITIONS.assets.find((asset) => asset.id === 'M4X')
if (nova === undefined || index === undefined) throw new Error('assets missing')

function event(id: string, scope: EventTypeDefinition['scope'], targets: string[], chance: number): EventTypeDefinition {
  return {
    id,
    scope,
    targets,
    chance,
    direction: { up: 0.6, down: 0.3, none: 0.1 },
    magnitudeMin: 2,
    magnitudeMax: 6,
    duration: 3,
    decay: 'linear',
    headline: id,
    modifiers: [],
  }
}

describe('expectedDrift', () => {
  it('equals a hand sum of the event terms for one stock', () => {
    const defs: MarketDefinitions = {
      ...MARKET_DEFINITIONS,
      calendar: undefined,
      events: [
        event('own', 'stock', ['NOVA', 'BLSW'], 0.1), // reaches NOVA once: 0.1 x 0.3 x 4
        event('sec', 'sector', ['A', 'B'], 0.05), // reaches NOVA through A: 0.05 x 0.3 x 4
        event('mkt', 'market', ['market'], 0.02), // reaches every stock: 0.02 x 0.3 x 4
      ],
    }
    const hand = (0.1 * 0.3 * 4 + 0.05 * 0.3 * 4 + 0.02 * 0.3 * 4) / 100
    expect(expectedDrift(defs, nova, env)).toBeCloseTo(hand, 12)
  })

  it('equals a hand sum of the calendar terms at the starting bands (growth and inflation mid, policy mid/mid)', () => {
    const defs: MarketDefinitions = { ...MARKET_DEFINITIONS, events: [] }
    const growth = 0.25 * 3 + 0.5 * 0.4 + 0.25 * -2.5
    const inflation = 0.25 * -1 + 0.5 * -0.2 + 0.25 * 0.8
    const policy = 0.5 * 0.25 + 0.35 * -1.5 + 0.15 * 1
    const hand = (growth + inflation + policy) / 30 / 100
    expect(expectedDrift(defs, nova, env)).toBeCloseTo(hand, 12)
  })

  it('is 0 for an index and negative for the shipped content', () => {
    expect(expectedDrift(MARKET_DEFINITIONS, index, env)).toBe(0)
    expect(expectedDrift(MARKET_DEFINITIONS, nova, env)).toBeLessThan(0)
  })
})
