// Fixed deposits: the "Fixed deposits" block of the Accounts panel, and the "Break deposit" buttons
// the bill and loan banners offer. The rules are in src/sim/deposits.ts; this file only reads them.

import { useState, type FormEvent } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { readPolicyRatePercent } from '../sim/accounts.ts'
import { DEPOSIT_MAX_OPEN, DEPOSIT_MIN_CENTS, DEPOSIT_TERMS_DAYS, RUN_LENGTH_DAYS } from '../sim/constants.ts'
import {
  depositAnnualRate,
  depositBreakValueCents,
  depositInterestCents,
  depositMaturityInterestCents,
  depositPenaltyCents,
} from '../sim/deposits.ts'
import type { Deposit, DepositSource, GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { formatUsd, parseUsdToCents } from './money.ts'
import { dispatch } from './store.ts'

function money(value: number, label: string): string {
  return formatUsd(value, label)
}

function percentText(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

function maturesText(deposit: Deposit): string {
  return deposit.maturityDay > RUN_LENGTH_DAYS ? `Day ${deposit.maturityDay} (after the run)` : `Day ${deposit.maturityDay}`
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'billPending':
      return 'Pay the bill first.'
    case 'loanPaymentPending':
      return 'A loan payment is pending. Settle it first.'
    case 'belowMinimum':
      return `The minimum is ${formatUsd(DEPOSIT_MIN_CENTS, 'minimum deposit')}.`
    case 'tooManyDeposits':
      return `At most ${DEPOSIT_MAX_OPEN} deposits can be open.`
    case 'insufficientFunds':
      return 'That account does not have enough.'
    case 'unknownDeposit':
      return 'That deposit is no longer open.'
    case 'runEnded':
      return 'The run has ended.'
    case 'notStarted':
      return 'Start a game first.'
    default:
      return reason
  }
}

/** One "Break deposit" button per open deposit, with the amount it returns. Used by the bill and loan banners. */
export function BreakDepositButtons({ game }: { game: GameState }) {
  const [message, setMessage] = useState<string | null>(null)
  const open = game.deposits?.open ?? []
  if (open.length === 0) return null

  function onBreak(deposit: Deposit): void {
    const outcome = dispatch({ type: 'breakDeposit', id: deposit.id })
    if (!outcome.accepted) {
      setMessage(reasonText(outcome.reason ?? 'rejected'))
      return
    }
    setMessage('Deposit broken. The money is in savings.')
  }

  return (
    <>
      {open.map((deposit) => (
        <button
          key={deposit.id}
          type="button"
          onClick={() => onBreak(deposit)}
          title={`Gives ${money(depositBreakValueCents(deposit), 'break value')} to savings: ${money(depositPenaltyCents(deposit), 'penalty')} penalty, interest lost.`}
        >
          Break deposit {money(deposit.principalCents, 'deposit')} (day {deposit.maturityDay}, get{' '}
          {money(depositBreakValueCents(deposit), 'break value')})
        </button>
      ))}
      {message !== null ? (
        <span className={message.startsWith('Deposit broken') ? 'trade-ok' : 'trade-alert'} role="status">
          {message}
        </span>
      ) : null}
    </>
  )
}

export function Deposits({ game }: { game: GameState | null }) {
  const [amountText, setAmountText] = useState('')
  const [term, setTerm] = useState<30 | 60 | 90>(30)
  const [from, setFrom] = useState<DepositSource>('cash')
  const [message, setMessage] = useState<string | null>(null)
  const [tone, setTone] = useState<'ok' | 'alert'>('alert')
  const [confirmId, setConfirmId] = useState<number | null>(null)

  if (game === null) return null
  const open = game.deposits?.open ?? []
  const policy = readPolicyRatePercent(game.market, MARKET_DEFINITIONS)
  const parsed = parseUsdToCents(amountText, 'Amount')
  const source = from === 'cash' ? game.accounts.cashCents : game.accounts.savingsCents
  const loanPending = game.loan.interestDueCents + (game.loan.principalDueCents ?? 0) > 0

  let blocked: string | null = null
  if (game.runEnd !== null) blocked = 'The run has ended.'
  else if (game.bill !== null) blocked = 'Pay the bill first.'
  else if (loanPending) blocked = 'A loan payment is pending. Settle it first.'
  else if (open.length >= DEPOSIT_MAX_OPEN) blocked = `At most ${DEPOSIT_MAX_OPEN} deposits can be open.`
  else if (parsed.ok && parsed.cents < DEPOSIT_MIN_CENTS) blocked = `The minimum is ${money(DEPOSIT_MIN_CENTS, 'minimum deposit')}.`
  else if (parsed.ok && parsed.cents > source) blocked = `${from === 'cash' ? 'Cash' : 'Savings'} has ${money(source, from)}. That amount is larger.`

  function onLock(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!parsed.ok) {
      setTone('alert')
      setMessage(parsed.reason)
      return
    }
    debugLog('[ui]', `deposit open cents=${parsed.cents} term=${term} from=${from}`)
    const outcome = dispatch({ type: 'openDeposit', amountCents: parsed.cents, termDays: term, from })
    if (!outcome.accepted) {
      console.error(`[ui] rejected openDeposit: ${outcome.reason ?? 'rejected'}`)
      setTone('alert')
      setMessage(reasonText(outcome.reason ?? 'rejected'))
      return
    }
    setTone('ok')
    setMessage('Deposit locked.')
    setAmountText('')
  }

  function onBreak(id: number): void {
    debugLog('[ui]', `deposit break id=${id}`)
    const outcome = dispatch({ type: 'breakDeposit', id })
    setConfirmId(null)
    if (!outcome.accepted) {
      console.error(`[ui] rejected breakDeposit: ${outcome.reason ?? 'rejected'}`)
      setTone('alert')
      setMessage(reasonText(outcome.reason ?? 'rejected'))
      return
    }
    setTone('ok')
    setMessage('Deposit broken. The money is in savings.')
  }

  return (
    <div className="deposits" aria-label="Fixed deposits">
      <h3>Fixed deposits</h3>
      {open.length === 0 ? (
        <p className="day-note">No deposits. Lock cash for 30 to 90 days for a better rate.</p>
      ) : (
        <table className="loan-schedule deposit-table" aria-label="Open fixed deposits">
          <thead>
            <tr>
              <th scope="col" className="num">
                Amount
              </th>
              <th scope="col" className="num">
                Rate
              </th>
              <th scope="col">Matures</th>
              <th scope="col" className="num">
                Interest
              </th>
              <th scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {open.map((deposit) => (
              <tr key={deposit.id}>
                <td className="num">{money(deposit.principalCents, 'deposit')}</td>
                <td className="num">{percentText(deposit.annualRate)}</td>
                <td>{maturesText(deposit)}</td>
                <td className="num">{money(depositMaturityInterestCents(deposit), 'deposit interest')}</td>
                <td className="deposit-action">
                  {confirmId === deposit.id ? (
                    <span className="deposit-confirm">
                      You get {money(depositBreakValueCents(deposit), 'break value')} (−{money(depositPenaltyCents(deposit), 'penalty')}{' '}
                      penalty, interest lost){' '}
                      <button type="button" onClick={() => onBreak(deposit.id)} disabled={game.runEnd !== null}>
                        Confirm
                      </button>{' '}
                      <button type="button" onClick={() => setConfirmId(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmId(deposit.id)} disabled={game.runEnd !== null}>
                      Break
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open.some((deposit) => deposit.maturityDay > RUN_LENGTH_DAYS) ? (
        <p className="day-note">A deposit that matures after the run still counts in net worth, with its interest so far.</p>
      ) : null}
      <form className="trade-form" onSubmit={onLock}>
        <label htmlFor="deposit-amount">
          Lock (USD){' '}
          <input
            id="deposit-amount"
            value={amountText}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setAmountText(event.target.value)
              setMessage(null)
            }}
          />
        </label>
        <label htmlFor="deposit-from">
          From{' '}
          <select id="deposit-from" value={from} onChange={(event) => setFrom(event.target.value === 'savings' ? 'savings' : 'cash')}>
            <option value="cash">cash</option>
            <option value="savings">savings</option>
          </select>
        </label>
        <div className="deposit-terms" role="group" aria-label="Term">
          {DEPOSIT_TERMS_DAYS.map((days) => {
            const rate = depositAnnualRate(policy, days)
            const interest = parsed.ok ? depositInterestCents(parsed.cents, rate, days) : null
            return (
              <button
                key={days}
                type="button"
                aria-pressed={term === days}
                className={term === days ? 'deposit-term deposit-term-on' : 'deposit-term'}
                onClick={() => setTerm(days)}
              >
                <span className="deposit-term-days">{days} days</span>
                <span className="deposit-term-rate">{percentText(rate)}</span>
                <span className="deposit-term-gain">{interest === null ? '—' : `+${money(interest, 'interest')}`}</span>
              </button>
            )
          })}
        </div>
        <button type="submit" disabled={blocked !== null} title={blocked ?? undefined}>
          Lock
        </button>
        {blocked !== null && game.runEnd === null ? <p className="day-note">{blocked}</p> : null}
      </form>
      <p className="day-note">
        Interest is paid with the principal into savings when the term ends. Breaking early returns the principal less 2% and
        loses the interest. A deposit covers a bill if you break it, and a missed loan payment breaks deposits last.
      </p>
      {message !== null ? (
        <p className={tone === 'ok' ? 'trade-ok' : 'trade-alert'} role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
