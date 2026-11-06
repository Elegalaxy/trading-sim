import { useState } from 'react'
import { activeJob } from '../sim/jobs.ts'
import { tierOf } from '../sim/lifestyle.ts'
import { consumablePrice } from '../sim/stats.ts'
import type { ConsumableDefinition, GameState } from '../sim/types.ts'
import { PerkBadge, StatBadge } from './Badges.tsx'
import { debugLog } from './debug.ts'
import { formatUsd } from './money.ts'
import { dispatch } from './store.ts'

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
      <p className="card-note">
        Once per item per day, paid from cash, no part of the day used. A full night at home also restores you.
      </p>
      {steady ? <p className="card-note">Steady routine: stress recovery from food and drink is 10% higher.</p> : null}
      {game.consumables.length === 0 ? (
        <p>Nothing is for sale.</p>
      ) : (
        <ul className="item-list">
          {game.consumables.map((item) => {
            const used = game.stats.consumed.includes(item.id)
            const price = consumablePrice(game, item)
            const locked = item.requiresHome !== undefined && tierOf(game.lifestyle, 'home') < item.requiresHome
            const poor = !locked && game.accounts.cashCents < price
            const why = locked ? 'Needs a kitchen (Home tier 1).' : poor ? 'Cash is too low.' : used ? 'Already used today.' : undefined
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={used ? 'item-row item-used' : 'item-row'}
                  onClick={() => onBuy(item)}
                  disabled={used || locked || game.runEnd !== null || poor}
                  title={why}
                >
                  <span className="item-name">{item.name}</span>
                  <span className="badges">
                    {item.energy !== 0 ? <StatBadge kind="energy" value={item.energy} label="Now" /> : null}
                    {item.stress !== 0 ? <StatBadge kind="stress" value={item.stress} label="Now" /> : null}
                    {item.nextEnergy !== undefined && item.nextEnergy !== 0 ? (
                      <StatBadge kind="energy" value={item.nextEnergy} label="Morning" title="Next morning, when you end the day." />
                    ) : null}
                    {item.nextStress !== undefined && item.nextStress !== 0 ? (
                      <StatBadge kind="stress" value={item.nextStress} label="Morning" title="Next morning, when you end the day." />
                    ) : null}
                    {locked ? <PerkBadge text="Needs kitchen" title="Home tier 1 or more." /> : null}
                  </span>
                  <span className="item-price">{used ? 'Used' : price === 0 ? 'Free' : formatUsd(price, item.name)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {message !== null ? (
        <p className={tone === 'ok' ? 'trade-ok' : 'trade-alert'} role={tone === 'ok' ? 'status' : 'alert'}>
          {message}
        </p>
      ) : null}
    </section>
  )
}
