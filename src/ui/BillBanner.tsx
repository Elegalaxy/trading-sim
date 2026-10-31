import { useState } from 'react'
import { unusedLoanLimitCents } from '../sim/loan.ts'
import type { GameState } from '../sim/types.ts'
import { dispatch } from './store.ts'
import { formatUsd } from './money.ts'

function money(value: number, label: string): string {
  return formatUsd(value, label)
}

export function BillBanner({ game }: { game: GameState | null }) {
  const day = game?.market.day ?? null
  const billDay = game?.bill?.day ?? null
  const key = `${day ?? 'x'}|${billDay ?? ''}`
  const [message, setMessage] = useState<string | null>(null)
  const [tracked, setTracked] = useState(key)
  if (tracked !== key) {
    setTracked(key)
    setMessage(null)
  }

  if (game === null || game.runEnd !== null || game.bill === null) return null

  const bill = game.bill
  const shortfall = bill.amountCents - game.accounts.cashCents
  if (!Number.isSafeInteger(shortfall)) {
    throw new Error(`bill shortfall is not a safe integer, received ${String(shortfall)}`)
  }
  const savings = game.accounts.savingsCents
  const withdraw = Math.min(Math.max(shortfall, 0), savings)
  const unused = unusedLoanLimitCents(game)
  const loanOpen = game.loan.balanceCents > 0
  const loanDraw = !loanOpen && shortfall > 0 ? Math.min(shortfall, unused) : 0

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

  function onLoan(): void {
    if (!Number.isSafeInteger(loanDraw) || loanDraw <= 0) {
      console.error('[ui] rejected loan draw: no unused limit')
      setMessage(loanOpen ? 'A loan is already open.' : 'No unused loan limit.')
      return
    }
    const outcome = dispatch({ type: 'takeLoan', amountCents: loanDraw })
    if (!outcome.accepted) {
      console.error(`[ui] rejected take loan: ${outcome.reason ?? 'rejected'}`)
      setMessage('Could not take a loan.')
      return
    }
    setMessage('Loan added to cash. Press Pay bill to pay it.')
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
        The bill is {money(bill.amountCents, 'bill')}. Cash has {money(game.accounts.cashCents, 'cash')}.
        Shortfall {money(Math.max(shortfall, 0), 'shortfall')}. The day cannot end until this is paid.
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
          <button type="button" onClick={onLoan} disabled={loanDraw <= 0}>
            Take a loan
          </button>
          {loanOpen ? (
            <span className="day-note">A loan is already open.</span>
          ) : loanDraw > 0 ? (
            <span className="day-note">Adds {money(loanDraw, 'loan draw')} to cash. It does not pay the bill.</span>
          ) : shortfall > 0 ? (
            <span className="day-note">No unused loan limit.</span>
          ) : null}
        </li>
      </ul>
      <p className="bill-actions">
        <button type="button" onClick={onPay} disabled={game.accounts.cashCents < bill.amountCents}>
          Pay bill
        </button>
      </p>
      {message !== null ? (
        <p
          className={
            message === 'Moved savings into cash.' ||
            message === 'Bill paid.' ||
            message === 'Loan added to cash. Press Pay bill to pay it.'
              ? 'trade-ok'
              : 'trade-alert'
          }
          role="status"
        >
          {message}
        </p>
      ) : null}
    </section>
  )
}
