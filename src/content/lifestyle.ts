// Provisional lifestyle from GAME_DESIGN section 6. Numbers live in sim constants.
// 1E = 100000 cents. Each offer lists what every tier does as badges (a stat change, or a perk with a
// tooltip), built from those constants. Tier 0 is the base.
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

/** A stat change (each night, for Home) or a perk with a tooltip that says what it does. */
export type TierBadge =
  | { kind: 'energy' | 'stress'; value: number; title?: string }
  | { kind: 'perk'; text: string; title: string }

export type LifestyleTier = {
  name: string
  badges: readonly TierBadge[]
}

export type LifestyleOffer = {
  id: LifestyleCategory
  name: string
  maxTier: number
  tierCostCents: number
  note: string
  /** What each tier is and does, index = tier. */
  tiers: readonly LifestyleTier[]
}

const NIGHT = 'Each night after a full sleep.'

function home(tier: number, name: string, perk?: Extract<TierBadge, { kind: 'perk' }>): LifestyleTier {
  return {
    name,
    badges: [
      { kind: 'energy', value: HOME_RECOVERY_ENERGY[tier] ?? 0, title: NIGHT },
      { kind: 'stress', value: -(HOME_RECOVERY_STRESS[tier] ?? 0), title: NIGHT },
      ...(perk === undefined ? [] : [perk]),
    ],
  }
}

export const LIFESTYLE_OFFERS: readonly LifestyleOffer[] = [
  {
    id: 'home',
    name: 'Home',
    maxTier: HOME_MAX_TIER,
    tierCostCents: HOME_TIER_COST_CENTS,
    note: 'Recovery each night after a full sleep.',
    tiers: [
      home(0, 'Shared room'),
      home(1, 'Studio', { kind: 'perk', text: 'Kitchen', title: 'You can make home-cooked meals.' }),
      home(2, 'Flat', { kind: 'perk', text: 'Quiet room', title: 'A short sleep costs half as much energy and stress.' }),
      home(3, 'House with a study', {
        kind: 'perk',
        text: 'Home office',
        title: 'A big losing day and a margin warning stress you half as much.',
      }),
    ],
  },
  {
    id: 'infoFeed',
    name: 'Information feed',
    maxTier: INFO_FEED_MAX_TIER,
    tierCostCents: INFO_FEED_TIER_COST_CENTS,
    note: 'More sources and a cleaner feed.',
    tiers: [
      { name: 'Base feed', badges: [] },
      {
        name: 'Sector notes',
        badges: [
          { kind: 'perk', text: 'Sector notes', title: `Adds the ${INFO_TIER1_SOURCE_ID} source.` },
          { kind: 'perk', text: 'Free first read', title: 'The first news read each day costs no energy.' },
        ],
      },
      {
        name: 'City desk',
        badges: [
          { kind: 'perk', text: 'City desk', title: `Adds the ${INFO_TIER2_SOURCE_ID} source.` },
          { kind: 'perk', text: 'No noise', title: 'Hides noise rumours.' },
          { kind: 'perk', text: 'Free Verify', title: 'Verify costs no energy. It still costs one research point.' },
        ],
      },
    ],
  },
  {
    id: 'health',
    name: 'Health',
    maxTier: HEALTH_MAX_TIER,
    tierCostCents: HEALTH_TIER_COST_CENTS,
    note: 'A gym membership.',
    tiers: [
      { name: 'No membership', badges: [] },
      {
        name: 'Gym membership',
        badges: [
          { kind: 'perk', text: 'Free gym', title: 'Gym sessions cost nothing.' },
          { kind: 'perk', text: `Stress cap ${HEALTH_STRESS_CEILING}`, title: `Your job alone can never push stress above ${HEALTH_STRESS_CEILING}.` },
        ],
      },
    ],
  },
  {
    id: 'equipment',
    name: 'Equipment',
    maxTier: EQUIPMENT_MAX_TIER,
    tierCostCents: EQUIPMENT_TIER_COST_CENTS,
    note: 'Better tools for trading.',
    tiers: [
      { name: 'Basic laptop', badges: [] },
      {
        name: 'Second screen',
        badges: [{ kind: 'perk', text: 'Half blur', title: 'The blur and delay from low energy are halved.' }],
      },
      {
        name: 'Pro platform',
        badges: [
          { kind: 'perk', text: 'Half blur', title: 'The blur and delay from low energy are halved.' },
          { kind: 'perk', text: 'Fee 0.08%', title: 'The trading fee is 0.08% instead of 0.1%.' },
        ],
      },
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
