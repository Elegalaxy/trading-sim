import { describe, expect, it } from 'vitest'

import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { formatEvent } from './log.ts'
import {
  MARGIN_MIN_RATIO_DENOMINATOR,
  MARGIN_MIN_RATIO_NUMERATOR,
  RATE_PPM_SCALE,
  STARTING_CASH_CENTS,
  STARTING_TRADING_CENTS,
  TRADE_FEE_DENOMINATOR,
} from './constants.ts'
import { settleBorrowFees } from './trading.ts'
import type {
  BorrowFeeEvent,
  CalendarDefinitions,
  CalendarEffectCell,
  CalendarItemKind,
  CalendarOutcome,
  GameState,
  LogEvent,
  MarketDefinitions,
  OrderFillEvent,
  OrderSide,
  PolicyChanceCell,
  RealizedEvent,
  ReleaseChanceCell,
} from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugTrading(message: string): void {
  io.writeSync(1, `[DEBUG trading] ${message}\n`)
}

const ASSETS: MarketDefinitions['assets'] = [
  { id: 'NOVA', kind: 'stock', sector: 'A', startPriceCents: 4800, dailyVolatility: 0.022, spreadPpm: 4000, borrowFeePpm: 300 },
  { id: 'BLSW', kind: 'stock', sector: 'A', startPriceCents: 11200, dailyVolatility: 0.018, spreadPpm: 3000, borrowFeePpm: 200 },
  { id: 'HRBU', kind: 'stock', sector: 'B', startPriceCents: 3100, dailyVolatility: 0.01, spreadPpm: 1000, borrowFeePpm: 100 },
  { id: 'KSR', kind: 'stock', sector: 'B', startPriceCents: 6400, dailyVolatility: 0.014, spreadPpm: 2000, borrowFeePpm: 150 },
  { id: 'M4X', kind: 'index', sector: null, startPriceCents: 100000, dailyVolatility: 0, spreadPpm: 1500, borrowFeePpm: 100 },
]

const BANDS = ['low', 'mid', 'high'] as const
const TRACKED = ['noiseRoll', 'eventRoll', 'calendarItem', 'headline', 'rumourGenerated'] as const

function roundDivHalfAway(numerator: number, denominator: number): number {
  const negative = numerator < 0
  const num = negative ? -numerator : numerator
  const quotient = Math.floor(num / denominator)
  const remainder = num % denominator
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient
  return negative ? -rounded : rounded
}

/** Independent copy of the half-spread rule. Doubling is applied before rounding. */
function halfSpreadCents(price: number, spreadPpm: number, widened: boolean): number {
  const ppm = widened ? spreadPpm * 2 : spreadPpm
  return roundDivHalfAway(price * ppm, RATE_PPM_SCALE * 2)
}

/** Independent copy of the 0.1% fee. */
function feeCents(notional: number): number {
  return roundDivHalfAway(notional * 1, TRADE_FEE_DENOMINATOR)
}

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

function calendar(): CalendarDefinitions {
  return {
    daysPerMonth: 30,
    schedule: [
      { kind: 'growthRelease', dayOfMonth: 10, entryId: 'growth' },
      { kind: 'inflationRelease', dayOfMonth: 20, entryId: 'inflation' },
      { kind: 'policyDecision', dayOfMonth: 25, entryId: 'policyRate' },
    ],
    growthEntryId: 'growth',
    inflationEntryId: 'inflation',
    policyEntryId: 'policyRate',
    inflationLowBelow: 2,
    inflationHighAt: 4,
    growthLowBelow: 1,
    growthHighAt: 3,
    rateStep: 0.25,
    policy: policyRows(1, 0, 0),
    growthRelease: releaseRows(0.25, 0.5, 0.25),
    inflationRelease: releaseRows(0.25, 0.5, 0.25),
    effects: effectRows(),
  }
}

function market(): MarketDefinitions {
  return {
    assets: ASSETS,
    environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
    events: [],
  }
}

