// Short deterministic hash of a JSON state. FNV-1a 64-bit over UTF-16 code units.
// No node:crypto and no Math.random. Same engine, same state, same hash.

import type { MarketState } from './types.ts'

const FNV_OFFSET_64 = 14695981039346656037n
const FNV_PRIME_64 = 1099511628211n
const UINT64_MASK = 0xffffffffffffffffn

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

/** 16 hex characters. The input is `JSON.stringify(state)` in the state's own key order. */
export function stateHash(state: MarketState): string {
  if (typeof state !== 'object' || state === null) {
    throw new Error(`stateHash expected an object, received ${describeValue(state)}`)
  }
  const json = JSON.stringify(state)
  if (typeof json !== 'string') {
    throw new Error('stateHash could not serialize state')
  }
  let hash = FNV_OFFSET_64
  for (let i = 0; i < json.length; i += 1) {
    hash ^= BigInt(json.charCodeAt(i))
    hash = (hash * FNV_PRIME_64) & UINT64_MASK
  }
  return hash.toString(16).padStart(16, '0')
}
