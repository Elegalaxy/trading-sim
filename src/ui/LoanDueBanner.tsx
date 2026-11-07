// Shown while a loan payment is pending (cash did not cover it on payday). It lists what
// End day will sell, from `previewLoanSale`, which runs the real sale on a copy, and offers
// the cheapest way out first: savings. Positions can be sold in the market section.

import { useState } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { pendingPaymentCents, previewLoanSale } from '../sim/loan.ts'
import type { GameState } from '../sim/types.ts'
import { BreakDepositButtons } from './Deposits.tsx'
import { formatUsd } from './money.ts'
import { dispatch } from './store.ts'

export function LoanDueBanner({ game }: { game: GameState | null }) {
  const key = `${game?.market.day ?? 'x'}|${game?.loan.interestDay ?? ''}`
  const [message, setMessage] = useState<string | null>(null)
  const [tracked, setTracked] = useState(key)
  if (tracked !== key) {
    setTracked(key)
    setMessage(null)
  }
  if (game === null || game.runEnd !== null) return null
  const due = pendingPaymentCents(game.loan)
  if (due === 0) return null

  const cash = game.accounts.cashCents
  const shortfall = Math.max(0, due - cash)
  const principal = game.loan.principalDueCents ?? 0
  const preview = previewLoanSale(game, MARKET_DEFINITIONS)
  const withdraw = Math.min(shortfall, game.accounts.savingsCents)

  function onWithdraw(): void {
    const outcome = dispatch({ type: 'transfer', from: 'savings', to: 'cash', amountCents: withdraw })
    if (!outcome.accepted) {
      console.error(`[ui] rejected savings withdrawal: ${outcome.reason ?? 'rejected'}`)
      setMessage('Could not withdraw from savings.')
      return
    }
    setMessage('Moved savings into cash.')
  }

  return (
    <section className="panel bill-banner loan-due" role="alert" aria-label="Loan payment due">
      <h2>Loan payment due</h2>
      <dl className="kv-row">
        <div>
          <dt>Payment</dt>
          <dd>{formatUsd(due, 'loan payment')}</dd>
        </div>
        <div>
          <dt>Interest</dt>
          <dd>{formatUsd(game.loan.interestDueCents, 'loan interest')}</dd>
        </div>
        <div>
          <dt>Instalment</dt>
          <dd>{formatUsd(principal, 'loan instalment')}</dd>
        </div>
        <div>
          <dt>Cash</dt>
          <dd>{formatUsd(cash, 'cash')}</dd>
        </div>
        <div>
          <dt>Shortfall</dt>
          <dd className={shortfall > 0 ? 'pnl-loss' : undefined}>{formatUsd(shortfall, 'shortfall')}</dd>
        </div>
      </dl>
      {shortfall === 0 ? (
        <p className="day-note">Cash covers it. End day takes the payment.</p>
      ) : (
        <div className="loan-sale">
          <p className="loan-sale-title">
            <span aria-hidden="true">▲ </span>If you do nothing, End day sells, in this order:
          </p>
          {preview.steps.length === 0 ? (
            <p className="day-note">Nothing is left to sell.</p>
          ) : (
            <table className="loan-sale-table">
              <tbody>
                {preview.steps.map((step, index) => (
                  <tr key={`${step.source}-${index}`}>
                    <td>{index + 1}.</td>
                    <td>
                      {step.source === 'savings'
                        ? 'Savings'
                        : step.source === 'deposit'
                          ? 'Fixed deposit (2% penalty, interest lost)'
                          : `Position ${step.source}`}
                    </td>
                    <td className="num">{formatUsd(step.amountCents, 'sale')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {preview.endsRun ? (
            <p className="trade-alert">
              <span aria-hidden="true">✖ </span>That is still not enough. The run ends.
            </p>
          ) : null}
        </div>
      )}
      <p className="bill-actions">
        <button
          type="button"
          onClick={onWithdraw}
          disabled={withdraw <= 0}
          title={
            shortfall === 0
              ? 'Cash already covers the payment.'
              : withdraw > 0
                ? `Moves ${formatUsd(withdraw, 'withdraw')} from savings to cash.`
                : 'Savings are empty.'
          }
        >
          Withdraw savings
        </button>
        <BreakDepositButtons game={game} />
        <span className="day-note">
          {game.section === 'market'
            ? 'Or sell positions yourself and move the proceeds to cash.'
            : 'Positions can be sold in the market section.'}
        </span>
      </p>
      {message !== null ? (
        <p className={message === 'Moved savings into cash.' ? 'trade-ok' : 'trade-alert'} role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}
