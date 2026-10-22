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
 *
 * `spreadPpm` and `borrowFeePpm` are provisional section 7 rates in parts per million of price
 * (1000 ppm = 0.10%, 100 ppm = 0.01%). They are optional on the type so a market fixture that
 * never trades does not need them. An order or a short borrow throws if the one it needs is missing.
 */
export type AssetDefinition = {
  id: string
  kind: AssetKind
  sector: SectorId | null
  startPriceCents: number
  dailyVolatility: number
  /** Full spread. 1000 is 0.10% and 4000 is 0.40% of the current price. */
  spreadPpm?: number
  /** Daily short borrow fee. 100 is 0.01% and 300 is 0.03% of abs(shares) × price. */
  borrowFeePpm?: number
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

/** Who can see a rumour source. The feed is generated for every source, then filtered. */
export const VISIBILITY_REQUIREMENTS = ['base', 'infoFeed1', 'infoFeed2', 'jobContacts'] as const

export type VisibilityRequirement = (typeof VISIBILITY_REQUIREMENTS)[number]

/** Honest label. The hit rate is hidden and lives on the source, not on the label. */
export const SOURCE_TIERS = ['high', 'medium', 'low'] as const

export type SourceTier = (typeof SOURCE_TIERS)[number]

/**
 * One rumour source. Passed in with the other definitions.
 * `hitRate` is the hidden probability that an attempt is true (section 2.4).
 * `visibility` is shown when the player's list shares one of these names.
 */
export type SourceDefinition = {
  id: string
  tier: SourceTier
  hitRate: number
  visibility: readonly VisibilityRequirement[]
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
  /**
   * Rumour sources. Omitted or empty means no rumours and no info-stream draws.
   * Headlines for events that already fired are still generated.
   */
  sources?: readonly SourceDefinition[]
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

/** Confirmed news for one event or calendar outcome that fired on the generation day. */
export type HeadlineItem = {
  kind: 'headline'
  eventId: string
  text: string
  magnitude: number
  top: boolean
}

/**
 * One emitted rumour. A skipped truth roll is not stored.
 * `visibility` is copied from the source so a later filter does not need definitions.
 */
export type RumourItem = {
  kind: 'rumour'
  sourceId: string
  tier: SourceTier
  truthRoll: number
  truth: boolean
  claim: string
  /** Event day minus the generation day. */
  leadDays: number
  targetEventId: string
  /** Low-tier false rumours only. */
  noise: boolean
  visibility: VisibilityRequirement[]
}

export type FeedItem = HeadlineItem | RumourItem

/** Full feed for `day`, before any player filter. */
export type DayFeed = {
  day: number
  items: FeedItem[]
}

export type HeadlineEvent = {
  kind: 'headline'
  /** Day the headline was generated. The event fired on this day. */
  day: number
  /** Day the feed is shown. */
  feedDay: number
  eventId: string
  text: string
  magnitude: number
  top: boolean
}

export type RumourGeneratedEvent = {
  kind: 'rumourGenerated'
  /** Day the rumour was generated. */
  day: number
  /** Day the feed is shown. */
  feedDay: number
  source: string
  tier: SourceTier
  truthRoll: number
  truth: boolean
  claim: string
  leadDays: number
  targetEventId: string
  noise: boolean
}

/** Cash, the trading account, and savings. Transfers between these are instant and free. */
export const ACCOUNT_NAMES = ['cash', 'trading', 'savings'] as const

export type AccountName = (typeof ACCOUNT_NAMES)[number]

/** Balances after a transfer, in cents. */
export type TransferEvent = {
  kind: 'transfer'
  day: number
  from: AccountName
  to: AccountName
  amountCents: number
  cashCents: number
  tradingCents: number
  savingsCents: number
}

/**
 * A player command that changed nothing.
 * `command` is the submitted type, or `invalid` when there was no type.
 * `account` is set only when `reason` is `unknownAccount`.
 */
export type CommandRejectedEvent = {
  kind: 'commandRejected'
  day: number
  command: string
  reason: string
  account?: string
}

/** One day's savings accrual, before a pay day moves the accumulator. */
export type SavingsAccrualEvent = {
  kind: 'savingsAccrual'
  day: number
  savingsCents: number
  /** Policy rate in percent after this day's market step. */
  policyRate: number
  annualRate: number
  accrualCents: number
  /** Accumulator after this day's accrual, before a payment. */
  accruedCents: number
}

/** Interest added to savings. `amountCents` is 0 when nothing has accrued. */
export type SavingsInterestPaidEvent = {
  kind: 'savingsInterestPaid'
  day: number
  amountCents: number
  savingsCents: number
  accruedCents: number
}

/** Buy pays the fill. Sell receives the fill. Quantity is whole shares, never a signed position. */
export const ORDER_SIDES = ['buy', 'sell'] as const

export type OrderSide = (typeof ORDER_SIDES)[number]

/**
 * One net position. Positive shares are long, negative shares are short.
 * `costCents` is the entry notional of the open shares (always >= 0), so the
 * entry average is costCents / abs(signedShares). A flat asset is omitted.
 */
export type OpenPosition = {
  asset: string
  signedShares: number
  costCents: number
}

/**
 * One market day's net realized result, in cents: closed-position P&L minus
 * trade fees and borrow fees. Kept for the Step 17 FI window. This step does
 * not check FI. A missing day means zero.
 */
export type RealizedDay = {
  day: number
  cents: number
}

/** Prices are cents. `halfSpread` is cents. `fee` is cents, 0.1% of shares × fill price. */
export type OrderFillEvent = {
  kind: 'orderFill'
  day: number
  asset: string
  side: OrderSide
  quantity: number
  price: number
  halfSpread: number
  fillPrice: number
  fee: number
}

/**
 * Daily borrow fee for a short, charged after the market step.
 * `ratePpm` is parts per million. `assessed`, `paid`, and `unpaid` are cents.
 * Unpaid is the part the trading account could not cover. It is not a loan.
 */
export type BorrowFeeEvent = {
  kind: 'borrowFee'
  day: number
  asset: string
  shares: number
  price: number
  ratePpm: number
  assessed: number
  paid: number
  unpaid: number
}

/** Closed-position P&L in cents, before the fee. Positive is a gain. */
export type RealizedEvent = {
  kind: 'realized'
  day: number
  asset: string
  amount: number
}

/** Player commands since the previous end of day. */
export type CommandLogEvent = TransferEvent | CommandRejectedEvent | OrderFillEvent | RealizedEvent

export type AccountLogEvent =
  | CommandLogEvent
  | BorrowFeeEvent
  | SavingsAccrualEvent
  | SavingsInterestPaidEvent

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
  | HeadlineEvent
  | RumourGeneratedEvent

/**
 * Seeded market. `day` is 0 before the first step.
 * `log` is the creation rolls, then only the latest day's events. The next step replaces it.
 * Stock `fairValue` is hidden. Event effects move it before the price step.
 * The index `fairValue` is the uncapped index quote in cents (float).
 * `calendarRolls` is not part of `scheduled`. A later distortion step must not filter it.
 * `feed` is the full day-ahead feed. Filtering it must not change this object or any stream.
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
  /** Feed for `day + 1`. Day 0 can hold rumours only, because nothing has fired yet. */
  feed: DayFeed
}

/** Player balances in integer cents. The accumulator is unpaid savings interest. */
export type PlayerAccounts = {
  cashCents: number
  tradingCents: number
  savingsCents: number
  accruedSavingsCents: number
}

/**
 * Market plus the player. Commands, fills, and interest live on `pending` and `log`.
 * They are not written onto `market`, so a command cannot change the market hash.
 * `pending` holds commands since the previous `endDay`. `log` is those commands
 * until `endDay` replaces it with the commands, that day's borrow fees, and savings.
 * `realized` is the per-day ledger (P&L minus fees and borrow fees). One row per day
 * that had a non-zero change. Days stay in increasing order.
 */
export type GameState = {
  market: MarketState
  accounts: PlayerAccounts
  positions: Record<string, OpenPosition>
  realized: RealizedDay[]
  pending: CommandLogEvent[]
  log: AccountLogEvent[]
}
