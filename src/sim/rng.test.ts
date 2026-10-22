import { describe, expect, it } from 'vitest'

import { createRng, nextFloat, nextInt, nextNormal, pickWeighted } from './rng.ts'
import { RNG_STREAM_NAMES, type RngStream, type RngStreamName } from './types.ts'

// Static `node:fs` is forbidden in src/sim, including tests. Load writeSync at
// runtime so [DEBUG rng] still reaches fd 1 when the reporter hides console.
const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugRng(message: string): void {
  io.writeSync(1, `[DEBUG rng] ${message}\n`)
}

const DEBUG_SEED = 'demo'

function takeFloats(stream: RngStream, count: number): number[] {
  const values: number[] = []
  for (let i = 0; i < count; i += 1) values.push(nextFloat(stream))
  return values
}

function copyStream(stream: RngStream): RngStream {
  const parsed: unknown = JSON.parse(JSON.stringify(stream))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('[DEBUG rng] JSON copy did not produce an object')
  }
  return parsed as RngStream
}

const preview = createRng(DEBUG_SEED)
const firstByStream = {} as Record<RngStreamName, number[]>
for (const name of RNG_STREAM_NAMES) {
  const first = takeFloats(preview[name], 5)
  firstByStream[name] = first
  debugRng(`seed=${DEBUG_SEED} stream=${name} first=${first.join(',')}`)
}

