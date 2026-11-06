import { describe, expect, it } from 'vitest'
import { CONSUMABLE_DEFINITIONS, JOB_DEFINITIONS, MARKET_DEFINITIONS } from '../content/index.ts'
import { createGame, endDay } from '../sim/game.ts'
import { nextPayday, playerDay, tradingDay } from './days.ts'

function game(jobId: string) {
  return createGame(MARKET_DEFINITIONS, 'days', { jobs: JOB_DEFINITIONS, jobId, consumables: CONSUMABLE_DEFINITIONS })
}

describe('player day numbers', () => {
  it('names the close the session leads to, the same day the news shows', () => {
    const state = game('jobless')
    expect(tradingDay(state)).toBe(1)
    expect(state.perception.shown.day).toBe(1)
    endDay(state, MARKET_DEFINITIONS)
    expect(tradingDay(state)).toBe(2)
    expect(state.perception.shown.day).toBe(tradingDay(state))
    expect(playerDay(state.market.day)).toBe(2)
    expect(playerDay(120)).toBe(120)
  })

  it('counts down to the close of day 30 and estimates the salary and bill', () => {
    const state = game('shopAssistant')
    const first = nextPayday(state, MARKET_DEFINITIONS)
    expect(first).toMatchObject({ day: 30, inDays: 29 })
    expect(first?.salaryCents).toBe(60_000)
    expect(first?.billCents).toBeGreaterThan(0)
    expect(first?.loanPaymentCents).toBe(0)
    for (let i = 0; i < 29; i += 1) endDay(state, MARKET_DEFINITIONS)
    expect(nextPayday(state, MARKET_DEFINITIONS)).toMatchObject({ day: 30, inDays: 0, salaryCents: 60_000 })
    endDay(state, MARKET_DEFINITIONS)
    const paid = state.log.find((event) => event.kind === 'salaryPaid')
    expect(paid?.kind === 'salaryPaid' ? paid.amountCents : null).toBe(60_000)
    if (state.bill !== null) return
    expect(nextPayday(state, MARKET_DEFINITIONS)).toMatchObject({ day: 60, inDays: 29 })
  })
})
