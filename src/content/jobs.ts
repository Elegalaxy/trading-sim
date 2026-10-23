// Provisional jobs from GAME_DESIGN section 6. 1E = 100000 cents.
// Pay is monthly, before the 30-day proration in the sim.
// Office clerk, trading-floor assistant, and freelance analyst name a course.
// Those courses are not sold yet, so the jobs stay locked.
// Energy and stress costs are stored for a later step and are not applied here.

import type { JobDefinition } from '../sim/types.ts'

export const JOB_DEFINITIONS: readonly JobDefinition[] = [
  {
    id: 'jobless',
    name: 'Jobless',
    slots: 0,
    payCents: 0,
    requirement: 'none',
    perk: 'none',
    energyCost: 0,
    stressCost: 0,
    sleepHours: 8,
  },
  {
    id: 'shopAssistant',
    name: 'Shop assistant',
    slots: 1,
    payCents: 60_000,
    requirement: 'none',
    perk: 'staffDiscount',
    energyCost: 5,
    stressCost: 2,
    sleepHours: 8,
  },
  {
    id: 'officeClerk',
    name: 'Office clerk',
    slots: 2,
    payCents: 110_000,
    requirement: 'basic',
    perk: 'steadyRoutine',
    energyCost: 10,
    stressCost: 8,
    sleepHours: 8,
  },
  {
    id: 'nightWarehouse',
    name: 'Night-shift warehouse',
    slots: 2,
    payCents: 130_000,
    requirement: 'none',
    perk: 'quietBreaks',
    energyCost: 20,
    stressCost: 12,
    sleepHours: 6,
  },
  {
    id: 'tradingFloor',
    name: 'Trading-floor assistant',
    slots: 2,
    payCents: 100_000,
    requirement: 'finance',
    perk: 'industryContacts',
    energyCost: 12,
    stressCost: 15,
    sleepHours: 7,
  },
  {
    id: 'freelanceAnalyst',
    name: 'Freelance analyst',
    slots: 1,
    payCents: 80_000,
    requirement: 'finance',
    perk: 'analystTools',
    energyCost: 6,
    stressCost: 6,
    sleepHours: 8,
  },
]
