// Intraday session. The market is open 17:00 to 21:00, in 16 steps of 15 minutes.
// `buildSession` runs at the start of a day. It previews the next market step on a
// copy of the market, so the day's closing prices are already known, then draws a
// bridge from the open (today's price) to that close for every asset. The real
// market state is not touched except for the `intraday` and `volume` streams. The
// real step at End day then prints exactly the previewed close, so a day never
// jumps at the close. The market, events, info and distortion streams are never read.
// Bars past the clock are hidden from the player. Orders fill at the quote at the
// clock. Margin, interest, borrow fees and liquidation still use the daily close.
// Volume is display only. It does not feed back into prices, spread or fills.

import {
  MARKET_OPEN_MINUTE,
  RUN_LENGTH_DAYS,
  SESSION_BAND_DENOMINATOR,
  SESSION_BAND_NUMERATOR,
  SESSION_BASE_NOTIONAL_CENTS,
  SESSION_EVENT_VOLUME_BOOST,
  SESSION_MOVE_VOLUME_BOOST,
  SESSION_NOISE_SCALE,
  SESSION_STEP_MINUTES,
  SESSION_STEPS,
  SESSION_VOLUME_NOISE,
  SESSION_WICK_SCALE,
} from './constants.ts'
import { formatMinute } from './day.ts'
import { indexQuoteCents, stepMarketDay } from './market.ts'
import { createRng, nextFloat, nextNormal } from './rng.ts'
import type {
  AssetDefinition,
  ClockStepEvent,
  GameState,
  MarketDefinitions,
  MarketState,
  SessionBar,
  SessionState,
} from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

/** `HH:MM` for a clock step. Step 0 is the open, the last step is the close. */
export function clockTime(step: number): string {
  if (!Number.isSafeInteger(step) || step < 0 || step > SESSION_STEPS) {
    throw new Error(`clock step must be a safe integer from 0 to ${SESSION_STEPS}, received ${describeValue(step)}`)
  }
  return formatMinute(MARKET_OPEN_MINUTE + step * SESSION_STEP_MINUTES)
}

function bandLow(open: number): number {
  return Math.max(1, Math.ceil((open * (SESSION_BAND_DENOMINATOR - SESSION_BAND_NUMERATOR)) / SESSION_BAND_DENOMINATOR))
}

function bandHigh(open: number): number {
  return Math.floor((open * (SESSION_BAND_DENOMINATOR + SESSION_BAND_NUMERATOR)) / SESSION_BAND_DENOMINATOR)
}

