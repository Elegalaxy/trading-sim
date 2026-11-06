// Provisional lifestyle from GAME_DESIGN section 6. Numbers live in sim constants.
// 1E = 100000 cents. Each offer lists what every tier does, in words, built from those constants.
// Information feed tier 1 shows sectorNote (medium, not on the base feed).
// Tier 2 shows cityDesk (high) and hides noise. The stored feed is not changed.

import {
  COURSE_COST_CENTS,
  EQUIPMENT_MAX_TIER,
  EQUIPMENT_TIER_COST_CENTS,
  HEALTH_MAX_TIER,
  HEALTH_STRESS_CEILING,
  HEALTH_TIER_COST_CENTS,
  HOME_MAX_TIER,
  HOME_RECOVERY_ENERGY,
  HOME_RECOVERY_STRESS,
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
  /** What each tier does, index = tier. Tier 0 is the base. */
  benefits: readonly string[]
}

function nightly(tier: number): string {
  return `+${HOME_RECOVERY_ENERGY[tier]} energy and -${HOME_RECOVERY_STRESS[tier]} stress each night after a full sleep`
}

export const LIFESTYLE_OFFERS: readonly LifestyleOffer[] = [
  {
    id: 'home',
    name: 'Home',
    maxTier: HOME_MAX_TIER,
    tierCostCents: HOME_TIER_COST_CENTS,
    note: 'Each tier adds 0.15E a month and speeds up your recovery.',
    benefits: [
      `Shared room: ${nightly(0)}.`,
      `Studio: ${nightly(1)}. A kitchen, so you can make home-cooked meals.`,
      `Flat: ${nightly(2)}. A quiet room: a short sleep costs half as much.`,
      `House with a study: ${nightly(3)}. A home office: a bad trading day stresses you half as much.`,
    ],
  },
  {
    id: 'infoFeed',
    name: 'Information feed',
    maxTier: INFO_FEED_MAX_TIER,
    tierCostCents: INFO_FEED_TIER_COST_CENTS,
    note: `Tier 1 adds ${INFO_TIER1_SOURCE_ID}. Tier 2 adds ${INFO_TIER2_SOURCE_ID} and hides noise.`,
    benefits: [
      'Base feed.',
      `Adds the ${INFO_TIER1_SOURCE_ID} source. The first news read each day is free.`,
      `Adds the ${INFO_TIER2_SOURCE_ID} source and hides noise. Verify costs no energy (still one research point).`,
    ],
  },
  {
    id: 'health',
    name: 'Health',
    maxTier: HEALTH_MAX_TIER,
    tierCostCents: HEALTH_TIER_COST_CENTS,
    note: 'A gym membership.',
    benefits: [
      'No membership.',
      `Gym membership: gym sessions are free, and your job alone can never push stress above ${HEALTH_STRESS_CEILING}.`,
    ],
  },
  {
    id: 'equipment',
    name: 'Equipment',
    maxTier: EQUIPMENT_MAX_TIER,
    tierCostCents: EQUIPMENT_TIER_COST_CENTS,
    note: 'Better tools for trading.',
    benefits: [
      'A basic laptop.',
      'A second screen: the blur and delay from low energy are halved.',
      'A pro platform: the trading fee is 0.08% instead of 0.1%.',
    ],
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
