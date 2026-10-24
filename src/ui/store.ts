// UI session. Market rules stay in src/sim. Daily closes are kept here because
// MarketState.log is replaced on every endDay.

import { useSyncExternalStore } from 'react'
import { CONSUMABLE_DEFINITIONS, JOB_DEFINITIONS, MARKET_DEFINITIONS, SOCIAL_POST_DEFINITIONS } from '../content/index.ts'
import { DAMAGED_SAVE_MESSAGE, inspectSave, isRunMode, isSeed, writeSave } from '../persist/save.ts'
import type { RunMode, SaveFile } from '../persist/save.ts'
import { recordScore } from '../persist/scores.ts'
import { applyCommand, createGame, endDay as simEndDay, endDayBlockReason } from '../sim/game.ts'
import { stateHash } from '../sim/hash.ts'
import { daySummary, type DaySummary } from '../sim/summary.ts'
import type { ForcedSaleEvent, GameState, LiquidationEvent } from '../sim/types.ts'
import { debugLog } from './debug.ts'

const SEED_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'
const DEFAULT_SEED_LENGTH = 8
const definitions = MARKET_DEFINITIONS

export type CloseRow = {
  day: number
  prices: Readonly<Record<string, number>>
}

export type TradingRun = {
  seed: string
  mode: RunMode
  /** True after this session has stored the score for the current ending. */
  scoreStored: boolean
  game: GameState
  closes: readonly CloseRow[]
  summary: DaySummary | null
  /** Liquidations from the game log for the summary day. The next command replaces that log. */
  liquidations: readonly LiquidationEvent[]
  /** Forced sales from missed loan interest on the summary day. */
  forcedSales: readonly ForcedSaleEvent[]
}

export type DispatchResult = {
  accepted: boolean
  reason: string | null
}

export type ParsedInteger = { ok: true; value: number } | { ok: false; reason: string }

export type TradingSnapshot = {
  run: TradingRun | null
}

type Listener = () => void

const listeners = new Set<Listener>()
let run: TradingRun | null = null
let snapshot: TradingSnapshot = { run: null }

function publish(): void {
  snapshot = { run }
  for (const listener of listeners) listener()
}

function autosaveCurrent(): void {
  if (run === null) return
  try {
    const written = writeSave({ mode: run.mode, seed: run.seed, state: run.game })
    debugLog('[save]', `saved day=${written.day} bytes=${written.bytes}`)
  } catch (error) {
    console.error('[save] failed to save', error)
  }
}

function storeScore(): void {
  if (run === null || run.game.runEnd === null || run.scoreStored) return
  const end = run.game.runEnd
  const mode = run.mode
  const seed = run.seed
  try {
    const recorded = recordScore(mode, {
      seed,
      score: end.score,
      day: end.day,
      outcome: end.outcome,
    })
    if (recorded.rejectedReason !== null) {
      console.error(`[save] rejected reason=${recorded.rejectedReason}`)
      debugLog('[save]', `rejected reason=${recorded.rejectedReason}`)
    }
  } catch (error) {
    console.error('[save] failed to record score', error)
    return
  }
  run = { ...run, scoreStored: true }
  debugLog('[save]', `score mode=${mode} seed=${seed} score=${end.score}`)
}

/** Save at the start of a day, and again when a run ends so Continue keeps that ending. */
function persistIfNeeded(saveDay: boolean): void {
  if (run === null) return
  const endedNow = run.game.runEnd !== null && !run.scoreStored
  if (saveDay || endedNow) autosaveCurrent()
  if (run.game.runEnd !== null) storeScore()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): TradingSnapshot {
  return snapshot
}

export function useTradingStore(): TradingSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export type { RunMode }

