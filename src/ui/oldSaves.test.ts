import { describe, expect, it } from 'vitest'

import { MARKET_DEFINITIONS as defs } from '../content/index.ts'
import { DAMAGED_SAVE_MESSAGE, SAVE_VERSION, type SaveFile } from '../persist/save.ts'
import { applyCommand, createGame, endDay } from '../sim/game.ts'
import type { GameState } from '../sim/types.ts'
import { continueGame } from './store.ts'

function save(mutate: (state: Record<string, any>) => void, days = 0): SaveFile {
  const game = createGame(defs, 'old')
  for (let day = 0; day < days; day += 1) {
    applyCommand(game, defs, { type: 'skip' })
    endDay(game, defs)
  }
  applyCommand(game, defs, { type: 'skip' })
  const state = structuredClone(game) as unknown as Record<string, any>
  mutate(state)
  return { version: SAVE_VERSION, savedAt: '2026-11-04T00:00:00.000Z', mode: 'seeded', seed: 'old', state: state as unknown as GameState }
}

describe('saves from before the market depth work', () => {
  it('load when current', () => {
    expect(continueGame(save(() => {}))).toBeNull()
  })

  it('say the save is damaged for calendar rolls without a consensus (before it)', () => {
    // The growth release is on day 10 and is rolled at the close of day 7, so a save after day 8 holds a roll.
    const withRoll = save((s) => {
      expect(s.market.calendarRolls.length).toBeGreaterThan(0)
      s.market.calendarRolls.forEach((roll: Record<string, unknown>) => delete roll.expected)
    }, 8)
    expect(continueGame(withRoll)).toBe(DAMAGED_SAVE_MESSAGE)
  })

  it.each([
    ['a session without the levels stream (before liquidity grabs)', (s: Record<string, any>) => delete s.session.streams.levels],
    ['a market without order-flow parties (before them)', (s: Record<string, any>) => delete s.market.participants],
    ['parties without the crowd and trend fields (partway)', (s: Record<string, any>) => delete s.market.participants.heat],
    ['a game without the social feed (before it)', (s: Record<string, any>) => delete s.social],
  ])('say the save is damaged for %s', (_label, mutate) => {
    expect(continueGame(save(mutate))).toBe(DAMAGED_SAVE_MESSAGE)
  })
})
