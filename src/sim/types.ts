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
  /** Whole shares in issue. Market cap is this times the price. Stocks only; display only. */
  sharesOutstanding?: number
  /** Typical daily traded value in cents at an average price. Sets the session volume scale. */
  liquidityNotionalCents?: number
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
  /** The consensus, fixed when the outcome is rolled (market depth M7). It does not depend on the roll. */
  expected: CalendarOutcome
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
  /** The consensus. Present from the day the item is rolled, three days ahead. */
  expected?: CalendarOutcome
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

/**
 * Order-flow parties (plan market depth, Step M4). Omitted means the price step is the
 * plain pull plus noise, with no extra draws.
 */
export type ParticipantDefinitions = {
  /** Price moves by net demand over depth. Depth is a stock's daily traded value times this many days. */
  depthDays: number
  informed: {
    /** Cents a fund puts behind one leaked event on one stock, at full size and the last day before it. */
    capitalCents: number
    /** The run's regime scales every leak chance by a draw from this range. */
    regimeMin: number
    regimeMax: number
    /** An event of this many percent or more trades at full size. Smaller ones trade in proportion. */
    magnitudeRefPercent: number
  }
  news: {
    /**
     * Share of the gap to news-adjusted fair value that news traders close each day a stock has
     * news in play, on top of the pull. The run's regime draws from this range. Above 1 overshoots.
     */
    efficiencyMin: number
    efficiencyMax: number
  }
  consensus: {
    /** Cents traders put behind the expected effect of a calendar release, at full size on the last day. */
    capitalCents: number
    /** An expected effect of this many percent or more trades at full size. */
    magnitudeRefPercent: number
  }
  crowd: {
    /** Cents of retail money behind a full mood swing in one stock. A thin stock moves more. */
    capitalCents: number
    /** The run's regime scales the crowd's money by a draw from this range. */
    heatMin: number
    heatMax: number
    /** How strongly a rumour of each source tier sways the crowd, from 0 to 1. */
    tierWeight: Readonly<Record<SourceTier, number>>
    /** How strongly a headline sways the crowd after the fact, from 0 to 1. */
    headlineWeight: number
    /** Share of the after-the-fact mood that fades each day. */
    chaseDecay: number
  }
  momentum: {
    /** Cents trend followers put behind a clear trend in one stock. */
    capitalCents: number
    /** Days of closes the trend is read over. */
    lookbackDays: number
    /** A move of this many percent over the look-back is a full-size trend. */
    thresholdPercent: number
  }
}

export type MarketDefinitions = {
  assets: readonly AssetDefinition[]
  participants?: ParticipantDefinitions
  /** The social feed. Omitted means no posts and no social-stream draws. */
  social?: SocialDefinitions
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
  /** Telegraphed layoffs (plan layoffs, loans and deposits, Step Y1). Omitted means none and no layoff-stream draws. */
  layoffs?: LayoffDefinitions
  /** Trader types that set the price against depth (price-model plan, Step P1). Omitted means the current model. */
  traders?: TraderDefinitions
}

/** The eight trader types, in the fixed order the per-run mix is drawn. */
export const TRADER_TYPES = ['value', 'noise', 'informed', 'news', 'consensus', 'crowd', 'trend', 'contrarian'] as const
export type TraderType = (typeof TRADER_TYPES)[number]

/**
 * Trader numbers (price-model plan section 2). Per type: `base` weight, the range the per-run
 * `mix` is drawn from, and `rate`, the share of the gap to target traded each day.
 * The mix is normalised so the sum of base x mix is the same every run.
 */
export type TraderDefinitions = {
  types: Record<TraderType, { base: number; mixMin: number; mixMax: number; rate: number }>
  /** News traders' per-run efficiency is drawn from this range. */
  efficiencyMin: number
  efficiencyMax: number
  /** Daily fractional addition to the anchor's carry, on top of cancelling the expected drift. */
  premiumPerDay: number
  /** Value traders' anchor is an EMA with this half-life in days. */
  anchorHalfLifeDays: number
  /** Value traders ignore a gap smaller than this (fraction). */
  valueDeadBand: number
  /** Gap (fraction) at which value traders are at full weight, and where the steeper slope starts. */
  valueFullGap: number
  valueDeepGap: number
  valueDeepSlope: number
  valueMaxMultiple: number
  /** Noise: AR(1) coefficient and share of `dailyVolatility` per draw. */
  noiseAr: number
  noiseShare: number
  /** Informed: size at which a leaked event trades at full weight (percent), hold and decay days. */
  informedMagnitudeRefPercent: number
  informedHoldDays: number
  informedDecayDays: number
  /** News: days held, then days decayed. */
  newsHoldDays: number
  newsDecayDays: number
  /** Consensus: ramp days before a release and decay days after. */
  consensusRampDays: number
  consensusDecayDays: number
  /** Crowd: return and drawdown windows, thresholds (fractions) and clamps. */
  crowdReturnDays: number
  crowdDrawdownDays: number
  crowdReturnScale: number
  crowdCapitulation: number
  crowdMoodClamp: number
  /** Trend: look-back and scale. */
  trendDays: number
  trendScale: number
  /** Contrarian: return threshold, scale, mood weight, flow weight and flow scale. */
  contrarianThreshold: number
  contrarianScale: number
  contrarianMoodWeight: number
  contrarianFlowWeight: number
  contrarianFlowScale: number
  /** Market makers: volatility EWMA weight and depth thinning. */
  volEwma: number
  volSens: number
  depthScaleMin: number
}

