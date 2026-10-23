import { describe, expect, it } from 'vitest'

import {
  BASE_MONTHLY_EXPENSES_CENTS,
  CENTS_PER_E,
  FI_HOLD_DAYS,
  FI_STREAK_FROM_DAY,
  FI_WINDOW_DAYS,
  MONTHLY_SALARY_CENTS,
  RUN_LENGTH_DAYS,
  SCORE_PER_DAY_LEFT,
  SCORE_PER_E,
  STARTING_CASH_CENTS,
  STARTING_TRADING_CENTS,
} from './constants.ts'
import { scoreFor } from './fi.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { formatEvent } from './log.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { RUN_LOST_BILL_REASON } from './monthly.ts'
import type { FiCheckEvent, GameState, MarketDefinitions } from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugFi(message: string): void {
  io.writeSync(1, `[DEBUG fi] ${message}\n`)
}

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
  { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018, spreadPpm: 3000, borrowFeePpm: 200 },
  { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100 },
  { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014, spreadPpm: 2000, borrowFeePpm: 150 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
]

function market(): MarketDefinitions {
  return {
    assets: ASSETS,
    environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
    events: [],
  }
}

function fiCheck(game: GameState): FiCheckEvent {
  const event = game.log.find((item) => item.kind === 'fiCheck')
  if (event?.kind !== 'fiCheck') throw new Error('[DEBUG fi] missing fiCheck')
  return event
}

function realizedOn(game: GameState, day: number): number {
  for (const row of game.realized) {
    if (row.day === day) return row.cents
  }
  return 0
}

