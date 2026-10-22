// Provisional rumour sources from plan section 2.4 / GAME_DESIGN section 5.
// Six sources, two per tier. Hidden hit rates: high 85%, medium 60%, low 35%.
// Visibility is a requirement list. A reader sees the source when they have any
// one of those names. Both low-tier sources include `base`, and each also names
// a locked requirement, so a base-only feed can be tested and the filter still
// drops the locked sources. Low-tier false rumours are flagged noise in the sim.

import type { SourceDefinition } from '../sim/types.ts'

export const SOURCE_DEFINITIONS: readonly SourceDefinition[] = [
  { id: 'cityDesk', tier: 'high', hitRate: 0.85, visibility: ['infoFeed2'] },
  { id: 'floorWire', tier: 'high', hitRate: 0.85, visibility: ['jobContacts'] },
  { id: 'sectorNote', tier: 'medium', hitRate: 0.6, visibility: ['infoFeed1'] },
  { id: 'marketBrief', tier: 'medium', hitRate: 0.6, visibility: ['base'] },
  { id: 'streetTalk', tier: 'low', hitRate: 0.35, visibility: ['base', 'infoFeed1'] },
  { id: 'openChatter', tier: 'low', hitRate: 0.35, visibility: ['base', 'jobContacts'] },
]
