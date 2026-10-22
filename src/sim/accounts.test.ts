import { describe, expect, it } from 'vitest'

import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { formatEvent } from './log.ts'
import { createMarket, stepMarketDay } from './market.ts'
import {
  CENTS_PER_E,
  SAVINGS_DAYS_PER_YEAR,
  SAVINGS_PAY_INTERVAL_DAYS,
  SAVINGS_SPREAD_PERCENT,
  STARTING_CASH_CENTS,
  STARTING_SAVINGS_CENTS,
  STARTING_TRADING_CENTS,
} from './constants.ts'
import type {
  CalendarDefinitions,
  CalendarEffectCell,
  CalendarItemKind,
  CalendarOutcome,
  GameState,
  LogEvent,
  MarketDefinitions,
  PlayerAccounts,
  PolicyChanceCell,
  ReleaseChanceCell,
  SavingsAccrualEvent,
  SavingsInterestPaidEvent,
} from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugAccounts(message: string): void {
  io.writeSync(1, `[DEBUG accounts] ${message}\n`)
}

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022 },
  { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018 },
  { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01 },
  { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0 },
]

const BANDS = ['low', 'mid', 'high'] as const
const TRACKED = ['noiseRoll', 'eventRoll', 'calendarItem', 'headline', 'rumourGenerated'] as const

function policyRows(hold: number, up: number, down: number): PolicyChanceCell[] {
  const rows: PolicyChanceCell[] = []
  for (const inflationBand of BANDS) {
    for (const growthBand of BANDS) rows.push({ inflationBand, growthBand, hold, up, down })
  }
  return rows
}

function releaseRows(above: number, inline: number, below: number): ReleaseChanceCell[] {
  return BANDS.map((band) => ({ band, above, inline, below }))
}

function effectRows(): CalendarEffectCell[] {
  const rows: CalendarEffectCell[] = []
  const add = (kind: CalendarItemKind, outcome: CalendarOutcome, sectorA: number, sectorB: number): void => {
    rows.push({ kind, outcome, sector: 'A', percent: sectorA })
    rows.push({ kind, outcome, sector: 'B', percent: sectorB })
  }
  add('policyDecision', 'up', -1.5, -4)
  add('policyDecision', 'down', 1, 3)
  add('policyDecision', 'hold', 0.25, -0.25)
  for (const kind of ['growthRelease', 'inflationRelease'] as const) {
    add(kind, 'above', 1, 0.4)
    add(kind, 'inline', 0.2, 0.1)
    add(kind, 'below', -1, -0.4)
  }
  return rows
}

function calendar(policyDay: number, hold: number, up: number, down: number): CalendarDefinitions {
  return {
    daysPerMonth: 30,
    schedule: [
      { kind: 'growthRelease', dayOfMonth: 10, entryId: 'growth' },
      { kind: 'inflationRelease', dayOfMonth: 20, entryId: 'inflation' },
      { kind: 'policyDecision', dayOfMonth: policyDay, entryId: 'policyRate' },
    ],
    growthEntryId: 'growth',
    inflationEntryId: 'inflation',
    policyEntryId: 'policyRate',
    inflationLowBelow: 2,
    inflationHighAt: 4,
    growthLowBelow: 1,
    growthHighAt: 3,
    rateStep: 0.25,
    policy: policyRows(hold, up, down),
    growthRelease: releaseRows(0.25, 0.5, 0.25),
    inflationRelease: releaseRows(0.25, 0.5, 0.25),
    effects: effectRows(),
  }
}

function market(policy = 4): MarketDefinitions {
  return {
    assets: ASSETS,
    environment: [{ id: 'policyRate', start: policy, driftSpeed: 0 }],
    events: [],
  }
}

