import { useState, type FormEvent } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { readPolicyRatePercent } from '../sim/accounts.ts'
import { LOAN_RATE_SPREAD_PERCENT } from '../sim/constants.ts'
import {
  loanAnnualRate,
  loanLimitCents,
  nextLoanPayment,
  pendingPaymentCents,
  projectLoanSchedule,
  unusedLoanLimitCents,
} from '../sim/loan.ts'
import type { GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { loanWarning } from './loanText.ts'
import { formatUsd, parseUsdToCents } from './money.ts'
import { dispatch } from './store.ts'
import { moneyText } from './numberInput.ts'

function money(value: number, label: string): string {
  return formatUsd(value, label)
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

  const takeParsed = parseUsdToCents(takeText, 'Loan amount')
  const repayParsed = parseUsdToCents(repayText, 'Repayment')
  const pending = game === null ? 0 : pendingPaymentCents(game.loan)
  const balance = game?.loan.balanceCents ?? 0
  const limit = game === null ? 0 : loanLimitCents(game)
  const unused = game === null ? 0 : unusedLoanLimitCents(game)
  const policy = game === null ? 0 : readPolicyRatePercent(game.market, MARKET_DEFINITIONS)
  const annual = loanAnnualRate(policy) * 100
  const accrued = game?.loan.accruedInterestCents ?? 0
  const payment = game === null ? null : nextLoanPayment(game, MARKET_DEFINITIONS)
  const warning = game === null ? null : loanWarning(game, MARKET_DEFINITIONS)
  const paymentsLeft = game?.loan.paymentsLeft ?? 0
  // The schedule of the draw being typed, shown before the player confirms.
  const schedule =
    game !== null && takeParsed.ok && takeParsed.cents > 0 && takeParsed.cents <= unused && balance === 0
      ? projectLoanSchedule(takeParsed.cents, game.market.day, policy)
      : []

  function onTake(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!takeParsed.ok) {
      console.error(`[ui] rejected loan amount ${JSON.stringify(takeText)}: ${takeParsed.reason}`)
      debugLog('[ui]', `loan take rejected before dispatch: ${takeParsed.reason}`)
      setTone('alert')
      setMessage(takeParsed.reason)
      return
    }
    debugLog('[ui]', `loan take usd cents=${takeParsed.cents}`)
    const outcome = dispatch({ type: 'takeLoan', amountCents: takeParsed.cents })
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
    debugLog('[ui]', `loan repay usd cents=${repayParsed.cents}`)
    if (game !== null && repayParsed.cents > game.accounts.cashCents) {
      console.error(`[ui] rejected repayment: cash ${game.accounts.cashCents} cents, asked ${repayParsed.cents}`)
      setTone('alert')
      setMessage(`Cash has ${formatUsd(game.accounts.cashCents, 'cash')}. That repayment is larger.`)
      return
    }
    const outcome = dispatch({ type: 'repayLoan', amountCents: repayParsed.cents })
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
    <section className={pending > 0 ? 'panel bill-banner' : 'panel'} aria-label="Bank loan">
      <h2>Bank loan</h2>
      {game === null ? (
        <p>Start a game to borrow.</p>
      ) : (
        <>
          <dl className="kv-row">
            <div>
              <dt>Balance</dt>
              <dd>{money(balance, 'loan balance')}</dd>
            </div>
            <div>
              <dt>Limit</dt>
              <dd>{money(limit, 'loan limit')}</dd>
            </div>
            <div>
              <dt>Unused</dt>
              <dd>{money(unused, 'unused loan')}</dd>
            </div>
            <div>
              <dt>Rate</dt>
              <dd title={`Policy + ${LOAN_RATE_SPREAD_PERCENT} points, accrued daily.`}>{rateText(annual)}% a year</dd>
            </div>
            <div>
              <dt>Interest so far</dt>
              <dd>{money(accrued, 'accrued interest')}</dd>
            </div>
            <div>
              <dt>Payments left</dt>
              <dd>{balance > 0 ? paymentsLeft : '—'}</dd>
            </div>
          </dl>
          {payment !== null ? (
            <dl className="kv-row">
              <div>
                <dt>{payment.pending ? 'Payment due now' : 'Next payment'}</dt>
                <dd>
                  {payment.pending ? '' : '≈ '}
                  {money(payment.totalCents, 'next loan payment')}
                </dd>
              </div>
              <div>
                <dt>Of which instalment</dt>
                <dd>{money(payment.principalCents, 'instalment')}</dd>
              </div>
              <div>
                <dt>Payday</dt>
                <dd>
                  Close of day {payment.day}
                  {payment.pending ? '' : ` (${payment.daysAway} day${payment.daysAway === 1 ? '' : 's'})`}
                </dd>
              </div>
            </dl>
          ) : null}
          {warning !== null ? (
            <p className="loan-warning" role="alert">
              <span aria-hidden="true">▲ </span>
              Cash is {money(game.accounts.cashCents, 'cash')}, below the next payment of about{' '}
              {money(warning.totalCents, 'next loan payment')} at the close of day {warning.day}. A missed payment sells
              positions, then savings.
            </p>
          ) : null}
          {pending > 0 ? (
            <p className="trade-alert" role="alert">
              A loan payment of {money(pending, 'loan payment')} is due. Cash pays it when cash covers it. At the end of
              the day, an unpaid payment sells the worst positions, then savings. Lifestyle is not changed.
            </p>
          ) : null}
          <form className="trade-form" onSubmit={onTake}>
            <label htmlFor="loan-take">
              Take (USD){' '}
              <input
                id="loan-take"
                value={takeText}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => setTakeText(moneyText(event.target.value))}
              />
            </label>
            <button
              type="submit"
              disabled={game.runEnd !== null || balance > 0}
              title={
                game.runEnd !== null
                  ? 'The run has ended.'
                  : balance > 0
                    ? 'A loan is already open. Pay it off before taking another.'
                    : undefined
              }
            >
              Take loan
            </button>
          </form>
          {schedule.length > 0 ? (
            <table className="loan-schedule" aria-label="Payment schedule for this loan">
              <thead>
                <tr>
                  <th scope="col">Payday</th>
                  <th scope="col" className="num">
                    Instalment
                  </th>
                  <th scope="col" className="num">
                    Interest
                  </th>
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <tr key={row.day}>
                    <td>Day {row.day}</td>
                    <td className="num">{money(row.principalCents, 'instalment')}</td>
                    <td className="num">≈ {money(row.interestCents, 'interest')}</td>
                    <td className="num">≈ {money(row.principalCents + row.interestCents, 'payment')}</td>
                  </tr>
                ))}
              </tbody>
              <caption>
                {schedule.some((row) => row.principalCents > 0)
                  ? 'Repaid in instalments on paydays; repaying early lowers the later ones. A missed payment sells positions, then savings.'
                  : 'No payday is left to take an instalment. The balance counts against your net worth at the end.'}
              </caption>
            </table>
          ) : null}
          <form className="trade-form" onSubmit={onRepay}>
            <label htmlFor="loan-repay">
              Repay (USD){' '}
              <input
                id="loan-repay"
                value={repayText}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => setRepayText(moneyText(event.target.value))}
              />
            </label>
            <button
              type="submit"
              disabled={game.runEnd !== null || balance === 0 || game.accounts.cashCents === 0}
              title={
                game.runEnd !== null
                  ? 'The run has ended.'
                  : balance === 0
                    ? 'There is no loan to repay.'
                    : game.accounts.cashCents === 0
                      ? 'Cash is empty.'
                      : undefined
              }
            >
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
