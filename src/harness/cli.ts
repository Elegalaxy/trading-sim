// Sandbox admin log for one seeded run.
// Player time goes through createGame and endDay. The market log is unchanged.
// One [sim] accounts line per day follows that day's market log and account events.
// --asset filters the market log. The closes table still lists every asset.

import { MARKET_DEFINITIONS } from '../content/index.ts'
import { createGame, endDay } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { formatEvent } from '../sim/log.ts'
import { daySummary, formatSummary } from '../sim/summary.ts'
import type { GameState, LogEvent } from '../sim/types.ts'

const USAGE =
  'usage: npm run sim -- --seed <seed> --days <1-1000> [--quiet] [--asset <id>] [--events-only] [--feed]'
const SEED_PATTERN = /^[A-Za-z0-9-]{1,32}$/
const DAYS_MIN = 1
const DAYS_MAX = 1000

type CliOptions = {
  seed: string
  days: number
  quiet: boolean
  eventsOnly: boolean
  feed: boolean
  asset: string | undefined
}

type CloseRow = {
  day: number
  prices: number[]
}

function fail(message: string, withUsage = false): never {
  const text = withUsage ? `error: ${message}\n${USAGE}\n` : `error: ${message}\n`
  process.stderr.write(text)
  process.exit(1)
}

function assetIds(): string[] {
  return MARKET_DEFINITIONS.assets.map((asset) => asset.id)
}

function readOptionValue(
  argv: readonly string[],
  index: number,
  name: string,
  inline: string | undefined,
): { value: string; consumed: number } {
  if (inline !== undefined) {
    if (inline.length === 0) fail(`--${name} requires a value`)
    return { value: inline, consumed: 0 }
  }
  const next = argv[index + 1]
  if (next === undefined || next.startsWith('-')) fail(`--${name} requires a value`)
  return { value: next, consumed: 1 }
}

function parseDays(text: string): number {
  if (!/^[1-9][0-9]*$/.test(text)) {
    fail(`--days must be an integer from ${DAYS_MIN} to ${DAYS_MAX}, received ${JSON.stringify(text)}`)
  }
  const days = Number(text)
  if (!Number.isSafeInteger(days) || days < DAYS_MIN || days > DAYS_MAX) {
    fail(`--days must be an integer from ${DAYS_MIN} to ${DAYS_MAX}, received ${JSON.stringify(text)}`)
  }
  return days
}

function parseSeed(text: string): string {
  if (!SEED_PATTERN.test(text)) {
    fail(
      `--seed must be 1 to 32 characters from A-Z, a-z, 0-9, and hyphen, received ${JSON.stringify(text)}`,
    )
  }
  return text
}

function parseAsset(text: string, ids: readonly string[]): string {
  if (!ids.includes(text)) {
    fail(`--asset must be one of ${ids.join(', ')}, received ${JSON.stringify(text)}`)
  }
  return text
}

function parseArgs(argv: readonly string[]): CliOptions {
  const ids = assetIds()
  let seed: string | undefined
  let days: number | undefined
  let quiet = false
  let eventsOnly = false
  let feed = false
  let asset: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1
    const name = eq === -1 ? arg : arg.slice(0, eq)
    const inline = eq === -1 ? undefined : arg.slice(eq + 1)

    if (name === '--quiet') {
      if (inline !== undefined) fail('--quiet does not take a value')
      quiet = true
      continue
    }
    if (name === '--events-only') {
      if (inline !== undefined) fail('--events-only does not take a value')
      eventsOnly = true
      continue
    }
    if (name === '--feed') {
      if (inline !== undefined) fail('--feed does not take a value')
      feed = true
      continue
    }
    if (name === '--seed') {
      if (seed !== undefined) fail('duplicate --seed')
      const read = readOptionValue(argv, i, 'seed', inline)
      seed = parseSeed(read.value)
      i += read.consumed
      continue
    }
    if (name === '--days') {
      if (days !== undefined) fail('duplicate --days')
      const read = readOptionValue(argv, i, 'days', inline)
      days = parseDays(read.value)
      i += read.consumed
      continue
    }
    if (name === '--asset') {
      if (asset !== undefined) fail('duplicate --asset')
      const read = readOptionValue(argv, i, 'asset', inline)
      asset = parseAsset(read.value, ids)
      i += read.consumed
      continue
    }
    if (arg.startsWith('-')) fail(`unknown argument ${JSON.stringify(arg)}`, true)
    fail(`unexpected argument ${JSON.stringify(arg)}`, true)
  }

  if (seed === undefined || days === undefined) {
    const missing: string[] = []
    if (seed === undefined) missing.push('--seed')
    if (days === undefined) missing.push('--days')
    fail(`missing ${missing.join(' and ')}`, true)
  }

  return { seed, days, quiet, eventsOnly, feed, asset }
}

function isPriceKind(kind: LogEvent['kind']): boolean {
  return kind === 'noiseRoll' || kind === 'priceStep' || kind === 'indexStep'
}

function isFeedKind(kind: LogEvent['kind']): boolean {
  return kind === 'headline' || kind === 'rumourGenerated'
}

