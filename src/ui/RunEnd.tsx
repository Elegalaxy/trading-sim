import type { GameState, RunOutcome } from '../sim/types.ts'

function whole(value: number, label: string): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer, received ${String(value)}`)
  }
  return String(value)
}

function outcomeTitle(outcome: RunOutcome): string {
  if (outcome === 'won') return 'Won'
  if (outcome === 'lost') return 'Lost'
  if (outcome === 'finished') return 'Finished'
  const unknown: never = outcome
  throw new Error(`run outcome is invalid, received ${String(unknown)}`)
}

function reasonText(reason: string): string {
  if (reason === 'financialIndependence') return 'Passive income covered expenses for 5 days.'
  if (reason === 'cannotCoverBill') return 'You cannot cover the bill.'
  if (reason === 'day120') return 'The run reached day 120.'
  return reason
}

export function RunEnd({ seed, game }: { seed: string; game: GameState }) {
  const end = game.runEnd
  if (end === null) return null
  if (typeof seed !== 'string' || seed.length === 0 || /[\r\n]/.test(seed)) {
    throw new Error(`run end seed must be one non-empty line, received ${JSON.stringify(seed)}`)
  }
  const tone = end.outcome === 'won' ? 'run-won' : end.outcome === 'lost' ? 'run-lost' : 'run-finished'

  return (
    <section className={`panel run-end ${tone}`} role="alert" aria-label="Run ended">
      <h2>{outcomeTitle(end.outcome)}</h2>
      <p>Outcome {end.outcome}.</p>
      <p>
        Reason {end.reason}. {reasonText(end.reason)}
      </p>
      <p>Day {whole(end.day, 'run end day')}.</p>
      <p>Net worth {whole(end.netWorthCents, 'net worth')} cents.</p>
      <p>Score {whole(end.score, 'score')}.</p>
      <p>Seed {seed}.</p>
    </section>
  )
}
