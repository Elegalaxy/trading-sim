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