/** One job that can be cut. A job not listed is exempt. */
export type LayoffJobRisk = { jobId: string; sector: SectorId; baseChance: number }

/**
 * Layoff odds. The modifiers are signed and added to the job's base chance, then the sum is
 * clamped to 0 .. `maxChance`. `sectorMovePercent` is the 20-day move of the job's sector, in
 * percent, that counts as a fall or a rise. `trueChance` is the chance that a warning is real.
 */
export type LayoffDefinitions = {
  jobs: readonly LayoffJobRisk[]
  growthBelow: number
  growthAbove: number
  sectorFall: number
  sectorRise: number
  sectorMovePercent: number
  maxChance: number
  trueChance: number
}

/**
 * An employer notice. `real` is hidden like a rumour's truth: the UI must not read it.
 * The stage is `rumour` until the decision day, then `confirmed` (a dropped notice is cleared).
 */
export type LayoffNotice = {
  jobId: string
  warnedDay: number
  decisionDay: number
  layoffDay: number
  real: boolean
  stage: 'rumour' | 'confirmed'
}

/** The employer's own stream and notice, apart from the market. `barred` are jobs lost this run. */
export type EmployerState = {
  stream: RngStream
  notice: LayoffNotice | null
  barred: string[]
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
  /**
   * Words for `{direction}`, keyed by the price direction. They describe the fact
   * ("beat", "hotter than expected"), not the price move. Omitted, the key itself is used.
   */
  directionWords?: Readonly<Record<EventDirection, string>>
  /**
   * Chance, before the run's regime, that informed money hears of this event once it is
   * scheduled and trades ahead of it. Omitted means 0.
   */
  leak?: number
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
  /** Cents moved by order-flow parties beyond the pull and the noise. Absent when 0. */
  flow?: number
  rawMove: number
  cappedMove: number
  capped: boolean
  newPrice: number
  gapAfter: number
}

/** One party's net demand in a stock for the day, and the cents it moved the price. Logged only when not 0. */
export type ParticipantFlowEvent = {
  kind: 'participantFlow'
  day: number
  asset: string
  party: 'informed' | 'news' | 'crowd' | 'momentum' | 'consensus' | 'player'
  /** Signed cents of demand. Positive buys. */
  demandCents: number
  depthCents: number
  moveCents: number
  /** Scheduled events being traded ahead of. */
  events: string[]
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
  /** The consensus the outcome is judged against. Not part of the log line. */
  expected: CalendarOutcome
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
  /**
   * The event's price direction. The text names the fact, not the move, so the bias
   * reads this field. Absent on calendar headlines and on feeds saved before it existed.
   */
  direction?: 'up' | 'down'
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
  /** The claimed price direction, true or false. Absent on feeds saved before it existed. */
  direction?: 'up' | 'down'
}

export type FeedItem = HeadlineItem | RumourItem

/** Full feed for `day`, before any player filter. */
export type DayFeed = {
  day: number
  items: FeedItem[]
}

/** What a distortion did to one visible item. Generated posts were not in the true feed. */
export const DISTORTION_ACTIONS = ['reweight', 'hide', 'generate'] as const

export type DistortionAction = (typeof DISTORTION_ACTIONS)[number]

/**
 * One displayed social post. Passed in with the other definitions.
 * `src/sim` does not import the content file. `{asset}` is the open position.
 * The sim marks every post low reliability. A post is not a market event.
 */
export type SocialPostDefinition = {
  id: string
  /** Visible source tag. */
  sourceId: string
  direction: 'up' | 'down'
  text: string
}

/**
 * One kind of retail poster in the always-on social feed (market depth M10). Text templates take
 * `{asset}`. `mood` says which crowd direction the persona posts in, or `any`.
 */
export type SocialPersona = {
  id: string
  mood: 'up' | 'down' | 'any'
  /** Plain wording. */
  calm: readonly string[]
  /** The same post with the emotion turned up. Stress swaps it in for posts that agree with a position. */
  loaded: readonly string[]
}

export type SocialDefinitions = {
  personas: readonly SocialPersona[]
  /** Chance a stock has a mood post today. */
  moodPostChance: number
  /** Crowd mood below this size, either way, is a coin flip. */
  moodThreshold: number
  /** Chance a scheduled event gets a true whisper, before the boost for an event informed money knows. */
  whisperTrueChance: number
  whisperLeakBoost: number
  /** False whisper slots a day, each with this chance of posting. They keep the hit rate low. */
  falseWhispersPerDay: number
  falseWhisperChance: number
  whisperCalm: string
  whisperLoaded: Readonly<Record<'up' | 'down', string>>
  /** A bar that moves at least this many percent can draw a chatter post. */
  chatterThresholdPercent: number
  maxChatterPerDay: number
  chatterCalm: Readonly<Record<'up' | 'down', string>>
}

/** A post in the social feed. `truth` is hidden and only whispers have one. `time` is the session time of chatter. */
export type SocialPost = {
  id: string
  kind: 'mood' | 'whisper' | 'chatter'
  persona: string
  asset: string
  direction: 'up' | 'down'
  calm: string
  loaded: string
  time: string | null
  truth: boolean | null
}

/** The social feed's own stream and today's posts. Never read by the market. */
export type SocialState = {
  stream: RngStream
  day: number
  posts: SocialPost[]
}

/** A headline or rumour in the shown feed. `distorted` is the tell. */
export type ShownNewsItem = (HeadlineItem | RumourItem) & { distorted: boolean }

