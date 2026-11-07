// Market model choice for the harness (price-model plan, Step P2). `current` is
// MARKET_DEFINITIONS as shipped; `traders` adds the trader definitions so the traders model
// prices the run. Both batch and single runs read it from --model.

import { MARKET_DEFINITIONS } from '../content/index.ts'
import { TRADER_DEFINITIONS } from '../content/traders.ts'
import type { MarketDefinitions } from '../sim/types.ts'

export const MODEL_NAMES = ['current', 'traders'] as const
export type ModelName = (typeof MODEL_NAMES)[number]

export function isModelName(value: string): value is ModelName {
  return (MODEL_NAMES as readonly string[]).includes(value)
}

export function definitionsFor(model: ModelName): MarketDefinitions {
  return model === 'traders' ? { ...MARKET_DEFINITIONS, traders: TRADER_DEFINITIONS } : MARKET_DEFINITIONS
}
