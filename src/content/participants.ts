// Order-flow parties (plan market depth, Step M4). Provisional placeholders.
// Price moves by net demand over depth, and depth is a stock's daily traded value
// (`liquidityNotionalCents`) times `depthDays`. A fund with a fixed amount of money therefore
// moves a thin stock more than a deep one.
// Informed money hears of some scheduled events (`leak` on the event type, scaled by the run's
// regime) and buys or sells ahead of them, more each day as the event gets closer.
// Rough size, NOVA ($1M a day, depth $10M): a full-size leak is $150k on the last day, 1.5%
// of the price; BLSW ($4M a day) feels a quarter of that.

import type { ParticipantDefinitions } from '../sim/types.ts'

export const PARTICIPANT_DEFINITIONS: ParticipantDefinitions = {
  depthDays: 10,
  informed: {
    capitalCents: 15_000_000,
    regimeMin: 0.5,
    regimeMax: 1.5,
    magnitudeRefPercent: 5,
  },
  news: {
    efficiencyMin: 0.4,
    efficiencyMax: 0.7,
  },
}
