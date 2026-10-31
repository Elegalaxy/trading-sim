// Provisional tuning from plan section 2.4, except the 8% cap, which is confirmed
// in GAME_DESIGN section 7. Kept as integers so the price step can stay exact.

/** Section 5. Fraction of the price-to-fair gap closed each day: 35%. */
export const FAIR_VALUE_PULL_NUMERATOR = 35
export const FAIR_VALUE_PULL_DENOMINATOR = 100

/** Section 7. Maximum absolute daily price change: 8%. */
export const DAILY_MOVE_CAP_NUMERATOR = 8
export const DAILY_MOVE_CAP_DENOMINATOR = 100

/** Section 5. Index level = this × the equal-weight average of (price / start price). */
export const INDEX_LEVEL_SCALE = 1000

/** Stored prices are integer cents. One currency unit = 100 cents. */
export const CENTS_PER_UNIT = 100

/** Section 5. Events are rolled this many days before they become active. Provisional. */
export const EVENT_LOOKAHEAD_DAYS = 3

/**
 * Section 5. Maximum absolute fair-value change per asset per day: 12%. Provisional.
 * The excess is dropped and logged. It is not added on a later day (plan Q12).
 */
export const FAIR_VALUE_CHANGE_LIMIT_NUMERATOR = 12
export const FAIR_VALUE_CHANGE_LIMIT_DENOMINATOR = 100

/**
 * Section 5. Rumour attempts per source at the end of each day, including day 0.
 * Provisional. One attempt per source is 6 rumours a day. Over 20 seeds × 120 days
 * that is 4800 attempts per tier, enough to check a hit rate within ±5 points.
 */
export const RUMOURS_PER_SOURCE_PER_DAY = 1

/** Section 5. A rumour claims an event this many days after the generation day. Provisional. */
export const RUMOUR_LEAD_MIN_DAYS = 1
export const RUMOUR_LEAD_MAX_DAYS = 3

/**
 * Section 6. Provisional unit. 1E = 1000.00 currency = 100000 cents.
 * `CENTS_PER_UNIT` is one currency unit (100 cents), and one E is 1000 of those.
 */
export const CENTS_PER_E = 1000 * CENTS_PER_UNIT

/** Section 6. Provisional starting cash: 3E = 300000 cents. */
export const STARTING_CASH_CENTS = 3 * CENTS_PER_E

/** Section 6. Provisional starting trading account: 3E = 300000 cents. */
export const STARTING_TRADING_CENTS = 3 * CENTS_PER_E

/** Section 6. Provisional starting savings. */
export const STARTING_SAVINGS_CENTS = 0

/**
 * Section 6. Provisional savings interest.
 * The policy rate is that day's environment value in percent, read after the
 * market step, so a rate decision on that day counts. No random stream is drawn.
 * Annual rate = max(0, policyRate − SAVINGS_SPREAD_PERCENT) / 100.
 * Daily accrual cents = round half away from zero of
 * savingsCents × annualRate / SAVINGS_DAYS_PER_YEAR.
 * The unpaid cents accumulate. The monthly cycle pays them into savings on each
 * multiple of SAVINGS_PAY_INTERVAL_DAYS (30, 60, 90, 120, and every later 30th
 * day), after that day's accrual, and the accumulator resets. A pay day still
 * logs a payment of 0 when savings is 0.
 * The environment entry is `policyRate` unless the calendar names another id.
 */
export const SAVINGS_SPREAD_PERCENT = 1.5
export const SAVINGS_DAYS_PER_YEAR = 365
export const SAVINGS_PAY_INTERVAL_DAYS = 30

/**
 * Section 6. Jobless monthly pay: 0. A job's pay lives on its definition.
 * The monthly cycle prorates that pay by days worked ÷ 30.
 */
export const MONTHLY_SALARY_CENTS = 0

/** Section 6. Provisional days before a switch or quit takes effect. The starting job has no notice. */
export const JOB_NOTICE_DAYS = 3

/**
 * Section 6. Staff discount off the bill that comes due while that perk is active.
 * 5 / 100 of the bill. A bill that is already pending keeps its amount.
 */
export const STAFF_DISCOUNT_NUMERATOR = 5
export const STAFF_DISCOUNT_DENOMINATOR = 100

/**
 * Section 6. Provisional base monthly expenses: 1E.
 * The bill copies base plus lifestyle tier costs when it comes due, then the
 * staff discount. A pending bill keeps that copied amount.
 */
