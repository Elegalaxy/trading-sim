// RNG stream names, in splitmix32 expansion order. Do not reorder: the sequence
// for a seed depends on this order.
export const RNG_STREAM_NAMES = ['market', 'events', 'info', 'distortion'] as const

export type RngStreamName = (typeof RNG_STREAM_NAMES)[number]

/**
 * One named random stream.
 *
 * `a`, `b`, `c`, and `d` are the sfc32 state: four unsigned 32-bit integers.
 * They are always present so the generator state stays explicit in JSON.
 *
 * `spare` is the unused second sample from a Box–Muller pair. It is absent
 * until `nextNormal` generates a pair and returns only the first. It is removed
 * when that cached sample is returned. A finite number survives
 * `JSON.parse(JSON.stringify(stream))`; a missing spare is omitted, which
 * restores "no cached sample".
 */
export type RngStream = {
  a: number
  b: number
  c: number
  d: number
  spare?: number
}

/** The four named streams for one run. Plain JSON, no hidden generator. */
export type RngState = {
  market: RngStream
  events: RngStream
  info: RngStream
  distortion: RngStream
}

/** One choice for `pickWeighted`. `weight` must be finite and >= 0. */
export type Weighted<T> = {
  value: T
  weight: number
}

/** Sector A is growth-sensitive. Sector B is rate-sensitive. The index has none. */
export type SectorId = 'A' | 'B'

export type AssetKind = 'stock' | 'index'

/**
 * One tradable instrument. Passed into the simulation; `src/sim` does not import content.
 * Prices and fair value are in cents. `dailyVolatility` is the one-day return standard deviation
 * (0.022 means 2.2%). Stock order is the order `stepMarketDay` draws market-stream noise.
 */
export type AssetDefinition = {
  id: string
  kind: AssetKind
  sector: SectorId | null
  startPriceCents: number
  dailyVolatility: number
}

export type MarketDefinitions = {
  assets: readonly AssetDefinition[]
}

/** Price in integer cents. Fair value is cents as a float. */
export type AssetState = {
  id: string
  priceCents: number
  fairValue: number
}

export type NoiseRollEvent = {
  kind: 'noiseRoll'
  day: number
  asset: string
  z: number
}

export type PriceStepEvent = {
  kind: 'priceStep'
  day: number
  asset: string
  previous: number
  fair: number
  pull: number
  noise: number
  rawMove: number
  cappedMove: number
  capped: boolean
  newPrice: number
  gapAfter: number
}

export type IndexStepEvent = {
  kind: 'indexStep'
  day: number
  asset: string
  previous: number
  quote: number
  rawMove: number
  cappedMove: number
  capped: boolean
  newPrice: number
  gapAfter: number
}

export type LogEvent = NoiseRollEvent | PriceStepEvent | IndexStepEvent

/**
 * Seeded market. `day` is 0 before the first step.
 * `log` is only the latest day's events; the next step replaces it.
 * Stock `fairValue` is hidden and is not moved by the price step.
 * The index `fairValue` is the uncapped index quote in cents (float).
 */
export type MarketState = {
  day: number
  streams: RngState
  assets: Record<string, AssetState>
  log: LogEvent[]
}
