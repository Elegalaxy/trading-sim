import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

// Provisional cosmetic scale (plan section 2.4). Display only: no simulation calls.
// No blur and no delay at energy 40 or above. Maximum at energy 0.
// blur px = (40 - energy) * 2 / 40. delay ms = (40 - energy) * 400 / 40.
export const FX_CLEAR_AT_ENERGY = 40
export const FX_MAX_BLUR_PX = 2
export const FX_MAX_DELAY_MS = 400

export const SETTINGS_KEY = 'trading-sim.settings.v1'

export type VisualSettings = {
  reduceVisualEffects: boolean
}

export type CosmeticFx = {
  blurPx: number
  delayMs: number
  /** Energy is below the clear point. Stays on when visual effects are reduced. */
  tell: boolean
}

const DEFAULT_SETTINGS: VisualSettings = { reduceVisualEffects: false }
const IDLE_FX: CosmeticFx = { blurPx: 0, delayMs: 0, tell: false }

let settingsSnapshot: VisualSettings = DEFAULT_SETTINGS
let settingsLoaded = false
const settingsListeners = new Set<() => void>()

type DisplayHold = { signature: string; value: unknown }
const displayHolds = new Map<string, DisplayHold>()

function isVisualSettings(value: unknown): value is VisualSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'reduceVisualEffects') return false
  return typeof (value as { reduceVisualEffects: unknown }).reduceVisualEffects === 'boolean'
}

function readStoredSettings(): VisualSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw === null) return DEFAULT_SETTINGS
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.error('[fx] ignored settings', error)
      return DEFAULT_SETTINGS
    }
    if (!isVisualSettings(parsed)) {
      console.error(`[fx] ignored settings: unexpected shape ${raw.slice(0, 200)}`)
      return DEFAULT_SETTINGS
    }
    return { reduceVisualEffects: parsed.reduceVisualEffects }
  } catch (error) {
    console.error('[fx] ignored settings', error)
    return DEFAULT_SETTINGS
  }
}

function ensureSettings(): VisualSettings {
  if (!settingsLoaded) {
    settingsLoaded = true
    settingsSnapshot = readStoredSettings()
  }
  return settingsSnapshot
}

export function getVisualSettings(): VisualSettings {
  return ensureSettings()
}

export function subscribeVisualSettings(listener: () => void): () => void {
  settingsListeners.add(listener)
  return () => {
    settingsListeners.delete(listener)
  }
}

export function useVisualSettings(): VisualSettings {
  return useSyncExternalStore(subscribeVisualSettings, getVisualSettings, getVisualSettings)
}

export function setReduceVisualEffects(reduceVisualEffects: boolean): void {
  if (typeof reduceVisualEffects !== 'boolean') {
    console.error(`[fx] reduceVisualEffects must be a boolean, received ${String(reduceVisualEffects)}`)
    return
  }
  ensureSettings()
  settingsSnapshot = { reduceVisualEffects }
  try {
    if (typeof localStorage === 'undefined') {
      console.error('[fx] failed to store settings: localStorage is not available')
    } else {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsSnapshot))
    }
  } catch (error) {
    console.error('[fx] failed to store settings', error)
  }
  for (const listener of settingsListeners) listener()
}

export function cosmeticFx(energy: number, reduced: boolean): CosmeticFx {
  if (!Number.isSafeInteger(energy) || energy < 0 || energy > 100) {
    console.error(`[fx] energy must be an integer from 0 to 100, received ${String(energy)}`)
    return IDLE_FX
  }
  if (typeof reduced !== 'boolean') {
    console.error(`[fx] reduced must be a boolean, received ${String(reduced)}`)
    return IDLE_FX
  }
  const tell = energy < FX_CLEAR_AT_ENERGY
  if (reduced || !tell) return { blurPx: 0, delayMs: 0, tell }
  const drop = FX_CLEAR_AT_ENERGY - energy
  return {
    blurPx: (drop * FX_MAX_BLUR_PX) / FX_CLEAR_AT_ENERGY,
    delayMs: (drop * FX_MAX_DELAY_MS) / FX_CLEAR_AT_ENERGY,
    tell,
  }
}

export function formatBlurPx(blurPx: number): string {
  const hundredths = Math.round(blurPx * 100)
  const whole = Math.trunc(hundredths / 100)
  const frac = Math.abs(hundredths % 100)
  if (frac === 0) return String(whole)
  if (frac % 10 === 0) return `${whole}.${frac / 10}`
  return `${whole}.${String(frac).padStart(2, '0')}`
}

export function formatFxLine(energy: number, reduced: boolean): string {
  const fx = cosmeticFx(energy, reduced)
  return `energy=${energy} blur=${formatBlurPx(fx.blurPx)} delay=${fx.delayMs} reduced=${reduced}`
}

export function blurFilter(blurPx: number): string | undefined {
  if (!(blurPx > 0)) return undefined
  return `blur(${formatBlurPx(blurPx)}px)`
}

export function useCosmeticFx(energy: number | null): CosmeticFx {
  const reduced = useVisualSettings().reduceVisualEffects
  if (energy === null) return IDLE_FX
  return cosmeticFx(energy, reduced)
}

export function useDelayedValue<T>(channel: string, value: T, delayMs: number, signature: string): T {
  const valueRef = useRef(value)
  const [held, setHeld] = useState(() => {
    const saved = displayHolds.get(channel) as { signature: string; value: T } | undefined
    if (saved !== undefined && saved.signature !== signature && delayMs > 0) return saved
    return { signature, value }
  })
  const safeDelay = Number.isFinite(delayMs) && delayMs > 0 ? Math.round(delayMs) : 0

  useEffect(() => {
    valueRef.current = value
  })

  useEffect(() => {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      console.error(`[fx] delay must be a finite number >= 0, received ${String(delayMs)}`)
    }
    const next = { signature, value: valueRef.current }
    if (safeDelay === 0 || held.signature === signature) {
      displayHolds.set(channel, next)
      if (held.signature !== signature) setHeld(next)
      return
    }
    if (typeof window === 'undefined') {
      console.error('[fx] delay skipped: window is not available')
      displayHolds.set(channel, next)
      setHeld(next)
      return
    }
    const timer = window.setTimeout(() => {
      const shown = { signature, value: valueRef.current }
      displayHolds.set(channel, shown)
      setHeld(shown)
    }, safeDelay)
    return () => window.clearTimeout(timer)
  }, [channel, signature, safeDelay, delayMs, held.signature])

  if (safeDelay === 0) return value
  return held.value
}
