// Market model choice for the harness (price-model plan, Step P2). `current` is
// MARKET_DEFINITIONS with `traders` stripped (the old price model); `traders` is the shipped
// MARKET_DEFINITIONS (traders wired in at P6). Both batch and single runs read it from --model.

import { MARKET_DEFINITIONS, TRADER_DEFINITIONS } from '../content/index.ts'
import type { MarketDefinitions } from '../sim/types.ts'

export const MODEL_NAMES = ['current', 'traders'] as const
export type ModelName = (typeof MODEL_NAMES)[number]

export function isModelName(value: string): value is ModelName {
  return (MODEL_NAMES as readonly string[]).includes(value)
}

export function definitionsFor(model: ModelName): MarketDefinitions {
  if (model === 'traders') return { ...MARKET_DEFINITIONS, traders: TRADER_DEFINITIONS }
  const { traders: _traders, ...withoutTraders } = MARKET_DEFINITIONS
  return withoutTraders
}