/**
 * Display-only post. `tier` is always low. It is never written onto the market feed.
 */
export type SocialPostItem = {
  kind: 'social'
  id: string
  sourceId: string
  tier: 'low'
  text: string
  asset: string
  direction: 'up' | 'down'
  distorted: true
}

export type ShownItem = ShownNewsItem | SocialPostItem

/** What the player sees for one day. `day` matches the visible feed's day. */
export type ShownFeed = {
  day: number
  items: ShownItem[]
}

/**
 * Admin true-versus-shown record. Not a market log line, so it cannot move prices.
 * `trueValue` is the unbiased text or index. `shownValue` is what the bias did.
 */
export type DistortionEvent = {
  kind: 'distortion'
  day: number
  item: string
  action: DistortionAction
  trueValue: string
  shownValue: string
}

/**
 * The day's biased view, fixed at day start. `verified` switches the UI to the true feed.
 * The stored market feed is not this object.
 */
export type PerceptionState = {
  day: number
  shown: ShownFeed
  events: DistortionEvent[]
  verified: boolean
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
  /** Whole number from 1 to MAX_LEVERAGE. Missing means DEFAULT_LEVERAGE (older saves). */
  leverage?: number
}

/**
 * One market day's net realized result, in cents: closed-position P&L minus
 * trade fees, borrow fees, and margin interest. The FI check reads this total
 * and does not subtract fees, spread, borrow, or margin interest again.
 * A missing day means zero.
 */
export type RealizedDay = {
  day: number
  cents: number
}

/**
 * Prices are cents. `halfSpread` is cents. `slippage` is cents a share paid beyond the half
 * spread by a large order, 0 when the order is small (omitted then). `fee` is cents,
 * 0.1% of shares × fill price.
 */
export type OrderFillEvent = {
  kind: 'orderFill'
  day: number
  asset: string
  side: OrderSide
  quantity: number
  price: number
  halfSpread: number
  slippage?: number
  fillPrice: number
  fee: number
}

/**
 * Daily borrow fee for a short, charged after the market step.
 * `ratePpm` is parts per million. `assessed`, `paid`, and `unpaid` are cents.
 * Unpaid is the part positive trading cash could not cover. It is not a loan.
 * A negative trading balance is the margin loan and is not used to pay this fee.
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

/**
 * One day of interest on the margin loan. `borrowed` is max(0, −trading cash)
 * before the charge. `interest` is cents deducted from trading cash.
 * `tradingCents` is the balance after the deduction.
 */
export type MarginInterestEvent = {
  kind: 'marginInterest'
  day: number
  borrowed: number
  /** Policy rate in percent after this day's market step. */
  policyRate: number
  annualRate: number
  interest: number
  tradingCents: number
}

/**
 * End-of-day margin snapshot. `positionValue` is gross, the sum of
 * abs(shares) × quoted price. `ratio` is equity / positionValue, or null
 * when nothing is open.
 */
export type MarginCheckEvent = {
  kind: 'marginCheck'
  day: number
  equity: number
  positionValue: number
  ratio: number | null
}

/** Logged when the ratio is 15% or lower and a position is open. */
export type MarginWarningEvent = {
  kind: 'marginWarning'
  day: number
  equity: number
  positionValue: number
  ratio: number
}

/**
 * One whole position closed by the end-of-day liquidation.
 * `quantity` is shares closed. `fill` is the fill price in cents.
 * `ratioAfter` is the margin ratio after this close, or null when flat.
 */
export type LiquidationEvent = {
  kind: 'liquidation'
  day: number
  asset: string
  quantity: number
  fill: number
  ratioAfter: number | null
  /** Liquidation fee in cents, on top of the trade fee. Missing on older logs. */
  fee?: number
  /** `HH:MM` of the bar when it happened inside the session. Missing for the close. */
  time?: string
}

/**
 * Funding paid for one open position for one day. `ratePpm` is the base plus the crowd
 * share, `amount` is cents paid (never received) on `notional`, the position value.
 */
export type FundingEvent = {
  kind: 'funding'
  day: number
  asset: string
  side: 'long' | 'short'
  notional: number
  ratePpm: number
  amount: number
}

/** Cents added to trading cash so equity is no longer negative. */
export type BackstopWriteOffEvent = {
  kind: 'backstopWriteOff'
  day: number
  amount: number
}

/**
 * Trading equity ended below 10% of its value at the start of the day.
 * This does not end the run. The stress spike is applied from this event.
 */
export type WipeOutEvent = {
  kind: 'wipeOut'
  day: number
  startEquity: number
  endEquity: number
}

/** Sections of one played day. A new day is `sleep`, which means the end of sleep. */
export const DAY_SECTIONS = ['sleep', 'work', 'market'] as const

export type DaySection = (typeof DAY_SECTIONS)[number]

/** The player skipped ahead. `from` and `to` are sections. */
export type SkipEvent = {
  kind: 'skip'
  day: number
  from: DaySection
  to: DaySection
}

/** The played section changed. `clock` is display-only `HH:MM` at `to`. */
export type SectionChangeEvent = {
  kind: 'sectionChange'
  day: number
  from: DaySection
  to: DaySection
  clock: string
}

/** The market clock moved forward inside the session. `from` and `to` are step numbers 0 to 16. */
export type ClockStepEvent = {
  kind: 'clockStep'
  day: number
  from: number
  to: number
  /** Display-only `HH:MM` at `to`. */
  time: string
}

export const RESTING_KINDS = ['limit', 'takeProfit', 'stopLoss'] as const
export type RestingKind = (typeof RESTING_KINDS)[number]

