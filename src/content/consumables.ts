// Provisional food, drink and care items (plan items and lifestyle, Step L1).
// 1E = 100000 cents. Each item can be used once per day, paid from cash, applied at once.
// `next*` lands at the next End day (a crash, a hangover). The home-cooked meal needs a kitchen
// (Home tier 1) and the gym session is free with the Health membership.
// Overnight recovery comes from the Home tier (sim/stats.ts), not from these amounts.

import type { ConsumableDefinition } from '../sim/types.ts'

export const CONSUMABLE_DEFINITIONS: readonly ConsumableDefinition[] = [
  { id: 'coffee', name: 'Coffee', costCents: 400, energy: 12, stress: 2 },
  { id: 'energyDrink', name: 'Energy drink', costCents: 600, energy: 22, stress: 0, nextEnergy: -10 },
  { id: 'herbalTea', name: 'Herbal tea', costCents: 300, energy: 0, stress: -8 },
  { id: 'takeawayMeal', name: 'Takeaway meal', costCents: 1_800, energy: 10, stress: -5 },
  { id: 'homeCookedMeal', name: 'Home-cooked meal', costCents: 800, energy: 10, stress: -6, requiresHome: 1 },
  { id: 'gymSession', name: 'Gym session', costCents: 1_200, energy: -6, stress: -15, nextEnergy: 4, freeWithHealth: true },
  { id: 'nightOut', name: 'Night out', costCents: 6_000, energy: 0, stress: -28, nextEnergy: -12 },
  { id: 'massage', name: 'Massage', costCents: 8_000, energy: 5, stress: -35 },
]
