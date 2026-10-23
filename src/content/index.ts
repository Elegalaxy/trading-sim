import type { MarketDefinitions } from '../sim/types.ts'
import { ASSET_DEFINITIONS } from './assets.ts'
import { CALENDAR_DEFINITIONS } from './calendar.ts'
import { ENVIRONMENT_DEFINITIONS } from './environment.ts'
import { EVENT_DEFINITIONS } from './events.ts'
import { SOURCE_DEFINITIONS } from './sources.ts'

export const MARKET_DEFINITIONS = {
  assets: ASSET_DEFINITIONS,
  environment: ENVIRONMENT_DEFINITIONS,
  events: EVENT_DEFINITIONS,
  calendar: CALENDAR_DEFINITIONS,
  sources: SOURCE_DEFINITIONS,
} satisfies MarketDefinitions

export { ASSET_DEFINITIONS } from './assets.ts'
export { CALENDAR_DEFINITIONS } from './calendar.ts'
export { ENVIRONMENT_DEFINITIONS } from './environment.ts'
export { EVENT_DEFINITIONS } from './events.ts'
export { SOURCE_DEFINITIONS } from './sources.ts'
export { CONSUMABLE_DEFINITIONS } from './consumables.ts'
export { JOB_DEFINITIONS } from './jobs.ts'
export { COURSE_OFFERS, INFO_TIER1_SOURCE_ID, INFO_TIER2_SOURCE_ID, LIFESTYLE_OFFERS } from './lifestyle.ts'
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
