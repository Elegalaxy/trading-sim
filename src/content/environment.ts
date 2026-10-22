// Provisional environment from plan section 2.4 / GAME_DESIGN section 5.
// Values are percent. Drift is per day, times one events-stream normal.
// The policy rate does not drift. The calendar in Step 7 is what changes it.
// More entries can be appended. The simulation walks this list. It has no per-name branch.

import type { EnvironmentEntryDefinition } from '../sim/types.ts'

export const ENVIRONMENT_DEFINITIONS: readonly EnvironmentEntryDefinition[] = [
  { id: 'growth', start: 2, driftSpeed: 0.01 },
  { id: 'inflation', start: 3, driftSpeed: 0.01 },
  { id: 'policyRate', start: 4, driftSpeed: 0 },
]
