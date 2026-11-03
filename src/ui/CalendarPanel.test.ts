import { describe, expect, it } from 'vitest'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { upcomingCalendar } from '../sim/calendar.ts'
import { createGame, endDay } from '../sim/game.ts'
import { playerCalendar } from './days.ts'

describe('calendar panel', () => {
  it('hides an outcome the sim has rolled until the day it happens', () => {
    const game = createGame(MARKET_DEFINITIONS, 'calendar-leak')
    // The growth release is on day 10. Its outcome is rolled at the close of day 7.
    for (let day = 0; day < 7; day += 1) endDay(game, MARKET_DEFINITIONS)
    const raw = upcomingCalendar(game.market, 30).find((item) => item.kind === 'growthRelease' && item.day === 10)
    expect(raw?.outcome).toBeDefined()
    const early = playerCalendar(game.market, 30).find((item) => item.kind === 'growthRelease' && item.day === 10)
    expect(early).toEqual({ kind: 'growthRelease', day: 10 })
    // Trading day 10 is when the release prints.
    endDay(game, MARKET_DEFINITIONS)
    endDay(game, MARKET_DEFINITIONS)
    const onTheDay = playerCalendar(game.market, 30).find((item) => item.kind === 'growthRelease' && item.day === 10)
    expect(onTheDay?.outcome).toBe(raw?.outcome)
  })
})
