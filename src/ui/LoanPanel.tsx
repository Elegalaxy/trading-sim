import { useState, type FormEvent } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { readPolicyRatePercent } from '../sim/accounts.ts'
import { LOAN_RATE_SPREAD_PERCENT } from '../sim/constants.ts'
import { loanAnnualRate, loanLimitCents, unusedLoanLimitCents } from '../sim/loan.ts'
import type { GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { dispatch, parsePositiveInteger } from './store.ts'

function cents(value: number, label: string): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer, received ${String(value)}`)
  }
  return String(value)
}

function rateText(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`loan rate must be a finite number, received ${String(value)}`)
  }
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'loanOutstanding':
      return 'A loan is already open. Pay it off before taking another.'
    case 'aboveLoanLimit':
      return 'That is above the unused loan limit.'
    case 'noLoan':
      return 'There is no loan to repay.'
    case 'aboveBalance':
      return 'That is more than the balance.'
    case 'insufficientFunds':
      return 'Not enough cash to repay that.'
    case 'runEnded':
      return 'The run has ended.'
    case 'notStarted':
      return 'Start a game first.'
    default:
      return reason
  }
}

export function LoanPanel({ game }: { game: GameState | null }) {
  const [takeText, setTakeText] = useState('')
  const [repayText, setRepayText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [tone, setTone] = useState<'ok' | 'alert'>('alert')
  const [tracked, setTracked] = useState(game)
  if (tracked !== game) {
    setTracked(game)
    setMessage(null)
  }

  const takeParsed = parsePositiveInteger(takeText, 'Loan amount')
  const repayParsed = parsePositiveInteger(repayText, 'Repayment')
  const interestDue = game?.loan.interestDueCents ?? 0
  const balance = game?.loan.balanceCents ?? 0
  const limit = game === null ? 0 : loanLimitCents(game)
  const unused = game === null ? 0 : unusedLoanLimitCents(game)
  const policy = game === null ? 0 : readPolicyRatePercent(game.market, MARKET_DEFINITIONS)
  const annual = loanAnnualRate(policy) * 100

  function onTake(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!takeParsed.ok) {
      console.error(`[ui] rejected loan amount ${JSON.stringify(takeText)}: ${takeParsed.reason}`)
      debugLog('[ui]', `loan take rejected before dispatch: ${takeParsed.reason}`)
      setTone('alert')
      setMessage(takeParsed.reason)
      return
    }
    const outcome = dispatch({ type: 'takeLoan', amountCents: takeParsed.value })
    if (!outcome.accepted) {
      const reason = outcome.reason ?? 'rejected'
      console.error(`[ui] rejected takeLoan: ${reason}`)
      setTone('alert')
      setMessage(reasonText(reason))
      return
    }
    setTone('ok')
    setMessage('Loan added to cash.')
    setTakeText('')
  }

  function onRepay(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!repayParsed.ok) {
      console.error(`[ui] rejected repayment ${JSON.stringify(repayText)}: ${repayParsed.reason}`)
      debugLog('[ui]', `loan repay rejected before dispatch: ${repayParsed.reason}`)
      setTone('alert')
      setMessage(repayParsed.reason)
      return
    }
    const outcome = dispatch({ type: 'repayLoan', amountCents: repayParsed.value })
    if (!outcome.accepted) {
      const reason = outcome.reason ?? 'rejected'
      console.error(`[ui] rejected repayLoan: ${reason}`)
      setTone('alert')
      setMessage(reasonText(reason))
      return
    }
    setTone('ok')
    setMessage('Repayment taken from cash.')
    setRepayText('')
  }

  return (
    <section className={interestDue > 0 ? 'panel bill-banner' : 'panel'} aria-label="Bank loan">
      <h2>Bank loan</h2>
      {game === null ? (
        <p>Start a game to borrow.</p>
      ) : (
        <>
          <ul className="balance-list">
            <li>Balance: {cents(balance, 'loan balance')} cents</li>
            <li>Limit: {cents(limit, 'loan limit')} cents</li>
            <li>Unused: {cents(unused, 'unused loan')} cents</li>
            <li>
              Rate: {rateText(annual)} percent a year (policy + {LOAN_RATE_SPREAD_PERCENT} points),
              charged monthly
            </li>
          </ul>
          {interestDue > 0 ? (
            <p className="trade-alert" role="alert">
              Loan interest of {cents(interestDue, 'loan interest')} cents is due. Cash pays it when cash covers it.
              At the end of the day, unpaid interest sells the worst positions, then savings. Lifestyle is not changed.
            </p>
          ) : null}
          <form className="trade-form" onSubmit={onTake}>
            <label htmlFor="loan-take">
              Take{' '}
              <input
                id="loan-take"
                value={takeText}
                inputMode="numeric"
                autoComplete="off"
                onChange={(event) => setTakeText(event.target.value)}
              />
            </label>
            <button type="submit" disabled={game.runEnd !== null || balance > 0}>
              Take loan
            </button>
          </form>
          <form className="trade-form" onSubmit={onRepay}>
            <label htmlFor="loan-repay">
              Repay{' '}
              <input
                id="loan-repay"
                value={repayText}
                inputMode="numeric"
                autoComplete="off"
                onChange={(event) => setRepayText(event.target.value)}
              />
            </label>
            <button type="submit" disabled={game.runEnd !== null || balance === 0}>
              Repay loan
            </button>
          </form>
        </>
      )}
      {message !== null ? (
        <p className={tone === 'ok' ? 'trade-ok' : 'trade-alert'} role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}