function clampTo(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

type ClosePreview = {
  closes: Record<string, number>
  /** Asset ids that have an event effect or a calendar slice today. */
  eventful: Set<string>
}

/**
 * The prices the next End day will print. Runs the real step on a copy and
 * reads nothing back into the market. Null when there is no next step.
 */
function previewNextStep(market: MarketState, defs: MarketDefinitions): ClosePreview | null {
  if (market.day >= RUN_LENGTH_DAYS) return null
  const copy = structuredClone(market)
  stepMarketDay(copy, defs)
  const closes: Record<string, number> = {}
  for (const def of defs.assets) closes[def.id] = copy.assets[def.id].priceCents
  const eventful = new Set<string>()
  for (const event of copy.log) {
    if (event.kind === 'effectApplied') eventful.add(event.asset)
  }
  return { closes, eventful }
}

/** Display-only U-shaped weight: busier at the open and the close. Sums to the step count. */
function volumeShape(): number[] {
  const raw: number[] = []
  let sum = 0
  for (let i = 0; i < SESSION_STEPS; i += 1) {
    const x = (i - (SESSION_STEPS - 1) / 2) / ((SESSION_STEPS - 1) / 2)
    const weight = 1 + 1.5 * x * x
    raw.push(weight)
    sum += weight
  }
  return raw.map((weight) => (weight * SESSION_STEPS) / sum)
}

function bridgePath(
  open: number,
  close: number,
  stepNoise: number,
  streamNormals: number[],
): number[] {
  const walk: number[] = [0]
  for (let i = 1; i <= SESSION_STEPS; i += 1) walk.push(walk[i - 1] + streamNormals[i - 1] * stepNoise)
  const low = bandLow(open)
  const high = bandHigh(open)
  const path: number[] = [open]
  for (let i = 1; i < SESSION_STEPS; i += 1) {
    const bridge = walk[i] - (i / SESSION_STEPS) * walk[SESSION_STEPS]
    const value = open + ((close - open) * i) / SESSION_STEPS + bridge
    path.push(clampTo(Math.round(value), low, high))
  }
  path.push(close)
  return path
}

function barsFromPath(
  path: number[],
  open: number,
  stepNoise: number,
  wicks: number[],
  volumes: number[],
): SessionBar[] {
  const low = bandLow(open)
  const high = bandHigh(open)
  const bars: SessionBar[] = []
  for (let i = 1; i <= SESSION_STEPS; i += 1) {
    const barOpen = path[i - 1]
    const barClose = path[i]
    const up = Math.round(wicks[(i - 1) * 2] * stepNoise * SESSION_WICK_SCALE)
    const down = Math.round(wicks[(i - 1) * 2 + 1] * stepNoise * SESSION_WICK_SCALE)
    bars.push({
      open: barOpen,
      high: clampTo(Math.max(barOpen, barClose) + up, low, high),
      low: clampTo(Math.min(barOpen, barClose) - down, low, high),
      close: barClose,
      volume: volumes[i - 1],
    })
  }
  return bars
}

/** The session streams for a new run. Derived from the seed, apart from the market streams. */
export function createSessionStreams(seed: string): SessionState['streams'] {
  const streams = createRng(`${seed}#session`)
  return { intraday: streams.market, volume: streams.events }
}

/** The session for the market's current day. Draws only the two session streams it is given. */
export function buildSession(
  market: MarketState,
  defs: MarketDefinitions,
  streams: SessionState['streams'],
): SessionState {
  const preview = previewNextStep(market, defs)
  const shape = volumeShape()
  const paths: Record<string, number[]> = {}
  const stepNoises: Record<string, number> = {}
  const normalsById: Record<string, number[]> = {}
  const wicksById: Record<string, number[]> = {}
  const volumesById: Record<string, number[]> = {}
  const stocks: AssetDefinition[] = []
  let volatilitySum = 0

  const drawFor = (def: AssetDefinition, noiseVolatility: number) => {
    const open = market.assets[def.id].priceCents
    const stepNoise = (noiseVolatility * open * SESSION_NOISE_SCALE) / Math.sqrt(SESSION_STEPS)
    const normals: number[] = []
    for (let i = 0; i < SESSION_STEPS; i += 1) normals.push(nextNormal(streams.intraday))
    const wicks: number[] = []
    for (let i = 0; i < SESSION_STEPS * 2; i += 1) wicks.push(nextFloat(streams.intraday))
    const noises: number[] = []
    for (let i = 0; i < SESSION_STEPS; i += 1) noises.push(nextNormal(streams.volume))
    stepNoises[def.id] = stepNoise
    normalsById[def.id] = normals
    wicksById[def.id] = wicks
    return { open, noises }
  }

  const volumesFor = (def: AssetDefinition, open: number, close: number, noises: number[]) => {
    const move = Math.min(1, Math.abs(close - open) / open / 0.08)
    const eventBoost = preview !== null && preview.eventful.has(def.id) ? SESSION_EVENT_VOLUME_BOOST : 0
    const base = SESSION_BASE_NOTIONAL_CENTS / open
    const day = base * (1 + SESSION_MOVE_VOLUME_BOOST * move + eventBoost)
    volumesById[def.id] = noises.map((z, i) =>
      Math.max(0, Math.round((day / SESSION_STEPS) * shape[i] * Math.exp(SESSION_VOLUME_NOISE * z))),
    )
  }

  for (const def of defs.assets) {
    if (def.kind !== 'stock') continue
    stocks.push(def)
    volatilitySum += def.dailyVolatility
    const { open, noises } = drawFor(def, def.dailyVolatility)
    const close = preview === null ? open : preview.closes[def.id]
    const noise = preview === null ? 0 : stepNoises[def.id]
    paths[def.id] = bridgePath(open, close, noise, normalsById[def.id])
    volumesFor(def, open, close, noises)
  }

  const meanVolatility = stocks.length === 0 ? 0 : volatilitySum / stocks.length
  for (const def of defs.assets) {
    if (def.kind !== 'index') continue
    const { open, noises } = drawFor(def, meanVolatility)
    const close = preview === null ? open : preview.closes[def.id]
    const path: number[] = [open]
    const low = bandLow(open)
    const high = bandHigh(open)
    const lastQuote = indexQuoteCents(defs, quotedAssets(defs, paths, SESSION_STEPS))
    for (let i = 1; i < SESSION_STEPS; i += 1) {
      const quote = indexQuoteCents(defs, quotedAssets(defs, paths, i))
      const value = quote + ((close - lastQuote) * i) / SESSION_STEPS
      path.push(clampTo(Math.round(value), low, high))
    }
    path.push(close)
    paths[def.id] = path
    volumesFor(def, open, close, noises)
    // The index shows the average stock activity, not a second helping.
    volumesById[def.id] = volumesById[def.id].map((volume) => Math.round(volume / Math.max(1, stocks.length)))
  }

  const bars: Record<string, SessionBar[]> = {}
  for (const def of defs.assets) {
    bars[def.id] = barsFromPath(
      paths[def.id],
      market.assets[def.id].priceCents,
      stepNoises[def.id],
      wicksById[def.id],
      volumesById[def.id],
    )
  }
  return { day: market.day, clock: 0, bars, streams }
}

/** Stock prices at step `i` as asset states, so the index formula can be reused. */
function quotedAssets(
  defs: MarketDefinitions,
  paths: Record<string, number[]>,
  step: number,
): MarketState['assets'] {
  const assets: MarketState['assets'] = {}
  for (const def of defs.assets) {
    if (def.kind !== 'stock') continue
    assets[def.id] = { id: def.id, priceCents: paths[def.id][step], fairValue: 0 }
  }
  return assets
}

/** Price of one asset at the clock. Step 0 is the open, which is today's stored price. */
export function sessionPrice(state: GameState, assetId: string): number {
  const asset = state.market.assets[assetId]
  if (asset === undefined) throw new Error(`asset ${assetId} is not in the market`)
  const clock = state.session.clock
  if (clock === 0) return asset.priceCents
  const bar = state.session.bars[assetId]?.[clock - 1]
  if (bar === undefined) throw new Error(`session has no bar ${clock} for ${assetId}`)
  return bar.close
}

/**
 * A copy of the market whose prices are the quotes at the clock. Orders, the margin
 * meter and equity read this. The stored market is not changed.
 */
export function quoteMarket(state: GameState): MarketState {
  if (state.session.clock === 0) return state.market
  const assets: MarketState['assets'] = {}
  for (const id of Object.keys(state.market.assets)) {
    assets[id] = { ...state.market.assets[id], priceCents: sessionPrice(state, id) }
  }
  return { ...state.market, assets }
}

/** Plain value check for a session read from a save. */
export function assertSession(session: SessionState, day: number, defs: MarketDefinitions): void {
  if (typeof session !== 'object' || session === null || Array.isArray(session)) {
    throw new Error(`session must be an object, received ${describeValue(session)}`)
  }
  if (session.day !== day) throw new Error(`session day ${describeValue(session.day)} must match market day ${day}`)
  if (!Number.isSafeInteger(session.clock) || session.clock < 0 || session.clock > SESSION_STEPS) {
    throw new Error(`session clock must be a safe integer from 0 to ${SESSION_STEPS}, received ${describeValue(session.clock)}`)
  }
  if (typeof session.streams !== 'object' || session.streams === null) {
    throw new Error(`session streams must be an object, received ${describeValue(session.streams)}`)
  }
  if (typeof session.bars !== 'object' || session.bars === null) {
    throw new Error(`session bars must be an object, received ${describeValue(session.bars)}`)
  }
  for (const def of defs.assets) {
    const list = session.bars[def.id]
    if (!Array.isArray(list) || list.length !== SESSION_STEPS) {
      throw new Error(`session bars for ${def.id} must have ${SESSION_STEPS} entries`)
    }
    for (const bar of list) {
      if (
        !Number.isSafeInteger(bar.open) ||
        !Number.isSafeInteger(bar.high) ||
        !Number.isSafeInteger(bar.low) ||
        !Number.isSafeInteger(bar.close) ||
        !Number.isSafeInteger(bar.volume) ||
        bar.low <= 0 ||
        bar.volume < 0 ||
        bar.high < Math.max(bar.open, bar.close) ||
        bar.low > Math.min(bar.open, bar.close)
      ) {
        throw new Error(`session bar for ${def.id} is not a valid bar`)
      }
    }
  }
}

export type ClockOutcome =
  | { accepted: true; event: ClockStepEvent }
  | { accepted: false; reason: string }

/** Move the clock forward. Only inside the market section, and never past the close. */
export function interpretTick(state: GameState, cmd: unknown): ClockOutcome {
  if (state.section !== 'market') return { accepted: false, reason: 'marketClosed' }
  const record = (typeof cmd === 'object' && cmd !== null ? cmd : {}) as { steps?: unknown }
  const steps = record.steps === undefined ? 1 : record.steps
  if (typeof steps !== 'number' || !Number.isSafeInteger(steps) || steps < 1) {
    return { accepted: false, reason: 'stepsNotPositiveInteger' }
  }
  const from = state.session.clock
  if (from >= SESSION_STEPS) return { accepted: false, reason: 'sessionOver' }
  const to = Math.min(SESSION_STEPS, from + steps)
  state.session.clock = to
  return { accepted: true, event: { kind: 'clockStep', day: state.market.day, from, to, time: clockTime(to) } }
}