function eventTarget(eventId: string): string {
  const parts = eventId.split(':')
  return parts[1] ?? ''
}

function matchesAsset(event: LogEvent, asset: string): boolean {
  switch (event.kind) {
    case 'noiseRoll':
    case 'priceStep':
    case 'indexStep':
    case 'effectApplied':
    case 'fairValueChange':
      return event.asset === asset
    case 'eventRoll':
    case 'eventDirection':
    case 'eventMagnitude':
      return event.target === asset
    case 'envDrift':
    case 'calendarItem':
      return false
    case 'headline':
      return eventTarget(event.eventId) === asset
    case 'rumourGenerated':
      return eventTarget(event.targetEventId) === asset
    default: {
      const unknown: never = event
      throw new Error(`cannot filter log event ${JSON.stringify(unknown)}`)
    }
  }
}

function showDayLog(options: CliOptions): boolean {
  // Feed lines live in the day log, so the default log shows them.
  // --feed adds the day summary and does not hide event lines.
  // --events-only still hides price lines. --quiet hides the log, except feed lines when --feed is set.
  return !options.quiet || options.eventsOnly || options.feed
}

function printAccountLog(game: GameState, options: CliOptions): void {
  if (!showDayLog(options)) return
  for (const event of game.log) {
    console.log(`[sim] ${formatEvent(event)}`)
  }
}

function requireCents(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe integer >= 0, received ${String(value)}`)
  }
  return value
}

/** Cash, trading, savings, and today's accrual. Pay days also print the interest paid. */
function accountsLine(game: GameState): string {
  let accrual = 0
  let paid: number | undefined
  for (const event of game.log) {
    if (event.kind === 'savingsAccrual') accrual = event.accrualCents
    if (event.kind === 'savingsInterestPaid') paid = event.amountCents
  }
  const cash = requireCents(game.accounts.cashCents, 'cash')
  const trading = requireCents(game.accounts.tradingCents, 'trading')
  const savings = requireCents(game.accounts.savingsCents, 'savings')
  const accruedToday = requireCents(accrual, 'accrual')
  let line = `[sim] accounts day=${game.market.day} cash=${cash} trading=${trading} savings=${savings} accrual=${accruedToday}`
  if (paid !== undefined) line = `${line} paid=${requireCents(paid, 'paid')}`
  return line
}

function printDayLog(log: readonly LogEvent[], options: CliOptions): void {
  if (showDayLog(options)) {
    for (const event of log) {
      if (options.quiet && !options.eventsOnly && !isFeedKind(event.kind)) continue
      if (options.eventsOnly && isPriceKind(event.kind)) continue
      if (options.asset !== undefined && !matchesAsset(event, options.asset)) continue
      console.log(`[sim] ${formatEvent(event)}`)
    }
  }
  if (options.feed) console.log(`[sim] summary ${formatSummary(daySummary(log))}`)
}

function priceAt(row: CloseRow, index: number, id: string): number {
  const price = row.prices[index]
  if (price === undefined) throw new Error(`missing close for ${id} on day ${row.day}`)
  return price
}

function closeLine(ids: readonly string[], row: CloseRow): string {
  const parts = ids.map((id, index) => `${id}=${priceAt(row, index, id)}`)
  return `[sim] day=${row.day} ${parts.join(' ')}`
}

function closeTable(ids: readonly string[], rows: readonly CloseRow[]): string[] {
  const header = ['day', ...ids]
  const body = rows.map((row) => [String(row.day), ...row.prices.map((price) => String(price))])
  const widths = header.map((cell, column) => {
    let width = cell.length
    for (const line of body) {
      const size = line[column]?.length ?? 0
      if (size > width) width = size
    }
    return width
  })
  const render = (cells: readonly string[]): string =>
    cells.map((cell, column) => cell.padStart(widths[column] ?? cell.length)).join(' ')
  return [render(header), ...body.map((cells) => render(cells))]
}

function run(options: CliOptions): void {
  const defs = MARKET_DEFINITIONS
  const ids = defs.assets.map((asset) => asset.id)
  const game = createGame(defs, options.seed)
  console.log(`[sim] seed=${options.seed} days=${options.days} assets=${ids.join(',')}`)
  printDayLog(game.market.log, options)
  printAccountLog(game, options)
  console.log(accountsLine(game))

  const closes: CloseRow[] = []
  for (let step = 0; step < options.days; step += 1) {
    endDay(game, defs)
    printDayLog(game.market.log, options)
    printAccountLog(game, options)
    console.log(accountsLine(game))
    closes.push({
      day: game.market.day,
      prices: ids.map((id) => {
        const asset = game.market.assets[id]
        if (asset === undefined) throw new Error(`missing close for ${id} on day ${game.market.day}`)
        return asset.priceCents
      }),
    })
  }

  if (options.quiet && !options.eventsOnly) {
    for (const row of closes) console.log(closeLine(ids, row))
  } else if (!options.eventsOnly) {
    console.log('[sim] closes')
    for (const line of closeTable(ids, closes)) console.log(`[sim] ${line}`)
  }
  console.log(`[sim] stateHash=${stateHash(game.market)}`)
}

run(parseArgs(process.argv.slice(2)))
