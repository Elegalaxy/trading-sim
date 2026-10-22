// Provisional asset list from plan section 2.4 / GAME_DESIGN section 5.
// Sector A (growth): NOVA, BLSW. Sector B (rate): HRBU, KSR.
// Stock order is the daily market-stream draw order. The index is not drawn.
// Start prices are cents. Daily volatility is the one-day return standard deviation.

import type { MarketDefinitions } from '../sim/types.ts'

export const MARKET_DEFINITIONS = {
  assets: [
    { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022 },
    { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018 },
    { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01 },
    { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014 },
    { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0 },
  ],
} satisfies MarketDefinitions
