// Provisional food and drink from the first-playable plan (Q10).
// 1E = 100000 cents. Each item can be used once per day.
// Home recovery is not folded into these amounts.

import type { ConsumableDefinition } from '../sim/types.ts'

export const CONSUMABLE_DEFINITIONS: readonly ConsumableDefinition[] = [
  { id: 'coffee', name: 'Coffee', costCents: 1_000, energy: 15, stress: 0 },
  { id: 'herbalTea', name: 'Herbal tea', costCents: 1_000, energy: 0, stress: -12 },
  { id: 'homeCookedMeal', name: 'Home-cooked meal', costCents: 2_000, energy: 8, stress: -6 },
  { id: 'nightOut', name: 'Night out', costCents: 6_000, energy: 0, stress: -25 },
]
