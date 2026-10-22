// RNG stream names, in splitmix32 expansion order. Do not reorder: the sequence
// for a seed depends on this order.
export const RNG_STREAM_NAMES = ['market', 'events', 'info', 'distortion'] as const

export type RngStreamName = (typeof RNG_STREAM_NAMES)[number]

/**
 * One named random stream.
 *
 * `a`, `b`, `c`, and `d` are the sfc32 state: four unsigned 32-bit integers.
 * They are always present so the generator state stays explicit in JSON.
 *
 * `spare` is the unused second sample from a Box–Muller pair. It is absent
 * until `nextNormal` generates a pair and returns only the first. It is removed
 * when that cached sample is returned. A finite number survives
 * `JSON.parse(JSON.stringify(stream))`; a missing spare is omitted, which
 * restores "no cached sample".
 */
export type RngStream = {
  a: number
  b: number
  c: number
  d: number
  spare?: number
}

/** The four named streams for one run. Plain JSON, no hidden generator. */
export type RngState = {
  market: RngStream
  events: RngStream
  info: RngStream
  distortion: RngStream
}

/** One choice for `pickWeighted`. `weight` must be finite and >= 0. */
export type Weighted<T> = {
  value: T
  weight: number
}

/** Sector A is growth-sensitive. Sector B is rate-sensitive. The index has none. */
export type SectorId = 'A' | 'B'

export type AssetKind = 'stock' | 'index'

/**
 * One tradable instrument. Passed into the simulation; `src/sim` does not import content.
 * Prices and fair value are in cents. `dailyVolatility` is the one-day return standard deviation
 * (0.022 means 2.2%). Stock order is the order `stepMarketDay` draws market-stream noise.
 */
export type AssetDefinition = {
  id: string
  kind: AssetKind
  sector: SectorId | null
  startPriceCents: number
  dailyVolatility: number
}

/** Coarse band for the calendar lookup. Thresholds live on the calendar definition. */
export type CalendarBand = 'low' | 'mid' | 'high'

/** One known macro date per month. Outcomes are not known until the events-stream roll. */
export type CalendarItemKind = 'growthRelease' | 'inflationRelease' | 'policyDecision'

export type PolicyOutcome = 'hold' | 'up' | 'down'

export type ReleaseOutcome = 'above' | 'inline' | 'below'

export type CalendarOutcome = PolicyOutcome | ReleaseOutcome

export type CalendarScheduleEntry = {
  kind: CalendarItemKind
  /** Day within the month, from 1 through `daysPerMonth`. */
  dayOfMonth: number
  /** Environment entry a release publishes, or the policy rate a decision changes. */
  entryId: string
}

export type PolicyChanceCell = {
  inflationBand: CalendarBand
  growthBand: CalendarBand
  hold: number
  up: number
  down: number
}

export type ReleaseChanceCell = {
  band: CalendarBand
  above: number
  inline: number
  below: number
}

/**
 * Fair-value effect for one sector. `percent` is signed and is a percent of the
 * morning fair value. It is applied in one day, then clipped with every other effect.
 */
export type CalendarEffectCell = {
  kind: CalendarItemKind
  outcome: CalendarOutcome
  sector: SectorId
  percent: number
}

/**
 * Provisional macro calendar. Passed in with the other definitions.
 * `src/sim` does not import the content file that fills these numbers.
 */
export type CalendarDefinitions = {
  daysPerMonth: number
  schedule: readonly CalendarScheduleEntry[]
  growthEntryId: string
  inflationEntryId: string
  policyEntryId: string
  /** Inflation strictly below this is `low`. Inflation at or above `inflationHighAt` is `high`. */
  inflationLowBelow: number
  inflationHighAt: number
  /** Growth strictly below this is `low`. Growth at or above `growthHighAt` is `high`. */
  growthLowBelow: number
  growthHighAt: number
  /** Percentage points added or removed by a policy decision. A cut is floored at 0. */
  rateStep: number
  policy: readonly PolicyChanceCell[]
  growthRelease: readonly ReleaseChanceCell[]
  inflationRelease: readonly ReleaseChanceCell[]
  effects: readonly CalendarEffectCell[]
}

