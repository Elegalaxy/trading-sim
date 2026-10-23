import { useState } from 'react'
import type { GameState } from '../sim/types.ts'
import { dispatch } from './store.ts'

function cents(value: number, label: string): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer, received ${String(value)}`)
  }
  return String(value)
}

export function BillBanner({ game }: { game: GameState | null }) {
  const day = game?.market.day ?? null
  const ended = game?.runEnd?.reason ?? null
  const billDay = game?.bill?.day ?? null
  const key = `${day ?? 'x'}|${ended ?? ''}|${billDay ?? ''}`
  const [message, setMessage] = useState<string | null>(null)
  const [tracked, setTracked] = useState(key)
  if (tracked !== key) {
    setTracked(key)
    setMessage(null)
  }

  if (game === null || (game.bill === null && game.runEnd === null)) return null

  if (game.runEnd !== null) {
    return (
      <section className="panel bill-ended" role="alert" aria-label="Run ended">
        <h2>Run ended</h2>
        <p>
          Day {cents(game.runEnd.day, 'run end day')}. You cannot cover the bill. The day cannot advance.
        </p>
      </section>
    )
  }

  const bill = game.bill
  if (bill === null) return null
  const shortfall = bill.amountCents - game.accounts.cashCents
  if (!Number.isSafeInteger(shortfall)) {
    throw new Error(`bill shortfall is not a safe integer, received ${String(shortfall)}`)
  }
  const savings = game.accounts.savingsCents
  const withdraw = Math.min(shortfall, savings)

  function onWithdraw(): void {
    if (!Number.isSafeInteger(withdraw) || withdraw <= 0) {
      console.error('[ui] rejected savings withdrawal: nothing to withdraw')
      setMessage('Nothing to withdraw.')
      return
    }
    const outcome = dispatch({ type: 'transfer', from: 'savings', to: 'cash', amountCents: withdraw })
    if (!outcome.accepted) {
      console.error(`[ui] rejected savings withdrawal: ${outcome.reason ?? 'rejected'}`)
      setMessage('Could not withdraw from savings.')
      return
    }
    setMessage('Moved savings into cash.')
  }

  function onPay(): void {
    const outcome = dispatch({ type: 'payBill' })
    if (!outcome.accepted) {
      console.error(`[ui] rejected pay bill: ${outcome.reason ?? 'rejected'}`)
      setMessage(outcome.reason === 'insufficientFunds' ? 'Not enough cash to pay the bill.' : 'Could not pay the bill.')
      return
    }
    setMessage('Bill paid.')
  }

  return (
    <section className="panel bill-banner" role="alert" aria-label="Bill due">
      <h2>Bill due</h2>
      <p>
        The bill is {cents(bill.amountCents, 'bill')} cents. Cash has {cents(game.accounts.cashCents, 'cash')} cents.
        Shortfall {cents(shortfall, 'shortfall')} cents. The day cannot end until this is paid.
      </p>
      <ul>
        <li>
          {game.section === 'market'
            ? 'Sell positions in the market section, then move the proceeds to cash.'
            : 'Selling positions only works in the market section. Skip ahead, sell, then move the proceeds to cash.'}
        </li>
        <li>
          <button type="button" onClick={onWithdraw} disabled={withdraw <= 0}>
            Withdraw from savings
          </button>
        </li>
        <li>
          <button type="button" disabled>
            Take a loan
          </button>
          <span className="day-note">Not available yet.</span>
        </li>
      </ul>
      <p className="bill-actions">
        <button type="button" onClick={onPay} disabled={game.accounts.cashCents < bill.amountCents}>
          Pay bill
        </button>
      </p>
      {message !== null ? (
        <p className={message === 'Moved savings into cash.' || message === 'Bill paid.' ? 'trade-ok' : 'trade-alert'} role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}
