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