/** Date rules copied onto the market so `upcomingCalendar` does not need definitions. */
export type CalendarRules = {
  daysPerMonth: number
  schedule: CalendarScheduleEntry[]
}

/** Outcome rolled ahead of the calendar day. `applied` flips when that day starts. */
export type CalendarRoll = {
  kind: CalendarItemKind
  day: number
  roll: number
  outcome: CalendarOutcome
  applied: boolean
}

/**
 * A known calendar date. `roll` and `outcome` are omitted until the events stream has rolled them.
 */
export type UpcomingCalendarItem = {
  kind: CalendarItemKind
  day: number
  roll?: number
  outcome?: CalendarOutcome
}

export type MarketDefinitions = {
  assets: readonly AssetDefinition[]
  /** Growth, inflation, policy rate, and any later entries. Order is the drift order. */
  environment: readonly EnvironmentEntryDefinition[]
  /** Rolled in this order, then each type's targets in listed order. */
  events: readonly EventTypeDefinition[]
  /**
   * Macro calendar. Omitted means no releases and no policy decisions, and no extra
   * events-stream draws. Dates are known before the outcome is rolled.
   */
  calendar?: CalendarDefinitions
}

/** Price in integer cents. Fair value is cents as a float. */
export type AssetState = {
  id: string
  priceCents: number
  fairValue: number
}

/**
 * One environment level. `start` and `value` use the same unit (provisional: percent).
 * `driftSpeed` is added each day as speed × one events-stream normal.
 * Zero speed does not draw. The policy rate stays put until a calendar decision changes it.
 */
export type EnvironmentEntryDefinition = {
  id: string
  start: number
  driftSpeed: number
}

export type EnvironmentEntryState = {
  id: string
  value: number
  /** Last published value. Absent until a calendar release prints this entry. */
  lastReleased?: number
}

/** Added per unit of (environment value − center), then chances are clamped and directions renormalized. */
export type EnvironmentModifier = {
  entryId: string
  center: number
  chancePerUnit: number
  upPerUnit: number
  downPerUnit: number
  nonePerUnit: number
}

export type EventScope = 'stock' | 'sector' | 'market'

export type DecayShape = 'frontLoaded' | 'linear'

/** `none` is a fired event that does not move fair value. */
export type EventDirection = 'up' | 'down' | 'none'

export type DirectionChances = {
  up: number
  down: number
  none: number
}

/**
 * Placeholder event type. `chance` is per target per day.
 * Stock targets are stock ids. Sector targets are `A` or `B`. The market target is `market`.
 * Magnitude is a percent of fair value. Duration is in days, including the event day.
 */
export type EventTypeDefinition = {
  id: string
  scope: EventScope
  targets: readonly string[]
  chance: number
  direction: DirectionChances
  magnitudeMin: number
  magnitudeMax: number
  duration: number
  decay: DecayShape
  /** Placeholders: `{target}`, `{direction}`, `{magnitude}`. */
  headline: string
  modifiers: readonly EnvironmentModifier[]
}

/** A fired event waiting for `eventDay`. Direction `none` is not stored. */
export type ScheduledEvent = {
  id: string
  typeId: string
  target: string
  eventDay: number
  direction: 'up' | 'down'
  magnitudePercent: number
  duration: number
  decay: DecayShape
  headline: string
}

export type ActiveEffectPart = {
  asset: string
  /** Signed fair-value cents, fixed when the effect becomes active. */
  totalDelta: number
}

/** Spreads `parts` across `duration` days. `dayIndex` is the next day to apply, starting at 0. */
export type ActiveEffect = {
  id: string
  typeId: string
  target: string
  eventDay: number
  decay: DecayShape
  duration: number
  dayIndex: number
  parts: ActiveEffectPart[]
}

