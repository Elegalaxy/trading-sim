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
 * The unpaid cents accumulate. On each multiple of SAVINGS_PAY_INTERVAL_DAYS
 * (30, 60, 90, 120, and every later 30th day) they are paid into savings and
 * the accumulator resets. A pay day still logs a payment of 0 when savings is 0.
 * The environment entry is `policyRate` unless the calendar names another id.
 */
export const SAVINGS_SPREAD_PERCENT = 1.5
export const SAVINGS_DAYS_PER_YEAR = 365
export const SAVINGS_PAY_INTERVAL_DAYS = 30

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
 * market step). The flag does not end the run and does not change stress.
 * Integer test: end × DENOMINATOR < start × NUMERATOR.
 */
export const WIPE_OUT_RATIO_NUMERATOR = 10
export const WIPE_OUT_RATIO_DENOMINATOR = 100