export const BASE_MONTHLY_EXPENSES_CENTS = CENTS_PER_E

/**
 * Section 6. Provisional lifestyle.
 * Home has 3 tiers above the base. Each adds 0.15E a month. Recovery is not applied.
 * Information feed has 2 tiers above the base. Each adds 0.1E a month.
 * An upgrade's upfront cost is 2 × the monthly cost that tier adds. A downgrade pays 0.
 * Courses cost 0.5E once and do not change the monthly bill.
 */
export const HOME_MAX_TIER = 3
export const HOME_TIER_COST_CENTS = 15_000
export const INFO_FEED_MAX_TIER = 2
export const INFO_FEED_TIER_COST_CENTS = 10_000
export const LIFESTYLE_UPFRONT_MULTIPLIER = 2
export const COURSE_COST_CENTS = 50_000

/**
 * Section 8. Provisional FI window and hold.
 * Passive income is the realized ledger (already net of fees, spread, borrow
 * fees, and margin interest) plus savings interest received. The rolling sum
 * uses this many day-numbers. The hold counts only from `FI_STREAK_FROM_DAY`.
 * The job is not required to be quit.
 */
export const FI_WINDOW_DAYS = 30
export const FI_HOLD_DAYS = 5
export const FI_STREAK_FROM_DAY = 30

/** Section 8. A run seals at the end of this day. The day-120 bill is not skipped. */
export const RUN_LENGTH_DAYS = 120

/**
 * Section 8. Provisional score.
 * Lost scores 0. Otherwise score = truncTowardZero(netWorthCents × SCORE_PER_E / CENTS_PER_E),
 * plus SCORE_PER_DAY_LEFT × (RUN_LENGTH_DAYS − end day) on a win. 1E = CENTS_PER_E.
 */
export const SCORE_PER_E = 100
export const SCORE_PER_DAY_LEFT = 10

/**
 * Section 12. One bank loan.
 * Limit cents = 2E + the active job's monthly pay + 0.25E × (home tier + information-feed tier).
 * A notice job does not count. Jobless pay is 0.
 * Annual rate = max(0, that day's policy percent + LOAN_RATE_SPREAD_PERCENT) / 100.
 * Interest cents = round half away from zero of balance × annual rate / LOAN_MONTHS_PER_YEAR.
 * It is due at the start of each 30th day and is paid from cash. Missed interest is
 * collected at the end of that day. A transfer into trading cannot leave cash plus
 * savings below the outstanding balance.
 */
export const LOAN_BASE_CENTS = 2 * CENTS_PER_E
export const LOAN_TIER_CENTS = CENTS_PER_E / 4
export const LOAN_RATE_SPREAD_PERCENT = 4
export const LOAN_MONTHS_PER_YEAR = 12

/** Section 6. Provisional policy-rate entry when the run has no calendar. */
export const POLICY_RATE_ENTRY_ID = 'policyRate'

/**
 * Section 7. Provisional trade fee: 0.1% of the fill notional (shares × fill price).
 * Fee cents = round half away from zero of notional × numerator / denominator.
 * The 5x equity rule is documented on `interpretOrder` in trading.ts.
 * Margin interest, liquidation, and the backstop are in margin.ts.
 * Spreads and borrow rates live on each asset as parts per million of price.
 */
export const TRADE_FEE_NUMERATOR = 1
export const TRADE_FEE_DENOMINATOR = 1000

/** Section 7. 1,000,000 ppm = 100% of the price. 1000 ppm = 0.10%. 100 ppm = 0.01%. */
export const RATE_PPM_SCALE = 1_000_000

/** Section 7. Provisional full spread on an asset: 0.10% to 0.40% of the current price. */
export const SPREAD_PPM_MIN = 1000
export const SPREAD_PPM_MAX = 4000

/** Section 7. Provisional daily short borrow fee: 0.01% to 0.03% of abs(shares) × price. */
export const BORROW_FEE_PPM_MIN = 100
export const BORROW_FEE_PPM_MAX = 300

/**
 * Section 7. Confirmed buying-power cap: 5x, a margin ratio of 20%.
 * Ratio = equity / gross position value, after the order, at the quoted price.
 * Reject when equity / gross would be below 20%. Exactly 20% is allowed.
 * Integer test: equity × DENOMINATOR >= gross × NUMERATOR.
 */