/** A limit order waiting for the price. Fills when a bar touches `limitCents`. */
export type RestingOrder = {
  id: number
  asset: string
  side: OrderSide
  quantity: number
  limitCents: number
  /** Exits set on the position once this order fills. Null means none. */
  tpCents: number | null
  slCents: number | null
  /** Shares the attached take profit or stop loss closes. Missing means the whole position. */
  tpQuantity?: number
  slQuantity?: number
  /** Leverage for the position this order opens. Missing means the open position's, else the default. */
  leverage?: number
}

export type ExitKind = 'takeProfit' | 'stopLoss'

/** One take profit or stop loss level. A hit closes `quantity` shares, or the whole position when null. */
export type ExitLevel = {
  id: number
  kind: ExitKind
  priceCents: number
  quantity: number | null
}

/** Take profit and stop loss levels for one open position. Never empty. */
export type PositionExit = {
  side: 'long' | 'short'
  levels: ExitLevel[]
}

export type RestingState = {
  nextId: number
  orders: RestingOrder[]
  exits: Record<string, PositionExit>
}

/**
 * Something happened to a limit order or an exit. Fills carry the bar time. Cents are
 * prices. `reason` is set when an order is dropped or an exit is removed or resized by the sim.
 */
export type RestingEvent = {
  kind: 'resting'
  day: number
  action: 'placed' | 'filled' | 'cancelled' | 'dropped' | 'resized'
  asset: string
  detail: RestingKind
  side: OrderSide | null
  quantity: number
  priceCents: number
  fee: number
  time: string | null
  reason: string | null
}

/**
 * Salary added to cash. One event per job worked in that month.
 * `days` is how many days of the 30-day month that job was active.
 * `amountCents` is monthly pay × days ÷ 30, rounded half away from zero.
 */
export type SalaryPaidEvent = {
  kind: 'salaryPaid'
  day: number
  job: string
  days: number
  amountCents: number
}

/** The player asked to switch or quit. The job changes on `effectiveDay`. */
export type JobChangeRequestedEvent = {
  kind: 'jobChangeRequested'
  day: number
  from: string
  to: string
  effectiveDay: number
}

/** A notice finished and the active job changed. */
export type JobChangedEvent = {
  kind: 'jobChanged'
  day: number
  from: string
  to: string
  slots: number
  sleepHours: number
}

/**
 * A perk changed what the player pays or what the feed shows.
 * Steady routine and quiet breaks change stats. They are not logged here.
 */
export type PerkAppliedEvent = {
  kind: 'perkApplied'
  day: number
  job: string
  perk: string
}

/** Expenses fixed for this cycle. `cashCents` is cash before the bill is paid. */
export type BillDueEvent = {
  kind: 'billDue'
  day: number
  amountCents: number
  cashCents: number
}

/** Bill paid from cash. `cashCents` is cash after the payment. */
export type BillPaidEvent = {
  kind: 'billPaid'
  day: number
  amountCents: number
  cashCents: number
}

/** Cash did not cover the bill. `shortfallCents` is the bill minus cash. */
export type BillPendingEvent = {
  kind: 'billPending'
  day: number
  amountCents: number
  cashCents: number
  shortfallCents: number
}

/**
 * Usable money compared with the bill. `tradingEquityCents` is trading cash
 * after closing every position at the current fill, including fees and spread.
 * Nothing is sold. `loanLimitCents` is unused loan room.
 */
export type CoverableCheckEvent = {
  kind: 'coverableCheck'
  day: number
  cashCents: number
  savingsCents: number
  tradingEquityCents: number
  loanLimitCents: number
  /** Break value of the open fixed deposits. Absent (read as 0) when there are none. */
  depositsCents?: number
  totalCents: number
  billCents: number
}

/** The run is over. `reason` is an id token such as `cannotCoverBill`. */
export type RunEndedEvent = {
  kind: 'runEnded'
  day: number
  reason: string
}

/**
 * End-of-day FI check. `passiveCents` is the rolling window sum plus `openLossCents`.
 * `windowDays` is how many day-numbers are in that sum.
 * `openLossCents` is the net unrealized result of open positions when below zero, else 0.
 * `streak` counts covered days from day 30, and only those days.
 */
export type FiCheckEvent = {
  kind: 'fiCheck'
  day: number
  windowDays: number
  passiveCents: number
  openLossCents: number
  expensesCents: number
  streak: number
}

export const STAT_NAMES = ['energy', 'stress'] as const

export type StatName = (typeof STAT_NAMES)[number]

/**
 * One stat moved. `delta` is the applied change after the 0 to 100 clamp,
 * so before + delta = after. `cause` is an id such as job, shortSleep, or consume.
 */
export type StatChangeEvent = {
  kind: 'statChange'
  day: number
  stat: StatName
  before: number
  cause: string
  delta: number
  after: number
}

/**
 * One consumable paid from cash. `cost` is cents.
 * `energyDelta` and `stressDelta` are the applied changes after the perk and the clamp.
 */
export type ConsumeEvent = {
  kind: 'consume'
  day: number
  item: string
  cost: number
  energyDelta: number
  stressDelta: number
}

/** The player read the news. `cost` is the energy price, 0 when the read was free. */
export type NewsReadEvent = {
  kind: 'newsRead'
  day: number
  cost: number
}

/**
 * The player opened today's true visible feed. `cost` is the energy price. Quiet breaks does not waive it.
 * `points` is the research points spent.
 */
