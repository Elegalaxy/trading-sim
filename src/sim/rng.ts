// Seeded sfc32 streams. A string seed is hashed to 32 bits (FNV-1a over
// UTF-16 code units) and expanded with splitmix32 into one sfc32 state per
// named stream. Draws mutate only the stream object they are given.

import { RNG_STREAM_NAMES, type RngState, type RngStream, type Weighted } from './types.ts'

const UINT32_MAX = 0xffffffff
const UINT32_MOD = 4294967296
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const SPLITMIX_INCREMENT = 0x9e3779b9
const SPLITMIX_MUL_1 = 0x21f0aaad
const SPLITMIX_MUL_2 = 0x735a2d97
const TWO_PI = Math.PI * 2

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'bigint') return `${value}n`
  if (value === undefined) return 'undefined'
  return String(value)
}

function assertUint32(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error(`${label} must be an unsigned 32-bit integer, received ${describeValue(value)}`)
  }
}

function assertStream(stream: RngStream): void {
  if (typeof stream !== 'object' || stream === null) {
    throw new Error(`rng stream must be an object, received ${describeValue(stream)}`)
  }
  assertUint32(stream.a, 'rng stream a')
  assertUint32(stream.b, 'rng stream b')
  assertUint32(stream.c, 'rng stream c')
  assertUint32(stream.d, 'rng stream d')
  if (stream.spare !== undefined && (typeof stream.spare !== 'number' || !Number.isFinite(stream.spare))) {
    throw new Error(
      `rng stream spare must be a finite number when present, received ${describeValue(stream.spare)}`,
    )
  }
}

/** FNV-1a, 32-bit, over UTF-16 code units. ASCII seeds match the byte hash. */
function hashSeed(seed: string): number {
  let hash = FNV_OFFSET
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

function splitmix32(state: number): { state: number; value: number } {
  const next = (state + SPLITMIX_INCREMENT) | 0
  let mixed = next ^ (next >>> 16)
  mixed = Math.imul(mixed, SPLITMIX_MUL_1)
  mixed = mixed ^ (mixed >>> 15)
  mixed = Math.imul(mixed, SPLITMIX_MUL_2)
  return { state: next, value: (mixed ^ (mixed >>> 15)) >>> 0 }
}

function takeStream(state: number): { state: number; stream: RngStream } {
  const a = splitmix32(state)
  const b = splitmix32(a.state)
  const c = splitmix32(b.state)
  const d = splitmix32(c.state)
  return {
    state: d.state,
    stream: { a: a.value, b: b.value, c: c.value, d: d.value },
  }
}

/** Build the four named streams from a string seed. */
export function createRng(seed: string): RngState {
  if (typeof seed !== 'string') {
    throw new Error(`seed must be a string, received ${describeValue(seed)}`)
  }
  let mixed = hashSeed(seed)
  const streams = {} as RngState
  for (const name of RNG_STREAM_NAMES) {
    const next = takeStream(mixed)
    mixed = next.state
    streams[name] = next.stream
  }
  return streams
}

/** Next unsigned 32-bit sfc32 output. Advances `stream`. */
function nextUint32(stream: RngStream): number {
  assertStream(stream)
  let a = stream.a | 0
  let b = stream.b | 0
  let c = stream.c | 0
  let d = stream.d | 0

  const t = (((a + b) | 0) + d) | 0
  d = (d + 1) | 0
  a = b ^ (b >>> 9)
  b = (c + (c << 3)) | 0
  c = (c << 21) | (c >>> 11)
  c = (c + t) | 0

  stream.a = a >>> 0
  stream.b = b >>> 0
  stream.c = c >>> 0
  stream.d = d >>> 0
  return t >>> 0
}

/** Next uniform value in [0, 1). Advances `stream` once. Does not read `spare`. */
export function nextFloat(stream: RngStream): number {
  return nextUint32(stream) / UINT32_MOD
}

/**
 * Integer in [min, max], both ends included.
 * Rejects values outside the unbiased 32-bit bucket so the remainder is uniform.
 * Advances `stream` at least once when the arguments are valid.
 */
export function nextInt(stream: RngStream, min: number, max: number): number {
  if (!Number.isSafeInteger(min)) {
    throw new Error(`nextInt min must be a safe integer, received ${describeValue(min)}`)
  }
  if (!Number.isSafeInteger(max)) {
    throw new Error(`nextInt max must be a safe integer, received ${describeValue(max)}`)
  }
  if (min > max) {
    throw new Error(`nextInt min must be <= max, received min=${describeValue(min)} max=${describeValue(max)}`)
  }
  const span = max - min + 1
  if (!Number.isSafeInteger(span) || span > UINT32_MOD) {
    throw new Error(
      `nextInt range must be a safe integer from 1 through ${UINT32_MOD}, received ${describeValue(span)}`,
    )
  }
  const limit = UINT32_MOD - (UINT32_MOD % span)
  let guard = 0
  let draw = nextUint32(stream)
  while (draw >= limit) {
    guard += 1
    if (guard > 64) throw new Error('nextInt could not draw an unbiased integer')
    draw = nextUint32(stream)
  }
  return min + (draw % span)
}

/**
 * Standard normal (mean 0, variance 1) via Box–Muller.
 * The second sample of the pair is stored on `stream.spare`, never in module state.
 * Consumes the stream's own uniforms. A cached spare is returned without a new draw.
 */
export function nextNormal(stream: RngStream): number {
  assertStream(stream)
  if (stream.spare !== undefined) {
    const spare = stream.spare
    delete stream.spare
    return spare
  }
  let u1 = nextFloat(stream)
  let guard = 0
  while (u1 === 0) {
    guard += 1
    if (guard > 64) throw new Error('nextNormal could not draw a non-zero uniform')
    u1 = nextFloat(stream)
  }
  const u2 = nextFloat(stream)
  const magnitude = Math.sqrt(-2 * Math.log(u1))
  const angle = TWO_PI * u2
  const spare = magnitude * Math.sin(angle)
  const value = magnitude * Math.cos(angle)
  if (!Number.isFinite(spare) || !Number.isFinite(value)) {
    throw new Error(
      `nextNormal produced a non-finite sample, received value=${describeValue(value)} spare=${describeValue(spare)}`,
    )
  }
  // JSON cannot tell -0 from 0, so store a positive zero. The copied spare then matches.
  stream.spare = spare === 0 ? 0 : spare
  return value
}

/**
 * Pick an entry by weight. One uniform draw when the weights are valid.
 * A zero weight is never chosen. Invalid weights throw before the draw.
 */
export function pickWeighted<T>(stream: RngStream, entries: readonly Weighted<T>[]): T {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`pickWeighted entries must be a non-empty array, received ${describeValue(entries)}`)
  }
  let total = 0
  for (let i = 0; i < entries.length; i += 1) {
    const entry: unknown = entries[i]
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`pickWeighted entries[${i}] must be an object, received ${describeValue(entry)}`)
    }
    const weight = (entry as { weight?: unknown }).weight
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new Error(
        `pickWeighted weight must be a finite number >= 0, received ${describeValue(weight)} at index ${i}`,
      )
    }
    total += weight
  }
  if (!(total > 0)) {
    throw new Error('pickWeighted weights must sum to a number > 0')
  }
  const roll = nextFloat(stream) * total
  let cursor = 0
  for (let i = 0; i < entries.length; i += 1) {
    cursor += entries[i].weight
    if (roll < cursor) return entries[i].value
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].weight > 0) return entries[i].value
  }
  throw new Error('pickWeighted failed to select an entry')
}
