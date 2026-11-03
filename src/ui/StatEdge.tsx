// Screen-edge effect for the stat warning states. Display only: no simulation calls.
// Stress above the warning mark draws a red glow around the window that pulses faster
// as stress rises. Energy below its mark darkens the corners. Both scale linearly
// from the mark (level 0) to the extreme (level 1). This is the telegraph for
// stress-bent news now that bent items carry no mark (GAME_DESIGN section 9).
// "Reduce visual effects" keeps the edge but stops the pulse.

import { useEffect, type CSSProperties } from 'react'
import { debugLog } from './debug.ts'
import { energyLevel, stressLevel, useVisualSettings } from './effects.ts'

function levelStyle(level: number): CSSProperties {
  return { '--level': level.toFixed(3) } as CSSProperties
}

export function StatEdge({ energy, stress }: { energy: number; stress: number }) {
  const reduced = useVisualSettings().reduceVisualEffects
  const stressed = stressLevel(stress)
  const tired = energyLevel(energy)
  const line = `edge stress=${stress} level=${stressed?.toFixed(2) ?? 'off'} energy=${energy} level=${tired?.toFixed(2) ?? 'off'} reduced=${reduced}`

  useEffect(() => {
    debugLog('[fx]', line)
  }, [line])

  return (
    <>
      {tired === null ? null : <div className="stat-edge stat-edge-energy" style={levelStyle(tired)} aria-hidden="true" />}
      {stressed === null ? null : (
        <div
          className={reduced ? 'stat-edge stat-edge-stress stat-edge-still' : 'stat-edge stat-edge-stress'}
          style={levelStyle(stressed)}
          aria-hidden="true"
        />
      )}
    </>
  )
}
