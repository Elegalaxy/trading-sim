import { useState } from 'react'
import { COURSE_OFFERS, LIFESTYLE_OFFERS } from '../content/lifestyle.ts'
import { COURSE_STUDY_UNITS, COURSE_UNITS_DAYTIME, COURSE_UNITS_EVENING } from '../sim/constants.ts'
import { lifestyleExpensesCents, projectedBillCents, tierOf, upfrontCents } from '../sim/lifestyle.ts'
import type { GameState, LifestyleCategory } from '../sim/types.ts'
import { PerkBadge, TierBadges } from './Badges.tsx'
import { debugLog } from './debug.ts'
import { formatUsd } from './money.ts'
import { dispatch } from './store.ts'

function reasonText(reason: string): string {
  if (reason === 'insufficientFunds') return 'Not enough cash.'
  if (reason === 'alreadyAtTier') return 'That tier is already set.'
  if (reason === 'alreadyOwned') return 'You already finished that course.'
  if (reason === 'alreadyEnrolled') return 'Finish the course you are on first.'
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
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [pickedCourse, setPickedCourse] = useState<string | null>(null)

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
      const paid = event.upfront === 0 ? 'No refund.' : `Paid ${formatUsd(event.upfront, 'lifestyle upfront')}.`
      setPicked((prev) => {
        const next = { ...prev }
        delete next[category]
        return next
      })
      setTone('ok')
      setMessage(`${offer?.name ?? event.category} is tier ${event.to}. ${paid} Monthly expenses ${formatUsd(event.expensesCents, 'expenses')}.`)
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
      setPickedCourse(null)
      setTone('ok')
      setMessage(
        `Enrolled in ${offer?.name ?? event.course} for ${formatUsd(event.cost, 'course')}. Study in your free time to finish it (${COURSE_STUDY_UNITS} units).`,
      )
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
      <dl className="kv-row">
        <div>
          <dt>Cash</dt>
          <dd>{formatUsd(current.accounts.cashCents, 'cash')}</dd>
        </div>
        <div>
          <dt>Monthly expenses</dt>
          <dd>{formatUsd(expenses, 'monthly expenses')}</dd>
        </div>
        <div>
          <dt>Next bill</dt>
          <dd>{formatUsd(nextBill, 'next bill')}</dd>
        </div>
      </dl>
      {current.bill !== null ? (
        <p className="card-note">Bill due now: {formatUsd(current.bill.amountCents, 'bill due')}. Changing lifestyle does not change it.</p>
      ) : null}
      <div className="card-list">
        {LIFESTYLE_OFFERS.map((offer) => {
          const tierNow = tierOf(current.lifestyle, offer.id)
          const pickedTier = picked[offer.id]
          const pickedInfo = pickedTier === undefined || pickedTier === tierNow ? undefined : offer.tiers[pickedTier]
          const pickedUpfront = pickedInfo === undefined || pickedTier === undefined ? 0 : upfrontCents(offer.id, tierNow, pickedTier)
          return (
            <article key={offer.id} className="card" aria-label={offer.name}>
              <header className="card-head">
                <h3>{offer.name}</h3>
                <span className="card-sub">{offer.note}</span>
              </header>
              <div className="tier-list" role="group" aria-label={`${offer.name} tier`}>
                {offer.tiers.map((tierInfo, tier) => {
                  const upfront = upfrontCents(offer.id, tierNow, tier)
                  const active = tier === tierNow
                  const unaffordable = upfront > 0 && current.accounts.cashCents < upfront
                  const isPicked = pickedTier === tier && !active
                  const action = upfront === 0 ? 'No refund' : `${formatUsd(upfront, 'tier upfront')} to switch`
                  return (
                    <button
                      key={tier}
                      type="button"
                      className={active ? 'tier-row tier-active' : isPicked ? 'tier-row tier-picked' : 'tier-row'}
                      aria-pressed={isPicked}
                      disabled={ended || active || unaffordable}
                      title={unaffordable ? 'Not enough cash.' : undefined}
                      onClick={() => setPicked((prev) => ({ ...prev, [offer.id]: tier }))}
                    >
                      <span className="tier-main">
                        <span className="tier-name">
                          Tier {tier} · {tierInfo.name}
                        </span>
                        <TierBadges badges={tierInfo.badges} />
                      </span>
                      <span className="tier-price">
                        <strong>{tier === 0 ? 'Base' : `+${formatUsd(tier * offer.tierCostCents, 'tier monthly')}/mo`}</strong>
                        {active ? (
                          <span className="tier-pill tier-pill-current">Current</span>
                        ) : isPicked ? (
                          <span className="tier-pill tier-pill-picked">Selected</span>
                        ) : (
                          <small>{action}</small>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                className="primary-action"
                disabled={ended || pickedInfo === undefined || pickedTier === undefined}
                onClick={() => {
                  if (pickedTier !== undefined) onTier(offer.id, pickedTier)
                }}
              >
                {pickedInfo === undefined || pickedTier === undefined
                  ? 'Pick a tier to switch'
                  : `Switch to Tier ${pickedTier} · ${pickedInfo.name}${pickedUpfront > 0 ? ` · ${formatUsd(pickedUpfront, 'tier upfront')} now` : ''}`}
              </button>
            </article>
          )
        })}
        {COURSE_OFFERS.map((offer) => {
          const owned = current.job.courses.includes(offer.id)
          const enrolled = current.study.course
          const studying = enrolled?.id === offer.id
          const blocked = ended || owned || enrolled !== null || current.accounts.cashCents < offer.costCents
          const isPicked = pickedCourse === offer.id && !blocked
          return (
            <article key={offer.id} className="card" aria-label={`${offer.name} course`}>
              <header className="card-head">
                <h3>{offer.name} course</h3>
                <span className="card-sub">Unlocks {offer.unlocks}. No monthly cost.</span>
              </header>
              <button
                type="button"
                className={studying ? 'tier-row tier-active' : isPicked ? 'tier-row tier-picked' : 'tier-row'}
                aria-pressed={isPicked}
                disabled={blocked}
                onClick={() => setPickedCourse(offer.id)}
                title={enrolled !== null && !studying ? 'Finish the course you are on first.' : undefined}
              >
                <span className="tier-main">
                  <span className="tier-name">
                    {owned
                      ? 'Done'
                      : studying
                        ? `Studying: ${enrolled.units} of ${COURSE_STUDY_UNITS} units`
                        : `${offer.name} course`}
                  </span>
                  <span className="badges">
                    <PerkBadge text={`${COURSE_STUDY_UNITS} units`} title="Units of study needed to finish." />
                    <PerkBadge text={`Free day +${COURSE_UNITS_DAYTIME}`} title="Units from a free daytime of study." />
                    <PerkBadge text={`Skipped market +${COURSE_UNITS_EVENING}`} title="Units from an evening of study instead of the market." />
                  </span>
                </span>
                <span className="tier-price">
                  <strong>{formatUsd(offer.costCents, offer.name)}</strong>
                  {studying ? (
                    <span className="tier-pill tier-pill-current">Current</span>
                  ) : isPicked ? (
                    <span className="tier-pill tier-pill-picked">Selected</span>
                  ) : (
                    <small>{owned ? 'owned' : 'one-off'}</small>
                  )}
                </span>
              </button>
              <button type="button" className="primary-action" disabled={!isPicked} onClick={() => onCourse(offer.id)}>
                {isPicked ? `Enrol in ${offer.name} · ${formatUsd(offer.costCents, 'course')}` : 'Pick the course to enrol'}
              </button>
            </article>
          )
        })}
      </div>
      {message !== null ? (
        <p className={tone === 'ok' ? 'trade-ok' : 'trade-alert'} role={tone === 'ok' ? 'status' : 'alert'}>
          {message}
        </p>
      ) : null}
    </section>
  )
}
