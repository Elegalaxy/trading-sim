import { describe, expect, it } from 'vitest'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { createGame, endDay, viewedFeed } from '../sim/game.ts'
import type { GameState, LayoffNotice } from '../sim/types.ts'
import { buildTicker, clampIndex, newsItemText, stepIndex, visibleNewsItems } from './ticker.ts'

function withEmployer(game: GameState, stage: 'rumour' | 'confirmed'): GameState {
  const notice = { jobId: 'warehouse', stage, decisionDay: 25, layoffDay: 30, real: true } as unknown as LayoffNotice
  const base = game.employer ?? ({} as NonNullable<GameState['employer']>)
  return { ...game, employer: { ...base, notice } as NonNullable<GameState['employer']> }
}

describe('ticker', () => {
  it('is empty without a game and after the run ended', () => {
    expect(buildTicker(null)).toEqual([])
    const game = createGame(MARKET_DEFINITIONS, 'ticker-end')
    expect(buildTicker({ ...game, runEnd: { day: 120 } as unknown as GameState['runEnd'] })).toEqual([])
  })

  it('includes calendar items', () => {
    const game = createGame(MARKET_DEFINITIONS, 'ticker-cal')
    for (let day = 0; day < 8; day += 1) endDay(game, MARKET_DEFINITIONS)
    expect(buildTicker(game).some((item) => item.source === 'calendar' && /^Day \d+: /.test(item.text))).toBe(true)
  })

  it('pins the employer notice first with its tone', () => {
    const game = createGame(MARKET_DEFINITIONS, 'ticker-emp')
    const rumour = buildTicker(withEmployer(game, 'rumour'))
    expect(rumour[0]?.source).toBe('employer')
    expect(rumour[0]?.tone).toBe('rumour')
    expect(buildTicker(withEmployer(game, 'confirmed'))[0]?.tone).toBe('confirmed')
    expect(buildTicker(game).some((item) => item.source === 'employer')).toBe(false)
  })

  it('shows the same market items as the News panel, distorted ones included', () => {
    const game = createGame(MARKET_DEFINITIONS, 'ticker-news')
    for (let day = 0; day < 12; day += 1) endDay(game, MARKET_DEFINITIONS)
    game.stats.stress = 100
    game.stats.newsReads = 1
    const panel = visibleNewsItems(viewedFeed(game), game.stats.newsReads).map(newsItemText)
    const ticker = buildTicker(game)
      .filter((item) => item.source === 'news')
      .map((item) => item.text)
    expect(ticker).toEqual(panel)
    expect(panel).toEqual(viewedFeed(game).items.map(newsItemText))
    // Before a read the panel shows only the top headline.
    game.stats.newsReads = 0
    expect(buildTicker(game).filter((item) => item.source === 'news').length).toBeLessThanOrEqual(1)
  })

  it('wraps the rotation in both directions', () => {
    expect(stepIndex(2, 3, 1)).toBe(0)
    expect(stepIndex(0, 3, -1)).toBe(2)
    expect(stepIndex(0, 0, 1)).toBe(0)
    expect(clampIndex(5, 3)).toBe(2)
    expect(clampIndex(1, 0)).toBe(0)
  })
})
