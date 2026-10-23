import { describe, expect, it } from 'vitest'

import {
  LOAN_BASE_CENTS,
  LOAN_TIER_CENTS,
  STARTING_CASH_CENTS,
  STARTING_TRADING_CENTS,
} from './constants.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { activeJob } from './jobs.ts'
import {
  RUN_LOST_LOAN_REASON,
  loanAnnualRate,
  loanInterestCents,
  loanLimitCents,
  settleMissedLoanInterest,
  unusedLoanLimitCents,
} from './loan.ts'
import { formatEvent } from './log.ts'
import type { ForcedSaleEvent, GameState, JobDefinition, MarketDefinitions } from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugLoan(message: string): void {
  io.writeSync(1, `[DEBUG loan] ${message}\n`)
}

const JOBS: readonly JobDefinition[] = [
  { id: 'jobless', name: 'Jobless', slots: 0, payCents: 0, requirement: 'none', perk: 'none', energyCost: 0, stressCost: 0, sleepHours: 8 },
  { id: 'shopAssistant', name: 'Shop assistant', slots: 1, payCents: 60_000, requirement: 'none', perk: 'staffDiscount', energyCost: 5, stressCost: 2, sleepHours: 8 },
  { id: 'nightWarehouse', name: 'Night-shift warehouse', slots: 2, payCents: 130_000, requirement: 'none', perk: 'quietBreaks', energyCost: 20, stressCost: 12, sleepHours: 6 },
]

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 1000, borrowFeePpm: 100 },
  { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018, spreadPpm: 1000, borrowFeePpm: 100 },
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

function pricesOf(game: GameState): Record<string, number> {
  const prices: Record<string, number> = {}
  for (const [id, asset] of Object.entries(game.market.assets)) prices[id] = asset.priceCents
  return prices
}

function sales(events: readonly { kind: string }[]): ForcedSaleEvent[] {
  return events.filter((event): event is ForcedSaleEvent => event.kind === 'forcedSale')
}

