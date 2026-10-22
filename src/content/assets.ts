// Provisional asset list from plan section 2.4 / GAME_DESIGN section 5.
// Sector A (growth): NOVA, BLSW. Sector B (rate): HRBU, KSR.
// Stock order is the daily market-stream draw order. The index is not drawn.
// Start prices are cents. Daily volatility is the one-day return standard deviation.
// spreadPpm is the full spread (1000 ppm = 0.10%, 4000 ppm = 0.40%).
// borrowFeePpm is the daily short borrow fee (100 ppm = 0.01%, 300 ppm = 0.03%).
// Wider names are the more volatile ones. The index is tighter than NOVA.

import type { AssetDefinition } from '../sim/types.ts'

export const ASSET_DEFINITIONS: readonly AssetDefinition[] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
  { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018, spreadPpm: 3000, borrowFeePpm: 200 },
  { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100 },
  { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014, spreadPpm: 2000, borrowFeePpm: 150 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
]
