// Provisional layoff odds from plan layoffs, loans and deposits, section 4.2. Every number is a placeholder.
// Each employer has a base chance per roll day (the growth-release day of a month: 10, 40, 70).
// A weak growth print adds to it, a strong one takes from it. A sector that fell 5% or more over
// 20 days adds more, one that rose 5% or more takes a little. The sum is clamped to 0 .. 0.40.
// A warning is real 60% of the time. The freelance analyst has no employer, so it is not listed.
// Sectors: shop and warehouse follow consumer spending (A); the office clerk and the trading
// floor are rate-sensitive back-office work (B).

import type { LayoffDefinitions } from '../sim/types.ts'

export const LAYOFF_DEFINITIONS: LayoffDefinitions = {
  jobs: [
    { jobId: 'shopAssistant', sector: 'A', baseChance: 0.08 },
    { jobId: 'nightWarehouse', sector: 'A', baseChance: 0.1 },
    { jobId: 'officeClerk', sector: 'B', baseChance: 0.04 },
    { jobId: 'tradingFloor', sector: 'B', baseChance: 0.08 },
  ],
  growthBelow: 0.08,
  growthAbove: -0.04,
  sectorFall: 0.05,
  sectorRise: -0.04,
  sectorMovePercent: 5,
  maxChance: 0.4,
  trueChance: 0.6,
}
