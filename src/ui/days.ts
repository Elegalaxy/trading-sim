// Day numbers as the player sees them. The sim counts closes: `market.day` is the number of
// closes so far, and the session on screen leads to the next one. The news, the calendar and
// the session all name that next close, so the player is trading day `market.day + 1`.
// The run ends after the close of day RUN_LENGTH_DAYS.
//
// Payday is the monthly cycle in `endDay`: it runs at the close of every 30th day (salary,
// savings interest, the loan payment, then the bill), so the next payday is the next multiple
// of 30 at or after the day being traded.

import { upcomingCalendar } from '../sim/calendar.ts'
import { RUN_LENGTH_DAYS, SAVINGS_PAY_INTERVAL_DAYS } from '../sim/constants.ts'
import { activeJob } from '../sim/jobs.ts'
import { projectedBillCents } from '../sim/lifestyle.ts'
import { nextLoanPayment } from '../sim/loan.ts'
import type { GameState, MarketDefinitions, MarketState, UpcomingCalendarItem } from '../sim/types.ts'

/** The day the player is trading: the close the session leads to. */
export function tradingDay(game: GameState): number {
  return Math.min(game.market.day + 1, RUN_LENGTH_DAYS)
}

/** A sim day that was logged during trading (orders, job notice) as the player's day number. */
export function playerDay(simDay: number): number {
  return Math.min(simDay + 1, RUN_LENGTH_DAYS)
}

export type Payday = {
  /** The day whose close runs the monthly cycle. */
  day: number
  /** 0 means at today's close. */
  inDays: number
  /** About what salary will pay, prorated by days worked. */
  salaryCents: number
  billCents: number
  /** The loan payment (interest plus instalment) due on this payday, 0 without a loan. */
  loanPaymentCents: number
}

/** The next monthly cycle and what it is expected to move. Null once the run is over. */
export function nextPayday(game: GameState, defs: MarketDefinitions): Payday | null {
  if (game.runEnd !== null || game.market.day >= RUN_LENGTH_DAYS) return null
  const today = tradingDay(game)
  const day = Math.ceil(today / SAVINGS_PAY_INTERVAL_DAYS) * SAVINGS_PAY_INTERVAL_DAYS
  const inDays = day - today
  let salary = 0
  for (const row of game.job.worked) {
    const job = game.job.catalog.find((item) => item.id === row.jobId)
    if (job !== undefined) salary += (job.payCents * row.days) / SAVINGS_PAY_INTERVAL_DAYS
  }
  // Today and the days left until payday are worked at the current job.
  salary += (activeJob(game.job).payCents * (inDays + 1)) / SAVINGS_PAY_INTERVAL_DAYS
  const loanPayment = nextLoanPayment(game, defs)
  return {
    day,
    inDays,
    salaryCents: Math.round(salary),
    billCents: projectedBillCents(game),
    loanPaymentCents: loanPayment === null ? 0 : loanPayment.totalCents,
  }
}

/**
 * Upcoming dates as the player may see them. The sim rolls an outcome three days ahead, so an
 * outcome is shown only from the day being traded (`market.day + 1`), when its headline prints.
 * The consensus is public from the roll, three days ahead.
 */
export function playerCalendar(market: MarketState, days: number): UpcomingCalendarItem[] {
  const today = market.day + 1
  return upcomingCalendar(market, days).map((item) =>
    item.day <= today
      ? item
      : { kind: item.kind, day: item.day, ...(item.expected === undefined ? {} : { expected: item.expected }) },
  )
}
