import { describe, expect, it } from 'vitest'

import {
  DEPOSIT_BREAK_PENALTY_PPM,
  DEPOSIT_MAX_OPEN,
  DEPOSIT_MIN_CENTS,
  STARTING_CASH_CENTS,
} from './constants.ts'
import {
  assertDeposits,
  depositAnnualRate,
  depositBreakValueCents,
  depositMaturityInterestCents,
  depositValueCents,
  depositsForForcedSale,
} from './deposits.ts'
import { netWorthCents } from './fi.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { formatEvent } from './log.ts'
import type { Deposit, GameState, MarketDefinitions } from './types.ts'

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 1000, borrowFeePpm: 100 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1000, borrowFeePpm: 100 },
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

function open(game: GameState, defs: MarketDefinitions, amountCents: number, termDays: number, from: string = 'cash'): void {
  applyCommand(game, defs, { type: 'openDeposit', amountCents, termDays, from })
}

function lastReason(game: GameState): string | null {
  const event = game.pending.findLast((item) => item.kind === 'commandRejected')
  return event?.kind === 'commandRejected' ? event.reason : null
}

describe('fixed deposits', () => {
  it('fixes the rate at opening: policy - 1.5 plus 1, 2 or 3 points', () => {
    expect(depositAnnualRate(4, 30)).toBeCloseTo(0.035, 12)
    expect(depositAnnualRate(4, 60)).toBeCloseTo(0.045, 12)
    expect(depositAnnualRate(4, 90)).toBeCloseTo(0.055, 12)
    expect(depositAnnualRate(0, 30)).toBe(0)
    const defs = market()
    const game = createGame(defs, 'rate')
    open(game, defs, 300_000, 90)
    const deposit = game.deposits?.open[0] as Deposit
    expect(deposit).toMatchObject({ id: 1, principalCents: 300_000, openedDay: 0, termDays: 90, maturityDay: 90 })
    expect(deposit.annualRate).toBeCloseTo(0.055, 12)
    // $3,000 for 90 days at 5.5% is $40.68.
    expect(depositMaturityInterestCents(deposit)).toBe(4068)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS - 300_000)
    // A later policy move does not touch it.
    const policy = game.market.environment.find((item) => item.id === 'policyRate')
    if (policy === undefined) throw new Error('missing policy entry')
    policy.value = 9
    advance(game, defs, 1)
    expect(game.deposits?.open[0]?.annualRate).toBe(deposit.annualRate)
    expect(depositMaturityInterestCents(game.deposits?.open[0] as Deposit)).toBe(4068)
  })

  it('pays principal plus interest into savings on the maturity day, with no rollover', () => {
    const defs = market()
    const game = createGame(defs, 'mature')
    open(game, defs, 300_000, 30)
    advance(game, defs, 29)
    expect(game.deposits?.open).toHaveLength(1)
    expect(game.accounts.savingsCents).toBeGreaterThanOrEqual(0)
    const savingsBefore = game.accounts.savingsCents
    endDay(game, defs)
    expect(game.market.day).toBe(30)
    // $3,000 for 30 days at 3.5% is $8.63.
    const matured = game.log.find((event) => event.kind === 'depositMatured')
    expect(matured).toMatchObject({ kind: 'depositMatured', day: 30, id: 1, principalCents: 300_000, interestCents: 863 })
    expect(game.deposits?.open).toEqual([])
    expect(game.accounts.savingsCents).toBe(savingsBefore + 300_000 + 863 + 0)
    if (matured !== undefined) expect(formatEvent(matured)).toContain('kind=depositMatured')
  })

  it('counts the interest as passive income for the FI check', () => {
    const defs = market()
    const game = createGame(defs, 'fi')
    open(game, defs, 300_000, 30)
    advance(game, defs, 30)
    // Savings were empty before, so the whole day-30 interest row is the deposit's.
    expect(game.fi.interest).toEqual([{ day: 30, cents: 863 }])
    expect(game.fi.status?.passiveCents).toBeGreaterThanOrEqual(863)
  })

  it('breaks the whole deposit for the principal less 2 percent and loses the interest', () => {
    expect(DEPOSIT_BREAK_PENALTY_PPM).toBe(20_000)
    const defs = market()
    const game = createGame(defs, 'break')
    open(game, defs, 100_000, 60)
    advance(game, defs, 10)
    const cash = game.accounts.cashCents
    const savingsBefore = game.accounts.savingsCents
    applyCommand(game, defs, { type: 'breakDeposit', id: 1 })
    const event = game.pending.at(-1)
    expect(event).toMatchObject({ kind: 'depositBroken', id: 1, principalCents: 100_000, paidCents: 98_000, penaltyCents: 2_000, forced: false, to: 'savings' })
    expect(game.accounts.savingsCents).toBe(savingsBefore + 98_000)
    expect(game.accounts.cashCents).toBe(cash)
    expect(game.deposits?.open).toEqual([])
    applyCommand(game, defs, { type: 'breakDeposit', id: 1 })
    expect(lastReason(game)).toBe('unknownDeposit')
    // Breaking costs more than the 60-day deposit would have earned.
    const kept: Deposit = { id: 1, principalCents: 300_000, openedDay: 0, termDays: 90, annualRate: 0.055, maturityDay: 90 }
    expect(depositBreakValueCents(kept)).toBe(294_000)
    expect(300_000 - depositBreakValueCents(kept)).toBeGreaterThan(depositMaturityInterestCents(kept))
  })

  it('refuses a deposit below the minimum, a fourth, a bad term or source, and too little money', () => {
    const defs = market()
    const game = createGame(defs, 'refuse')
    open(game, defs, DEPOSIT_MIN_CENTS - 1, 30)
    expect(lastReason(game)).toBe('belowMinimum')
    open(game, defs, 0, 30)
    expect(lastReason(game)).toBe('amountZero')
    open(game, defs, 10_000.5, 30)
    expect(lastReason(game)).toBe('amountNotInteger')
    open(game, defs, 20_000, 45)
    expect(lastReason(game)).toBe('unknownTerm')
    open(game, defs, 20_000, 30, 'trading')
    expect(lastReason(game)).toBe('unknownAccount')
    open(game, defs, 20_000, 30, 'savings')
    expect(lastReason(game)).toBe('insufficientFunds')
    open(game, defs, STARTING_CASH_CENTS + 1, 30)
    expect(lastReason(game)).toBe('insufficientFunds')
    expect(game.deposits?.open).toEqual([])
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)

    expect(DEPOSIT_MAX_OPEN).toBe(3)
    for (let count = 0; count < DEPOSIT_MAX_OPEN; count += 1) open(game, defs, 20_000, 30)
    expect(game.deposits?.open).toHaveLength(3)
    open(game, defs, 20_000, 30)
    expect(lastReason(game)).toBe('tooManyDeposits')
    expect(game.deposits?.open).toHaveLength(3)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS - 60_000)
  })

  it('opens from savings', () => {
    const defs = market()
    const game = createGame(defs, 'savings')
    applyCommand(game, defs, { type: 'transfer', from: 'cash', to: 'savings', amountCents: 50_000 })
    open(game, defs, 30_000, 30, 'savings')
    expect(game.accounts.savingsCents).toBe(20_000)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS - 50_000)
    expect(game.pending.at(-1)).toMatchObject({ kind: 'depositOpened', from: 'savings', principalCents: 30_000 })
  })

  it('refuses a new deposit while a bill or a loan payment is pending', () => {
    const defs = market()
    const billed = createGame(defs, 'bill')
    billed.accounts.cashCents = 0
    billed.accounts.savingsCents = 50_000
    advance(billed, defs, 30)
    expect(billed.bill).not.toBeNull()
    open(billed, defs, 20_000, 30, 'savings')
    expect(lastReason(billed)).toBe('billPending')
    expect(billed.deposits?.open).toEqual([])

    const owing = createGame(defs, 'owing')
    owing.loan.interestDueCents = 500
    owing.loan.interestDay = 0
    open(owing, defs, 20_000, 30)
    expect(lastReason(owing)).toBe('loanPaymentPending')
    expect(owing.deposits?.open).toEqual([])
  })

  it('keeps net worth the same on opening, grows it pro rata, and counts the full value at maturity', () => {
    const defs = market()
    const game = createGame(defs, 'worth')
    const before = netWorthCents(game, defs)
    open(game, defs, 300_000, 90)
    expect(netWorthCents(game, defs)).toBe(before)
    const deposit = game.deposits?.open[0] as Deposit
    expect(depositValueCents(deposit, 0)).toBe(300_000)
    expect(depositValueCents(deposit, 45)).toBe(300_000 + 2034)
    expect(depositValueCents(deposit, 90)).toBe(300_000 + 4068)
    expect(depositValueCents(deposit, 200)).toBe(300_000 + 4068)
  })

  it('orders deposits for a forced sale by latest maturity, later id on a tie', () => {
    const defs = market()
    const game = createGame(defs, 'order')
    open(game, defs, 20_000, 60)
    open(game, defs, 20_000, 90)
    open(game, defs, 20_000, 30)
    expect(depositsForForcedSale(game).map((item) => item.id)).toEqual([2, 1, 3])
    const twin = createGame(defs, 'order')
    open(twin, defs, 20_000, 30)
    open(twin, defs, 20_000, 30)
    expect(depositsForForcedSale(twin).map((item) => item.id)).toEqual([2, 1])
  })

  it('does not touch the market and uses no randomness', () => {
    const defs = market()
    const plain = createGame(defs, 'same')
    const locked = createGame(defs, 'same')
    open(locked, defs, 100_000, 30)
    advance(plain, defs, 35)
    advance(locked, defs, 35)
    expect(stateHash(locked.market)).toBe(stateHash(plain.market))
    expect(locked.session.streams).toEqual(plain.session.streams)
  })

  it('rejects a damaged deposits block', () => {
    expect(() => assertDeposits({ nextId: 1, open: [] })).not.toThrow()
    expect(() => assertDeposits({ nextId: 0, open: [] })).toThrow()
    const row: Deposit = { id: 1, principalCents: 20_000, openedDay: 0, termDays: 30, annualRate: 0.035, maturityDay: 30 }
    expect(() => assertDeposits({ nextId: 2, open: [row] })).not.toThrow()
    expect(() => assertDeposits({ nextId: 2, open: [{ ...row, maturityDay: 31 }] })).toThrow()
    expect(() => assertDeposits({ nextId: 1, open: [row] })).toThrow()
  })
})
