import { describe, expect, it } from 'vitest'

import {
  BASE_MONTHLY_EXPENSES_CENTS,
  MONTHLY_SALARY_CENTS,
  STARTING_CASH_CENTS,
  STARTING_TRADING_CENTS,
  UNUSED_LOAN_LIMIT_CENTS,
} from './constants.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { formatEvent } from './log.ts'
import { createMarket, stepMarketDay } from './market.ts'
import { RUN_LOST_BILL_REASON } from './monthly.ts'
import { closeWholePosition, tradingEquity } from './trading.ts'
import type { CoverableCheckEvent, GameState, MarketDefinitions, OpenPosition } from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugMonthly(message: string): void {
  io.writeSync(1, `[DEBUG monthly] ${message}\n`)
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

function advance(game: GameState, defs: MarketDefinitions, days: number): void {
  for (let step = 0; step < days; step += 1) endDay(game, defs)
}

function eventKind(game: GameState, kind: string): GameState['log'][number] | undefined {
  return game.log.find((item) => item.kind === kind)
}

function coverable(game: GameState): CoverableCheckEvent {
  const event = eventKind(game, 'coverableCheck')
  if (event?.kind !== 'coverableCheck') throw new Error('[DEBUG monthly] missing coverableCheck')
  return event
}

function positionOf(game: GameState): OpenPosition {
  const position = game.positions.NOVA
  if (position === undefined) throw new Error('[DEBUG monthly] missing NOVA position')
  return { asset: position.asset, signedShares: position.signedShares, costCents: position.costCents }
}

describe('monthly cycle, bills, and the shortfall choice', () => {
  it('pays the bill from cash on day 30 and day 60 when cash covers it', () => {
    expect(BASE_MONTHLY_EXPENSES_CENTS).toBe(100_000)
    expect(MONTHLY_SALARY_CENTS).toBe(0)
    expect(UNUSED_LOAN_LIMIT_CENTS).toBe(0)
    expect(STARTING_CASH_CENTS).toBe(300_000)

    const defs = market()
    const game = createGame(defs, 'demo')
    const marketOnly = createMarket(defs, 'demo')
    const dueDays: number[] = []
    for (let day = 1; day <= 60; day += 1) {
      endDay(game, defs)
      stepMarketDay(marketOnly, defs)
      expect(stateHash(game.market)).toBe(stateHash(marketOnly))
      expect(game.market.day).toBe(day)
      const due = eventKind(game, 'billDue')
      if (due?.kind === 'billDue') {
        dueDays.push(due.day)
        expect(due.amountCents).toBe(BASE_MONTHLY_EXPENSES_CENTS)
        expect(eventKind(game, 'billPending')).toBeUndefined()
        expect(eventKind(game, 'runEnded')).toBeUndefined()
        const paid = eventKind(game, 'billPaid')
        if (paid?.kind !== 'billPaid') throw new Error('[DEBUG monthly] missing billPaid')
        expect(paid.amountCents).toBe(due.amountCents)
        expect(paid.cashCents).toBe(due.cashCents - due.amountCents)
        const salary = eventKind(game, 'salaryPaid')
        if (salary?.kind !== 'salaryPaid') throw new Error('[DEBUG monthly] missing salaryPaid')
        expect(salary.amountCents).toBe(0)
        const check = coverable(game)
        expect(check.loanLimitCents).toBe(0)
        expect(check.totalCents).toBe(check.cashCents + check.savingsCents + check.tradingEquityCents + check.loanLimitCents)
        expect(check.totalCents).toBeGreaterThanOrEqual(check.billCents)
        expect(check.cashCents).toBe(due.cashCents)
        debugMonthly(
          `auto-pay day=${day} ${formatEvent(due)} ${formatEvent(paid)} ${formatEvent(salary)} ${formatEvent(check)}`,
        )
      } else {
        expect(eventKind(game, 'billPaid')).toBeUndefined()
      }
      expect(game.bill).toBeNull()
      expect(game.runEnd).toBeNull()
      expect(game.positions).toEqual({})
    }

    expect(dueDays).toEqual([30, 60])
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS - 2 * BASE_MONTHLY_EXPENSES_CENTS)
    expect(game.accounts.tradingCents).toBe(STARTING_TRADING_CENTS)
    expect(game.accounts.savingsCents).toBe(0)
    expect(formatEvent(eventKind(game, 'salaryPaid') as GameState['log'][number])).toBe('day=60 kind=salaryPaid amount=0')
    debugMonthly(`auto-pay cash=${game.accounts.cashCents} trading=${game.accounts.tradingCents} savings=0`)
  })

  it('blocks end day until a savings withdrawal and payBill clear the shortfall, and does not sell or move savings itself', () => {
    const defs = market()
    const game = createGame(defs, 'short')
    const twin = createGame(defs, 'short')
    applyCommand(game, defs, { type: 'skip' })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    const opened = positionOf(game)
    const tradingAfterBuy = game.accounts.tradingCents
    applyCommand(game, defs, { type: 'transfer', from: 'cash', to: 'savings', amountCents: game.accounts.cashCents })
    expect(game.accounts.cashCents).toBe(0)
    expect(game.accounts.savingsCents).toBe(STARTING_CASH_CENTS)

    for (let day = 1; day <= 29; day += 1) {
      endDay(game, defs)
      endDay(twin, defs)
      expect(stateHash(game.market)).toBe(stateHash(twin.market))
      expect(positionOf(game)).toEqual(opened)
    }
    expect(game.market.day).toBe(29)
    const savingsBefore = game.accounts.savingsCents
    const accruedBefore = game.accounts.accruedSavingsCents
    endDay(game, defs)
    endDay(twin, defs)
    expect(game.market.day).toBe(30)
    expect(stateHash(game.market)).toBe(stateHash(twin.market))
    expect(game.section).toBe('sleep')
    expect(positionOf(game)).toEqual(opened)
    expect(game.accounts.tradingCents).toBe(tradingAfterBuy)
    expect(game.accounts.cashCents).toBe(0)
    const paid = eventKind(game, 'savingsInterestPaid')
    if (paid?.kind !== 'savingsInterestPaid') throw new Error('[DEBUG monthly] missing savings interest')
    expect(game.accounts.savingsCents).toBe(savingsBefore + paid.amountCents)
    expect(paid.amountCents).toBe(accruedBefore + (eventKind(game, 'savingsAccrual') as { accrualCents: number }).accrualCents)
    expect(game.accounts.savingsCents).toBeGreaterThan(savingsBefore)
    expect(game.bill).toEqual({ day: 30, amountCents: BASE_MONTHLY_EXPENSES_CENTS })
    expect(game.runEnd).toBeNull()
    const pending = eventKind(game, 'billPending')
    if (pending?.kind !== 'billPending') throw new Error('[DEBUG monthly] missing billPending')
    expect(pending.shortfallCents).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    expect(pending.cashCents).toBe(0)
    const check = coverable(game)
    expect(check.totalCents).toBeGreaterThanOrEqual(check.billCents)
    expect(check.savingsCents).toBe(game.accounts.savingsCents)
    const marked = tradingEquity(game, defs).equity
    const clone = JSON.parse(JSON.stringify(game)) as GameState
    closeWholePosition(clone, defs, 'NOVA')
    expect(check.tradingEquityCents).toBe(clone.accounts.tradingCents)
    expect(check.tradingEquityCents).toBeLessThan(marked)
    expect(positionOf(game)).toEqual(opened)
    debugMonthly(
      `pending shortfall=${pending.shortfallCents} savings=${game.accounts.savingsCents} interest=${paid.amountCents} tradingEquity=${check.tradingEquityCents} marked=${marked} shares=${opened.signedShares}`,
    )
    debugMonthly(formatEvent(pending))
    debugMonthly(formatEvent(check))

    const day = game.market.day
    const hash = stateHash(game.market)
    const savingsAtBill = game.accounts.savingsCents
    expect(() => endDay(game, defs)).toThrow('end day blocked: billPending')
    expect(game.market.day).toBe(day)
    expect(stateHash(game.market)).toBe(hash)
    expect(positionOf(game)).toEqual(opened)
    expect(game.accounts.savingsCents).toBe(savingsAtBill)
    expect(game.accounts.cashCents).toBe(0)

    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'sell', quantity: 1 })
    const closed = game.log.find((item) => item.kind === 'commandRejected')
    if (closed?.kind !== 'commandRejected') throw new Error('[DEBUG monthly] missing marketClosed')
    expect(closed.reason).toBe('marketClosed')
    expect(positionOf(game)).toEqual(opened)
    expect(game.bill).not.toBeNull()

    applyCommand(game, defs, { type: 'payBill' })
    const rejected = [...game.log].reverse().find((item) => item.kind === 'commandRejected')
    if (rejected?.kind !== 'commandRejected') throw new Error('[DEBUG monthly] missing insufficientFunds')
    expect(rejected.reason).toBe('insufficientFunds')
    expect(game.accounts.cashCents).toBe(0)
    expect(game.accounts.savingsCents).toBe(savingsAtBill)
    expect(positionOf(game)).toEqual(opened)
    expect(game.runEnd).toBeNull()
    const afterReject = coverable(game)
    expect(afterReject.totalCents).toBeGreaterThanOrEqual(afterReject.billCents)
    debugMonthly(`pay rejected cash=0 savings=${game.accounts.savingsCents} ${formatEvent(afterReject)}`)

    applyCommand(game, defs, {
      type: 'transfer',
      from: 'savings',
      to: 'cash',
      amountCents: BASE_MONTHLY_EXPENSES_CENTS,
    })
    expect(game.accounts.cashCents).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    expect(game.accounts.savingsCents).toBe(savingsAtBill - BASE_MONTHLY_EXPENSES_CENTS)
    expect(positionOf(game)).toEqual(opened)
    expect(() => endDay(game, defs)).toThrow('end day blocked: billPending')

    applyCommand(game, defs, { type: 'payBill' })
    const payment = game.log.find((item) => item.kind === 'billPaid')
    if (payment?.kind !== 'billPaid') throw new Error('[DEBUG monthly] missing player billPaid')
    expect(payment.cashCents).toBe(0)
    expect(formatEvent(payment)).toBe(`day=30 kind=billPaid amount=${BASE_MONTHLY_EXPENSES_CENTS} cash=0`)
    expect(game.bill).toBeNull()
    expect(game.accounts.savingsCents).toBe(savingsAtBill - BASE_MONTHLY_EXPENSES_CENTS)
    expect(positionOf(game)).toEqual(opened)
    expect(game.section).toBe('sleep')
    endDay(game, defs)
    expect(game.market.day).toBe(31)
    expect(game.section).toBe('sleep')
    expect(positionOf(game)).toEqual(opened)
    debugMonthly(
      `paid from withdrawn savings cash=${game.accounts.cashCents} savings=${game.accounts.savingsCents} day=${game.market.day} shares=${opened.signedShares}`,
    )
  })

  it('ends the run at once when coverable money is below the bill and then blocks the next day', () => {
    const defs = market()
    const lost = createGame(defs, 'loss')
    const plain = createGame(defs, 'loss')
    lost.accounts.cashCents = 0
    lost.accounts.tradingCents = 0
    lost.accounts.savingsCents = 0
    debugMonthly('loss fixture cash=0 trading=0 savings=0 because transfers cannot destroy money')
    advance(lost, defs, 29)
    advance(plain, defs, 29)
    expect(lost.runEnd).toBeNull()
    expect(lost.market.day).toBe(29)
    endDay(lost, defs)
    endDay(plain, defs)
    expect(stateHash(lost.market)).toBe(stateHash(plain.market))
    expect(lost.market.day).toBe(30)
    expect(lost.accounts.cashCents).toBe(0)
    expect(lost.accounts.savingsCents).toBe(0)
    expect(lost.accounts.tradingCents).toBe(0)
    expect(lost.positions).toEqual({})
    expect(lost.bill).toBeNull()
    expect(lost.runEnd).toEqual({
      outcome: 'lost',
      day: 30,
      reason: RUN_LOST_BILL_REASON,
      netWorthCents: 0,
      score: 0,
    })
    expect(eventKind(lost, 'billPaid')).toBeUndefined()
    const check = coverable(lost)
    expect(check.cashCents).toBe(0)
    expect(check.savingsCents).toBe(0)
    expect(check.tradingEquityCents).toBe(0)
    expect(check.loanLimitCents).toBe(0)
    expect(check.totalCents).toBe(0)
    expect(check.billCents).toBe(BASE_MONTHLY_EXPENSES_CENTS)
    expect(check.totalCents).toBeLessThan(check.billCents)
    const ended = eventKind(lost, 'runEnded')
    if (ended?.kind !== 'runEnded') throw new Error('[DEBUG monthly] missing runEnded')
    expect(formatEvent(ended)).toBe(`day=30 kind=runEnded reason=${RUN_LOST_BILL_REASON}`)
    debugMonthly(`loss ${formatEvent(check)} ${formatEvent(ended)}`)

    const hash = stateHash(lost.market)
    expect(() => endDay(lost, defs)).toThrow('end day blocked: runEnded')
    expect(lost.market.day).toBe(30)
    expect(stateHash(lost.market)).toBe(hash)
    applyCommand(lost, defs, { type: 'transfer', from: 'cash', to: 'savings', amountCents: 1 })
    const rejection = lost.log.at(-1)
    if (rejection?.kind !== 'commandRejected') throw new Error('[DEBUG monthly] missing runEnded rejection')
    expect(rejection.reason).toBe('runEnded')
    expect(lost.accounts.cashCents).toBe(0)
    expect(lost.accounts.savingsCents).toBe(0)
    expect(plain.runEnd).toBeNull()
    expect(plain.accounts.cashCents).toBe(STARTING_CASH_CENTS - BASE_MONTHLY_EXPENSES_CENTS)
    debugMonthly(`loss blocked day=${lost.market.day} plain cash=${plain.accounts.cashCents}`)
  })
})