/** 8 characters from the harness seed alphabet. Rejects bytes that would bias the draw. */
export function randomSeed(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available')
  }
  const chars: string[] = []
  const bytes = new Uint8Array(32)
  const limit = SEED_ALPHABET.length * 4
  while (chars.length < DEFAULT_SEED_LENGTH) {
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= limit) continue
      const index = byte % SEED_ALPHABET.length
      const char = SEED_ALPHABET[index]
      if (char === undefined) throw new Error(`seed alphabet missing index ${index}`)
      chars.push(char)
      if (chars.length === DEFAULT_SEED_LENGTH) break
    }
  }
  const seed = chars.join('')
  if (!isSeed(seed)) throw new Error(`generated seed failed validation, received ${JSON.stringify(seed)}`)
  return seed
}

function commandLabel(cmd: unknown): string {
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return 'invalid'
  if (!Object.hasOwn(cmd, 'type')) return 'invalid'
  const type = (cmd as { type?: unknown }).type
  if (typeof type !== 'string' || type.length === 0 || /[\r\n]/.test(type)) return 'invalid'
  return type
}

function readPrices(game: GameState): Record<string, number> {
  const prices: Record<string, number> = {}
  for (const def of definitions.assets) {
    const asset = game.market.assets[def.id]
    if (asset === undefined) {
      throw new Error(`missing close for ${def.id} on day ${game.market.day}`)
    }
    if (!Number.isSafeInteger(asset.priceCents) || asset.priceCents <= 0) {
      throw new Error(
        `close for ${def.id} on day ${game.market.day} must be a positive safe integer, received ${asset.priceCents}`,
      )
    }
    prices[def.id] = asset.priceCents
  }
  return prices
}

/**
 * Reset to day 0. Does not advance the market.
 * Seeded uses the entered seed. Normal draws a new seed from crypto.getRandomValues.
 * Returns a reason when the mode, seed, or starting job is rejected, and does not start a run.
 */
export function startGame(seed: string, jobId = 'jobless', mode: string = 'seeded'): string | null {
  if (!isRunMode(mode)) {
    const reason = 'Pick Seeded or Normal.'
    console.error(`[ui] rejected mode ${JSON.stringify(mode)}: ${reason}`)
    return reason
  }
  if (mode === 'seeded' && !isSeed(seed)) {
    const reason = 'Seed must be 1 to 32 characters from A-Z, a-z, 0-9, and hyphen.'
    console.error(`[ui] rejected seed ${JSON.stringify(seed)}: ${reason}`)
    return reason
  }
  if (typeof jobId !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(jobId)) {
    const reason = 'That job is not on the menu.'
    console.error(`[store] job start rejected ${JSON.stringify(jobId)}: ${reason}`)
    debugLog('[store]', 'job start invalid rejected unknownJob')
    return reason
  }
  const chosen = JOB_DEFINITIONS.find((job) => job.id === jobId)
  if (chosen === undefined) {
    const reason = 'That job is not on the menu.'
    console.error(`[store] job start ${jobId} rejected: ${reason}`)
    debugLog('[store]', `job start ${jobId} rejected unknownJob`)
    return reason
  }
  if (chosen.requirement !== 'none') {
    const reason = 'That job needs a course.'
    console.error(`[store] job start ${jobId} rejected: ${reason}`)
    debugLog('[store]', `job start ${jobId} rejected jobLocked`)
    return reason
  }
  const chosenSeed = mode === 'normal' ? randomSeed() : seed
  let game: GameState
  try {
    game = createGame(definitions, chosenSeed, {
      jobs: JOB_DEFINITIONS,
      jobId,
      consumables: CONSUMABLE_DEFINITIONS,
      socialPosts: SOCIAL_POST_DEFINITIONS,
    })
  } catch (error) {
    console.error('[store] createGame failed', error)
    throw error
  }
  run = {
    seed: chosenSeed,
    mode,
    scoreStored: false,
    game,
    closes: [],
    summary: null,
    liquidations: [],
    forcedSales: [],
  }
  debugLog('[ui]', `newRun mode=${mode} seed=${chosenSeed} job=${jobId}`)
  persistIfNeeded(true)
  debugLog(
    '[store]',
    `job start ${jobId} slots=${chosen.slots} sleepHours=${chosen.sleepHours} pay=${chosen.payCents}`,
  )
  logDistortion(game)
  publish()
  return null
}

