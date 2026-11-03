import { describe, expect, it } from 'vitest'

import { applyCommand, createGame, endDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { bentPostCount, shownPosts } from '../sim/social.ts'
import type { GameState, MarketDefinitions } from '../sim/types.ts'
import { MARKET_DEFINITIONS } from './index.ts'

function play(defs: MarketDefinitions, seed: string, days: number, visit?: (game: GameState) => void): GameState {
  const game = createGame(defs, seed)
  for (let day = 0; day < days; day += 1) {
    visit?.(game)
    applyCommand(game, defs, { type: 'skip' })
    endDay(game, defs)
  }
  return game
}

describe('social feed', () => {
  it('never moves the market: same hash with the feed on and off', () => {
    const { social: _social, ...withoutSocial } = MARKET_DEFINITIONS
    void _social
    const on = play(MARKET_DEFINITIONS, 'feed', 25)
    const off = play(withoutSocial, 'feed', 25)
    expect(on.social).toBeDefined()
    expect(off.social).toBeUndefined()
    expect(stateHash(on.market)).toBe(stateHash(off.market))
    expect(on.session.bars).toEqual(off.session.bars)
  })

  it('is the same for the same seed and has posts of every kind over a month', () => {
    const kinds = new Set<string>()
    const a = play(MARKET_DEFINITIONS, 'same', 30, (game) => {
      game.session.clock = 16
      for (const post of game.social?.posts ?? []) kinds.add(post.kind)
      game.session.clock = 0
    })
    const b = play(MARKET_DEFINITIONS, 'same', 30)
    expect(a.social?.posts).toEqual(b.social?.posts)
    expect([...kinds].sort()).toEqual(['chatter', 'mood', 'whisper'])
  })

  it('keeps chatter hidden until the session clock reaches its time', () => {
    let checked = 0
    play(MARKET_DEFINITIONS, 'clock', 30, (game) => {
      const chatter = (game.social?.posts ?? []).filter((post) => post.kind === 'chatter')
      if (chatter.length === 0) return
      game.session.clock = 0
      expect(shownPosts(game).some((item) => item.post.kind === 'chatter')).toBe(false)
      game.session.clock = 16
      expect(shownPosts(game).filter((item) => item.post.kind === 'chatter')).toHaveLength(chatter.length)
      game.session.clock = 0
      checked += 1
    })
    expect(checked).toBeGreaterThan(0)
  })

  it('has a whisper hit rate below the low rumour tier', () => {
    let truth = 0
    let total = 0
    for (let seed = 0; seed < 12; seed += 1) {
      play(MARKET_DEFINITIONS, `whisper-${seed}`, 30, (game) => {
        for (const post of game.social?.posts ?? []) {
          if (post.kind !== 'whisper') continue
          total += 1
          if (post.truth === true) truth += 1
        }
      })
    }
    expect(total).toBeGreaterThan(100)
    expect(truth / total).toBeLessThan(0.35)
    expect(truth).toBeGreaterThan(0)
  })

  it('bends no post at or below stress 60 and at most a quarter of them at stress 100, unmarked', () => {
    let sawBent = false
    play(MARKET_DEFINITIONS, 'stress', 20, (game) => {
      game.session.clock = 16
      const visible = (game.social?.posts ?? []).length
      game.positions.NOVA = { asset: 'NOVA', signedShares: 10, costCents: 48000, leverage: 1 }
      game.stats.stress = 60
      expect(bentPostCount(game)).toBe(0)
      game.stats.stress = 100
      const bent = bentPostCount(game)
      expect(bent).toBeLessThanOrEqual(Math.floor(visible / 4))
      if (bent > 0) sawBent = true
      game.perception.verified = true
      expect(bentPostCount(game)).toBe(0)
      game.perception.verified = false
      delete game.positions.NOVA
      game.session.clock = 0
    })
    expect(sawBent).toBe(true)
  })
})