function demoMarket(): MarketDefinitions {
  return {
    assets: ASSETS,
    environment: [
      { id: 'growth', start: 2, driftSpeed: 0 },
      { id: 'inflation', start: 3, driftSpeed: 0 },
      { id: 'policyRate', start: 4, driftSpeed: 0 },
    ],
    events: [
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
    ],
    calendar: calendar(),
    sources: [{ id: 'marketBrief', tier: 'medium', hitRate: 1, visibility: ['base'] }],
  }
}

function quote(game: GameState, id: string): number {
  const price = game.market.assets[id]?.priceCents
  if (!Number.isSafeInteger(price)) throw new Error(`[DEBUG trading] missing price for ${id}`)
  return price
}

function spreadOf(id: string): number {
  const ppm = ASSETS.find((asset) => asset.id === id)?.spreadPpm
  if (ppm === undefined) throw new Error(`[DEBUG trading] missing spread for ${id}`)
  return ppm
}

function order(asset: string, side: OrderSide, quantity: number): { type: 'order'; asset: string; side: OrderSide; quantity: number } {
  return { type: 'order', asset, side, quantity }
}

/** Orders are rejected until skip opens the market. Existing cases trade after that. */
function place(
  game: GameState,
  defs: MarketDefinitions,
  cmd: { type: 'order'; asset: string; side: OrderSide; quantity: number },
): void {
  if (game.section !== 'market') applyCommand(game, defs, { type: 'skip' })
  const section: string = game.section
  if (section !== 'market') throw new Error(`[DEBUG trading] skip left section ${section}`)
  applyCommand(game, defs, cmd)
}

function fills(game: GameState): OrderFillEvent[] {
  return game.log.filter((event): event is OrderFillEvent => event.kind === 'orderFill')
}

function realizedEvents(game: GameState): RealizedEvent[] {
  return game.log.filter((event): event is RealizedEvent => event.kind === 'realized')
}

function printPlayer(game: GameState): void {
  for (const event of game.log) {
    if (event.kind === 'orderFill' || event.kind === 'borrowFee' || event.kind === 'realized' || event.kind === 'commandRejected') {
      debugTrading(formatEvent(event))
    }
  }
}

function marketPicture(game: GameState): string {
  const prices = Object.entries(game.market.assets)
    .map(([id, asset]) => `${id}:${asset.priceCents}:${asset.fairValue}`)
    .join(',')
  const log = game.market.log.map((event) => formatEvent(event)).join('\n')
  return `${stateHash(game.market)}\n${prices}\n${log}`
}

function playerPicture(game: GameState): string {
  return JSON.stringify({
    accounts: game.accounts,
    positions: game.positions,
    realized: game.realized,
  })
}

