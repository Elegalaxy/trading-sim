// Provisional macro calendar from plan section 2.4 / GAME_DESIGN section 5.
// A month is 30 days. Growth prints on day 10, inflation on day 20, and the
// policy rate is decided on day 25. A hike or cut is 0.25 percentage points.
// Every chance and effect below is a tuning placeholder.
//
// Bands: inflation low < 2, high >= 4; growth low < 1, high >= 3. Starts are
// growth 2 (mid) and inflation 3 (mid). Policy `up` is a hike.
// A hike's fair-value percent is more negative for sector B than for sector A.

import type {
  CalendarDefinitions,
  CalendarEffectCell,
  PolicyChanceCell,
  ReleaseChanceCell,
} from '../sim/types.ts'

function policy(
  inflationBand: PolicyChanceCell['inflationBand'],
  growthBand: PolicyChanceCell['growthBand'],
  hold: number,
  up: number,
  down: number,
): PolicyChanceCell {
  return { inflationBand, growthBand, hold, up, down }
}

function release(band: ReleaseChanceCell['band'], above: number, inline: number, below: number): ReleaseChanceCell {
  return { band, above, inline, below }
}

function effect(
  kind: CalendarEffectCell['kind'],
  outcome: CalendarEffectCell['outcome'],
  sector: CalendarEffectCell['sector'],
  percent: number,
): CalendarEffectCell {
  return { kind, outcome, sector, percent }
}

const POLICY_EFFECTS: readonly CalendarEffectCell[] = [
  effect('policyDecision', 'up', 'A', -1.5),
  effect('policyDecision', 'up', 'B', -4),
  effect('policyDecision', 'down', 'A', 1),
  effect('policyDecision', 'down', 'B', 3),
  effect('policyDecision', 'hold', 'A', 0.25),
  effect('policyDecision', 'hold', 'B', -0.25),
]

const GROWTH_EFFECTS: readonly CalendarEffectCell[] = [
  effect('growthRelease', 'above', 'A', 3),
  effect('growthRelease', 'above', 'B', 1),
  effect('growthRelease', 'inline', 'A', 0.4),
  effect('growthRelease', 'inline', 'B', 0.2),
  effect('growthRelease', 'below', 'A', -2.5),
  effect('growthRelease', 'below', 'B', -0.8),
]

const INFLATION_EFFECTS: readonly CalendarEffectCell[] = [
  effect('inflationRelease', 'above', 'A', -1),
  effect('inflationRelease', 'above', 'B', -2.5),
  effect('inflationRelease', 'inline', 'A', -0.2),
  effect('inflationRelease', 'inline', 'B', -0.5),
  effect('inflationRelease', 'below', 'A', 0.8),
  effect('inflationRelease', 'below', 'B', 1.5),
]

export const CALENDAR_DEFINITIONS: CalendarDefinitions = {
  daysPerMonth: 30,
  schedule: [
    { kind: 'growthRelease', dayOfMonth: 10, entryId: 'growth' },
    { kind: 'inflationRelease', dayOfMonth: 20, entryId: 'inflation' },
    { kind: 'policyDecision', dayOfMonth: 25, entryId: 'policyRate' },
  ],
  growthEntryId: 'growth',
  inflationEntryId: 'inflation',
  policyEntryId: 'policyRate',
  inflationLowBelow: 2,
  inflationHighAt: 4,
  growthLowBelow: 1,
  growthHighAt: 3,
  rateStep: 0.25,
  policy: [
    policy('low', 'low', 0.7, 0.05, 0.25),
    policy('low', 'mid', 0.65, 0.1, 0.25),
    policy('low', 'high', 0.55, 0.15, 0.3),
    policy('mid', 'low', 0.45, 0.4, 0.15),
    policy('mid', 'mid', 0.5, 0.35, 0.15),
    policy('mid', 'high', 0.4, 0.45, 0.15),
    policy('high', 'low', 0.25, 0.65, 0.1),
    policy('high', 'mid', 0.2, 0.7, 0.1),
    policy('high', 'high', 0.15, 0.75, 0.1),
  ],
  growthRelease: [
    release('low', 0.1, 0.25, 0.65),
    release('mid', 0.25, 0.5, 0.25),
    release('high', 0.65, 0.25, 0.1),
  ],
  inflationRelease: [
    release('low', 0.1, 0.25, 0.65),
    release('mid', 0.25, 0.5, 0.25),
    release('high', 0.65, 0.25, 0.1),
  ],
  effects: [...POLICY_EFFECTS, ...GROWTH_EFFECTS, ...INFLATION_EFFECTS],
}