function datedMarket(policyDay: number, hold: number, up: number, down: number, withFeed: boolean): MarketDefinitions {
  return {
    assets: ASSETS,
    environment: [
      { id: 'growth', start: 2, driftSpeed: 0 },
      { id: 'inflation', start: 3, driftSpeed: 0 },
      { id: 'policyRate', start: 4, driftSpeed: 0 },
    ],
    events: withFeed
      ? [
          {
            id: 'earningsBeat',
            scope: 'stock',
            targets: ['NOVA'],
            chance: 1,
            direction: { up: 1, down: 0, none: 0 },
            magnitudeMin: 2,
            magnitudeMax: 2,
            duration: 1,
            decay: 'linear',
            headline: '{target} {direction}',
            modifiers: [],
          },
        ]
      : [],
    calendar: calendar(policyDay, hold, up, down),
    sources: withFeed ? [{ id: 'marketBrief', tier: 'medium', hitRate: 1, visibility: ['base'] }] : undefined,
  }
}

function balances(game: GameState): PlayerAccounts {
  return { ...game.accounts }
}

function accountCents(accounts: PlayerAccounts, name: 'cash' | 'trading' | 'savings'): number {
  if (name === 'cash') return accounts.cashCents
  if (name === 'trading') return accounts.tradingCents
  return accounts.savingsCents
}

function policyPercent(game: GameState): number {
  const entry = game.market.environment.find((item) => item.id === 'policyRate')
  if (entry === undefined) throw new Error('[DEBUG accounts] missing policyRate')
  return entry.value
}

/** Independent copy of the provisional formula. Production must match this expression. */
function formulaAccrual(savingsCents: number, policy: number): number {
  const annualRate = Math.max(0, policy - SAVINGS_SPREAD_PERCENT) / 100
  const raw = (savingsCents * annualRate) / SAVINGS_DAYS_PER_YEAR
  if (!Number.isFinite(raw)) throw new Error(`[DEBUG accounts] accrual was not finite: ${raw}`)
  const rounded = Math.round(Math.abs(raw))
  return raw < 0 ? -rounded : rounded
}

function accrualEvent(game: GameState): SavingsAccrualEvent {
  const event = game.log.find((item) => item.kind === 'savingsAccrual')
  if (event?.kind !== 'savingsAccrual') throw new Error('[DEBUG accounts] missing savingsAccrual')
  return event
}

function paidEvent(game: GameState): SavingsInterestPaidEvent | undefined {
  const event = game.log.find((item) => item.kind === 'savingsInterestPaid')
  if (event === undefined) return undefined
  if (event.kind !== 'savingsInterestPaid') throw new Error('[DEBUG accounts] payment had the wrong kind')
  return event
}

function trackedLines(log: readonly LogEvent[]): string[] {
  const lines: string[] = []
  for (const event of log) {
    if ((TRACKED as readonly string[]).includes(event.kind)) lines.push(formatEvent(event))
  }
  return lines
}

