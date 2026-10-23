import { describe, expect, it } from 'vitest'

import {
  MARKET_CLOSE_MINUTE,
  MARKET_OPEN_MINUTE,
  PLAYER_IS_JOBLESS,
  SLEEP_END_MINUTE,
  SLEEP_HOURS,
  WORK_FULL_TIME_END_MINUTE,
  WORK_PART_TIME_END_MINUTE,
  WORK_START_MINUTE,
} from './constants.ts'
import { DAY_START_SECTION, dayBlocks, formatMinute, interpretSkip, sectionClock } from './day.ts'
import { applyCommand, createGame, endDay } from './game.ts'
import { stateHash } from './hash.ts'
import { formatEvent } from './log.ts'
import type { MarketDefinitions } from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugDay(message: string): void {
  io.writeSync(1, `[DEBUG day] ${message}\n`)
}

const defs: MarketDefinitions = {
  assets: [
    {
      id: 'NOVA',
      kind: 'stock',
      sector: 'A',
      startPriceCents: 4800,
      dailyVolatility: 0.022,
      spreadPpm: 1000,
      borrowFeePpm: 100,
    },
    {
      id: 'M4X',
      kind: 'index',
      sector: null,
      startPriceCents: 100000,
      dailyVolatility: 0,
      spreadPpm: 1000,
      borrowFeePpm: 100,
    },
  ],
  environment: [{ id: 'policyRate', start: 4, driftSpeed: 0 }],
  events: [],
}