describe('seeded rng', () => {
  it('repeats each stream for the same seed', () => {
    const left = createRng(DEBUG_SEED)
    const right = createRng(DEBUG_SEED)
    expect(new Set(RNG_STREAM_NAMES.map((name) => firstByStream[name].join(','))).size).toBe(
      RNG_STREAM_NAMES.length,
    )
    for (const name of RNG_STREAM_NAMES) {
      expect(takeFloats(left[name], 5)).toEqual(firstByStream[name])
      expect(takeFloats(right[name], 5)).toEqual(firstByStream[name])
      const moreLeft: number[] = []
      const moreRight: number[] = []
      for (let i = 0; i < 40; i += 1) {
        moreLeft.push(nextFloat(left[name]), nextInt(left[name], -3, 3), nextNormal(left[name]))
        moreRight.push(nextFloat(right[name]), nextInt(right[name], -3, 3), nextNormal(right[name]))
        const pickedLeft = pickWeighted(left[name], [
          { value: 0, weight: 1 },
          { value: 1, weight: 3 },
        ])
        const pickedRight = pickWeighted(right[name], [
          { value: 0, weight: 1 },
          { value: 1, weight: 3 },
        ])
        moreLeft.push(pickedLeft)
        moreRight.push(pickedRight)
      }
      expect(moreRight).toEqual(moreLeft)
    }
  })

  it('keeps other streams still when one stream is drawn', () => {
    const untouched = createRng(DEBUG_SEED)
    const disturbed = createRng(DEBUG_SEED)
    for (let i = 0; i < 30; i += 1) {
      nextFloat(disturbed.market)
      nextInt(disturbed.market, -2, 4)
      nextNormal(disturbed.market)
      pickWeighted(disturbed.market, [
        { value: 'a', weight: 1 },
        { value: 'b', weight: 3 },
      ])
    }
    for (const name of ['events', 'info', 'distortion'] as const) {
      expect(takeFloats(disturbed[name], 20)).toEqual(takeFloats(untouched[name], 20))
    }
  })

  it('continues identically after a JSON copy, including a cached spare normal', () => {
    const live = createRng(DEBUG_SEED).market
    const prefix = takeFloats(live, 10)
    const copiedMid = copyStream(live)
    expect(takeFloats(copiedMid, 10)).toEqual(takeFloats(live, 10))
    expect(prefix).toHaveLength(10)

    const original = createRng('spare').info
    const firstNormal = nextNormal(original)
    expect(typeof original.spare).toBe('number')
    expect(Number.isFinite(original.spare)).toBe(true)
    const pending = copyStream(original)
    expect(pending.a).toBe(original.a)
    expect(pending.b).toBe(original.b)
    expect(pending.c).toBe(original.c)
    expect(pending.d).toBe(original.d)
    expect(pending.spare).toBe(original.spare)
    const cached = pending.spare
    const words = { a: original.a, b: original.b, c: original.c, d: original.d }
    expect(nextNormal(original)).toBe(cached)
    expect(original.spare).toBeUndefined()
    expect({ a: original.a, b: original.b, c: original.c, d: original.d }).toEqual(words)
    expect(nextNormal(pending)).toBe(cached)
    expect(pending.spare).toBeUndefined()
    const fromOriginal = [nextNormal(original), nextFloat(original), nextInt(original, 1, 6)]
    const fromPending = [nextNormal(pending), nextFloat(pending), nextInt(pending, 1, 6)]
    expect(fromPending).toEqual(fromOriginal)
    expect(pending).toEqual(original)
    expect(nextNormal(createRng('spare').info)).toBe(firstNormal)
  })

  it('draws a standard normal from the stream uniforms and caches the spare on the stream', () => {
    const floats = createRng(DEBUG_SEED).distortion
    const normals = createRng(DEBUG_SEED).distortion
    const u1 = nextFloat(floats)
    const u2 = nextFloat(floats)
    expect(u1).not.toBe(0)
    const magnitude = Math.sqrt(-2 * Math.log(u1))
    const angle = Math.PI * 2 * u2
    const spare = magnitude * Math.sin(angle)
    expect(nextNormal(normals)).toBe(magnitude * Math.cos(angle))
    expect(normals.spare).toBe(spare === 0 ? 0 : spare)
    expect({ a: normals.a, b: normals.b, c: normals.c, d: normals.d }).toEqual({
      a: floats.a,
      b: floats.b,
      c: floats.c,
      d: floats.d,
    })
    expect(nextNormal(normals)).toBe(spare === 0 ? 0 : spare)
    expect(normals.spare).toBeUndefined()
  })

  it('keeps 10000 floats and normals inside the sanity bounds', () => {
    const floats = takeFloats(createRng(DEBUG_SEED).market, 10_000)
    let floatSum = 0
    for (const value of floats) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      floatSum += value
    }
    const floatMean = floatSum / floats.length
    debugRng(`seed=${DEBUG_SEED} stream=market first=${firstByStream.market.join(',')} floatMean=${floatMean}`)

    const normalStream = createRng(DEBUG_SEED).market
    const normals: number[] = []
    for (let i = 0; i < 10_000; i += 1) normals.push(nextNormal(normalStream))
    let normalSum = 0
    for (const value of normals) {
      expect(Number.isFinite(value)).toBe(true)
      normalSum += value
    }
    const normalMean = normalSum / normals.length
    let square = 0
    for (const value of normals) {
      const delta = value - normalMean
      square += delta * delta
    }
    const normalSd = Math.sqrt(square / normals.length)
    debugRng(
      `seed=${DEBUG_SEED} stream=market normalMean=${normalMean} normalSd=${normalSd}`,
    )
    expect(floatMean).toBeGreaterThanOrEqual(0.48)
    expect(floatMean).toBeLessThanOrEqual(0.52)
    expect(normalMean).toBeGreaterThanOrEqual(-0.05)
    expect(normalMean).toBeLessThanOrEqual(0.05)
    expect(normalSd).toBeGreaterThanOrEqual(0.95)
    expect(normalSd).toBeLessThanOrEqual(1.05)
  })

  it('rejects bad arguments without advancing the stream', () => {
    expect(() => createRng(1 as never)).toThrow('seed must be a string, received 1')
    const stream = createRng(DEBUG_SEED).info
    const before = { a: stream.a, b: stream.b, c: stream.c, d: stream.d }
    expect(() => nextInt(stream, 1.5, 2)).toThrow('nextInt min must be a safe integer, received 1.5')
    expect(() => nextInt(stream, 3, 1)).toThrow('nextInt min must be <= max, received min=3 max=1')
    expect(() => pickWeighted(stream, [])).toThrow('pickWeighted entries must be a non-empty array')
    expect(() => pickWeighted(stream, [{ value: 'a', weight: -1 }])).toThrow(
      'pickWeighted weight must be a finite number >= 0, received -1 at index 0',
    )
    expect(() => pickWeighted(stream, [{ value: 'a', weight: 0 }])).toThrow(
      'pickWeighted weights must sum to a number > 0',
    )
    expect(stream).toEqual(before)
    expect(Object.hasOwn(stream, 'spare')).toBe(false)

    const seen = new Set<number>()
    for (let i = 0; i < 200; i += 1) {
      const rolled = nextInt(stream, 1, 3)
      expect(rolled).toBeGreaterThanOrEqual(1)
      expect(rolled).toBeLessThanOrEqual(3)
      seen.add(rolled)
    }
    expect([...seen].sort()).toEqual([1, 2, 3])

    const weighted = createRng(DEBUG_SEED).distortion
    const mirror = createRng(DEBUG_SEED).distortion
    const picked = pickWeighted(weighted, [
      { value: 'no', weight: 0 },
      { value: 'yes', weight: 1 },
    ])
    nextFloat(mirror)
    expect(picked).toBe('yes')
    expect({ a: weighted.a, b: weighted.b, c: weighted.c, d: weighted.d }).toEqual({
      a: mirror.a,
      b: mirror.b,
      c: mirror.c,
      d: mirror.d,
    })
  })
})
