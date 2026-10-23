// Provisional lifestyle from GAME_DESIGN section 6. Numbers live in sim constants.
// 1E = 100000 cents. Home recovery is not applied.
// Information feed tier 1 shows sectorNote (medium, not on the base feed).
// Tier 2 shows cityDesk (high) and hides noise. The stored feed is not changed.

import {
  COURSE_COST_CENTS,
  HOME_MAX_TIER,
  HOME_TIER_COST_CENTS,
  INFO_FEED_MAX_TIER,
  INFO_FEED_TIER_COST_CENTS,
} from '../sim/constants.ts'
import type { CourseId, LifestyleCategory } from '../sim/types.ts'

/** Medium source added at information feed tier 1. Its requirement is `infoFeed1`. */
export const INFO_TIER1_SOURCE_ID = 'sectorNote'

/** High source added at information feed tier 2. Its requirement is `infoFeed2`. */
export const INFO_TIER2_SOURCE_ID = 'cityDesk'

export type LifestyleOffer = {
  id: LifestyleCategory
  name: string
  maxTier: number
  tierCostCents: number
  note: string
}

export const LIFESTYLE_OFFERS: readonly LifestyleOffer[] = [
  {
    id: 'home',
    name: 'Home',
    maxTier: HOME_MAX_TIER,
    tierCostCents: HOME_TIER_COST_CENTS,
    note: 'Each tier adds 0.15E a month. Recovery is not applied yet.',
  },
  {
    id: 'infoFeed',
    name: 'Information feed',
    maxTier: INFO_FEED_MAX_TIER,
    tierCostCents: INFO_FEED_TIER_COST_CENTS,
    note: `Tier 1 adds ${INFO_TIER1_SOURCE_ID}. Tier 2 adds ${INFO_TIER2_SOURCE_ID} and hides noise.`,
  },
]

export type CourseOffer = {
  id: CourseId
  name: string
  costCents: number
  unlocks: string
}

export const COURSE_OFFERS: readonly CourseOffer[] = [
  { id: 'basic', name: 'Basic', costCents: COURSE_COST_CENTS, unlocks: 'Office clerk' },
  {
    id: 'finance',
    name: 'Finance',
    costCents: COURSE_COST_CENTS,
    unlocks: 'Trading-floor assistant and Freelance analyst',
  },
]