describe('bank loan', () => {
  it('rejects a second loan until the first is repaid, and the limit uses the active job', () => {
    expect(LOAN_TIER_CENTS).toBe(25_000)
    expect(loanInterestCents(75, 4)).toBe(1)
    expect(loanInterestCents(100_000, 4)).toBe(667)
    expect(loanAnnualRate(4)).toBe(0.08)
    debugLoan(`interest 75 cents at 4% -> ${loanInterestCents(75, 4)}; 100000 -> ${loanInterestCents(100_000, 4)}`)

    const defs = market()
    const game = createGame(defs, 'limit', { jobs: JOBS, jobId: 'shopAssistant' })
    const twin = createGame(defs, 'limit', { jobs: JOBS, jobId: 'shopAssistant' })
    game.lifestyle = { home: 2, infoFeed: 1 }
    const limit = LOAN_BASE_CENTS + 60_000 + LOAN_TIER_CENTS * (2 + 1)
    expect(loanLimitCents(game)).toBe(limit)
    expect(activeJob(game.job).id).toBe('shopAssistant')
    applyCommand(game, defs, { type: 'setJob', jobId: 'nightWarehouse' })
    expect(game.job.pending?.jobId).toBe('nightWarehouse')
    expect(loanLimitCents(game)).toBe(limit)
    expect(activeJob(game.job).payCents).toBe(60_000)
    debugLoan(`limit=${limit} active=shopAssistant notice=nightWarehouse pay stays ${activeJob(game.job).payCents}`)

    const over = applyCommand(game, defs, { type: 'takeLoan', amountCents: limit + 1 })
    expect(over.log.at(-1)).toMatchObject({ kind: 'commandRejected', command: 'takeLoan', reason: 'aboveLoanLimit' })
    expect(game.loan.balanceCents).toBe(0)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)

    applyCommand(game, defs, { type: 'takeLoan', amountCents: limit })
    const taken = game.log.at(-1)
    if (taken?.kind !== 'loanTaken') throw new Error('[DEBUG loan] missing loanTaken')
    expect(taken.amountCents).toBe(limit)
    expect(taken.balanceCents).toBe(limit)
    expect(taken.limitCents).toBe(limit)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS + limit)
    expect(stateHash(game.market)).toBe(stateHash(twin.market))
    debugLoan(formatEvent(taken))

    const second = applyCommand(game, defs, { type: 'takeLoan', amountCents: 1 })
    const rejected = second.log.at(-1)
    if (rejected?.kind !== 'commandRejected') throw new Error('[DEBUG loan] missing second-loan rejection')
    expect(rejected.reason).toBe('loanOutstanding')
    expect(game.loan.balanceCents).toBe(limit)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS + limit)
    debugLoan(formatEvent(rejected))

    applyCommand(game, defs, { type: 'repayLoan', amountCents: 1 })
    expect(game.loan.balanceCents).toBe(limit - 1)
    const still = applyCommand(game, defs, { type: 'takeLoan', amountCents: 1 })
    expect(still.log.at(-1)).toMatchObject({ reason: 'loanOutstanding' })
    applyCommand(game, defs, { type: 'repayLoan', amountCents: limit - 1 })
    const repaid = game.log.at(-1)
    if (repaid?.kind !== 'loanRepaid') throw new Error('[DEBUG loan] missing loanRepaid')
    expect(repaid.balanceCents).toBe(0)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    debugLoan(formatEvent(repaid))

    applyCommand(game, defs, { type: 'takeLoan', amountCents: 1_000 })
    expect(game.loan.balanceCents).toBe(1_000)
    expect(game.log.at(-1)).toMatchObject({ kind: 'loanTaken', amountCents: 1_000 })
    debugLoan(`second draw after payoff balance=${game.loan.balanceCents}`)
  })

  it('pays interest from cash on the 30th day and does not sell', () => {
    const defs = market()
    const game = createGame(defs, 'auto')
    const hashBefore = stateHash(game.market)
    applyCommand(game, defs, { type: 'takeLoan', amountCents: 100_000 })
    expect(stateHash(game.market)).toBe(hashBefore)
    advance(game, defs, 30)
    expect(game.market.day).toBe(30)
    expect(game.loan.balanceCents).toBe(100_000)
    expect(game.loan.interestDueCents).toBe(0)
    const due = game.log.find((event) => event.kind === 'loanInterestDue')
    const paid = game.log.find((event) => event.kind === 'loanInterestPaid')
    if (due?.kind !== 'loanInterestDue' || paid?.kind !== 'loanInterestPaid') {
      throw new Error('[DEBUG loan] missing interest events')
    }
    expect(due.amountCents).toBe(667)
    expect(due.policyRate).toBe(4)
    expect(due.annualRate).toBe(loanAnnualRate(4))
    expect(paid.amountCents).toBe(667)
    expect(paid.balanceCents).toBe(100_000)
    expect(game.log.some((event) => event.kind === 'forcedSale')).toBe(false)
    expect(game.bill).toBeNull()
    expect(game.runEnd).toBeNull()
    debugLoan(`${formatEvent(due)} ${formatEvent(paid)}`)
  })

  it('sells the worst position, then savings, and never changes lifestyle or prices', () => {
    const defs = market()
    const game = createGame(defs, 'sale')
    game.lifestyle = { home: 2, infoFeed: 1 }
    applyCommand(game, defs, { type: 'skip' })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    applyCommand(game, defs, { type: 'order', asset: 'BLSW', side: 'buy', quantity: 1 })
    const nova = game.positions.NOVA
    const blsw = game.positions.BLSW
    const novaQuote = game.market.assets.NOVA
    const blswQuote = game.market.assets.BLSW
    if (nova === undefined || blsw === undefined || novaQuote === undefined || blswQuote === undefined) {
      throw new Error('[DEBUG loan] missing positions')
    }
    const blswFill = [...game.log].reverse().find((event) => event.kind === 'orderFill' && event.asset === 'BLSW')
    if (blswFill?.kind !== 'orderFill') throw new Error('[DEBUG loan] missing BLSW fill')
    novaQuote.priceCents = 1_000
    blswQuote.priceCents = blswFill.fillPrice
    const novaPnl = 1_000 * nova.signedShares - nova.costCents
    const blswPnl = blswFill.fillPrice * blsw.signedShares - blsw.costCents
    expect(novaPnl).toBeLessThan(blswPnl)
    game.loan.balanceCents = 100_000
    game.loan.interestDueCents = 100
    game.loan.interestDay = game.market.day
    game.accounts.cashCents = 0
    game.accounts.savingsCents = 50_000
    const prices = pricesOf(game)
    const hash = stateHash(game.market)
    const lifestyle = { ...game.lifestyle }
    const events = settleMissedLoanInterest(game, defs)
    const sold = sales(events)
    expect(sold.map((event) => event.source)).toEqual(['NOVA'])
    expect(sold[0]?.amountCents).toBeGreaterThanOrEqual(100)
    expect(game.positions.NOVA).toBeUndefined()
    expect(game.positions.BLSW).toEqual(blsw)
    expect(game.accounts.savingsCents).toBe(50_000)
    expect(game.loan.interestDueCents).toBe(0)
    expect(game.loan.balanceCents).toBe(100_000)
    expect(game.lifestyle).toEqual(lifestyle)
    expect(pricesOf(game)).toEqual(prices)
    expect(stateHash(game.market)).toBe(hash)
    expect(game.runEnd).toBeNull()
    debugLoan(`worst first pnl nova=${novaPnl} blsw=${blswPnl} ${sold.map((event) => formatEvent(event)).join(' ')}`)

    const chain = createGame(defs, 'chain')
    chain.lifestyle = { home: 1, infoFeed: 0 }
    applyCommand(chain, defs, { type: 'skip' })
    applyCommand(chain, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    const chainNova = chain.market.assets.NOVA
    if (chainNova === undefined) throw new Error('[DEBUG loan] missing NOVA')
    chainNova.priceCents = 100
    chain.loan.balanceCents = 50_000
    chain.loan.interestDueCents = 10_000
    chain.loan.interestDay = 0
    chain.accounts.cashCents = 0
    chain.accounts.savingsCents = 20_000
    const chainLifestyle = { ...chain.lifestyle }
    const chainPrices = pricesOf(chain)
    const chainEvents = settleMissedLoanInterest(chain, defs)
    const chainSales = sales(chainEvents)
    expect(chainSales.map((event) => event.source)).toEqual(['NOVA', 'savings'])
    expect(chainSales[0]?.amountCents).toBeLessThan(10_000)
    expect(chainSales[1]?.amountCents).toBe(10_000 - (chainSales[0]?.amountCents ?? 0))
    expect(chain.loan.interestDueCents).toBe(0)
    expect(chain.lifestyle).toEqual(chainLifestyle)
    expect(pricesOf(chain)).toEqual(chainPrices)
    expect(chain.runEnd).toBeNull()
    debugLoan(`then savings ${chainSales.map((event) => formatEvent(event)).join(' ')}`)

    const lost = createGame(defs, 'short-interest')
    lost.lifestyle = { home: 3, infoFeed: 2 }
    lost.loan.balanceCents = 80_000
    lost.loan.interestDueCents = 500
    lost.loan.interestDay = 0
    lost.accounts.cashCents = 0
    lost.accounts.savingsCents = 0
    lost.accounts.tradingCents = 0
    const lostLifestyle = { ...lost.lifestyle }
    const lostPrices = pricesOf(lost)
    const lostHash = stateHash(lost.market)
    endDay(lost, defs)
    expect(lost.market.day).toBe(0)
    expect(stateHash(lost.market)).toBe(lostHash)
    expect(pricesOf(lost)).toEqual(lostPrices)
    expect(lost.lifestyle).toEqual(lostLifestyle)
    expect(lost.positions).toEqual({})
    expect(lost.runEnd).toMatchObject({ outcome: 'lost', day: 0, reason: RUN_LOST_LOAN_REASON, score: 0 })
    const ended = lost.log.find((event) => event.kind === 'runEnded')
    if (ended?.kind !== 'runEnded') throw new Error('[DEBUG loan] missing loan runEnded')
    expect(formatEvent(ended)).toBe(`day=0 kind=runEnded reason=${RUN_LOST_LOAN_REASON}`)
    expect(lost.log.some((event) => event.kind === 'forcedSale')).toBe(false)
    debugLoan(`still short ${formatEvent(ended)} lifestyle home=${lost.lifestyle.home} info=${lost.lifestyle.infoFeed}`)
  })

  it('lets a bill be paid with loan cash and does not sell to pay the bill', () => {
    const defs = market()
    const game = createGame(defs, 'bill')
    const twin = createGame(defs, 'bill')
    game.accounts.cashCents = 0
    game.accounts.savingsCents = 0
    game.accounts.tradingCents = 0
    applyCommand(game, defs, { type: 'skip' })
    advance(game, defs, 29)
    advance(twin, defs, 29)
    endDay(game, defs)
    endDay(twin, defs)
    expect(game.market.day).toBe(30)
    expect(stateHash(game.market)).toBe(stateHash(twin.market))
    expect(game.runEnd).toBeNull()
    expect(game.bill).toEqual({ day: 30, amountCents: 100_000 })
    const check = game.log.find((event) => event.kind === 'coverableCheck')
    if (check?.kind !== 'coverableCheck') throw new Error('[DEBUG loan] missing coverableCheck')
    expect(check.loanLimitCents).toBe(LOAN_BASE_CENTS)
    expect(check.totalCents).toBeGreaterThanOrEqual(check.billCents)
    expect(game.positions).toEqual({})
    debugLoan(formatEvent(check))

    expect(() => endDay(game, defs)).toThrow('end day blocked: billPending')
    expect(game.positions).toEqual({})
    expect(game.log.some((event) => event.kind === 'forcedSale')).toBe(false)

    const draw = Math.min(game.bill?.amountCents ?? 0, unusedLoanLimitCents(game))
    applyCommand(game, defs, { type: 'takeLoan', amountCents: draw })
    expect(game.bill).not.toBeNull()
    expect(game.accounts.cashCents).toBe(draw)
    expect(game.loan.balanceCents).toBe(draw)
    debugLoan(`loan cash=${game.accounts.cashCents} bill still ${game.bill?.amountCents}`)
    applyCommand(game, defs, { type: 'payBill' })
    expect(game.bill).toBeNull()
    expect(game.accounts.cashCents).toBe(0)
    expect(game.runEnd).toBeNull()
    endDay(game, defs)
    endDay(twin, defs)
    expect(game.market.day).toBe(31)
    expect(stateHash(game.market)).toBe(stateHash(twin.market))
    expect(game.positions).toEqual({})
    debugLoan(`bill paid from loan day=${game.market.day} balance=${game.loan.balanceCents}`)
  })

  it('blocks a transfer into trading that would leave cash and savings below the loan', () => {
    const defs = market()
    const game = createGame(defs, 'move')
    applyCommand(game, defs, { type: 'takeLoan', amountCents: 100_000 })
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS + 100_000)
    const blocked = applyCommand(game, defs, {
      type: 'transfer',
      from: 'cash',
      to: 'trading',
      amountCents: STARTING_CASH_CENTS + 1,
    })
    const rejection = blocked.log.at(-1)
    if (rejection?.kind !== 'commandRejected') throw new Error('[DEBUG loan] missing transfer rejection')
    expect(rejection.reason).toBe('belowLoanBalance')
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS + 100_000)
    expect(game.accounts.tradingCents).toBe(STARTING_TRADING_CENTS)
    expect(game.accounts.savingsCents).toBe(0)
    debugLoan(formatEvent(rejection))

    applyCommand(game, defs, {
      type: 'transfer',
      from: 'cash',
      to: 'trading',
      amountCents: STARTING_CASH_CENTS,
    })
    expect(game.accounts.cashCents).toBe(100_000)
    expect(game.accounts.tradingCents).toBe(STARTING_TRADING_CENTS + STARTING_CASH_CENTS)
    applyCommand(game, defs, { type: 'transfer', from: 'trading', to: 'cash', amountCents: STARTING_CASH_CENTS })
    applyCommand(game, defs, { type: 'transfer', from: 'cash', to: 'savings', amountCents: 40_000 })
    expect(game.accounts.cashCents + game.accounts.savingsCents).toBe(STARTING_CASH_CENTS + 100_000)
    const kept = applyCommand(game, defs, { type: 'transfer', from: 'cash', to: 'trading', amountCents: 1 })
    expect(kept.log.at(-1)).toMatchObject({ kind: 'transfer' })
    expect(game.accounts.cashCents + game.accounts.savingsCents).toBe(STARTING_CASH_CENTS + 100_000 - 1)
    debugLoan(
      `after allowed moves cash=${game.accounts.cashCents} savings=${game.accounts.savingsCents} trading=${game.accounts.tradingCents}`,
    )

    applyCommand(game, defs, { type: 'repayLoan', amountCents: 50_000 })
    expect(game.loan.balanceCents).toBe(50_000)
    expect(game.log.at(-1)).toMatchObject({ kind: 'loanRepaid' })
  })

  it('collects missed interest at the end of the due day without selling for the bill', () => {
    const defs = market()
    const game = createGame(defs, 'day30', { jobs: JOBS, jobId: 'jobless' })
    game.lifestyle = { home: 1, infoFeed: 1 }
    const lifestyle = { ...game.lifestyle }
    applyCommand(game, defs, { type: 'skip' })
    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 20 })
    const openedNova = game.positions.NOVA?.signedShares
    applyCommand(game, defs, { type: 'takeLoan', amountCents: 100_000 })
    applyCommand(game, defs, {
      type: 'transfer',
      from: 'cash',
      to: 'savings',
      amountCents: game.accounts.cashCents,
    })
    expect(game.accounts.cashCents).toBe(0)
    advance(game, defs, 30)
    expect(game.market.day).toBe(30)
    expect(game.loan.interestDueCents).toBe(667)
    expect(game.bill).not.toBeNull()
    expect(game.runEnd).toBeNull()
    expect(game.lifestyle).toEqual(lifestyle)
    const positionBefore = game.positions.NOVA?.signedShares
    expect(positionBefore).toBe(openedNova)
    expect(() => endDay(game, defs)).toThrow('end day blocked: billPending')
    expect(game.positions.NOVA?.signedShares).toBe(positionBefore)
    expect(game.lifestyle).toEqual(lifestyle)
    expect(game.log.some((event) => event.kind === 'forcedSale')).toBe(false)
    debugLoan(`bill blocked the day interest=${game.loan.interestDueCents} shares=${positionBefore}`)

    const bill = game.bill?.amountCents
    if (bill === undefined) throw new Error('[DEBUG loan] missing bill')
    applyCommand(game, defs, { type: 'transfer', from: 'savings', to: 'cash', amountCents: bill })
    applyCommand(game, defs, { type: 'payBill' })
    expect(game.bill).toBeNull()
    expect(game.accounts.cashCents).toBe(0)
    const novaQuote = game.market.assets.NOVA
    if (novaQuote === undefined) throw new Error('[DEBUG loan] missing NOVA price')
    novaQuote.priceCents = 1_000
    const savings = game.accounts.savingsCents
    endDay(game, defs)
    expect(game.market.day).toBe(31)
    expect(game.runEnd).toBeNull()
    expect(game.lifestyle).toEqual(lifestyle)
    expect(game.loan.interestDueCents).toBe(0)
    expect(game.loan.balanceCents).toBe(100_000)
    const forced = game.log.filter((event) => event.kind === 'forcedSale')
    expect(forced[0]).toMatchObject({ kind: 'forcedSale', source: 'NOVA' })
    expect(forced.some((event) => event.kind === 'forcedSale' && event.source === 'savings')).toBe(false)
    expect(game.accounts.savingsCents).toBe(savings)
    expect(game.positions.NOVA).toBeUndefined()
    for (const event of forced) {
      if (event.kind === 'forcedSale') debugLoan(formatEvent(event))
    }
    debugLoan(`end of due day savings=${game.accounts.savingsCents} lifestyle home=${game.lifestyle.home} info=${game.lifestyle.infoFeed}`)
  })
})