export type NewsVerifiedEvent = {
  kind: 'newsVerified'
  day: number
  cost: number
  points: number
}

/** Free-time slots. Daytime is the work section when jobless. Evening is the market session. */
export const STUDY_SLOTS = ['daytime', 'evening'] as const

export type StudySlot = (typeof STUDY_SLOTS)[number]

/** Research earns points for verify. Course works toward the enrolled course. */
export const STUDY_ACTIVITIES = ['research', 'course'] as const

export type StudyActivity = (typeof STUDY_ACTIVITIES)[number]

/**
 * One free-time slot spent. `points` and `units` are the totals after it.
 * `course` is the enrolled course for a course session, else null.
 */
export type StudiedEvent = {
  kind: 'studied'
  day: number
  slot: StudySlot
  activity: StudyActivity
  points: number
  course: CourseId | null
  units: number
  energyCost: number
}

/** Enough study finished the enrolled course. Its jobs are now open. */
export type CourseCompletedEvent = {
  kind: 'courseCompleted'
  day: number
  course: CourseId
}

/**
 * Research points, the course in progress, and the slots spent today.
 * `used` is cleared at end of day.
 */
export type StudyState = {
  points: number
  course: { id: CourseId; units: number } | null
  used: StudySlot[]
}

/** Home and the information feed. Tier 0 is the base lifestyle. */
export const LIFESTYLE_CATEGORIES = ['home', 'infoFeed', 'health', 'equipment'] as const

export type LifestyleCategory = (typeof LIFESTYLE_CATEGORIES)[number]

/** Tiers above the base. What a tier does lives in the sim (stats.ts, trading.ts, lifestyle.ts). */
export type LifestyleState = {
  home: number
  infoFeed: number
  /** Absent in saves from before Health and Equipment. Read it with `tierOf`. */
  health?: number
  equipment?: number
}

/**
 * A lifestyle tier changed. `upfront` is cents paid now, 0 on a downgrade.
 * `expensesCents` is the new monthly cost before the staff discount.
 * A pending bill is not part of this event and is not rewritten.
 */
export type LifestyleChangeEvent = {
  kind: 'lifestyleChange'
  day: number
  category: LifestyleCategory
  from: number
  to: number
  upfront: number
  expensesCents: number
}

/** Enrolment in a course, paid once. Study finishes it and unlocks its jobs. Monthly expenses do not change. */
export type CoursePurchasedEvent = {
  kind: 'coursePurchased'
  day: number
  course: CourseId
  cost: number
}

/** Cash received from a new loan. `balanceCents` is the balance after the draw. */
export type LoanTakenEvent = {
  kind: 'loanTaken'
  day: number
  amountCents: number
  balanceCents: number
  cashCents: number
  limitCents: number
  /** Paydays that will take principal. Missing in old logs. */
  paymentsLeft?: number
}

/** Principal repaid from cash. Early repayment has no fee. `balanceCents` is the balance after. */
export type LoanRepaidEvent = {
  kind: 'loanRepaid'
  day: number
  amountCents: number
  balanceCents: number
  cashCents: number
}

/**
 * One day of loan interest added to the accrued total. It is charged on the next payday.
 * `balanceCents` is the balance it accrued on.
 */
export type LoanAccrualEvent = {
  kind: 'loanAccrual'
  day: number
  balanceCents: number
  policyRate: number
  annualRate: number
  accrualCents: number
  accruedCents: number
}

/**
 * Loan payment assessed on a payday. `amountCents` is the interest accrued since the
 * last payday and `principalCents` the instalment (0 when missing in old logs).
 * `cashCents` is cash before it is paid. `annualRate` is the decimal rate.
 */
export type LoanInterestDueEvent = {
  kind: 'loanInterestDue'
  day: number
  amountCents: number
  principalCents?: number
  balanceCents: number
  cashCents: number
  /** Policy rate in percent after the market step that opened this day. */
  policyRate: number
  annualRate: number
}

/** Loan payment paid from cash. `balanceCents` is the balance after the instalment. */
export type LoanInterestPaidEvent = {
  kind: 'loanInterestPaid'
  day: number
  amountCents: number
  principalCents?: number
  cashCents: number
  balanceCents: number
}

/**
 * Cents moved to cash to pay a missed loan payment.
 * `source` is an asset id, `savings` or `deposit`. Lifestyle is not a source.
 */
export type ForcedSaleEvent = {
  kind: 'forcedSale'
  day: number
  source: string
  amountCents: number
}

/** An employer notice opened (a rumour of cuts). The hidden `real` flag is not logged here. */
export type LayoffWarningEvent = {
  kind: 'layoffWarning'
  day: number
  job: string
  chance: number
  warnRoll: number
  decisionDay: number
  layoffDay: number
}

/** The decision day: the cuts are confirmed. */
export type LayoffConfirmedEvent = {
  kind: 'layoffConfirmed'
  day: number
  job: string
  layoffDay: number
}

/** The decision day: the rumour was false and the notice is cleared. */
export type LayoffDroppedEvent = {
  kind: 'layoffDropped'
  day: number
  job: string
}

/** The layoff day came and the player was no longer in that job. No severance. */
export type LayoffAvoidedEvent = {
  kind: 'layoffAvoided'
  day: number
  job: string
}

/** The job ended. A `jobChanged` to jobless follows. */
export type LaidOffEvent = {
  kind: 'laidOff'
  day: number
  job: string
}

/** Severance paid to cash. `cashCents` is cash after the payment. */
export type SeverancePaidEvent = {
  kind: 'severancePaid'
  day: number
  job: string
  amountCents: number
  cashCents: number
}

