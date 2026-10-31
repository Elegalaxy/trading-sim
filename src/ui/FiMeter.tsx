import { FI_HOLD_DAYS } from '../sim/constants.ts'
import { lifestyleExpensesCents } from '../sim/lifestyle.ts'
import type { GameState } from '../sim/types.ts'
import { formatUsd } from './money.ts'

function cents(value: number, label: string): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer, received ${String(value)}`)
  }
  return String(value)
}

export function FiMeter({ game }: { game: GameState | null }) {
  if (game === null) {
    return (
      <section className="panel" aria-label="Financial independence">
        <h2>Financial independence</h2>
        <p>Start a game to see the FI window.</p>
      </section>
    )
  }

  const status = game.fi.status
  const windowDays = status?.windowDays ?? 0
  const passiveCents = status?.passiveCents ?? 0
  const expensesCents = status?.expensesCents ?? lifestyleExpensesCents(game.lifestyle)
  const streak = status?.streak ?? 0
  if (expensesCents <= 0) {
    throw new Error(`FI expenses must be > 0, received ${String(expensesCents)}`)
  }
  const width = passiveCents <= 0 ? 0 : Math.min(100, (passiveCents / expensesCents) * 100)
  const covered = status !== null && passiveCents >= expensesCents

  return (
    <section className={covered ? 'panel fi-covered' : 'panel'} aria-label="Financial independence">
      <h2>Financial independence</h2>
      <p>Window {cents(windowDays, 'FI window')} days.</p>
      <p>Passive income {formatUsd(passiveCents, 'passive income')}.</p>
      <p>Expenses {formatUsd(expensesCents, 'expenses')}.</p>
      <p>
        Hold {cents(streak, 'FI streak')} of {cents(FI_HOLD_DAYS, 'FI hold')}.
      </p>
      <div className="fi-track" aria-hidden="true">
        <div className="fi-fill" style={{ width: `${width}%` }} />
      </div>
    </section>
  )
}