describe('orders, fees, and borrow', () => {
  it('loses exactly two fees plus the full spread on a same-day round trip', () => {
    const defs = market()
    const game = createGame(defs, 'round')
    const before = marketPicture(game)
    const price = quote(game, 'NOVA')
    const half = halfSpreadCents(price, spreadOf('NOVA'), false)
    const quantity = 10
    place(game, defs, order('NOVA', 'buy', quantity))
    place(game, defs, order('NOVA', 'sell', quantity))
    const [buy, sell] = fills(game)
    if (buy === undefined || sell === undefined) throw new Error('[DEBUG trading] missing round-trip fills')
    expect(buy.price).toBe(price)
    expect(sell.price).toBe(price)
    expect(buy.halfSpread).toBe(half)
    expect(sell.halfSpread).toBe(half)
    expect(buy.fillPrice).toBe(price + half)
    expect(sell.fillPrice).toBe(price - half)
    expect(buy.fee).toBe(feeCents(quantity * buy.fillPrice))
    expect(sell.fee).toBe(feeCents(quantity * sell.fillPrice))
    const loss = 2 * half * quantity + buy.fee + sell.fee
    expect(game.accounts.tradingCents).toBe(STARTING_TRADING_CENTS - loss)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    expect(game.accounts.savingsCents).toBe(0)
    expect(game.positions).toEqual({})
    const closed = realizedEvents(game)
    expect(closed).toHaveLength(1)
    expect(closed[0]?.amount).toBe((sell.fillPrice - buy.fillPrice) * quantity)
    expect(game.realized).toEqual([{ day: 0, cents: -loss }])
    expect(marketPicture(game)).toBe(before)
    printPlayer(game)
    debugTrading(
      `round-trip asset=NOVA quantity=${quantity} price=${price} halfSpread=${half} buyFill=${buy.fillPrice} sellFill=${sell.fillPrice} feeBuy=${buy.fee} feeSell=${sell.fee} loss=${loss}`,
    )
    expect(loss).toBe(296)
    expect(buy.fillPrice).toBe(buy.price + buy.halfSpread)
    expect(sell.fillPrice).toBe(sell.price - sell.halfSpread)
  })

  it('rounds a half cent away from zero for the spread and the fee', () => {
    const defs = market()
    const spreadGame = createGame(defs, 'half-spread')
    const nova = spreadGame.market.assets.NOVA
    if (nova === undefined) throw new Error('[DEBUG trading] missing NOVA')
    nova.priceCents = 1250
    const halfRawNumerator = 1250 * spreadOf('NOVA')
    expect(halfRawNumerator / (RATE_PPM_SCALE * 2)).toBe(2.5)
    place(spreadGame, defs, order('NOVA', 'buy', 1))
    const spreadFill = fills(spreadGame)[0]
    if (spreadFill === undefined) throw new Error('[DEBUG trading] missing half-spread fill')
    expect(spreadFill.halfSpread).toBe(3)
    expect(spreadFill.fillPrice).toBe(1253)
    printPlayer(spreadGame)

    const feeGame = createGame(defs, 'half-fee')
    const priced = feeGame.market.assets.NOVA
    if (priced === undefined) throw new Error('[DEBUG trading] missing NOVA')
    priced.priceCents = 1248
    const half = halfSpreadCents(1248, spreadOf('NOVA'), false)
    expect(half).toBe(2)
    const fill = 1248 + half
    expect(fill).toBe(1250)
    expect((2 * fill) / TRADE_FEE_DENOMINATOR).toBe(2.5)
    place(feeGame, defs, order('NOVA', 'buy', 2))
    const feeFill = fills(feeGame)[0]
    if (feeFill === undefined) throw new Error('[DEBUG trading] missing half-fee fill')
    expect(feeFill.fee).toBe(3)
    expect(feeFill.fillPrice).toBe(fill)
    printPlayer(feeGame)
    debugTrading(`half-cent spread halfSpread=${spreadFill.halfSpread} fee=${feeFill.fee} from notional ${2 * fill}`)
  })

  it('gains on a short when the quoted price falls', () => {
    const defs = market()
    const game = createGame(defs, 'short')
    place(game, defs, order('NOVA', 'sell', 10))
    const opened = fills(game)[0]
    if (opened === undefined) throw new Error('[DEBUG trading] missing short open')
    expect(game.positions.NOVA?.signedShares).toBe(-10)
    const priceBefore = quote(game, 'NOVA')
    const trading = game.accounts.tradingCents
    const equityBefore = trading + -10 * priceBefore
    const nova = game.market.assets.NOVA
    if (nova === undefined) throw new Error('[DEBUG trading] missing NOVA')
    const fairBefore = nova.fairValue
    nova.priceCents = 4000
    const priceAfter = quote(game, 'NOVA')
    expect(priceAfter).toBe(4000)
    expect(priceAfter).toBeLessThan(priceBefore)
    const equityAfter = trading + -10 * priceAfter
    const markGain = equityAfter - equityBefore
    expect(markGain).toBe(10 * (priceBefore - priceAfter))
    expect(markGain).toBeGreaterThan(0)
    const beforeCover = marketPicture(game)
    place(game, defs, order('NOVA', 'buy', 10))
    const covered = fills(game)[1]
    const pnl = realizedEvents(game)[0]
    if (covered === undefined || pnl === undefined) throw new Error('[DEBUG trading] missing short cover')
    expect(covered.fillPrice).toBe(priceAfter + covered.halfSpread)
    expect(pnl.amount).toBe(opened.fillPrice * 10 - covered.fillPrice * 10)
    expect(pnl.amount).toBeGreaterThan(0)
    expect(game.positions).toEqual({})
    expect(nova.priceCents).toBe(4000)
    expect(nova.fairValue).toBe(fairBefore)
    expect(marketPicture(game)).toBe(beforeCover)
    expect(game.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    expect(game.accounts.savingsCents).toBe(0)
    printPlayer(game)
    debugTrading(
      `short gain mark=${markGain} realized=${pnl.amount} openFill=${opened.fillPrice} coverFill=${covered.fillPrice} price ${priceBefore}->${priceAfter}`,
    )
  })

  it('rejects a bad quantity, an unknown asset, and leverage past 5x without changing anything', () => {
    const defs = market()
    const probe = createGame(defs, 'power')
    const price = quote(probe, 'NOVA')
    const ppm = spreadOf('NOVA')
    const trading = probe.accounts.tradingCents
    const preview = (side: OrderSide, quantity: number) => {
      const half = halfSpreadCents(price, ppm, false)
      const fill = side === 'buy' ? price + half : price - half
      const notional = quantity * fill
      const fee = feeCents(notional)
      const nextTrading = trading + (side === 'buy' ? -(notional + fee) : notional - fee)
      const shares = side === 'buy' ? quantity : -quantity
      const equity = nextTrading + shares * price
      const gross = Math.abs(shares) * price
      return { nextTrading, equity, gross }
    }
    const judge = (side: OrderSide, quantity: number): 'ok' | 'cash' | 'power' => {
      const row = preview(side, quantity)
      if (!Number.isSafeInteger(row.nextTrading) || !Number.isSafeInteger(row.equity)) return 'power'
      if (row.gross === 0) return row.nextTrading < 0 ? 'cash' : 'ok'
      if (row.equity < 0) return 'cash'
      if (row.equity * MARGIN_MIN_RATIO_DENOMINATOR < row.gross * MARGIN_MIN_RATIO_NUMERATOR) return 'power'
      return 'ok'
    }
    let buyPower = 0
    let sellPower = 0
    let buyWasCash = 0
    let sellWasOneX = 0
    for (let quantity = 1; quantity <= 5000; quantity += 1) {
      const bought = preview('buy', quantity)
      const sold = preview('sell', quantity)
      if (buyWasCash === 0 && bought.nextTrading < 0) buyWasCash = quantity
      if (sellWasOneX === 0 && sold.equity >= 0 && sold.gross > sold.equity) sellWasOneX = quantity
      if (buyPower === 0 && judge('buy', quantity) === 'power') buyPower = quantity
      if (sellPower === 0 && judge('sell', quantity) === 'power') sellPower = quantity
    }
    expect(buyWasCash).toBeGreaterThan(1)
    expect(sellWasOneX).toBeGreaterThan(1)
    expect(buyPower).toBeGreaterThan(buyWasCash)
    expect(sellPower).toBeGreaterThan(sellWasOneX)
    expect(judge('buy', buyWasCash)).toBe('ok')
    expect(judge('sell', sellWasOneX)).toBe('ok')
    expect(judge('buy', buyPower - 1)).toBe('ok')
    expect(judge('sell', sellPower - 1)).toBe('ok')
    expect(judge('buy', buyPower)).toBe('power')
    expect(judge('sell', sellPower)).toBe('power')
    debugTrading(
      `5x boundary oldCashBuy=${buyWasCash} oldOneXShort=${sellWasOneX} buyPower=${buyPower} shortPower=${sellPower} price=${price}`,
    )

    const cases: { cmd: unknown; reason: string; command: string }[] = [
      { cmd: order('NOVA', 'buy', 0), reason: 'quantityZero', command: 'order' },
      { cmd: order('NOVA', 'buy', -3), reason: 'quantityNegative', command: 'order' },
      { cmd: order('NOVA', 'sell', 1.5), reason: 'quantityNotInteger', command: 'order' },
      { cmd: order('NOPE', 'buy', 1), reason: 'unknownAsset', command: 'order' },
      { cmd: order('NOVA', 'buy', buyPower), reason: 'insufficientBuyingPower', command: 'order' },
      { cmd: order('NOVA', 'sell', sellPower), reason: 'insufficientBuyingPower', command: 'order' },
      { cmd: { type: 'eat' }, reason: 'notTransfer', command: 'eat' },
    ]
    for (const entry of cases) {
      const game = createGame(defs, 'reject')
      const marketBefore = marketPicture(game)
      const playerBefore = playerPicture(game)
      if (entry.command === 'order') applyCommand(game, defs, { type: 'skip' })
      applyCommand(game, defs, entry.cmd)
      expect(playerPicture(game)).toBe(playerBefore)
      expect(marketPicture(game)).toBe(marketBefore)
      const rejections = game.log.filter((event) => event.kind === 'commandRejected')
      expect(rejections).toHaveLength(1)
      const logged = rejections[0]
      if (logged?.kind !== 'commandRejected') throw new Error(`[DEBUG trading] missing rejection ${entry.reason}`)
      expect(logged.reason).toBe(entry.reason)
      expect(logged.command).toBe(entry.command)
      debugTrading(formatEvent(logged))
    }

    const leveragedBuy = createGame(defs, 'allow-buy')
    place(leveragedBuy, defs, order('NOVA', 'buy', buyWasCash))
    expect(leveragedBuy.positions.NOVA?.signedShares).toBe(buyWasCash)
    expect(leveragedBuy.accounts.tradingCents).toBeLessThan(0)
    expect(leveragedBuy.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    const buyEquity = leveragedBuy.accounts.tradingCents + buyWasCash * price
    const buyGross = buyWasCash * price
    expect(buyEquity).toBeGreaterThanOrEqual(0)
    expect(buyEquity * MARGIN_MIN_RATIO_DENOMINATOR).toBeGreaterThanOrEqual(buyGross * MARGIN_MIN_RATIO_NUMERATOR)
    const oldShort = createGame(defs, 'allow-sell')
    place(oldShort, defs, order('NOVA', 'sell', sellWasOneX))
    expect(oldShort.positions.NOVA?.signedShares).toBe(-sellWasOneX)
    const shortEquity = oldShort.accounts.tradingCents + -sellWasOneX * price
    const shortGross = sellWasOneX * price
    expect(shortGross).toBeGreaterThan(shortEquity)
    expect(shortEquity).toBeGreaterThanOrEqual(0)
    expect(shortEquity * MARGIN_MIN_RATIO_DENOMINATOR).toBeGreaterThanOrEqual(shortGross * MARGIN_MIN_RATIO_NUMERATOR)
    const capBuy = createGame(defs, 'cap-buy')
    place(capBuy, defs, order('NOVA', 'buy', buyPower - 1))
    expect(capBuy.positions.NOVA?.signedShares).toBe(buyPower - 1)
    const capEquity = capBuy.accounts.tradingCents + (buyPower - 1) * price
    expect(capEquity).toBeGreaterThanOrEqual(0)
    const capSell = createGame(defs, 'cap-sell')
    place(capSell, defs, order('NOVA', 'sell', sellPower - 1))
    expect(capSell.positions.NOVA?.signedShares).toBe(-(sellPower - 1))
    const capShortEquity = capSell.accounts.tradingCents + -(sellPower - 1) * price
    expect(capShortEquity).toBeGreaterThanOrEqual(0)
    debugTrading(
      `accepted oldCashBuy=${buyWasCash} trading=${leveragedBuy.accounts.tradingCents} equity=${buyEquity} oldOneXShort=${sellWasOneX} capBuy=${buyPower - 1} capShort=${sellPower - 1}`,
    )
  })

  it('does not spend wallet cash or savings, and selling through a long opens a short', () => {
    const defs = market()
    const empty = createGame(defs, 'wallet')
    applyCommand(empty, defs, { type: 'transfer', from: 'trading', to: 'savings', amountCents: STARTING_TRADING_CENTS })
    const parked = playerPicture(empty)
    const parkedMarket = marketPicture(empty)
    place(empty, defs, order('NOVA', 'buy', 1))
    expect(playerPicture(empty)).toBe(parked)
    expect(empty.accounts.tradingCents).toBe(0)
    expect(empty.accounts.savingsCents).toBe(STARTING_TRADING_CENTS)
    expect(empty.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    expect(empty.positions).toEqual({})
    expect(empty.log.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'insufficientTradingCash' })
    expect(marketPicture(empty)).toBe(parkedMarket)
    const rejectedOrder = empty.log.at(-1)
    if (rejectedOrder === undefined) throw new Error('[DEBUG trading] missing wallet rejection')
    debugTrading(formatEvent(rejectedOrder))

    const flip = createGame(defs, 'flip')
    place(flip, defs, order('NOVA', 'buy', 5))
    place(flip, defs, order('NOVA', 'sell', 8))
    const [bought, sold] = fills(flip)
    if (bought === undefined || sold === undefined) throw new Error('[DEBUG trading] missing flip fills')
    expect(flip.positions.NOVA).toEqual({
      asset: 'NOVA',
      signedShares: -3,
      costCents: sold.fillPrice * 3,
    })
    const pnl = realizedEvents(flip)[0]
    if (pnl === undefined) throw new Error('[DEBUG trading] missing flip realized')
    expect(pnl.amount).toBe(5 * (sold.fillPrice - bought.fillPrice))
    expect(flip.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    expect(flip.accounts.savingsCents).toBe(0)
    printPlayer(flip)
    debugTrading(`flip long 5 then sell 8 leaves short ${flip.positions.NOVA?.signedShares} realized=${pnl.amount}`)
  })

  it('doubles the spread on an event day before rounding, and the index only for a calendar item', () => {
    const defs = market()
    const quiet = createGame(defs, 'wide')
    place(quiet, defs, order('NOVA', 'buy', 1))
    const quietHalf = fills(quiet)[0]?.halfSpread
    expect(quietHalf).toBe(halfSpreadCents(quote(quiet, 'NOVA'), spreadOf('NOVA'), false))

    const named = createGame(defs, 'wide')
    named.market.feed = {
      day: 1,
      items: [{ kind: 'headline', eventId: 'earningsBeat:NOVA:0', text: 'NOVA up', magnitude: 2, top: true }],
    }
    const before = marketPicture(named)
    place(named, defs, order('NOVA', 'buy', 1))
    place(named, defs, order('HRBU', 'buy', 1))
    const novaFill = fills(named).find((event) => event.asset === 'NOVA')
    const hrbuFill = fills(named).find((event) => event.asset === 'HRBU')
    if (novaFill === undefined || hrbuFill === undefined) throw new Error('[DEBUG trading] missing widened fills')
    expect(novaFill.halfSpread).toBe(halfSpreadCents(4800, 4000, true))
    expect(novaFill.halfSpread).toBe(19)
    expect(novaFill.halfSpread).not.toBe((quietHalf ?? 0) * 2)
    expect(novaFill.fillPrice).toBe(novaFill.price + novaFill.halfSpread)
    expect(hrbuFill.halfSpread).toBe(halfSpreadCents(3100, 1000, false))
    expect(marketPicture(named)).toBe(before)
    printPlayer(named)

    const stale = createGame(defs, 'wide')
    stale.market.feed = {
      day: 1,
      items: [{ kind: 'headline', eventId: 'earningsBeat:NOVA:1', text: 'NOVA tomorrow', magnitude: 2, top: true }],
    }
    place(stale, defs, order('NOVA', 'buy', 1))
    expect(fills(stale)[0]?.halfSpread).toBe(quietHalf)

    const sector = createGame(defs, 'wide')
    sector.market.feed = {
      day: 1,
      items: [{ kind: 'headline', eventId: 'regulation:A:0', text: 'sector A', magnitude: 2, top: true }],
    }
    place(sector, defs, order('NOVA', 'buy', 1))
    expect(fills(sector)[0]?.halfSpread).toBe(quietHalf)

    const indexHeadline = createGame(defs, 'wide')
    indexHeadline.market.feed = {
      day: 1,
      items: [{ kind: 'headline', eventId: 'sentiment:M4X:0', text: 'index up', magnitude: 2, top: true }],
    }
    place(indexHeadline, defs, order('M4X', 'buy', 1))
    const indexQuiet = fills(indexHeadline)[0]
    if (indexQuiet === undefined) throw new Error('[DEBUG trading] missing index fill')
    expect(indexQuiet.halfSpread).toBe(halfSpreadCents(100000, 1500, false))
    expect(indexQuiet.fillPrice).toBe(indexQuiet.price + indexQuiet.halfSpread)
    printPlayer(indexHeadline)

    const macro = createGame(defs, 'wide')
    macro.market.calendarRolls.push({
      kind: 'growthRelease',
      day: 0,
      roll: 0.25,
      outcome: 'above',
      applied: true,
    })
    const macroBefore = marketPicture(macro)
    place(macro, defs, order('NOVA', 'buy', 1))
    place(macro, defs, order('HRBU', 'buy', 1))
    place(macro, defs, order('M4X', 'buy', 1))
    const widened = fills(macro)
    expect(widened.map((event) => event.halfSpread)).toEqual([
      halfSpreadCents(4800, 4000, true),
      halfSpreadCents(3100, 1000, true),
      halfSpreadCents(100000, 1500, true),
    ])
    expect(widened[2]?.halfSpread).toBe(150)
    expect(marketPicture(macro)).toBe(macroBefore)
    printPlayer(macro)
    debugTrading(
      `event-day half spreads NOVA=${novaFill.halfSpread} HRBU=${hrbuFill.halfSpread} indexHeadline=${indexQuiet.halfSpread} calendarIndex=${widened[2]?.halfSpread}`,
    )
  })

  it('charges a short a daily borrow fee after the market step and logs an unpaid remainder', () => {
    const defs = market()
    const held = createGame(defs, 'borrow')
    place(held, defs, order('NOVA', 'buy', 1))
    endDay(held, defs)
    expect(held.log.some((event) => event.kind === 'borrowFee')).toBe(false)
    expect(held.accounts.cashCents).toBe(STARTING_CASH_CENTS)
    debugTrading('long borrow fees=0')

    const opened = createGame(defs, 'demo')
    const priceBefore = quote(opened, 'NOVA')
    place(opened, defs, order('NOVA', 'sell', 10))
    const cashBefore = opened.accounts.cashCents
    const savingsBefore = opened.accounts.savingsCents
    endDay(opened, defs)
    const priceAfter = quote(opened, 'NOVA')
    const borrow = opened.log.find((event): event is BorrowFeeEvent => event.kind === 'borrowFee')
    if (borrow === undefined) throw new Error('[DEBUG trading] missing end-of-day borrow fee')
    expect(borrow.day).toBe(1)
    expect(borrow.price).toBe(priceAfter)
    expect(borrow.shares).toBe(10)
    expect(borrow.ratePpm).toBe(300)
    expect(borrow.assessed).toBe(roundDivHalfAway(10 * priceAfter * 300, RATE_PPM_SCALE))
    expect(borrow.paid).toBe(borrow.assessed)
    expect(borrow.unpaid).toBe(0)
    expect(opened.accounts.cashCents).toBe(cashBefore)
    expect(opened.accounts.savingsCents).toBe(savingsBefore)
    expect(opened.accounts.tradingCents).toBeGreaterThanOrEqual(0)
    const day1 = opened.realized.find((row) => row.day === 1)
    expect(day1?.cents).toBe(-borrow.assessed)
    debugTrading(formatEvent(borrow))
    debugTrading(`borrow uses post-step price ${priceBefore}->${priceAfter} assessed=${borrow.assessed}`)

    const short = createGame(defs, 'unpaid')
    const asset = short.market.assets.NOVA
    if (asset === undefined) throw new Error('[DEBUG trading] missing NOVA')
    asset.priceCents = 4500
    short.positions.NOVA = { asset: 'NOVA', signedShares: -10, costCents: 47000 }
    short.accounts.tradingCents = 4
    short.accounts.cashCents = 111
    short.accounts.savingsCents = 222
    const assessed = roundDivHalfAway(10 * 4500 * 300, RATE_PPM_SCALE)
    expect(assessed).toBe(14)
    const events = settleBorrowFees(short, defs)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ assessed: 14, paid: 4, unpaid: 10, price: 4500 })
    expect(short.accounts.tradingCents).toBe(0)
    expect(short.accounts.cashCents).toBe(111)
    expect(short.accounts.savingsCents).toBe(222)
    expect(short.positions.NOVA?.signedShares).toBe(-10)
    expect(asset.priceCents).toBe(4500)
    expect(short.realized).toEqual([{ day: 0, cents: -14 }])
    if (events[0] === undefined) throw new Error('[DEBUG trading] missing unpaid borrow')
    debugTrading(formatEvent(events[0]))
    debugTrading(`unpaid borrow assessed=${assessed} paid=4 unpaid=10 trading=0 wallet untouched`)
  })

  it('keeps seed demo market logs identical with and without trades', () => {
    const defs = demoMarket()
    const quiet = createGame(defs, 'demo')
    const traded = createGame(defs, 'demo')
    place(traded, defs, order('HRBU', 'sell', 1))
    place(traded, defs, order('NOVA', 'buy', 1))
    expect(marketPicture(traded)).toBe(marketPicture(quiet))

    const seen = new Set<string>()
    let fills = traded.log.filter((event) => event.kind === 'orderFill').length
    const take = (log: readonly LogEvent[]): string[] => {
      const lines: string[] = []
      for (const event of log) {
        if ((TRACKED as readonly string[]).includes(event.kind)) {
          seen.add(event.kind)
          lines.push(formatEvent(event))
        }
      }
      return lines
    }
    expect(take(traded.market.log)).toEqual(take(quiet.market.log))

    for (let day = 1; day <= 12; day += 1) {
      endDay(quiet, defs)
      endDay(traded, defs)
      expect(marketPicture(traded)).toBe(marketPicture(quiet))
      expect(take(traded.market.log)).toEqual(take(quiet.market.log))
      if (day === 5) {
        place(traded, defs, order('HRBU', 'buy', 1))
        fills += traded.log.filter((event) => event.kind === 'orderFill').length
        expect(marketPicture(traded)).toBe(marketPicture(quiet))
      }
    }

    expect([...seen].sort()).toEqual([...TRACKED].sort())
    expect(fills).toBeGreaterThan(0)
    expect(traded.accounts.cashCents).toBe(quiet.accounts.cashCents)
    expect(traded.accounts.savingsCents).toBe(quiet.accounts.savingsCents)
    debugTrading(
      `demo market logs matched for ${[...TRACKED].join(',')} across 12 days; quietHash=${stateHash(quiet.market)}`,
    )
  })
})
