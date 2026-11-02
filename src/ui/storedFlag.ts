import { useState } from 'react'

// A true/false layout choice kept in localStorage. Storage can be missing or blocked, so every
// access is guarded and the default is used when it fails.

const KEY_PREFIX = 'trading-sim.layout.'

export function useStoredFlag(id: string, initial: boolean): [boolean, (next: boolean) => void] {
  const [flag, setFlag] = useState(() => {
    try {
      const stored = window.localStorage.getItem(KEY_PREFIX + id)
      if (stored === '1') return true
      if (stored === '0') return false
    } catch {
      // Storage is unavailable: use the default.
    }
    return initial
  })
  function set(next: boolean): void {
    setFlag(next)
    try {
      window.localStorage.setItem(KEY_PREFIX + id, next ? '1' : '0')
    } catch {
      // Not remembered.
    }
  }
  return [flag, set]
}

/** A number layout choice (a column width) kept in localStorage, clamped to [min, max]. */
export function useStoredNumber(id: string, initial: number, min: number, max: number): [number, (next: number) => void] {
  const clamp = (value: number): number => Math.min(max, Math.max(min, Math.round(value)))
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(KEY_PREFIX + id)
      if (stored !== null) {
        const parsed = Number(stored)
        if (Number.isFinite(parsed)) return clamp(parsed)
      }
    } catch {
      // Storage is unavailable: use the default.
    }
    return clamp(initial)
  })
  function set(next: number): void {
    const clamped = clamp(next)
    setValue(clamped)
    try {
      window.localStorage.setItem(KEY_PREFIX + id, String(clamped))
    } catch {
      // Not remembered.
    }
  }
  return [value, set]
}