export const MARGIN_MIN_RATIO_NUMERATOR = 1
export const MARGIN_MIN_RATIO_DENOMINATOR = 5

/** Section 7. Confirmed warning when the end-of-day ratio is 15% or lower and gross is positive. */
export const MARGIN_WARNING_RATIO_NUMERATOR = 15
export const MARGIN_WARNING_RATIO_DENOMINATOR = 100

/** Section 7. Confirmed liquidation when the end-of-day ratio is 10% or lower and gross is positive. */
export const MARGIN_LIQUIDATION_RATIO_NUMERATOR = 10
export const MARGIN_LIQUIDATION_RATIO_DENOMINATOR = 100

/**
 * Section 7. Provisional margin interest.
 * Annual rate = max(0, that day's policy rate percent + this spread) / 100.
 * Borrowed amount = max(0, −trading cash). Daily interest = round half away
 * from zero of borrowed × annual rate / MARGIN_DAYS_PER_YEAR.
 * Charged once, after the market step, before the short borrow fee.
 */
export const MARGIN_INTEREST_SPREAD_PERCENT = 3
export const MARGIN_DAYS_PER_YEAR = 365

/**
 * Section 7. Provisional wipe-out. After the end-of-day check, trading equity
 * is below this fraction of its value at the start of the day (before the
 * market step). The flag does not end the run. Stats reads it for the stress spike.
 * Integer test: end × DENOMINATOR < start × NUMERATOR.
 */
export const WIPE_OUT_RATIO_NUMERATOR = 10
export const WIPE_OUT_RATIO_DENOMINATOR = 100

/**
 * Section 4. Provisional clock. Display only. The simulation stores the
 * section and the sleep hours; these minutes are not a running timer.
 * Sleep ends at 07:00. Work is 08:00–12:00 (part-time) or 08:00–16:00
 * (full-time). The market is open 17:00–21:00.
 */
export const SLEEP_END_MINUTE = 7 * 60
export const WORK_START_MINUTE = 8 * 60
export const WORK_PART_TIME_END_MINUTE = 12 * 60
export const WORK_FULL_TIME_END_MINUTE = 16 * 60
export const MARKET_OPEN_MINUTE = 17 * 60
export const MARKET_CLOSE_MINUTE = 21 * 60

/** Section 4. Jobless sleep, and the sleep hours before a run chooses a job. A job may set another length. */
export const SLEEP_HOURS = 8

/**
 * Section 4. Default when `createGame` is not given a job. The live job is on the player.
 * Jobless skip still runs from the end of sleep. A job's skip runs from the end of work.
 */
export const PLAYER_IS_JOBLESS = true

/**
 * Section 9. Provisional bias. Stress at or below the floor does not change the feed.
 * At the ceiling, at most this percent of the visible items are distorted.
 * The share scales in a straight line between the two. The count is rounded down,
 * so a small feed stays under the cap. Verify spends the same energy as reading the news.
 */
export const BIAS_STRESS_FLOOR = 60
export const BIAS_STRESS_CEILING = 100
export const BIAS_CAP_PERCENT = 25
export const VERIFY_ENERGY_COST = 2

/**
 * Intraday session (design section 5). The market window is split into this many
 * steps of SESSION_STEP_MINUTES. 17:00 to 21:00 is 16 steps of 15 minutes. Provisional.
 */
export const SESSION_STEPS = 16
export const SESSION_STEP_MINUTES = 15

/** Intraday bars stay within this band around the open: 12%. The daily close is capped at 8%. */
export const SESSION_BAND_NUMERATOR = 12
export const SESSION_BAND_DENOMINATOR = 100

/** Share of the daily volatility used as the size of intraday noise. Provisional. */
export const SESSION_NOISE_SCALE = 1

/** A bar's wick reaches past its body by up to this fraction of one step's noise. Provisional. */
export const SESSION_WICK_SCALE = 0.6

/**
 * Volume is cosmetic. Daily base notional in cents, divided by the open price,
 * gives a base share count. Provisional.
 */
export const SESSION_BASE_NOTIONAL_CENTS = 200_000_000

/** Extra volume on a day of a full 8% move, and on an event day. The bar noise is log-normal. */
export const SESSION_MOVE_VOLUME_BOOST = 1.5
export const SESSION_EVENT_VOLUME_BOOST = 0.6
export const SESSION_VOLUME_NOISE = 0.25
