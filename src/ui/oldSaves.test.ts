import { describe, expect, it } from 'vitest'

import { MARKET_DEFINITIONS as defs } from '../content/index.ts'
import { DAMAGED_SAVE_MESSAGE, SAVE_VERSION, type SaveFile } from '../persist/save.ts'
import { applyCommand, createGame, endDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import type { GameState, MarketDefinitions } from '../sim/types.ts'
import { continueGame, getSnapshot } from './store.ts'

function useTradingStoreSnapshot() {
  return getSnapshot().run
}

function save(mutate: (state: Record<string, any>) => void, days = 0, rules: MarketDefinitions = defs): SaveFile {
  const game = createGame(rules, 'old')
  for (let day = 0; day < days; day += 1) {
    applyCommand(game, rules, { type: 'skip' })
    endDay(game, rules)
  }
  applyCommand(game, rules, { type: 'skip' })
  const state = structuredClone(game) as unknown as Record<string, any>
  mutate(state)
  return { version: SAVE_VERSION, savedAt: '2026-11-04T00:00:00.000Z', mode: 'seeded', seed: 'old', state: state as unknown as GameState }
}

describe('saves from before the market depth work', () => {
  it('load when current', () => {
    expect(continueGame(save(() => {}))).toBeNull()
  })

  it('load with a lifestyle from before Health and Equipment, and get the current item menu', () => {
    const old = save((s) => {
      s.lifestyle = { home: 1, infoFeed: 0 }
      s.consumables = [{ id: 'coffee', name: 'Coffee', costCents: 1_000, energy: 15, stress: 0 }]
    })
    expect(continueGame(old)).toBeNull()
    const loaded = useTradingStoreSnapshot()
    expect(loaded?.game.lifestyle).toEqual({ home: 1, infoFeed: 0, health: 0, equipment: 0 })
    expect(loaded?.game.consumables.map((item) => item.id)).toContain('gymSession')
  })

  it('load an open loan from before the payment schedule, and give it one as if drawn that day', () => {
    const old = save((s) => {
      s.loan = { balanceCents: 90_000, interestDueCents: 0, interestDay: null }
    }, 40)
    expect(continueGame(old)).toBeNull()
    const loaded = useTradingStoreSnapshot()
    // Day 40: paydays 60, 90 and 120 are all at least 7 days away.
    expect(loaded?.game.loan).toMatchObject({ balanceCents: 90_000, paymentsLeft: 3, firstPaymentDay: 60 })
    expect(loaded?.game.loan.accruedInterestCents).toBeUndefined()
  })

  it('load without an employer (before layoffs) and give it the stream a run with layoffs has at that day', () => {
    // Day 45: roll days 10 and 40 are behind, so four draws.
    const fresh = createGame(defs, 'old')
    for (let day = 0; day < 45; day += 1) {
      applyCommand(fresh, defs, { type: 'skip' })
      endDay(fresh, defs)
    }
    const old = save((s) => {
      delete s.employer
    }, 45)
    expect(continueGame(old)).toBeNull()
    const loaded = useTradingStoreSnapshot()
    expect(loaded?.game.employer?.stream).toEqual(fresh.employer?.stream)
    expect(loaded?.game.employer).toMatchObject({ notice: null, barred: [] })
  })

  it('keep an open notice and a barred job from a current save, and refuse a damaged employer block', () => {
    const open = save((s) => {
      s.employer.notice = { jobId: 'shopAssistant', warnedDay: 10, decisionDay: 20, layoffDay: 30, real: true, stage: 'confirmed' }
      s.employer.barred = ['nightWarehouse']
    })
    expect(continueGame(open)).toBeNull()
    expect(useTradingStoreSnapshot()?.game.employer).toMatchObject({ notice: { stage: 'confirmed' }, barred: ['nightWarehouse'] })
    expect(continueGame(save((s) => { s.employer.barred = 'x' }))).toBe(DAMAGED_SAVE_MESSAGE)
    expect(continueGame(save((s) => { delete s.employer.stream.a }))).toBe(DAMAGED_SAVE_MESSAGE)
    expect(continueGame(save((s) => { s.employer.notice = { jobId: 'x' } }))).toBe(DAMAGED_SAVE_MESSAGE)
  })

  it('load without deposits (before them) as an empty block, and keep open deposits from a current save', () => {
    const old = save((s) => {
      delete s.deposits
    })
    expect(continueGame(old)).toBeNull()
    expect(useTradingStoreSnapshot()?.game.deposits).toEqual({ nextId: 1, open: [] })

    const held = save((s) => {
      s.deposits = {
        nextId: 2,
        open: [{ id: 1, principalCents: 50_000, openedDay: 0, termDays: 60, annualRate: 0.045, maturityDay: 60 }],
      }
    })
    expect(continueGame(held)).toBeNull()
    expect(useTradingStoreSnapshot()?.game.deposits?.open).toHaveLength(1)
    expect(continueGame(save((s) => { s.deposits = { nextId: 1, open: 'x' } }))).toBe(DAMAGED_SAVE_MESSAGE)
    expect(continueGame(save((s) => { s.deposits = { nextId: 1, open: [{ id: 1 }] } }))).toBe(DAMAGED_SAVE_MESSAGE)
    expect(
      continueGame(
        save((s) => {
          s.deposits = { nextId: 2, open: [{ id: 1, principalCents: 50_000, openedDay: 0, termDays: 45, annualRate: 0.045, maturityDay: 45 }] }
        }),
      ),
    ).toBe(DAMAGED_SAVE_MESSAGE)
  })

  it('say the save is damaged for calendar rolls without a consensus (before it)', () => {
    // The growth release is on day 10 and is rolled at the close of day 7, so a save after day 8 holds a roll.
    const withRoll = save((s) => {
      expect(s.market.calendarRolls.length).toBeGreaterThan(0)
      s.market.calendarRolls.forEach((roll: Record<string, unknown>) => delete roll.expected)
    }, 8)
    expect(continueGame(withRoll)).toBe(DAMAGED_SAVE_MESSAGE)
  })

  describe('a save from before the traders model', () => {
    // Played with the old rules, as a pre-P6 save was: its session preview is the old model's.
    const pre = () => save(() => {}, 3, (({ traders: _traders, ...rest }) => rest)(defs))
    const loadedGame = (file: SaveFile): GameState => {
      expect(continueGame(file)).toBeNull()
      return structuredClone(getSnapshot().run!.game)
    }
    const anchors = (game: GameState): number[] =>
      game.market.log.flatMap((e) => (e.kind === 'priceStep' && e.anchor !== undefined ? [e.anchor] : []))

    it('gets a book that starts two days on, with the lagged anchor at the previewed close', () => {
      const game = loadedGame(pre())
      const book = game.market.participants?.book
      expect(book?.activeFromDay).toBe(game.market.day + 2)
      for (const [id, seen] of Object.entries(book!.seenAnchor)) {
        const bars = game.session.bars[id]
        expect(seen).toBe(bars[bars.length - 1].close)
      }
    })

    it('prints the session close on the next End day, then runs the new model the day after', () => {
      const game = loadedGame(pre())
      const closes = Object.fromEntries(Object.entries(game.session.bars).map(([id, bars]) => [id, bars[bars.length - 1].close]))
      applyCommand(game, defs, { type: 'skip' })
      endDay(game, defs)
      for (const [id, close] of Object.entries(closes)) expect(game.market.assets[id].priceCents).toBe(close)
      expect(anchors(game)).toEqual([])
      applyCommand(game, defs, { type: 'skip' })
      endDay(game, defs)
      expect(anchors(game).length).toBeGreaterThan(0)
    })

    it('is deterministic', () => {
      const run = (): string => {
        const game = loadedGame(pre())
        for (let i = 0; i < 4; i += 1) {
          applyCommand(game, defs, { type: 'skip' })
          endDay(game, defs)
        }
        return stateHash(game.market)
      }
      expect(run()).toBe(run())
    })

    it('leaves a save that already has a book untouched', () => {
      const file = save(() => {}, 3)
      const before = structuredClone(file.state.market.participants?.book)
      expect(before).toBeDefined()
      expect(loadedGame(file).market.participants?.book).toEqual(before)
    })
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
