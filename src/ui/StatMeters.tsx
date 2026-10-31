import { useEffect } from 'react'
import { ENERGY_WARNING_BELOW, STRESS_WARNING_ABOVE } from '../sim/stats.ts'
import type { GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { formatFxLine, useVisualSettings } from './effects.ts'
import { Settings } from './Settings.tsx'

function assertStat(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be an integer from 0 to 100, received ${String(value)}`)
  }
  return value
}

function Meter({
  label,
  value,
  warning,
  hint,
}: {
  label: string
  value: number
  warning: boolean
  hint: string
}) {
  return (
    <div className={warning ? 'stat-meter stat-warning' : 'stat-meter'} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <p>
        {label} {value}
        {warning ? ` ${hint}` : ''}
      </p>
      <div className="stat-track" aria-hidden="true">
        <div className="stat-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

export function StatMeters({ game, compact = false }: { game: GameState | null; compact?: boolean }) {
  const energy = game === null ? null : assertStat(game.stats.energy, 'energy')
  const stress = game === null ? null : assertStat(game.stats.stress, 'stress')
  const energyWarning = energy !== null && energy < ENERGY_WARNING_BELOW
  const stressWarning = stress !== null && stress > STRESS_WARNING_ABOVE
  const signature = game === null ? 'none' : `energy=${energy} stress=${stress} energyWarning=${energyWarning} stressWarning=${stressWarning}`

  const reduced = useVisualSettings().reduceVisualEffects
  const fxLine = energy === null ? null : formatFxLine(energy, reduced)

  useEffect(() => {
    debugLog('[ui]', `stats ${signature}`)
  }, [signature])

  useEffect(() => {
    if (fxLine === null) return
    debugLog('[fx]', fxLine)
  }, [fxLine])

  return (
    <div className={compact ? 'stats-compact' : undefined}>
      <section className="panel" aria-label="Energy and stress">
        {compact ? null : <h2>Energy and stress</h2>}
        {energy === null || stress === null ? (
          <p>Start a game to see energy and stress.</p>
        ) : (
          <>
            <Meter label="Energy" value={energy} warning={energyWarning} hint="(low)" />
            <Meter label="Stress" value={stress} warning={stressWarning} hint="(high)" />
          </>
        )}
      </section>
      <Settings />
    </div>
  )
}
