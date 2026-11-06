import { useState } from 'react'
import { activeJob } from '../sim/jobs.ts'
import { tierOf } from '../sim/lifestyle.ts'
import { consumablePrice } from '../sim/stats.ts'
import type { ConsumableDefinition, GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { formatUsd } from './money.ts'
import { dispatch } from './store.ts'

function amounts(energy: number, stress: number): string {
  const parts: string[] = []
  if (energy !== 0) parts.push(`${energy > 0 ? '+' : ''}${energy} energy`)
  if (stress !== 0) parts.push(`${stress > 0 ? '+' : ''}${stress} stress`)
  return parts.join(', ')
}

function effectText(item: ConsumableDefinition): string {
  const now = amounts(item.energy, item.stress)
  const next = amounts(item.nextEnergy ?? 0, item.nextStress ?? 0)
  const parts = [now.length === 0 ? 'No change now' : `Now ${now}`]
  if (next.length > 0) parts.push(`next morning ${next}`)
  return parts.join('; ')
}

function reasonText(reason: string): string {
  if (reason === 'insufficientFunds') return 'Not enough cash.'
  if (reason === 'alreadyConsumed') return 'Already used today.'
  if (reason === 'needsKitchen') return 'You need a kitchen: upgrade Home to tier 1.'
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
      <p>Once per item per day. Paid from cash. Does not take a section of the day. A night at home also restores you; a better Home restores more.</p>
      {steady ? <p>Steady routine: stress recovery from food and drink is 10% higher.</p> : null}
      {game.consumables.length === 0 ? (
        <p>Nothing is for sale.</p>
      ) : (
        <ul className="consumable-list">
          {game.consumables.map((item) => {
            const used = game.stats.consumed.includes(item.id)
            const price = consumablePrice(game, item)
            const locked = item.requiresHome !== undefined && tierOf(game.lifestyle, 'home') < item.requiresHome
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onBuy(item)}
                  disabled={used || locked || game.runEnd !== null || game.accounts.cashCents < price}
                  title={locked ? 'Needs a kitchen (Home tier 1).' : undefined}
                >
                  {used ? `${item.name} (used today)` : item.name}
                </button>
                <span>
                  {price === 0 ? 'Free (Health membership)' : formatUsd(price, item.name)}. {effectText(item)}.
                  {locked ? ' Needs a kitchen (Home tier 1).' : ''}
                  {!locked && game.accounts.cashCents < price ? ' Cash is too low.' : ''}
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