function cloneGame(state: GameState): GameState {
  let parsed: unknown
  try {
    parsed = JSON.parse(JSON.stringify(state))
  } catch (error) {
    throw new Error(`saved game could not be copied: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('saved game copy was not an object')
  }
  return parsed as GameState
}

/**
 * Restore a validated save. The header keeps that save's mode and seed.
 * Returns the damaged-save message when the save is not used.
 */
export function continueGame(save: SaveFile): string | null {
  const checked = inspectSave(save)
  if (!checked.ok) {
    if (checked.cause === null || checked.cause === undefined) {
      console.error(`[save] rejected reason=${checked.reason}`)
    } else {
      console.error(`[save] rejected reason=${checked.reason}`, checked.cause)
    }
    debugLog('[save]', `rejected reason=${checked.reason}`)
    return DAMAGED_SAVE_MESSAGE
  }
  let game: GameState
  try {
    game = cloneGame(checked.save.state)
  } catch (error) {
    console.error('[save] rejected reason=shape', error)
    debugLog('[save]', 'rejected reason=shape')
    return DAMAGED_SAVE_MESSAGE
  }
  let summary: DaySummary | null = null
  let closes: CloseRow[] = []
  let liquidations: LiquidationEvent[] = []
  let forcedSales: ForcedSaleEvent[] = []
  try {
    if (game.market.day > 0) {
      summary = daySummary(game.market.log)
      closes = [{ day: game.market.day, prices: readPrices(game) }]
    }
    liquidations = readLiquidations(game)
    forcedSales = readForcedSales(game)
  } catch (error) {
    console.error('[save] rejected reason=shape', error)
    debugLog('[save]', 'rejected reason=shape')
    return DAMAGED_SAVE_MESSAGE
  }
  run = {
    seed: checked.save.seed,
    mode: checked.save.mode,
    scoreStored: game.runEnd !== null,
    game,
    closes,
    summary,
    liquidations,
    forcedSales,
  }
  debugLog('[save]', `loaded day=${game.market.day}`)
  debugLog('[ui]', `continue mode=${checked.save.mode} seed=${checked.save.seed} day=${game.market.day}`)
  publish()
  return null
}

/** Leave the dashboard for the start screen. The saved day stays in localStorage. */
export function leaveRun(): void {
  run = null
  publish()
}

function commandToken(value: unknown): string {
  if (typeof value === 'string' && value.length > 0 && !/[\r\n]/.test(value)) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return 'invalid'
}

function isSkipCommand(cmd: unknown): boolean {
  return typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) && (cmd as { type?: unknown }).type === 'skip'
}

/** `[store] skip from=... to=...` with accepted or rejected. */
function logSkip(cmd: unknown, from: string, to: string, accepted: boolean, reason: string): void {
  if (!isSkipCommand(cmd)) return
  const status = accepted ? 'accepted' : `rejected ${reason}`
  debugLog('[store]', `skip from=${commandToken(from)} to=${commandToken(to)} ${status}`)
}

/** `[store] order ...` and `[store] transfer ...` with accepted or rejected. */
function logOrderOrTransfer(cmd: unknown, accepted: boolean, reason: string): void {
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return
  const record = cmd as {
    type?: unknown
    asset?: unknown
    side?: unknown
    quantity?: unknown
    from?: unknown
    to?: unknown
    amountCents?: unknown
  }
  const status = accepted ? 'accepted' : `rejected ${reason}`
  if (record.type === 'order') {
    debugLog(
      '[store]',
      `order ${commandToken(record.asset)} ${commandToken(record.side)} ${commandToken(record.quantity)} ${status}`,
    )
    return
  }
  if (record.type === 'transfer') {
    debugLog(
      '[store]',
      `transfer ${commandToken(record.from)} ${commandToken(record.to)} ${commandToken(record.amountCents)} ${status}`,
    )
  }
}

/** `[store] runEnded outcome=... reason=... day=... netWorth=... score=...` */
function logRunEnd(game: GameState): void {
  const end = game.runEnd
  if (end === null) return
  debugLog(
    '[store]',
    `runEnded outcome=${end.outcome} reason=${end.reason} day=${end.day} netWorth=${end.netWorthCents} score=${end.score}`,
  )
}

function isSetJobCommand(cmd: unknown): boolean {
  return typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) && (cmd as { type?: unknown }).type === 'setJob'
}

function isTypedCommand(cmd: unknown, type: string): boolean {
  return typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) && (cmd as { type?: unknown }).type === type
}

/** `[store] consume <item> accepted|rejected`. */
function logConsume(cmd: unknown, game: GameState | null, accepted: boolean, reason: string): void {
  if (!isTypedCommand(cmd, 'consume')) return
  const item = commandToken((cmd as { item?: unknown }).item)
  if (!accepted || game === null) {
    debugLog('[store]', `consume ${item} rejected ${reason}`)
    return
  }
  const event = [...game.pending].reverse().find((entry) => entry.kind === 'consume')
  if (event === undefined || event.kind !== 'consume') {
    console.error('[store] consume accepted without a consume event')
    debugLog('[store]', `consume ${item} accepted missing-event`)
    return
  }
  debugLog(
    '[store]',
    `consume ${event.item} cost=${event.cost} energy=${event.energyDelta} stress=${event.stressDelta}`,
  )
}

/** `[store] lifestyle ...` for a tier change or a course purchase. */
function logLifestyle(cmd: unknown, game: GameState | null, accepted: boolean, reason: string): void {
  if (isTypedCommand(cmd, 'setLifestyle')) {
    const record = cmd as { category?: unknown; tier?: unknown }
    const category = commandToken(record.category)
    const tier = commandToken(record.tier)
    if (!accepted || game === null) {
      debugLog('[store]', `lifestyle setLifestyle ${category} tier=${tier} rejected ${reason}`)
      return
    }
    const event = [...game.pending].reverse().find((entry) => entry.kind === 'lifestyleChange')
    if (event === undefined || event.kind !== 'lifestyleChange') {
      console.error('[store] lifestyle accepted without a lifestyleChange event')
      debugLog('[store]', `lifestyle setLifestyle ${category} tier=${tier} accepted missing-event`)
      return
    }
    debugLog(
      '[store]',
      `lifestyle category=${event.category} from=${event.from} to=${event.to} upfront=${event.upfront} expenses=${event.expensesCents}`,
    )
    return
  }
  if (!isTypedCommand(cmd, 'buyCourse')) return
  const course = commandToken((cmd as { course?: unknown }).course)
  if (!accepted || game === null) {
    debugLog('[store]', `lifestyle buyCourse ${course} rejected ${reason}`)
    return
  }
  const event = [...game.pending].reverse().find((entry) => entry.kind === 'coursePurchased')
  if (event === undefined || event.kind !== 'coursePurchased') {
    console.error('[store] course accepted without a coursePurchased event')
    debugLog('[store]', `lifestyle buyCourse ${course} accepted missing-event`)
    return
  }
  debugLog('[store]', `lifestyle buyCourse course=${event.course} cost=${event.cost}`)
}

/** `[store] loan takeLoan|repayLoan ...` and the interest events from the day log. */
function logLoanCommand(cmd: unknown, game: GameState | null, accepted: boolean, reason: string): void {
  const taking = isTypedCommand(cmd, 'takeLoan')
  const repaying = isTypedCommand(cmd, 'repayLoan')
  if (!taking && !repaying) return
  const amount = commandToken((cmd as { amountCents?: unknown }).amountCents)
  const type = taking ? 'takeLoan' : 'repayLoan'
  if (!accepted || game === null) {
    debugLog('[store]', `loan ${type} amount=${amount} rejected ${reason}`)
    return
  }
  const kind = taking ? 'loanTaken' : 'loanRepaid'
  const event = [...game.pending].reverse().find((entry) => entry.kind === kind)
  if (event === undefined || (event.kind !== 'loanTaken' && event.kind !== 'loanRepaid')) {
    console.error('[store] loan accepted without a loan event')
    debugLog('[store]', `loan ${type} amount=${amount} accepted missing-event`)
    return
  }
  debugLog(
    '[store]',
    `loan ${type} amount=${event.amountCents} balance=${event.balanceCents} cash=${event.cashCents} accepted`,
  )
}

function logLoanDay(game: GameState): void {
  for (const event of game.log) {
    if (event.kind === 'loanInterestDue') {
      debugLog(
        '[store]',
        `loan interestDue day=${event.day} amount=${event.amountCents} cash=${event.cashCents} balance=${event.balanceCents}`,
      )
    } else if (event.kind === 'loanInterestPaid') {
      debugLog(
        '[store]',
        `loan interestPaid day=${event.day} amount=${event.amountCents} cash=${event.cashCents} balance=${event.balanceCents}`,
      )
    } else if (event.kind === 'forcedSale') {
      debugLog('[store]', `loan forcedSale source=${event.source} amount=${event.amountCents} day=${event.day}`)
    } else if (event.kind === 'runEnded' && event.reason === 'cannotPayLoanInterest') {
      debugLog('[store]', `loan runEnded reason=${event.reason} day=${event.day}`)
    }
  }
}

/** `[store] readNews cost=... energy=...` when the read is accepted. */
function logNewsRead(cmd: unknown, game: GameState | null, accepted: boolean, reason: string): void {
  if (!isTypedCommand(cmd, 'readNews')) return
  if (!accepted || game === null) {
    debugLog('[store]', `readNews rejected ${reason}`)
    return
  }
  const event = [...game.pending].reverse().find((entry) => entry.kind === 'newsRead')
  if (event === undefined || event.kind !== 'newsRead') {
    console.error('[store] readNews accepted without a newsRead event')
    debugLog('[store]', 'readNews accepted missing-event')
    return
  }
  debugLog('[store]', `readNews cost=${event.cost} energy=${game.stats.energy}`)
}

/** `[store] verify cost=... energy=...` when verify is accepted. */
function logVerify(cmd: unknown, game: GameState | null, accepted: boolean, reason: string): void {
  if (!isTypedCommand(cmd, 'verify')) return
  if (!accepted || game === null) {
    debugLog('[store]', `verify rejected ${reason}`)
    return
  }
  const event = [...game.pending].reverse().find((entry) => entry.kind === 'newsVerified')
  if (event === undefined || event.kind !== 'newsVerified') {
    console.error('[store] verify accepted without a newsVerified event')
    debugLog('[store]', 'verify accepted missing-event')
    return
  }
  debugLog('[store]', `verify cost=${event.cost} energy=${game.stats.energy}`)
}

/** `[store] distortion item=... action=... true=... shown=...` for each biased item. */
function logDistortion(game: GameState): void {
  for (const event of game.perception.events) {
    debugLog(
      '[store]',
      `distortion item=${event.item} action=${event.action} true=${event.trueValue} shown=${event.shownValue}`,
    )
  }
}

/** `[store] job setJob ... accepted|rejected`. */
function logJobCommand(cmd: unknown, accepted: boolean, reason: string, effectiveDay: number | null): void {
  if (!isSetJobCommand(cmd)) return
  const record = cmd as { jobId?: unknown }
  const id = commandToken(record.jobId)
  if (accepted) {
    const day = effectiveDay === null ? 'none' : String(effectiveDay)
    debugLog('[store]', `job setJob ${id} accepted effectiveDay=${day}`)
    return
  }
  debugLog('[store]', `job setJob ${id} rejected ${reason}`)
}

/** `[store] job changed|salary|perk` from the day log. */
function logJobDay(game: GameState): void {
  for (const event of game.log) {
    if (event.kind === 'jobChanged') {
      debugLog(
        '[store]',
        `job changed from=${event.from} to=${event.to} day=${event.day} slots=${event.slots} sleepHours=${event.sleepHours}`,
      )
    } else if (event.kind === 'salaryPaid') {
      debugLog(
        '[store]',
        `job salary job=${event.job} days=${event.days} amount=${event.amountCents} day=${event.day}`,
      )
    } else if (event.kind === 'perkApplied') {
      debugLog('[store]', `job perk perk=${event.perk} job=${event.job} day=${event.day}`)
    }
  }
}

/** `[store] bill pending|paid|runEnded ...` when a bill or a lost run is in view. */
function logBill(game: GameState): void {
  if (game.runEnd !== null) {
    debugLog('[store]', `bill runEnded day=${game.runEnd.day} reason=${game.runEnd.reason}`)
    return
  }
  if (game.bill !== null) {
    const shortfall = game.bill.amountCents - game.accounts.cashCents
    debugLog(
      '[store]',
      `bill pending day=${game.bill.day} amount=${game.bill.amountCents} cash=${game.accounts.cashCents} shortfall=${shortfall}`,
    )
    return
  }
  for (let index = game.log.length - 1; index >= 0; index -= 1) {
    const event = game.log[index]
    if (event?.kind !== 'billPaid') continue
    debugLog('[store]', `bill paid day=${event.day} amount=${event.amountCents} cash=${event.cashCents}`)
    return
  }
}

/** One player command. Acceptance comes from the simulation log, not from a second set of rules. */
export function dispatch(cmd: unknown): DispatchResult {
  const label = commandLabel(cmd)
  if (run === null) {
    console.error(`[store] dispatch ${label} rejected: game has not started`)
    debugLog('[store]', `dispatch ${label} -> rejected notStarted`)
    logOrderOrTransfer(cmd, false, 'notStarted')
    if (isSkipCommand(cmd)) debugLog('[store]', 'skip rejected notStarted')
    logJobCommand(cmd, false, 'notStarted', null)
    logConsume(cmd, null, false, 'notStarted')
    logNewsRead(cmd, null, false, 'notStarted')
    logVerify(cmd, null, false, 'notStarted')
    logLifestyle(cmd, null, false, 'notStarted')
    logLoanCommand(cmd, null, false, 'notStarted')
    return { accepted: false, reason: 'notStarted' }
  }
  if (run.game.runEnd !== null) {
    logRunEnd(run.game)
    debugLog('[store]', `dispatch ${label} -> rejected runEnded`)
    logOrderOrTransfer(cmd, false, 'runEnded')
    if (isSkipCommand(cmd)) debugLog('[store]', 'skip rejected runEnded')
    logJobCommand(cmd, false, 'runEnded', null)
    logConsume(cmd, run.game, false, 'runEnded')
    logNewsRead(cmd, run.game, false, 'runEnded')
    logVerify(cmd, run.game, false, 'runEnded')
    logLifestyle(cmd, run.game, false, 'runEnded')
    logLoanCommand(cmd, run.game, false, 'runEnded')
    return { accepted: false, reason: 'runEnded' }
  }
  const from = run.game.section
  const before = run.game.pending.length
  try {
    applyCommand(run.game, definitions, cmd)
  } catch (error) {
    console.error('[store] dispatch failed', error)
    throw error
  }
  const added = run.game.pending.slice(before)
  const rejection = added.find((event) => event.kind === 'commandRejected')
  const to = run.game.section
  if (rejection !== undefined) {
    debugLog('[store]', `dispatch ${label} -> rejected ${rejection.reason}`)
    logOrderOrTransfer(cmd, false, rejection.reason)
    logSkip(cmd, from, to, false, rejection.reason)
    logJobCommand(cmd, false, rejection.reason, null)
    logConsume(cmd, run.game, false, rejection.reason)
    logNewsRead(cmd, run.game, false, rejection.reason)
    logVerify(cmd, run.game, false, rejection.reason)
    logLifestyle(cmd, run.game, false, rejection.reason)
    logLoanCommand(cmd, run.game, false, rejection.reason)
    logBill(run.game)
    logRunEnd(run.game)
    persistIfNeeded(false)
    publish()
    return { accepted: false, reason: rejection.reason }
  }
  debugLog('[store]', `dispatch ${label} -> accepted`)
  logOrderOrTransfer(cmd, true, '')
  logSkip(cmd, from, to, true, '')
  logJobCommand(cmd, true, '', run.game.job.pending?.effectiveDay ?? null)
  logConsume(cmd, run.game, true, '')
  logNewsRead(cmd, run.game, true, '')
  logVerify(cmd, run.game, true, '')
  logLifestyle(cmd, run.game, true, '')
  logLoanCommand(cmd, run.game, true, '')
  logBill(run.game)
  logRunEnd(run.game)
  persistIfNeeded(false)
  publish()
  return { accepted: true, reason: null }
}

/** Advance one day. Records that day's closes because the market log will be replaced tomorrow. */
export function endDay(): void {
  if (run === null) {
    console.error('[store] endDay rejected: game has not started')
    debugLog('[store]', 'endDay -> rejected notStarted')
    return
  }
  const block = endDayBlockReason(run.game)
  if (block !== null) {
    debugLog('[store]', `bill endDay blocked ${block} day=${run.game.market.day}`)
    if (block === 'runEnded') logRunEnd(run.game)
    return
  }
  const dayBefore = run.game.market.day
  try {
    simEndDay(run.game, definitions)
  } catch (error) {
    console.error('[store] endDay failed', error)
    throw error
  }
  logBill(run.game)
  logRunEnd(run.game)
  logJobDay(run.game)
  logLoanDay(run.game)
  debugLog('[store]', `stats energy=${run.game.stats.energy} stress=${run.game.stats.stress}`)
  logDistortion(run.game)
  if (run.game.market.day === dayBefore) {
    const day = run.game.market.day
    const events = run.game.market.log.length
    const hash = stateHash(run.game.market)
    run = {
      seed: run.seed,
      mode: run.mode,
      scoreStored: run.scoreStored,
      game: run.game,
      closes: run.closes,
      summary: run.summary,
      liquidations: readLiquidations(run.game),
      forcedSales: readForcedSales(run.game),
    }
    debugLog('[store]', `endDay day=${day} events=${events} hash=${hash}`)
    persistIfNeeded(true)
    publish()
    return
  }
  const prices = readPrices(run.game)
  const summary = daySummary(run.game.market.log)
  const liquidations = readLiquidations(run.game)
  const forcedSales = readForcedSales(run.game)
  const day = run.game.market.day
  const events = run.game.market.log.length
  const hash = stateHash(run.game.market)
  run = {
    seed: run.seed,
    mode: run.mode,
    scoreStored: run.scoreStored,
    game: run.game,
    closes: [...run.closes, { day, prices }],
    summary,
    liquidations,
    forcedSales,
  }
  debugLog('[store]', `endDay day=${day} events=${events} hash=${hash}`)
  debugLog(
    '[store]',
    `liquidations ${
      liquidations.length === 0
        ? 'none'
        : liquidations.map((event) => `${event.asset} quantity=${event.quantity}`).join(', ')
    }`,
  )
  persistIfNeeded(true)
  publish()
}

/**
 * Positive whole number in the safe-integer range.
 * Empty, fractional, negative, and huge text are reasons and are not parsed.
 */
export function parsePositiveInteger(raw: string, label: string): ParsedInteger {
  if (typeof raw !== 'string') return { ok: false, reason: `${label} must be a positive whole number.` }
  if (label.length === 0 || /[\r\n]/.test(label)) {
    throw new Error(`integer label must be a single line, received ${JSON.stringify(label)}`)
  }
  const text = raw.trim()
  if (text.length === 0) return { ok: false, reason: `${label} is empty.` }
  if (text.includes('.')) return { ok: false, reason: `${label} must be a whole number.` }
  if (text.startsWith('-')) return { ok: false, reason: `${label} must be positive.` }
  if (!/^[0-9]+$/.test(text)) return { ok: false, reason: `${label} must be a positive whole number.` }
  if (/^0+$/.test(text)) return { ok: false, reason: `${label} must be positive.` }
  if (text.length > 1 && text.startsWith('0')) {
    return { ok: false, reason: `${label} must be a positive whole number.` }
  }
  const max = String(Number.MAX_SAFE_INTEGER)
  if (text.length > max.length || (text.length === max.length && text > max)) {
    return { ok: false, reason: `${label} is too large.` }
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value <= 0) return { ok: false, reason: `${label} is too large.` }
  return { ok: true, value }
}

/** Copy liquidation rows off the game log before the next command replaces it. */
function readLiquidations(game: GameState): LiquidationEvent[] {
  const found: LiquidationEvent[] = []
  for (const event of game.log) {
    if (event.kind !== 'liquidation') continue
    if (!Number.isSafeInteger(event.day) || event.day < 0) {
      throw new Error(`liquidation day must be a safe integer >= 0, received ${String(event.day)}`)
    }
    if (typeof event.asset !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(event.asset)) {
      throw new Error(`liquidation asset is invalid, received ${JSON.stringify(event.asset)}`)
    }
    if (!Number.isSafeInteger(event.quantity) || event.quantity <= 0) {
      throw new Error(
        `liquidation quantity for ${event.asset} must be a positive safe integer, received ${String(event.quantity)}`,
      )
    }
    if (!Number.isSafeInteger(event.fill) || event.fill <= 0) {
      throw new Error(
        `liquidation fill for ${event.asset} must be a positive safe integer, received ${String(event.fill)}`,
      )
    }
    if (event.ratioAfter !== null && (typeof event.ratioAfter !== 'number' || !Number.isFinite(event.ratioAfter))) {
      throw new Error(
        `liquidation ratio for ${event.asset} must be a finite number or null, received ${String(event.ratioAfter)}`,
      )
    }
    found.push({
      kind: 'liquidation',
      day: event.day,
      asset: event.asset,
      quantity: event.quantity,
      fill: event.fill,
      ratioAfter: event.ratioAfter,
    })
  }
  return found
}

/** Copy forced-sale rows off the game log before the next command replaces it. */
function readForcedSales(game: GameState): ForcedSaleEvent[] {
  const found: ForcedSaleEvent[] = []
  for (const event of game.log) {
    if (event.kind !== 'forcedSale') continue
    if (!Number.isSafeInteger(event.day) || event.day < 0) {
      throw new Error(`forced sale day must be a safe integer >= 0, received ${String(event.day)}`)
    }
    if (typeof event.source !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(event.source)) {
      throw new Error(`forced sale source is invalid, received ${JSON.stringify(event.source)}`)
    }
    if (!Number.isSafeInteger(event.amountCents) || event.amountCents < 0) {
      throw new Error(
        `forced sale amount for ${event.source} must be a safe integer >= 0, received ${String(event.amountCents)}`,
      )
    }
    found.push({ kind: 'forcedSale', day: event.day, source: event.source, amountCents: event.amountCents })
  }
  return found
}
