import { useEffect, useState, useSyncExternalStore } from 'react'
import type { GameState } from '../sim/types.ts'
import { blurFilter, useCosmeticFx, useVisualSettings } from './effects.ts'
import { buildTicker, clampIndex, stepIndex, TICKER_INTERVAL_MS, type TickerItem, type TickerTarget } from './ticker.ts'

// A one-line headline ticker under the top bar. It shows one headline at a time and rotates by
// itself unless the pointer or keyboard focus is inside it, the player paused it, or motion is
// reduced (the OS setting or the app's "Reduce visual effects"): then only prev/next move it.
// Market headlines carry the same stress/energy distortion and blur as the News panel.

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeMotion(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(REDUCED_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

function osReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches
}

export function Ticker({ game, onOpen }: { game: GameState | null; onOpen: (target: TickerTarget) => void }) {
  const items = buildTicker(game)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const osReduced = useSyncExternalStore(subscribeMotion, osReducedMotion, () => false)
  const reduced = useVisualSettings().reduceVisualEffects || osReduced
  const fx = useCosmeticFx(game?.stats.energy ?? null, game?.lifestyle.equipment ?? 0)
  const count = items.length
  const at = clampIndex(index, count)
  const current: TickerItem | undefined = items[at]
  const auto = !paused && !hovered && !focused && !reduced && count > 1

  // The timer restarts on every change of headline, so a manual step gets the full interval.
  useEffect(() => {
    if (!auto) return
    const timer = window.setTimeout(() => setIndex((value) => stepIndex(clampIndex(value, count), count, 1)), TICKER_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [auto, at, count])

  const filter = current?.source === 'news' ? blurFilter(fx.blurPx) : undefined
  const tone = current?.tone === 'confirmed' ? ' ticker-confirmed' : current?.tone === 'rumour' ? ' ticker-rumour' : ''
  const state = reduced ? 'Auto-rotation is off while motion is reduced' : paused ? 'Paused' : 'Rotating'

  return (
    <section
      className={`ticker${tone}`}
      aria-label="Headline ticker"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      {current === undefined ? (
        <span className="ticker-empty">No headlines today</span>
      ) : (
        <button
          type="button"
          className="ticker-headline"
          title={`${current.label}: ${current.text}`}
          aria-label={`${current.label}: ${current.text}. Open.`}
          onClick={() => onOpen(current.target)}
        >
          <span className="ticker-chip">{current.label}</span>
          <span
            key={current.id}
            className={reduced ? 'ticker-text' : 'ticker-text ticker-text-in'}
            aria-live="off"
            style={filter === undefined ? undefined : { filter }}
          >
            {current.text}
          </span>
        </button>
      )}
      <span className="ticker-controls">
        <span className="ticker-count" title={state}>
          {count === 0 ? '0/0' : `${at + 1}/${count}`}
        </span>
        <button type="button" aria-label="Previous headline" title="Previous headline" disabled={count < 2} onClick={() => setIndex(stepIndex(at, count, -1))}>
          ‹
        </button>
        <button type="button" aria-label="Next headline" title="Next headline" disabled={count < 2} onClick={() => setIndex(stepIndex(at, count, 1))}>
          ›
        </button>
        <button
          type="button"
          aria-label={paused ? 'Resume rotation' : 'Pause rotation'}
          aria-pressed={paused}
          title={reduced ? state : paused ? 'Resume rotation' : 'Pause rotation'}
          disabled={reduced || count < 2}
          onClick={() => setPaused(!paused)}
        >
          {paused ? '▶' : '❚❚'}
        </button>
      </span>
      <ul className="sr-only" aria-label="All headlines">
        {items.map((item) => (
          <li key={item.id}>{`${item.label}: ${item.text}`}</li>
        ))}
      </ul>
    </section>
  )
}