describe('day sections, clock, and skip', () => {
  it('starts at the end of sleep and shows sleep, work, and market', () => {
    expect(PLAYER_IS_JOBLESS).toBe(true)
    expect(SLEEP_HOURS).toBe(8)
    expect(SLEEP_END_MINUTE).toBe(7 * 60)
    expect(WORK_START_MINUTE).toBe(8 * 60)
    expect(WORK_PART_TIME_END_MINUTE).toBe(12 * 60)
    expect(WORK_FULL_TIME_END_MINUTE).toBe(16 * 60)
    expect(MARKET_OPEN_MINUTE).toBe(17 * 60)
    expect(MARKET_CLOSE_MINUTE).toBe(21 * 60)
    expect(formatMinute(SLEEP_END_MINUTE)).toBe('07:00')
    expect(formatMinute(MARKET_OPEN_MINUTE)).toBe('17:00')
    expect(sectionClock('sleep')).toBe('07:00')
    expect(sectionClock('market')).toBe('17:00')

    const blocks = dayBlocks(SLEEP_HOURS, true)
    expect(blocks.map((block) => block.section)).toEqual(['sleep', 'work', 'market'])
    expect(blocks.map((block) => block.title)).toEqual(['Sleep', 'Work', 'Market'])
    expect(blocks[0]?.clock).toBe('23:00-07:00 (8h)')
    expect(blocks[1]?.clock).toBe('08:00-12:00 part-time, 08:00-16:00 full-time')
    expect(blocks[1]?.empty).toBe(true)
    expect(blocks[2]?.clock).toBe('17:00-21:00')
    expect(dayBlocks(6, false)[0]?.clock).toBe('01:00-07:00 (6h)')
    expect(dayBlocks(6, false)[1]?.empty).toBe(false)

    const game = createGame(defs, 'demo')
    expect(game.section).toBe(DAY_START_SECTION)
    expect(game.section).toBe('sleep')
    expect(game.sleepHours).toBe(SLEEP_HOURS)
    expect(game.market.day).toBe(0)
    debugDay(
      `start section=${game.section} sleepHours=${game.sleepHours} clock=${blocks.map((block) => `${block.section} ${block.clock}`).join(' | ')}`,
    )
  })

  it('rejects an order before market open, then skip opens the market', () => {
    const game = createGame(defs, 'closed')
    const accounts = JSON.stringify(game.accounts)
    const positions = JSON.stringify(game.positions)
    expect(() => applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })).not.toThrow()
    const closed = game.log.at(-1)
    if (closed?.kind !== 'commandRejected') throw new Error('[DEBUG day] missing marketClosed')
    expect(closed.reason).toBe('marketClosed')
    expect(closed.command).toBe('order')
    expect(formatEvent(closed)).toBe('day=0 kind=commandRejected command="order" reason=marketClosed')
    expect(JSON.stringify(game.accounts)).toBe(accounts)
    expect(JSON.stringify(game.positions)).toBe(positions)
    expect(game.section).toBe('sleep')
    debugDay(formatEvent(closed))

    expect(() => applyCommand(game, defs, { type: 'order', quantity: 'nope' })).not.toThrow()
    expect(game.log.at(-1)).toMatchObject({ kind: 'commandRejected', command: 'order', reason: 'marketClosed' })

    applyCommand(game, defs, { type: 'transfer', from: 'cash', to: 'savings', amountCents: 100 })
    const transfer = game.log.find((event) => event.kind === 'transfer')
    if (transfer?.kind !== 'transfer') throw new Error('[DEBUG day] missing transfer during sleep')
    expect(transfer.amountCents).toBe(100)
    expect(game.section).toBe('sleep')
    debugDay(formatEvent(transfer))

    expect(() => applyCommand(game, defs, { type: 'skip' })).not.toThrow()
    expect(game.section).toBe('market')
    const skip = game.log.find((event) => event.kind === 'skip')
    const change = game.log.find((event) => event.kind === 'sectionChange')
    if (skip?.kind !== 'skip' || change?.kind !== 'sectionChange') throw new Error('[DEBUG day] missing skip events')
    expect(skip).toEqual({ kind: 'skip', day: 0, from: 'sleep', to: 'market' })
    expect(change).toEqual({ kind: 'sectionChange', day: 0, from: 'sleep', to: 'market', clock: '17:00' })
    expect(formatEvent(skip)).toBe('day=0 kind=skip from=sleep to=market')
    expect(formatEvent(change)).toBe('day=0 kind=sectionChange from=sleep to=market clock=17:00')
    debugDay(formatEvent(skip))
    debugDay(formatEvent(change))
    debugDay(`after skip section=${game.section} clock=${change.clock}`)

    applyCommand(game, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    const fill = game.log.find((event) => event.kind === 'orderFill')
    if (fill?.kind !== 'orderFill') throw new Error('[DEBUG day] order after skip did not fill')
    expect(fill.asset).toBe('NOVA')
    expect(fill.quantity).toBe(1)
    expect(game.positions.NOVA?.signedShares).toBe(1)
    debugDay(formatEvent(fill))

    const pending = game.pending.length
    expect(() => applyCommand(game, defs, { type: 'skip' })).not.toThrow()
    expect(game.section).toBe('market')
    expect(game.log.at(-1)).toMatchObject({ kind: 'commandRejected', command: 'skip', reason: 'cannotSkip' })
    expect(formatEvent(game.log.at(-1)!)).toBe('day=0 kind=commandRejected command="skip" reason=cannotSkip')
    expect(game.positions.NOVA?.signedShares).toBe(1)
    debugDay(formatEvent(game.log.at(-1)!))
    expect(game.pending.length).toBe(pending + 1)
  })

  it('allows skip from the end of work, and rejects it from sleep when employed', () => {
    const employed = interpretSkip('sleep', 0, false)
    expect(employed.accepted).toBe(false)
    if (employed.accepted) throw new Error('[DEBUG day] employed sleep skip should reject')
    expect(employed.event.reason).toBe('cannotSkip')
    debugDay(formatEvent(employed.event))

    const fromWork = interpretSkip('work', 3, true)
    expect(fromWork.accepted).toBe(true)
    if (!fromWork.accepted) throw new Error('[DEBUG day] work skip should open the market')
    expect(fromWork.section).toBe('market')
    expect(fromWork.events[0]).toMatchObject({ kind: 'skip', from: 'work', to: 'market', day: 3 })
    expect(fromWork.events[1]).toMatchObject({ kind: 'sectionChange', clock: '17:00', day: 3 })
    debugDay(formatEvent(fromWork.events[0]))
    debugDay(formatEvent(fromWork.events[1]))

    const game = createGame(defs, 'work')
    game.section = 'work'
    applyCommand(game, defs, { type: 'skip' })
    expect(game.section).toBe('market')
    expect(game.log[0]).toMatchObject({ kind: 'skip', from: 'work', to: 'market' })
    debugDay(`jobless work skip section=${game.section}`)
  })

  it('ends the day from any section and does not change the market', () => {
    const quiet = createGame(defs, 'demo')
    const skipped = createGame(defs, 'demo')
    expect(() => endDay(quiet, defs)).not.toThrow()
    expect(quiet.section).toBe('sleep')
    expect(quiet.market.day).toBe(1)

    applyCommand(skipped, defs, { type: 'skip' })
    expect(skipped.section).toBe('market')
    expect(() => applyCommand(skipped, defs, { type: 'dance' })).not.toThrow()
    expect(skipped.log.at(-1)).toMatchObject({ kind: 'commandRejected', command: 'dance', reason: 'notTransfer' })
    expect(() => applyCommand(skipped, defs, null)).not.toThrow()
    expect(skipped.log.at(-1)).toMatchObject({ kind: 'commandRejected', command: 'invalid', reason: 'notTransfer' })
    debugDay(formatEvent(skipped.log.at(-2)!))
    debugDay(formatEvent(skipped.log.at(-1)!))

    endDay(skipped, defs)
    expect(skipped.section).toBe('sleep')
    expect(skipped.market.day).toBe(1)
    expect(stateHash(skipped.market)).toBe(stateHash(quiet.market))
    expect(skipped.sleepHours).toBe(quiet.sleepHours)

    applyCommand(skipped, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    expect(skipped.log.at(-1)).toMatchObject({ reason: 'marketClosed' })
    applyCommand(skipped, defs, { type: 'skip' })
    expect(skipped.section).toBe('market')
    const ordered = stateHash(skipped.market)
    applyCommand(skipped, defs, { type: 'order', asset: 'NOVA', side: 'buy', quantity: 1 })
    expect(stateHash(skipped.market)).toBe(ordered)
    debugDay(`next day section=${skipped.section} marketUnchanged=${stateHash(skipped.market) === ordered}`)
  })
})