describe('FI hold, run end, and score', () => {
  it('scores lost as 0 and otherwise uses truncating integer E', () => {
    expect(scoreFor('lost', 500_000, 30)).toBe(0)
    expect(scoreFor('finished', 100_099, RUN_LENGTH_DAYS)).toBe(100)
    expect(scoreFor('finished', -1500, RUN_LENGTH_DAYS)).toBe(-1)
    const worth = Math.floor((500_000 * SCORE_PER_E) / CENTS_PER_E)
    const daysLeft = RUN_LENGTH_DAYS - 34
    expect(scoreFor('won', 500_000, 34)).toBe(worth + daysLeft * SCORE_PER_DAY_LEFT)
    debugFi(`score lost=0 finished 100099 cents -> 100 won day 34 worth=${worth} daysLeft=${daysLeft}`)
  })

  it('ignores unrealized gains and a cash increase that is not realized or savings interest', () => {
    expect(MONTHLY_SALARY_CENTS).toBe(0)
    const defs = market()
    const game = createGame(defs, 'salary')
    applyCommand(game, defs, { type: 'skip' })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    const fee = -realizedOn(game, 0)
    expect(fee).toBeGreaterThan(0)
    const salaryStandIn = 99_999
    game.accounts.cashCents += salaryStandIn
    endDay(game, defs)
    const check = fiCheck(game)
    const position = game.positions.NOVA
    const price = game.market.assets.NOVA?.priceCents
    if (position === undefined || price === undefined) throw new Error('[DEBUG fi] missing NOVA after the day')
    const unrealized = position.signedShares * price - position.costCents
    expect(unrealized).not.toBe(0)
    const passive = realizedOn(game, 0) + realizedOn(game, 1)
    expect(check.passiveCents).toBe(passive)
    expect(check.passiveCents).not.toBe(passive + salaryStandIn)
    expect(check.passiveCents).not.toBe(passive + unrealized)
    expect(check.windowDays).toBe(1)
    debugFi(
      `${formatEvent(check)} fee=${fee} unrealized=${unrealized} salaryStandIn=${salaryStandIn} cash=${game.accounts.cashCents}`,
    )
  })

  it('adds savings interest once and does not add a fake salary on top', () => {
    const defs = market()
    const game = createGame(defs, 'interest')
    applyCommand(game, defs, { type: 'transfer', from: 'trading', to: 'savings', amountCents: 200_000 })
    for (let day = 1; day < FI_STREAK_FROM_DAY; day += 1) endDay(game, defs)
    const salaryStandIn = 99_999
    game.accounts.cashCents += salaryStandIn
    endDay(game, defs)
    const check = fiCheck(game)
    const paid = game.log.find((item) => item.kind === 'savingsInterestPaid')
    if (paid?.kind !== 'savingsInterestPaid') throw new Error('[DEBUG fi] missing savings interest')
    expect(paid.amountCents).toBeGreaterThan(0)
    expect(game.realized).toEqual([])
    expect(check.passiveCents).toBe(paid.amountCents)
    expect(check.passiveCents).not.toBe(paid.amountCents + salaryStandIn)
    expect(check.windowDays).toBe(FI_WINDOW_DAYS)
    debugFi(`${formatEvent(check)} ${formatEvent(paid)} salaryStandIn=${salaryStandIn}`)
  })

  it('does not subtract margin interest a second time', () => {
    const defs = market()
    const game = createGame(defs, 'loan')
    game.accounts.tradingCents = -100_000
    endDay(game, defs)
    const interest = game.log.find((item) => item.kind === 'marginInterest')
    if (interest?.kind !== 'marginInterest') throw new Error('[DEBUG fi] missing margin interest')
    expect(interest.interest).toBeGreaterThan(0)
    const check = fiCheck(game)
    expect(game.realized).toEqual([{ day: 1, cents: -interest.interest }])
    expect(check.passiveCents).toBe(-interest.interest)
    expect(check.passiveCents).not.toBe(-2 * interest.interest)
    debugFi(`${formatEvent(check)} ${formatEvent(interest)}`)
  })

  it('wins on the 5th covered day from day 30 and not on the 4th', () => {
    const defs = market()
    const game = createGame(defs, 'fi')
    for (let day = 1; day <= 40; day += 1) {
      game.realized.push({ day, cents: BASE_MONTHLY_EXPENSES_CENTS })
    }
    let fourth = ''
    for (let day = 1; day <= FI_STREAK_FROM_DAY + FI_HOLD_DAYS - 2; day += 1) {
      endDay(game, defs)
      expect(game.market.day).toBe(day)
      expect(game.runEnd).toBeNull()
      if (day < FI_STREAK_FROM_DAY) expect(game.fi.streak).toBe(0)
      if (day === FI_STREAK_FROM_DAY - 1) {
        const early = fiCheck(game)
        expect(early.passiveCents).toBeGreaterThanOrEqual(early.expensesCents)
        expect(early.streak).toBe(0)
        debugFi(`before day 30 ${formatEvent(early)}`)
      }
      if (day === FI_STREAK_FROM_DAY + FI_HOLD_DAYS - 2) {
        expect(game.fi.streak).toBe(FI_HOLD_DAYS - 1)
        expect(game.log.some((item) => item.kind === 'runEnded')).toBe(false)
        fourth = formatEvent(fiCheck(game))
      }
    }
    expect(game.market.day).toBe(33)
    expect(fourth).toBe('day=33 kind=fiCheck windowDays=30 passive=3000000 expenses=100000 streak=4')
    debugFi(`4th day no win ${fourth}`)

    endDay(game, defs)
    const check = fiCheck(game)
    expect(formatEvent(check)).toBe('day=34 kind=fiCheck windowDays=30 passive=3000000 expenses=100000 streak=5')
    expect(game.runEnd).toEqual({
      outcome: 'won',
      day: 34,
      reason: 'financialIndependence',
      netWorthCents: STARTING_CASH_CENTS + STARTING_TRADING_CENTS - BASE_MONTHLY_EXPENSES_CENTS,
      score: 500 + (RUN_LENGTH_DAYS - 34) * SCORE_PER_DAY_LEFT,
    })
    const ended = game.log.find((item) => item.kind === 'runEnded')
    if (ended?.kind !== 'runEnded') throw new Error('[DEBUG fi] missing win runEnded')
    expect(formatEvent(ended)).toBe('day=34 kind=runEnded reason=financialIndependence')
    debugFi(`5th day win ${formatEvent(check)} ${formatEvent(ended)} score=${game.runEnd?.score}`)
    expect(() => endDay(game, defs)).toThrow('end day blocked: runEnded')
  })

  it('ends a no-trade run at day 120 after the bill, without another price step', () => {
    const defs = market()
    const game = createGame(defs, 'demo')
    const twin = createMarket(defs, 'demo')
    for (let day = 1; day <= RUN_LENGTH_DAYS; day += 1) {
      endDay(game, defs)
      stepMarketDay(twin, defs)
      expect(stateHash(game.market)).toBe(stateHash(twin))
      expect(game.market.day).toBe(day)
      expect(game.runEnd).toBeNull()
    }
    expect(game.bill).toEqual({ day: RUN_LENGTH_DAYS, amountCents: BASE_MONTHLY_EXPENSES_CENTS })
    const hash = stateHash(game.market)
    expect(() => endDay(game, defs)).toThrow('end day blocked: billPending')
    expect(stateHash(game.market)).toBe(hash)
    expect(game.runEnd).toBeNull()

    applyCommand(game, defs, { type: 'transfer', from: 'trading', to: 'cash', amountCents: BASE_MONTHLY_EXPENSES_CENTS })
    applyCommand(game, defs, { type: 'payBill' })
    expect(game.bill).toBeNull()
    expect(game.runEnd).toBeNull()
    endDay(game, defs)
    expect(game.market.day).toBe(RUN_LENGTH_DAYS)
    expect(stateHash(game.market)).toBe(hash)
    const netWorth = STARTING_CASH_CENTS + STARTING_TRADING_CENTS - 4 * BASE_MONTHLY_EXPENSES_CENTS
    expect(game.runEnd).toEqual({
      outcome: 'finished',
      day: RUN_LENGTH_DAYS,
      reason: 'day120',
      netWorthCents: netWorth,
      score: Math.floor((netWorth * SCORE_PER_E) / CENTS_PER_E),
    })
    const ended = game.log.find((item) => item.kind === 'runEnded')
    if (ended?.kind !== 'runEnded') throw new Error('[DEBUG fi] missing day-120 runEnded')
    expect(formatEvent(ended)).toBe(`day=${RUN_LENGTH_DAYS} kind=runEnded reason=day120`)
    debugFi(`day 120 seal ${formatEvent(ended)} hash=${hash} score=${game.runEnd?.score} netWorth=${netWorth}`)
    expect(() => endDay(game, defs)).toThrow('end day blocked: runEnded')
    expect(stateHash(game.market)).toBe(hash)
  })

  it('scores a bill loss at 0 and still blocks the next day', () => {
    const defs = market()
    const game = createGame(defs, 'loss')
    game.accounts.cashCents = 0
    game.accounts.tradingCents = 0
    game.accounts.savingsCents = 0
    for (let day = 1; day < FI_STREAK_FROM_DAY; day += 1) endDay(game, defs)
    endDay(game, defs)
    expect(game.runEnd).toEqual({
      outcome: 'lost',
      day: FI_STREAK_FROM_DAY,
      reason: RUN_LOST_BILL_REASON,
      netWorthCents: 0,
      score: 0,
    })
    const check = fiCheck(game)
    expect(check.streak).toBe(0)
    debugFi(`loss score=0 ${formatEvent(check)}`)
    expect(() => endDay(game, defs)).toThrow('end day blocked: runEnded')
  })
})
