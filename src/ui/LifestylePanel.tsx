import { useState } from 'react'
import { COURSE_OFFERS, LIFESTYLE_OFFERS } from '../content/lifestyle.ts'
import { lifestyleExpensesCents, projectedBillCents, upfrontCents } from '../sim/lifestyle.ts'
import type { GameState, LifestyleCategory } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { dispatch } from './store.ts'

function reasonText(reason: string): string {
  if (reason === 'insufficientFunds') return 'Not enough cash.'
  if (reason === 'alreadyAtTier') return 'That tier is already set.'
  if (reason === 'alreadyOwned') return 'You already own that course.'
  if (reason === 'invalidTier') return 'That tier is not available.'
  if (reason === 'unknownCategory') return 'That lifestyle category is unknown.'
  if (reason === 'unknownCourse') return 'That course is not for sale.'
  if (reason === 'runEnded') return 'The run has ended.'
  if (reason === 'notStarted') return 'Start a game first.'
  return reason
}

export function LifestylePanel({ game }: { game: GameState | null }) {
  const [message, setMessage] = useState<string | null>(null)
  const [tone, setTone] = useState<'ok' | 'alert'>('alert')

  if (game === null) {
    return (
      <section className="panel" aria-label="Lifestyle">
        <h2>Lifestyle</h2>
        <p>Start a game to change lifestyle.</p>
      </section>
    )
  }

  const current = game
  const ended = current.runEnd !== null
  const expenses = lifestyleExpensesCents(current.lifestyle)
  const nextBill = projectedBillCents(current)

  function onTier(category: LifestyleCategory, tier: number): void {
    debugLog('[ui]', `lifestyle ${category} ${tier}`)
    const outcome = dispatch({ type: 'setLifestyle', category, tier })
    if (outcome.accepted) {
      const event = [...current.pending].reverse().find((entry) => entry.kind === 'lifestyleChange')
      if (event === undefined || event.kind !== 'lifestyleChange') {
        console.error('[ui] lifestyle accepted without a lifestyleChange event')
        setTone('alert')
        setMessage('The change was not logged.')
        return
      }
      const offer = LIFESTYLE_OFFERS.find((item) => item.id === event.category)
      const paid = event.upfront === 0 ? 'No refund.' : `Paid ${event.upfront} cents.`
      setTone('ok')
      setMessage(`${offer?.name ?? event.category} is tier ${event.to}. ${paid} Monthly expenses ${event.expensesCents} cents.`)
      return
    }
    const reason = outcome.reason ?? 'rejected'
    console.error(`[ui] rejected lifestyle ${category} ${tier}: ${reason}`)
    setTone('alert')
    setMessage(reasonText(reason))
  }

  function onCourse(course: string): void {
    debugLog('[ui]', `lifestyle course ${course}`)
    const outcome = dispatch({ type: 'buyCourse', course })
    if (outcome.accepted) {
      const event = [...current.pending].reverse().find((entry) => entry.kind === 'coursePurchased')
      if (event === undefined || event.kind !== 'coursePurchased') {
        console.error('[ui] course accepted without a coursePurchased event')
        setTone('alert')
        setMessage('The purchase was not logged.')
        return
      }
      const offer = COURSE_OFFERS.find((item) => item.id === event.course)
      setTone('ok')
      setMessage(`${offer?.name ?? event.course} bought for ${event.cost} cents. The monthly bill did not change.`)
      return
    }
    const reason = outcome.reason ?? 'rejected'
    console.error(`[ui] rejected course ${course}: ${reason}`)
    setTone('alert')
    setMessage(reasonText(reason))
  }

  return (
    <section className="panel" aria-label="Lifestyle">
      <h2>Lifestyle</h2>
      <p>Cash {current.accounts.cashCents} cents.</p>
      <p>
        Monthly expenses {expenses} cents. Next bill {nextBill} cents.
      </p>
      {current.bill !== null ? (
        <p>
          Bill due now: {current.bill.amountCents} cents. Changing lifestyle does not change it.
        </p>
      ) : null}
      <ul className="lifestyle-list">
        {LIFESTYLE_OFFERS.map((offer) => {
          const tierNow = current.lifestyle[offer.id]
          return (
            <li key={offer.id}>
              <p>
                {offer.name} tier {tierNow}. {offer.note}
              </p>
              {Array.from({ length: offer.maxTier + 1 }, (_, tier) => {
                const upfront = upfrontCents(offer.id, tierNow, tier)
                const label =
                  tier === tierNow ? `Tier ${tier} (current)` : upfront === 0 ? `Tier ${tier} (no refund)` : `Tier ${tier} (pay ${upfront})`
                return (
                  <button key={tier} type="button" disabled={ended || tier === tierNow} onClick={() => onTier(offer.id, tier)}>
                    {label}
                  </button>
                )
              })}
            </li>
          )
        })}
      </ul>
      <ul className="lifestyle-list">
        {COURSE_OFFERS.map((offer) => {
          const owned = current.job.courses.includes(offer.id)
          return (
            <li key={offer.id}>
              <button type="button" disabled={ended || owned} onClick={() => onCourse(offer.id)}>
                {owned ? `${offer.name} (owned)` : `Buy ${offer.name}`}
              </button>
              <span>
                {offer.costCents} cents. Unlocks {offer.unlocks}. No monthly cost.
              </span>
            </li>
          )
        })}
      </ul>
      {message !== null ? (
        <p className={tone === 'ok' ? 'trade-ok' : 'trade-alert'} role={tone === 'ok' ? 'status' : 'alert'}>
          {message}
        </p>
      ) : null}
    </section>
  )
}