/** Where a deposit's money came from. */
export type DepositSource = 'cash' | 'savings'

/** A fixed deposit was opened. The rate is fixed from this day's policy rate. */
export type DepositOpenedEvent = {
  kind: 'depositOpened'
  day: number
  id: number
  principalCents: number
  termDays: number
  annualRate: number
  maturityDay: number
  from: DepositSource
}

/**
 * A deposit was broken: `paidCents` (principal less the penalty) went to `to`. `forced` is true when
 * a missed loan payment sold it (proceeds to cash), false when the player broke it (proceeds to savings).
 */
export type DepositBrokenEvent = {
  kind: 'depositBroken'
  day: number
  id: number
  principalCents: number
  paidCents: number
  penaltyCents: number
  forced: boolean
  to: 'cash' | 'savings'
}

/** A deposit matured: principal plus interest went to savings. The interest counts as passive income. */
export type DepositMaturedEvent = {
  kind: 'depositMatured'
  day: number
  id: number
  principalCents: number
  interestCents: number
  savingsCents: number
}

/** Player commands since the previous end of day, plus a bill payment or cover check from those commands. */
export type CommandLogEvent =
  | TransferEvent
  | CommandRejectedEvent
  | OrderFillEvent
  | RealizedEvent
  | SkipEvent
  | SectionChangeEvent
  | ClockStepEvent
  | RestingEvent
  | JobChangeRequestedEvent
  | BillPaidEvent
  | CoverableCheckEvent
  | RunEndedEvent
  | StatChangeEvent
  | ConsumeEvent
  | NewsReadEvent
  | NewsVerifiedEvent
  | StudiedEvent
  | CourseCompletedEvent
  | LifestyleChangeEvent
  | CoursePurchasedEvent
  | LoanTakenEvent
  | LoanRepaidEvent
  | LiquidationEvent
  | BackstopWriteOffEvent
  | DepositOpenedEvent
  | DepositBrokenEvent

export type MarginLogEvent =
  | MarginInterestEvent
  | MarginCheckEvent
  | MarginWarningEvent
  | LiquidationEvent
  | BackstopWriteOffEvent
  | WipeOutEvent

export type AccountLogEvent =
  | CommandLogEvent
  | BorrowFeeEvent
  | FundingEvent
  | MarginLogEvent
  | SavingsAccrualEvent
  | SavingsInterestPaidEvent
  | SalaryPaidEvent
  | JobChangedEvent
  | PerkAppliedEvent
  | BillDueEvent
  | BillPendingEvent
  | FiCheckEvent
  | LoanAccrualEvent
  | LoanInterestDueEvent
  | LoanInterestPaidEvent
  | ForcedSaleEvent
  | LayoffWarningEvent
  | LayoffConfirmedEvent
  | LayoffDroppedEvent
  | LayoffAvoidedEvent
  | LaidOffEvent
  | SeverancePaidEvent
  | DepositMaturedEvent

export type LogEvent =
  | NoiseRollEvent
  | PriceStepEvent
  | IndexStepEvent
  | ParticipantFlowEvent
  | EnvDriftEvent
  | EventRollEvent
  | EventDirectionEvent
  | EventMagnitudeEvent
  | EffectAppliedEvent
  | FairValueChangeEvent
  | CalendarItemEvent
  | HeadlineEvent
  | RumourGeneratedEvent

/** One 15-minute bar. Prices are integer cents. Volume is whole shares and is display only. */
export type SessionBar = {
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * Today's market session, fixed at the start of the day. `bars[id]` has one bar per step.
 * The last bar closes at the price the next end of day will print. `clock` is how many
 * steps have been played, 0 (open) through the number of bars (close). Bars past `clock`
 * are hidden from the player. A day with no further step (day 120) is flat.
 */
export type SessionState = {
  day: number
  clock: number
  bars: Record<string, SessionBar[]>
  /**
   * Own streams, kept off the market so a session can never move a market hash.
   * They advance once per day, when the session is built.
   */
  streams: { intraday: RngStream; volume: RngStream; levels: RngStream }
}

/**
 * Seeded market. `day` is 0 before the first step.
 * `log` is the creation rolls, then only the latest day's events. The next step replaces it.
 * Stock `fairValue` is hidden. Event effects move it before the price step.
 * The index `fairValue` is the uncapped index quote in cents (float).
 * `calendarRolls` is not part of `scheduled`. A later distortion step must not filter it.
 * `feed` is the full day-ahead feed. Filtering it must not change this object or any stream.
 */
/** Own stream and regime for the order-flow parties. Plain JSON, cloned with the market. */
export type ParticipantState = {
  stream: RngStream
  /** The run's regime: scales every leak chance. Never shown. */
  informed: number
  /** The run's news-trader efficiency (a share of the gap closed each news day). Never shown. */
  news: number
  /** The run's crowd regime: scales the crowd's money. Never shown. */
  heat: number
  /** Crowd belief in each rumoured event, signed. A rumour's share leaves when its day comes. */
  shares: Record<string, number>
  /** Crowd mood chasing headlines, per stock, signed, fading. */
  chase: Record<string, number>
  /** The crowd's total mood per stock after the last step. The crowd trades the change. */
  mood: Record<string, number>
  /** The last few closes per stock, oldest first, for the trend followers. */
  closes: Record<string, number[]>
  /** Scheduled event ids that informed money knows about. */
  leaked: string[]
  /** Trader positions (price-model plan, Step P1). Absent until the traders model is on. */
  book?: TraderBook
}

/** Per-run trader state. Plain JSON, cloned with the market. Positions are dimensionless, in depth units. */
export type TraderBook = {
  activeFromDay: number
  /** Per-run weights, drawn once. */
  mix: Record<TraderType, number>
  /** News traders' efficiency, per run. */
  efficiency: number
  /** Anchor multiplier per stock, starts at 1. */
  carry: Record<string, number>
  /** Value traders' lagged anchor per stock. */
  seenAnchor: Record<string, number>
  pos: Record<string, Record<TraderType, number>>
  /** Keyed `${eventId}|${asset}|${type}`. */
  eventPos: Record<string, number>
  /** EWMA of the absolute daily return per stock. */
  vol: Record<string, number>
  /** Yesterday's net non-noise flow per stock. */
  lastFlow: Record<string, number>
}

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
  /** Order-flow parties. Absent when the definitions have none. Never reads player state. */
  participants?: ParticipantState
  log: LogEvent[]
  /** Feed for `day + 1`. Day 0 can hold rumours only, because nothing has fired yet. */
  feed: DayFeed
}