export type NoiseRollEvent = {
  kind: 'noiseRoll'
  day: number
  asset: string
  z: number
}

export type PriceStepEvent = {
  kind: 'priceStep'
  day: number
  asset: string
  previous: number
  fair: number
  pull: number
  noise: number
  rawMove: number
  cappedMove: number
  capped: boolean
  newPrice: number
  gapAfter: number
}

export type IndexStepEvent = {
  kind: 'indexStep'
  day: number
  asset: string
  previous: number
  quote: number
  rawMove: number
  cappedMove: number
  capped: boolean
  newPrice: number
  gapAfter: number
}

export type EnvDriftEvent = {
  kind: 'envDrift'
  day: number
  entry: string
  before: number
  shock: number
  delta: number
  after: number
}

export type EventRollEvent = {
  kind: 'eventRoll'
  /** Day the roll was made. Creation rolls use 0. */
  day: number
  /** Day the event becomes active. */
  eventDay: number
  type: string
  target: string
  roll: number
  /** Per-day chance after environment modifiers, clamped to [0, 1]. */
  chance: number
  fired: boolean
}

export type EventDirectionEvent = {
  kind: 'eventDirection'
  day: number
  eventDay: number
  type: string
  target: string
  roll: number
  up: number
  down: number
  none: number
  shiftUp: number
  shiftDown: number
  shiftNone: number
  result: EventDirection
}

export type EventMagnitudeEvent = {
  kind: 'eventMagnitude'
  day: number
  eventDay: number
  type: string
  target: string
  roll: number
  min: number
  max: number
  magnitude: number
}

export type EffectAppliedEvent = {
  kind: 'effectApplied'
  day: number
  asset: string
  effect: string
  dayIndex: number
  delta: number
  /** Calendar item kind when this slice came from the calendar. Omitted for ordinary events. */
  calendar?: string
}

export type FairValueChangeEvent = {
  kind: 'fairValueChange'
  day: number
  asset: string
  before: number
  /** Sum of today's effect deltas before the daily limit. */
  total: number
  /** Delta actually added. Excess (`total` − `clipped`) is dropped, not carried. */
  clipped: number
  after: number
  /** Calendar item kind when today's sum includes a calendar effect for this asset. */
  calendar?: string
}

/** One environment entry as logged on a calendar item, before or after the outcome is applied. */
export type EnvironmentView = {
  id: string
  value: number
  /** Null until a release has published this entry. */
  lastReleased: number | null
}

/**
 * Logged on the calendar day, when the outcome is applied.
 * The roll itself happened `EVENT_LOOKAHEAD_DAYS` earlier and is stored until then.
 */
export type CalendarItemEvent = {
  kind: 'calendarItem'
  day: number
  item: CalendarItemKind
  roll: number
  outcome: CalendarOutcome
  before: EnvironmentView[]
  after: EnvironmentView[]
}

export type LogEvent =
  | NoiseRollEvent
  | PriceStepEvent
  | IndexStepEvent
  | EnvDriftEvent
  | EventRollEvent
  | EventDirectionEvent
  | EventMagnitudeEvent
  | EffectAppliedEvent
  | FairValueChangeEvent
  | CalendarItemEvent

/**
 * Seeded market. `day` is 0 before the first step.
 * `log` is the creation rolls, then only the latest day's events. The next step replaces it.
 * Stock `fairValue` is hidden. Event effects move it before the price step.
 * The index `fairValue` is the uncapped index quote in cents (float).
 * `calendarRolls` is not part of `scheduled`. A later distortion step must not filter it.
 */
export type MarketState = {
  day: number
  streams: RngState
  assets: Record<string, AssetState>
  environment: EnvironmentEntryState[]
  /** Copied at creation. Empty schedule means this run has no macro dates. */
  calendarRules: CalendarRules
  /** Rolled outcomes waiting for their day, plus today's item after it is applied. */
  calendarRolls: CalendarRoll[]
  scheduled: ScheduledEvent[]
  active: ActiveEffect[]
  log: LogEvent[]
}
