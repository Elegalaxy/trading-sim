// Placeholder trader numbers (price-model plan, Step P1). Not wired into MARKET_DEFINITIONS
// until Step P6; tuned in Step P5. Base weights are in depth units: a position of 1 would be one
// whole depth, which moves the price by 100%. Value at 0.1 is a party that holds 10% of a depth
// at a full signal (a 10% gap). Scaled down from the first draft (value 3) in Step P2: at 3 a
// single day's wanted trade is 150% of the price and the 8% cap binds every day. Noise ignores
// its base except through the normalisation: its size is dailyVolatility x noiseShare x mix.

import type { TraderDefinitions } from '../sim/types.ts'

export const TRADER_DEFINITIONS: TraderDefinitions = {
  types: {
    value: { base: 0.1, mixMin: 0.5, mixMax: 1.5, rate: 0.5 },
    noise: { base: 0.03, mixMin: 0.5, mixMax: 1.5, rate: 1 },
    informed: { base: 0.03, mixMin: 0.3, mixMax: 2, rate: 0.7 },
    news: { base: 0.03, mixMin: 0.5, mixMax: 1.5, rate: 1 },
    consensus: { base: 0.03, mixMin: 0.5, mixMax: 1.5, rate: 0.7 },
    crowd: { base: 0.03, mixMin: 0.3, mixMax: 2.5, rate: 0.6 },
    trend: { base: 0.015, mixMin: 0.3, mixMax: 2, rate: 0.5 },
    contrarian: { base: 0.015, mixMin: 0.3, mixMax: 2, rate: 0.5 },
  },
  efficiencyMin: 0.5,
  efficiencyMax: 1.3,
  premiumPerDay: 0.0002,
  // Measured (P2b, 100 seeds x 1,000 days x 4 stocks): fair value falls 0.0245 points a day faster than
  // `expectedDrift` and a mean log change sits 0.016 below the simple mean; 0.0005 (0.05 points) puts the
  // anchor's mean log change at the premium.
  carryCorrectionPerDay: 0.0005,
  // P3: 3 days (the plan's first guess) made value traders sell every fresh news move against a stale
  // anchor, so an average event gave back about a third of its day-0 move before recovering; 1.5 halves that.
  anchorHalfLifeDays: 1.5,
  valueDeadBand: 0.01,
  valueFullGap: 0.1,
  valueDeepGap: 0.2,
  valueDeepSlope: 3,
  valueMaxMultiple: 3,
  noiseAr: 0.7,
  noiseShare: 0.5,
  informedMagnitudeRefPercent: 5,
  informedHoldDays: 1,
  informedDecayDays: 3,
  newsHoldDays: 3,
  newsDecayDays: 3,
  consensusRampDays: 2,
  consensusDecayDays: 4,
  crowdReturnDays: 5,
  crowdDrawdownDays: 10,
  crowdReturnScale: 0.05,
  crowdCapitulation: -0.08,
  crowdMoodClamp: 1.5,
  trendDays: 5,
  trendScale: 0.04,
  contrarianThreshold: 0.04,
  contrarianScale: 0.04,
  contrarianMoodWeight: 0.3,
  contrarianFlowWeight: 0.5,
  contrarianFlowScale: 0.02,
  volEwma: 0.1,
  // P3: at 1 the thinning fed on the news days' own volatility (13% of stock-days capped); 0.25 gives under 3%.
  volSens: 0.25,
  depthScaleMin: 0.4,
}
