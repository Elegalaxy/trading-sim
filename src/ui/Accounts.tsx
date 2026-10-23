import { useEffect, useState, type FormEvent } from 'react'
import { ACCOUNT_NAMES, type AccountName, type GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { dispatch, parsePositiveInteger } from './store.ts'

function isAccountName(value: string): value is AccountName {
  return (ACCOUNT_NAMES as readonly string[]).includes(value)
}

function transferReasonText(reason: string): string {
  switch (reason) {
    case 'insufficientFunds':
      return 'That account does not have enough.'
    case 'belowLoanBalance':
      return 'That would leave cash and savings below the loan balance.'
    case 'sameAccount':
      return 'Choose two different accounts.'
    case 'unknownAccount':
      return 'Unknown account.'
    case 'notStarted':
      return 'Start a game first.'
    default:
      return reason
  }
}

function balanceText(cents: number, name: string): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`${name} balance must be a safe integer, received ${String(cents)}`)
  }
  return `${cents} cents`
}

export function Accounts({ game }: { game: GameState | null }) {
  const [from, setFrom] = useState<AccountName>('cash')
  const [to, setTo] = useState<AccountName>('trading')
  const [amountText, setAmountText] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [trackedGame, setTrackedGame] = useState(game)
  if (trackedGame !== game) {
    setTrackedGame(game)
    setResultMessage(null)
  }

  const parsed = parsePositiveInteger(amountText, 'Amount')
  const amountError = !parsed.ok && (attempted || amountText.trim().length > 0) ? parsed.reason : null
  const balances =
    game === null
      ? ''
      : `cash=${game.accounts.cashCents} trading=${game.accounts.tradingCents} savings=${game.accounts.savingsCents}`

  useEffect(() => {
    if (balances === '') return
    debugLog('[ui]', `accounts ${balances}`)
  }, [balances])

  useEffect(() => {
    if (amountError === null) return
    debugLog('[ui]', `transfer input rejected: ${amountError}`)
  }, [amountError])

  function onAccount(value: string, which: 'from' | 'to'): void {
    if (!isAccountName(value)) {
      console.error(`[ui] rejected ${which} account ${JSON.stringify(value)}`)
      return
    }
    if (which === 'from') setFrom(value)
    else setTo(value)
    setResultMessage(null)
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setAttempted(true)
    if (!parsed.ok) {
      setResultMessage(null)
      console.error(`[ui] rejected transfer amount ${JSON.stringify(amountText)}: ${parsed.reason}`)
      debugLog('[ui]', `transfer rejected before dispatch: ${parsed.reason}`)
      return
    }
    if (game === null) {
      console.error('[ui] rejected transfer: game has not started')
      debugLog('[ui]', 'transfer rejected before dispatch: notStarted')
      setResultMessage('Start a game first.')
      return
    }
    if (game.runEnd !== null) {
      console.error('[ui] rejected transfer: run ended')
      debugLog('[ui]', 'transfer rejected before dispatch: runEnded')
      setResultMessage('The run has ended.')
      return
    }
    const outcome = dispatch({ type: 'transfer', from, to, amountCents: parsed.value })
    if (outcome.accepted) {
      setResultMessage('Transfer accepted.')
      return
    }
    setResultMessage(transferReasonText(outcome.reason ?? 'rejected'))
  }

  return (
    <section className="panel">
      <h2>Accounts</h2>
      {game === null ? (
        <p>Start a game to see balances.</p>
      ) : (
        <ul className="balance-list">
          <li>Cash: {balanceText(game.accounts.cashCents, 'cash')}</li>
          <li>Trading: {balanceText(game.accounts.tradingCents, 'trading')}</li>
          <li>Savings: {balanceText(game.accounts.savingsCents, 'savings')}</li>
        </ul>
      )}
      <form className="trade-form" onSubmit={onSubmit}>
        <label htmlFor="transfer-from">
          From{' '}
          <select id="transfer-from" value={from} onChange={(event) => onAccount(event.target.value, 'from')}>
            {ACCOUNT_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="transfer-to">
          To{' '}
          <select id="transfer-to" value={to} onChange={(event) => onAccount(event.target.value, 'to')}>
            {ACCOUNT_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="transfer-amount">
          Amount (cents){' '}
          <input
            id="transfer-amount"
            value={amountText}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setAmountText(event.target.value)
              setResultMessage(null)
            }}
          />
        </label>
        <button type="submit" disabled={game?.runEnd != null}>
          Transfer
        </button>
        {amountError !== null ? (
          <p className="trade-alert" role="alert">
            {amountError}
          </p>
        ) : null}
        {resultMessage !== null ? (
          <p
            className={resultMessage === 'Transfer accepted.' ? 'trade-ok' : 'trade-alert'}
            role={resultMessage === 'Transfer accepted.' ? 'status' : 'alert'}
          >
            {resultMessage}
          </p>
        ) : null}
      </form>
    </section>
  )
}
