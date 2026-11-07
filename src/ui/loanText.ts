// Loan wording shared by the Loan panel, the due banner, the End day confirm and the day report.
// The sale list comes from `previewLoanSale`, which runs the real forced sale on a copy.

import { LOAN_WARNING_DAYS } from '../sim/constants.ts'
import { nextLoanPayment, previewLoanSale, type LoanPaymentEstimate, type LoanSalePreview } from '../sim/loan.ts'
import type { GameState, MarketDefinitions } from '../sim/types.ts'
import { formatUsd } from './money.ts'

/** The payment due in the next LOAN_WARNING_DAYS days that cash does not cover yet, else null. */
export function loanWarning(game: GameState, defs: MarketDefinitions): LoanPaymentEstimate | null {
  if (game.runEnd !== null || game.loan.balanceCents + (game.loan.accruedInterestCents ?? 0) === 0) return null
  const payment = nextLoanPayment(game, defs)
  if (payment === null || payment.pending || payment.daysAway > LOAN_WARNING_DAYS) return null
  return game.accounts.cashCents < payment.totalCents ? payment : null
}

/** "Sell NOVA, KSR, then $120.00 of savings" for a sale preview. Empty when nothing sells. */
export function saleText(preview: LoanSalePreview): string {
  if (preview.steps.length === 0) return ''
  const positions = preview.steps.filter((step) => step.source !== 'savings' && step.source !== 'deposit').map((step) => step.source)
  const savings = preview.steps.find((step) => step.source === 'savings')
  const deposits = preview.steps.filter((step) => step.source === 'deposit')
  const head = positions.length > 0 ? `Sell ${positions.join(', ')}` : ''
  const takes: string[] = []
  if (savings !== undefined) takes.push(`${formatUsd(savings.amountCents, 'savings')} of savings`)
  if (deposits.length > 0) {
    const total = deposits.reduce((sum, step) => sum + step.amountCents, 0)
    takes.push(`break ${deposits.length === 1 ? 'a fixed deposit' : `${deposits.length} fixed deposits`} for ${formatUsd(total, 'deposits')}`)
  }
  const tail = takes.join(' and ')
  if (head !== '' && tail !== '') return `${head} and take ${tail}`
  return head !== '' ? head : `Take ${tail}`
}

/** The preview for the pending payment, or null when none is pending or nothing would sell. */
export function pendingSale(game: GameState, defs: MarketDefinitions): LoanSalePreview | null {
  if (game.runEnd !== null || game.loan.interestDueCents + (game.loan.principalDueCents ?? 0) === 0) return null
  const preview = previewLoanSale(game, defs)
  return preview.steps.length > 0 || preview.endsRun ? preview : null
}
