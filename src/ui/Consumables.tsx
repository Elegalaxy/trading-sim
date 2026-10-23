import { useState } from 'react'
import { activeJob } from '../sim/jobs.ts'
import type { ConsumableDefinition, GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { dispatch } from './store.ts'

function effectText(item: ConsumableDefinition): string {
  const parts: string[] = []
  if (item.energy !== 0) parts.push(`${item.energy > 0 ? '+' : ''}${item.energy} energy`)
  if (item.stress !== 0) parts.push(`${item.stress > 0 ? '+' : ''}${item.stress} stress`)
  if (parts.length === 0) return 'No stat change'
  return parts.join(', ')
}

function reasonText(reason: string): string {
  if (reason === 'insufficientFunds') return 'Not enough cash.'
  if (reason === 'alreadyConsumed') return 'Already used today.'
  if (reason === 'unknownItem') return 'That item is not for sale.'
  if (reason === 'runEnded') return 'The run has ended.'
  if (reason === 'notStarted') return 'Start a game first.'
  return reason
}

export function Consumables({ game }: { game: GameState | null }) {
  const day = game?.market.day ?? -1
  const [message, setMessage] = useState<string | null>(null)
  const [tone, setTone] = useState<'ok' | 'alert'>('alert')
  const [trackedDay, setTrackedDay] = useState(day)
  if (trackedDay !== day) {
    setTrackedDay(day)
    setMessage(null)
  }

  if (game === null) {
    return (
      <section className="panel" aria-label="Food and drink">
        <h2>Food and drink</h2>
        <p>Start a game to buy food and drink.</p>
      </section>
    )
  }

  const steady = activeJob(game.job).perk === 'steadyRoutine'

  function onBuy(item: ConsumableDefinition): void {
    debugLog('[ui]', `consume ${item.id}`)
    const outcome = dispatch({ type: 'consume', item: item.id })
    if (outcome.accepted) {
      setTone('ok')
      setMessage(`${item.name} bought.`)
      return
    }
    const reason = outcome.reason ?? 'rejected'
    console.error(`[ui] rejected consume ${item.id}: ${reason}`)
    setTone('alert')
    setMessage(reasonText(reason))
  }

  return (
    <section className="panel" aria-label="Food and drink">
      <h2>Food and drink</h2>
      <p>Once per item per day. Paid from cash. Does not take a section of the day.</p>
      {steady ? <p>Steady routine: stress recovery from food and drink is 10% higher.</p> : null}
      {game.consumables.length === 0 ? (
        <p>Nothing is for sale.</p>
      ) : (
        <ul className="consumable-list">
          {game.consumables.map((item) => {
            const used = game.stats.consumed.includes(item.id)
            return (
              <li key={item.id}>
                <button type="button" onClick={() => onBuy(item)}>
                  {used ? `${item.name} (used today)` : item.name}
                </button>
                <span>
                  {item.costCents} cents. {effectText(item)}.
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {message !== null ? <p role={tone === 'alert' ? 'alert' : undefined}>{message}</p> : null}
    </section>
  )
}