/**
 * Player balances in integer cents. The accumulator is unpaid savings interest.
 * `tradingCents` may be negative. That negative balance is the margin loan.
 * Cash and savings stay >= 0 and are not part of trading equity.
 */
export type PlayerAccounts = {
  cashCents: number
  tradingCents: number
  savingsCents: number
  accruedSavingsCents: number
}

/** Expenses due until the player pays them from cash. The amount was fixed when it came due. */
export type PendingBill = {
  day: number
  amountCents: number
}

/** How a run stopped. `finished` is day 120 without a win or a loss. */
export const RUN_OUTCOMES = ['won', 'lost', 'finished'] as const

export type RunOutcome = (typeof RUN_OUTCOMES)[number]

/**
 * The run is over. Further days do not advance and commands are rejected.
 * `netWorthCents` and `score` are fixed here. Lost scores 0.
 */
export type RunEnd = {
  outcome: RunOutcome
  day: number
  reason: string
  netWorthCents: number
  score: number
}

/** Savings interest received on one monthly day. The FI window adds this to realized. */
export type FiInterest = {
  day: number
  cents: number
}

/** Course that gates a job. None means the job is open. `buyCourse` adds one to the player. */
export const COURSE_IDS = ['basic', 'finance'] as const

export type CourseId = (typeof COURSE_IDS)[number]

export type JobRequirement = 'none' | CourseId

/** One perk. `none` is jobless. Steady routine and quiet breaks change stats. */
export const JOB_PERKS = [
  'none',
  'staffDiscount',
  'steadyRoutine',
  'quietBreaks',
  'industryContacts',
  'analystTools',
] as const

export type JobPerk = (typeof JOB_PERKS)[number]

/**
 * One job on the menu. Passed into the simulation; `src/sim` does not import content.
 * `slots` is 0 (jobless), 1 (part-time, 08:00–12:00), or 2 (full-time, 08:00–16:00).
 * `payCents` is the monthly salary before the 30-day proration.
 * `energyCost` and `stressCost` are applied at the end of each day that job was active.
 */
export type JobDefinition = {
  id: string
  name: string
  slots: number
  payCents: number
  requirement: JobRequirement
  perk: JobPerk
  energyCost: number
  stressCost: number
  sleepHours: number
}

/** Days of one job inside the current pay month, in the order they were worked. */
export type JobWorked = {
  jobId: string
  days: number
}

/** A switch or quit that has not started. `effectiveDay` is the first day of the new job. */
export type PendingJobChange = {
  jobId: string
  effectiveDay: number
}

/**
 * One food or drink. Passed in with the job menu. `src/sim` does not import content.
 * `costCents` is paid from cash. `energy` and `stress` are signed.
 * Positive energy raises energy. Negative stress lowers stress.
 * Using one does not take a section of the day.
 */
export type ConsumableDefinition = {
  id: string
  name: string
  costCents: number
  energy: number
  stress: number
  /** Added at the next End day, after the day's own costs (an energy drink's crash, a hangover). */
  nextEnergy?: number
  nextStress?: number
  /** Lowest Home tier that can make or use it (a home-cooked meal needs a kitchen). */
  requiresHome?: number
  /** Costs nothing with the Health membership. */
  freeWithHealth?: boolean
}

/** Energy, stress, and what was used since the last end of day. */
export type PlayerStats = {
  energy: number
  stress: number
  consumed: string[]
  newsReads: number
}

/**
 * Employment for this run. `catalog` is the menu copied at the start.
 * `courses` lists Basic and Finance once each, after `buyCourse`.
 * A required course that is missing keeps that job locked.
 */
export type PlayerJob = {
  catalog: JobDefinition[]
  jobId: string
  pending: PendingJobChange | null
  worked: JobWorked[]
  courses: CourseId[]
}

/**
 * One bank loan. `balanceCents` is unpaid principal.
 * `interestDueCents` and `principalDueCents` are the payment from `interestDay`
 * that cash did not cover. Both and the day are clear when nothing is pending.
 * The pending principal is part of the balance until it is paid.
 * `accruedInterestCents` is daily interest not yet charged (collected on a payday).
 * `paymentsLeft` is the number of paydays that still take principal, and
 * `firstPaymentDay` is the first payday that takes any (an earlier payday takes interest only).
 * The optional fields read as 0 when missing (old saves, hand-built states).
 */
