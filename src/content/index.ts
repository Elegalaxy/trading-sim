import type { MarketDefinitions } from '../sim/types.ts'
import { ASSET_DEFINITIONS } from './assets.ts'
import { ENVIRONMENT_DEFINITIONS } from './environment.ts'
import { EVENT_DEFINITIONS } from './events.ts'

export const MARKET_DEFINITIONS = {
  assets: ASSET_DEFINITIONS,
  environment: ENVIRONMENT_DEFINITIONS,
  events: EVENT_DEFINITIONS,
} satisfies MarketDefinitions

export { ASSET_DEFINITIONS } from './assets.ts'
export { ENVIRONMENT_DEFINITIONS } from './environment.ts'
export { EVENT_DEFINITIONS } from './events.ts'
export type {
  AssetDefinition,
  AssetKind,
  DecayShape,
  EnvironmentEntryDefinition,
  EventDirection,
  EventScope,
  EventTypeDefinition,
  MarketDefinitions,
  SectorId,
} from '../sim/types.ts'