describe('accounts and transfers', () => {
  it('starts with 3E cash, 3E trading, and empty savings', () => {
    expect(CENTS_PER_E).toBe(100_000)
    expect(STARTING_CASH_CENTS).toBe(300_000)
    expect(STARTING_TRADING_CENTS).toBe(300_000)
    expect(STARTING_SAVINGS_CENTS).toBe(0)
    expect(SAVINGS_SPREAD_PERCENT).toBe(1.5)
    expect(SAVINGS_DAYS_PER_YEAR).toBe(365)
    expect(SAVINGS_PAY_INTERVAL_DAYS).toBe(30)

    const defs = market()
    const game = createGame(defs, 'demo')
    debugAccounts(
      `start cash=${game.accounts.cashCents} trading=${game.accounts.tradingCents} savings=${game.accounts.savingsCents} accrued=${game.accounts.accruedSavingsCents}`,
    )
    expect(game.accounts).toEqual({
      cashCents: 300_000,
      tradingCents: 300_000,
      savingsCents: 0,
      accruedSavingsCents: 0,
    })
    expect(game.market.day).toBe(0)
    expect(game.log).toEqual([])
    expect(game.pending).toEqual([])
  })

  it('moves exact cent amounts and cannot go negative', () => {
    const defs = market()
    const funded: Array<['cash' | 'trading', 'cash' | 'trading' | 'savings', number]> = [
      ['cash', 'trading', 12_345],
      ['trading', 'cash', 12_345],
      ['cash', 'savings', 12_345],
      ['trading', 'savings', 12_345],
    ]
    for (const [from, to, amount] of funded) {
      const game = createGame(defs, 'move')
      const hash = stateHash(game.market)
      const before = balances(game)
      applyCommand(game, defs, { type: 'transfer', from, to, amountCents: amount })
      expect(stateHash(game.market)).toBe(hash)
      expect(game.accounts.accruedSavingsCents).toBe(0)
      for (const name of ['cash', 'trading', 'savings'] as const) {
        const delta = name === from ? -amount : name === to ? amount : 0
        expect(accountCents(game.accounts, name)).toBe(accountCents(before, name) + delta)
      }
      const event = game.log[0]
      if (event?.kind !== 'transfer') throw new Error('[DEBUG accounts] missing transfer')
      expect(event.amountCents).toBe(amount)
      expect(event.cashCents).toBe(game.accounts.cashCents)
      expect(event.tradingCents).toBe(game.accounts.tradingCents)
      expect(event.savingsCents).toBe(game.accounts.savingsCents)
      debugAccounts(`transfer ${from}->${to} amount=${amount} ${formatEvent(event)}`)
    }

    const chain = createGame(defs, 'move')
    const hash = stateHash(chain.market)
    applyCommand(chain, defs, { type: 'transfer', from: 'cash', to: 'savings', amountCents: 1000 })
    applyCommand(chain, defs, { type: 'transfer', from: 'savings', to: 'trading', amountCents: 250 })
    applyCommand(chain, defs, { type: 'transfer', from: 'savings', to: 'cash', amountCents: 750 })
    expect(chain.accounts).toEqual({
      cashCents: 299_750,
      tradingCents: 300_250,
      savingsCents: 0,
      accruedSavingsCents: 0,
    })
    expect(stateHash(chain.market)).toBe(hash)
    expect(chain.log.map((event) => event.kind)).toEqual(['transfer', 'transfer', 'transfer'])

    const emptied = createGame(defs, 'move')
    applyCommand(emptied, defs, { type: 'transfer', from: 'cash', to: 'trading', amountCents: 1 })
    expect(formatEvent(emptied.log[0]!)).toBe(
      'day=0 kind=transfer from=cash to=trading amount=1 cash=299999 trading=300001 savings=0',
    )
    applyCommand(emptied, defs, {
      type: 'transfer',
      from: 'cash',
      to: 'trading',
      amountCents: STARTING_CASH_CENTS - 1,
    })
    expect(emptied.accounts.cashCents).toBe(0)
    expect(emptied.accounts.tradingCents).toBe(600_000)
    const blocked = stateHash(emptied.market)
    const stuck = balances(emptied)
    applyCommand(emptied, defs, { type: 'transfer', from: 'cash', to: 'trading', amountCents: 1 })
    expect(emptied.accounts).toEqual(stuck)
    expect(stateHash(emptied.market)).toBe(blocked)
    expect(emptied.log.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'insufficientFunds' })

    applyCommand(emptied, defs, { type: 'transfer', from: 'trading', to: 'savings', amountCents: 1.0 })
    expect(emptied.accounts.savingsCents).toBe(1)
    expect(emptied.accounts.tradingCents).toBe(599_999)
  })

  it('rejects bad commands with a reason and leaves balances and the market hash unchanged', () => {
    const defs = market()
    const cases: { cmd: unknown; reason: string; command: string; account?: string }[] = [
      {
        cmd: { type: 'transfer', from: 'cash', to: 'savings', amountCents: -5 },
        reason: 'amountNegative',
        command: 'transfer',
      },
      {
        cmd: { type: 'transfer', from: 'cash', to: 'savings', amountCents: 0 },
        reason: 'amountZero',
        command: 'transfer',
      },
      {
        cmd: { type: 'transfer', from: 'cash', to: 'savings', amountCents: 1.5 },
        reason: 'amountNotInteger',
        command: 'transfer',
      },
      {
        cmd: { type: 'transfer', from: 'cash', to: 'savings', amountCents: '10' },
        reason: 'amountNotInteger',
        command: 'transfer',
      },
      {
        cmd: { type: 'transfer', from: 'cash', to: 'savings', amountCents: 2 ** 53 },
        reason: 'amountNotSafeInteger',
        command: 'transfer',
      },
      {
        cmd: { type: 'transfer', from: 'cash', to: 'savings', amountCents: Number.NaN },
        reason: 'amountNaN',
        command: 'transfer',
      },
      {
        cmd: { type: 'transfer', from: 'cash', to: 'savings', amountCents: Number.POSITIVE_INFINITY },
        reason: 'amountNotFinite',
        command: 'transfer',
      },
      {
        cmd: { type: 'transfer', from: 'cash', to: 'savings', amountCents: Number.NEGATIVE_INFINITY },
        reason: 'amountNotFinite',
        command: 'transfer',
      },
      {
        cmd: { type: 'transfer', from: 'cash', to: 'savings', amountCents: STARTING_CASH_CENTS + 1 },
        reason: 'insufficientFunds',
        command: 'transfer',
      },
      {
        cmd: { type: 'transfer', from: 'savings', to: 'cash', amountCents: 1 },
        reason: 'insufficientFunds',
        command: 'transfer',
      },
      {
        cmd: { type: 'transfer', from: 'vault', to: 'cash', amountCents: 1 },
        reason: 'unknownAccount',
        command: 'transfer',
        account: 'vault',
      },
      {
        cmd: { type: 'transfer', from: 'cash', to: 'vault', amountCents: 1 },
        reason: 'unknownAccount',
        command: 'transfer',
        account: 'vault',
      },
      {
        cmd: { type: 'transfer', from: 'cash', to: 'cash', amountCents: 1 },
        reason: 'sameAccount',
        command: 'transfer',
      },
      { cmd: { type: 'eat' }, reason: 'notTransfer', command: 'eat' },
      { cmd: null, reason: 'notTransfer', command: 'invalid' },
      { cmd: 'transfer', reason: 'notTransfer', command: 'invalid' },
    ]

    for (const entry of cases) {
      const game = createGame(defs, 'reject')
      const hash = stateHash(game.market)
      const before = balances(game)
      applyCommand(game, defs, entry.cmd)
      expect(game.accounts).toEqual(before)
      expect(stateHash(game.market)).toBe(hash)
      const logged = game.log[0]
      if (logged?.kind !== 'commandRejected') throw new Error(`[DEBUG accounts] missing rejection for ${entry.reason}`)
      expect(logged.reason).toBe(entry.reason)
      expect(logged.command).toBe(entry.command)
      expect(logged.account).toBe(entry.account)
      debugAccounts(formatEvent(logged))
    }

    const game = createGame(defs, 'reject')
    applyCommand(game, defs, { type: 'eat' })
    expect(formatEvent(game.log[0]!)).toBe('day=0 kind=commandRejected command="eat" reason=notTransfer')
  })

  it('rounds half away from zero and pays nothing at or below the spread', () => {
    const half = createGame(market(), 'half')
    applyCommand(half, defsOf(half), { type: 'transfer', from: 'cash', to: 'savings', amountCents: 7300 })
    endDay(half, defsOf(half))
    expect(accrualEvent(half).accrualCents).toBe(1)
    expect(formulaAccrual(7300, 4)).toBe(1)
    debugAccounts(`half-cent 7300 -> ${accrualEvent(half).accrualCents}`)

    const oneAndHalf = createGame(market(), 'half')
    applyCommand(oneAndHalf, defsOf(oneAndHalf), {
      type: 'transfer',
      from: 'cash',
      to: 'savings',
      amountCents: 21_900,
    })
    endDay(oneAndHalf, defsOf(oneAndHalf))
    expect(accrualEvent(oneAndHalf).accrualCents).toBe(2)
    expect(formulaAccrual(21_900, 4)).toBe(2)
    debugAccounts(`half-cent 21900 -> ${accrualEvent(oneAndHalf).accrualCents}`)

    for (const policy of [0, 1.5]) {
      const defs = market(policy)
      const game = createGame(defs, 'floor')
      applyCommand(game, defs, { type: 'transfer', from: 'cash', to: 'savings', amountCents: 100_000 })
      endDay(game, defs)
      const accrual = accrualEvent(game)
      expect(accrual.annualRate).toBe(0)
      expect(accrual.accrualCents).toBe(0)
      expect(formulaAccrual(100_000, policy)).toBe(0)
      debugAccounts(`floor policy=${policy} accrual=${accrual.accrualCents}`)
    }
  })

  it('pays the sum of daily accruals on day 30, using that day\'s policy rate', () => {
    const defs = datedMarket(30, 0, 1, 0, false)
    const funded = createGame(defs, 'hike')
    const twin = createGame(defs, 'hike')
    const moved = 100_000
    applyCommand(funded, defs, { type: 'transfer', from: 'cash', to: 'savings', amountCents: moved })
    expect(funded.accounts.savingsCents).toBe(moved)
    expect(stateHash(funded.market)).toBe(stateHash(twin.market))

    const logged: number[] = []
    const formula: number[] = []
    for (let day = 1; day <= 30; day += 1) {
      endDay(funded, defs)
      endDay(twin, defs)
      expect(stateHash(funded.market)).toBe(stateHash(twin.market))
      const policy = policyPercent(funded)
      expect(policy).toBe(day < 30 ? 4 : 4.25)
      const accrual = accrualEvent(funded)
      const expected = formulaAccrual(moved, policy)
      expect(accrual.policyRate).toBe(policy)
      expect(accrual.savingsCents).toBe(moved)
      expect(accrual.accrualCents).toBe(expected)
      expect(accrual.accruedCents).toBe(logged.reduce((sum, cents) => sum + cents, 0) + expected)
      logged.push(accrual.accrualCents)
      formula.push(expected)
      if (day < 30) {
        expect(paidEvent(funded)).toBeUndefined()
        expect(funded.accounts.savingsCents).toBe(moved)
        expect(funded.accounts.accruedSavingsCents).toBe(logged.reduce((sum, cents) => sum + cents, 0))
      }
    }

    const paid = paidEvent(funded)
    if (paid === undefined) throw new Error('[DEBUG accounts] missing day-30 payment')
    const formulaSum = formula.reduce((sum, cents) => sum + cents, 0)
    const loggedSum = logged.reduce((sum, cents) => sum + cents, 0)
    expect(paid.amountCents).toBe(loggedSum)
    expect(paid.amountCents).toBe(formulaSum)
    expect(paid.amountCents).toBe(29 * 7 + 8)
    expect(paid.savingsCents).toBe(moved + paid.amountCents)
    expect(paid.accruedCents).toBe(0)
    expect(funded.accounts.savingsCents).toBe(moved + paid.amountCents)
    expect(funded.accounts.accruedSavingsCents).toBe(0)
    expect(funded.accounts.cashCents).toBe(STARTING_CASH_CENTS - moved)
    expect(funded.accounts.tradingCents).toBe(STARTING_TRADING_CENTS)
    debugAccounts(
      `funded payment=${paid.amountCents} savings=${funded.accounts.savingsCents} day30accrual=${logged[29]} formula=${formulaSum}`,
    )
    debugAccounts(formatEvent(paid))

    endDay(funded, defs)
    const next = accrualEvent(funded)
    expect(paidEvent(funded)).toBeUndefined()
    expect(next.accrualCents).toBe(formulaAccrual(funded.accounts.savingsCents, policyPercent(funded)))
    expect(funded.accounts.accruedSavingsCents).toBe(next.accrualCents)
    expect(funded.accounts.savingsCents).toBe(moved + paid.amountCents)
  })

  it('logs a zero payment on day 30 when savings is empty, and again on day 60', () => {
    const defs = market()
    const game = createGame(defs, 'zero')
    const paidDays: number[] = []
    let day30Accrual = ''
    let day30Paid = ''
    for (let day = 1; day <= 60; day += 1) {
      endDay(game, defs)
      const accrual = accrualEvent(game)
      expect(accrual.accrualCents).toBe(0)
      expect(formulaAccrual(0, policyPercent(game))).toBe(0)
      const paid = paidEvent(game)
      if (paid !== undefined) {
        expect(paid.amountCents).toBe(0)
        expect(paid.savingsCents).toBe(0)
        paidDays.push(day)
        if (day === 30) {
          day30Accrual = formatEvent(accrual)
          day30Paid = formatEvent(paid)
        }
      }
      expect(game.accounts.savingsCents).toBe(0)
      expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)
      expect(game.accounts.tradingCents).toBe(STARTING_TRADING_CENTS)
    }
    expect(paidDays).toEqual([30, 60])
    expect(day30Accrual).toBe(
      'day=30 kind=savingsAccrual savings=0 policyRate=4 annualRate=0.025 accrual=0 accrued=0',
    )
    expect(day30Paid).toBe('day=30 kind=savingsInterestPaid amount=0 savings=0 accrued=0')
    debugAccounts(`zero-savings pay days=${paidDays.join(',')} ${day30Paid}`)
  })

  it('keeps seed demo market, event, and feed lines identical when money moves', () => {
    const defs = datedMarket(25, 1, 0, 0, true)
    const plain = createGame(defs, 'demo')
    const moved = createGame(defs, 'demo')
    const marketOnly = createMarket(defs, 'demo')
    applyCommand(moved, defs, { type: 'transfer', from: 'trading', to: 'savings', amountCents: 50_000 })
    expect(stateHash(plain.market)).toBe(stateHash(marketOnly))
    expect(stateHash(moved.market)).toBe(stateHash(marketOnly))

    const seen = new Set<string>()
    const take = (log: readonly LogEvent[]): string[] => {
      const lines = trackedLines(log)
      for (const line of lines) {
        const kind = TRACKED.find((name) => line.includes(`kind=${name}`))
        if (kind !== undefined) seen.add(kind)
      }
      return lines
    }
    expect(take(plain.market.log)).toEqual(take(marketOnly.log))
    expect(take(moved.market.log)).toEqual(take(marketOnly.log))

    for (let day = 1; day <= 31; day += 1) {
      if (day === 15) {
        applyCommand(moved, defs, { type: 'transfer', from: 'cash', to: 'trading', amountCents: 1000 })
      }
      if (day === 31) {
        applyCommand(moved, defs, { type: 'transfer', from: 'savings', to: 'cash', amountCents: 1 })
      }
      endDay(plain, defs)
      endDay(moved, defs)
      stepMarketDay(marketOnly, defs)
      expect(stateHash(plain.market)).toBe(stateHash(marketOnly))
      expect(stateHash(moved.market)).toBe(stateHash(marketOnly))
      expect(take(plain.market.log)).toEqual(take(marketOnly.log))
      expect(take(moved.market.log)).toEqual(take(marketOnly.log))
      expect(plain.market.log.length).toBe(marketOnly.log.length)
      expect(moved.market.log.length).toBe(marketOnly.log.length)
    }

    expect([...seen].sort()).toEqual([...TRACKED].sort())
    const daily = formulaAccrual(50_000, 4)
    expect(moved.accounts.savingsCents).toBe(50_000 + daily * 30 - 1)
    debugAccounts(
      `demo lines matched for ${[...TRACKED].join(',')} across 31 days with transfers; savings=${moved.accounts.savingsCents}`,
    )
  })

  it('does not advance the market when the policy rate entry is missing', () => {
    const defs: MarketDefinitions = { assets: ASSETS, environment: [], events: [] }
    const game = createGame(defs, 'none')
    const hash = stateHash(game.market)
    expect(() => endDay(game, defs)).toThrow('savings interest needs environment entry policyRate')
    expect(game.market.day).toBe(0)
    expect(stateHash(game.market)).toBe(hash)
    expect(game.accounts.savingsCents).toBe(0)
  })
})

function defsOf(game: GameState): MarketDefinitions {
  return market(policyPercent(game))
}