export type BankLoan = {
  balanceCents: number
  interestDueCents: number
  interestDay: number | null
  accruedInterestCents?: number
  principalDueCents?: number
  paymentsLeft?: number
  firstPaymentDay?: number
}

/** One fixed deposit. `annualRate` is the decimal rate fixed at opening. */
export type Deposit = {
  id: number
  principalCents: number
  openedDay: number
  termDays: 30 | 60 | 90
  annualRate: number
  maturityDay: number
}

/** The open fixed deposits. Absent in saves from before deposits (read as none). */
export type DepositsState = { nextId: number; open: Deposit[] }

/** Last end-of-day FI check. The meter reads this. It is not a second ledger. */
export type FiStatus = {
  day: number
  windowDays: number
  /** Window sum plus `openLossCents`. */
  passiveCents: number
  /** Net open loss at that close, 0 or below. */
  openLossCents: number
  expensesCents: number
  streak: number
}

/**
 * FI progress. `interest` is savings interest received, by the day it was paid.
 * The window sum reads the live realized ledger plus these rows.
 * `streak` is consecutive covered checks from day 30.
 */
export type FiTracker = {
  streak: number
  interest: FiInterest[]
  status: FiStatus | null
}

/**
 * Market plus the player. Commands, fills, and interest live on `pending` and `log`.
 * They are not written onto `market`, so a command cannot change the market hash.
 * `pending` holds commands since the previous `endDay`. `log` is those commands
 * until `endDay` replaces it with the commands, that day's margin interest,
 * borrow fees, margin check, savings accrual, and, on a 30th day, the monthly cycle.
 * `realized` is the per-day ledger (P&L minus fees, borrow fees, and margin interest).
 * One row per day that had a non-zero change. Days stay in increasing order.
 * `section` is the played part of the day. A jobless day starts at `sleep` (the end of sleep).
 * A day with a job starts at `work`, because that job occupies the work section.
 * `sleepHours` is how long that sleep block lasts. The active job sets it. The clock is display only.
 * `job` is employment, the notice, and the days worked since the last salary. It is not on the market.
 * `bill` is set while expenses are unpaid. `runEnd` is set on an FI win, a bill loss, or day 120.
 * `fi` holds the interest rows and the last FI check. It does not copy the realized ledger.
 * `stats` is energy and stress. `consumables` is the menu copied at the start.
 * End-of-day stat lines sit on `log` with the other account events. They are not on the market.
 * `lifestyle` is the Home and information-feed tiers. Courses stay on `job`.
 * `loan` is the single bank loan. A balance above 0 blocks another draw.
 * `socialPosts` is the display-only post menu. `perception` is the biased feed for this day.
 * It is rebuilt at day start and is not part of the market log.
 */
export type GameState = {
  market: MarketState
  /** Today's intraday path and the market clock. See session.ts. */
  session: SessionState
  /** Limit orders and take profit or stop loss. Checked against each bar as the clock moves. */
  resting: RestingState
  accounts: PlayerAccounts
  section: DaySection
  sleepHours: number
  job: PlayerJob
  positions: Record<string, OpenPosition>
  realized: RealizedDay[]
  pending: CommandLogEvent[]
  log: AccountLogEvent[]
  bill: PendingBill | null
  runEnd: RunEnd | null
  fi: FiTracker
  stats: PlayerStats
  consumables: ConsumableDefinition[]
  socialPosts: SocialPostDefinition[]
  perception: PerceptionState
  lifestyle: LifestyleState
  loan: BankLoan
  /** Research points, the course being studied, and today's free-time slots. */
  study: StudyState
  /** Every fill the book made, oldest first (section 5, the fill ledger). */
  fills: FillRecord[]
  /** One row per closed day, oldest first: the session that led into the close and the closing equity. */
  past: PastDay[]
  /** Social feed. Absent when the definitions have none. Never read by the market. */
  social?: SocialState
  /**
   * Net value the player bought (positive) or sold (negative) with market orders in each stock
   * today, in cents. It joins the market's order flow (plan market depth, Step M13) and is reset
   * when the day ends. Absent means none.
   */
  orderFlow?: Record<string, number>
  /** Layoff stream, open notice and jobs lost. Absent when the definitions have no layoffs. Never read by the market. */
  employer?: EmployerState
  /** Fixed deposits. Absent in older saves. No randomness. */
  deposits?: DepositsState
}

/**
 * A closed day, kept so a reloaded chart and equity curve still show it. `day` is the market
 * day after the close (1 for the first close). `prices` are the closes in cents, `bars` the
 * 15-minute session that led into them, and `equityCents` the trading equity at the close.
 * A record only: nothing in the sim reads it back.
 */
export type PastDay = {
  day: number
  prices: Record<string, number>
  bars: Record<string, SessionBar[]>
  equityCents: number
}

/** How a fill happened. */
export type FillVia = 'market' | 'limit' | 'takeProfit' | 'stopLoss' | 'liquidation' | 'forcedSale'

/**
 * One row of the fill ledger. `day` is the market day (the player's day is `day + 1`) and
 * `time` the `HH:MM` of the 15-minute bar. `feeCents` is every fee the fill paid.
 * `realizedCents` is the closed P&L before the fee, null when the fill only opened or added.
 * `slippageCents` is cents a share paid beyond the half spread.
 */
export type FillRecord = {
  n: number
  asset: string
  day: number
  time: string
  side: 'buy' | 'sell'
  quantity: number
  fillCents: number
  feeCents: number
  realizedCents: number | null
  slippageCents: number
  via: FillVia
}
