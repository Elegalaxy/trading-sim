import { useEffect, useState, type FormEvent } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { interpretOrder, tradingEquity } from '../sim/trading.ts'
import { ORDER_SIDES, type GameState, type OrderSide } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { dispatch, parsePositiveInteger } from './store.ts'

type OrderQuote =
  | {
      accepted: true
      fillPrice: number
      fee: number
      spreadCost: number
      equity: number
      gross: number
    }
  | { accepted: false; reason: string }

function isOrderSide(value: string): value is OrderSide {
  return (ORDER_SIDES as readonly string[]).includes(value)
}

function orderReasonText(reason: string): string {
  switch (reason) {
    case 'insufficientBuyingPower':
      return 'Too little buying power.'
    case 'insufficientTradingCash':
      return 'Too little trading cash.'
    case 'unknownAsset':
      return 'Unknown asset.'
    case 'notStarted':
      return 'Start a game first.'
    case 'marketClosed':
      return 'The market is closed.'
    default:
      return reason
  }
}

function ratioAfterText(equity: number, gross: number): string {
  if (gross === 0) return 'There is no margin ratio after this trade.'
  if (!Number.isSafeInteger(equity) || !Number.isSafeInteger(gross) || gross < 0) {
    throw new Error(`margin ratio after the trade needs safe equity and gross, received ${equity} / ${gross}`)
  }
  const percent = (equity / gross) * 100
  if (!Number.isFinite(percent)) throw new Error('margin ratio after the trade is not finite')
  return `Margin ratio after the trade: ${percent.toFixed(2)}%.`
}

/** Fill, fee, spread, and the ratio after the trade. The clone is not the live game. */
function quoteOrder(game: GameState, asset: string, side: OrderSide, quantity: number): OrderQuote {
  if (game.section !== 'market') return { accepted: false, reason: 'marketClosed' }
  let clone: GameState
  try {
    clone = structuredClone(game)
  } catch (error) {
    console.error('[ui] order estimate clone failed', error)
    throw error
  }
  if (clone === game) throw new Error('order estimate must not use the live game')
  const outcome = interpretOrder(clone, MARKET_DEFINITIONS, { type: 'order', asset, side, quantity })
  if (!outcome.accepted) {
    const rejection = outcome.events.find((event) => event.kind === 'commandRejected')
    const reason = rejection !== undefined && rejection.kind === 'commandRejected' ? rejection.reason : 'rejected'
    return { accepted: false, reason }
  }
  const fill = outcome.events.find((event) => event.kind === 'orderFill')
  if (fill === undefined || fill.kind !== 'orderFill') {
    throw new Error('accepted order estimate did not include a fill')
  }
  const spreadCost = fill.quantity * fill.halfSpread
  if (!Number.isSafeInteger(spreadCost)) {
    throw new Error(`spread cost is not a safe integer, received ${String(spreadCost)}`)
  }
  const book = tradingEquity(clone, MARKET_DEFINITIONS)
  return {
    accepted: true,
    fillPrice: fill.fillPrice,
    fee: fill.fee,
    spreadCost,
    equity: book.equity,
    gross: book.gross,
  }
}

export function OrderPanel({ game }: { game: GameState | null }) {
  const assets = MARKET_DEFINITIONS.assets
  const first = assets[0]?.id ?? 'NOVA'
  const [asset, setAsset] = useState(first)
  const [side, setSide] = useState<OrderSide>('buy')
  const [quantityText, setQuantityText] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const section = game?.section ?? null
  const [trackedGame, setTrackedGame] = useState(game)
  const [trackedSection, setTrackedSection] = useState(section)
  if (trackedGame !== game || trackedSection !== section) {
    setTrackedGame(game)
    setTrackedSection(section)
    setResultMessage(null)
  }

  const parsed = parsePositiveInteger(quantityText, 'Quantity')
  const quantityError = !parsed.ok && (attempted || quantityText.trim().length > 0) ? parsed.reason : null
  const quote = game !== null && parsed.ok ? quoteOrder(game, asset, side, parsed.value) : null
  const quoteKey =
    quote === null
      ? ''
      : quote.accepted
        ? `accepted ${asset} ${side} ${parsed.ok ? parsed.value : 0} fill=${quote.fillPrice} fee=${quote.fee} spreadCost=${quote.spreadCost} equity=${quote.equity} gross=${quote.gross}`
        : `rejected ${asset} ${side} ${parsed.ok ? parsed.value : 0} ${quote.reason}`

  useEffect(() => {
    if (quantityError === null) return
    debugLog('[ui]', `order input rejected: ${quantityError}`)
  }, [quantityError])

  useEffect(() => {
    if (quoteKey === '') return
    debugLog('[ui]', `order estimate ${quoteKey}`)
  }, [quoteKey])

  function onAsset(value: string): void {
    if (!assets.some((item) => item.id === value)) {
      console.error(`[ui] rejected asset ${JSON.stringify(value)}`)
      return
    }
    setAsset(value)
    setResultMessage(null)
  }

  function onSide(value: string): void {
    if (!isOrderSide(value)) {
      console.error(`[ui] rejected side ${JSON.stringify(value)}`)
      return
    }
    setSide(value)
    setResultMessage(null)
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setAttempted(true)
    if (!parsed.ok) {
      setResultMessage(null)
      console.error(`[ui] rejected quantity ${JSON.stringify(quantityText)}: ${parsed.reason}`)
      debugLog('[ui]', `order rejected before dispatch: ${parsed.reason}`)
      return
    }
    if (game === null) {
      console.error('[ui] rejected order: game has not started')
      debugLog('[ui]', 'order rejected before dispatch: notStarted')
      setResultMessage('Start a game first.')
      return
    }
    if (game.runEnd !== null) {
      console.error('[ui] rejected order: run ended')
      debugLog('[ui]', 'order rejected before dispatch: runEnded')
      setResultMessage('The run has ended.')
      return
    }
    const outcome = dispatch({ type: 'order', asset, side, quantity: parsed.value })
    if (outcome.accepted) {
      setResultMessage('Order accepted.')
      return
    }
    setResultMessage(orderReasonText(outcome.reason ?? 'rejected'))
  }

  return (
    <section className="panel">
      <h2>Order</h2>
      <form className="trade-form" onSubmit={onSubmit}>
        <label htmlFor="order-asset">
          Asset{' '}
          <select id="order-asset" value={asset} onChange={(event) => onAsset(event.target.value)}>
            {assets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="order-side">
          Side{' '}
          <select id="order-side" value={side} onChange={(event) => onSide(event.target.value)}>
            {ORDER_SIDES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="order-quantity">
          Quantity{' '}
          <input
            id="order-quantity"
            value={quantityText}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuantityText(event.target.value)
              setResultMessage(null)
            }}
          />
        </label>
        <button type="submit" disabled={game?.runEnd != null}>
          Place order
        </button>
        {quantityError !== null ? (
          <p className="trade-alert" role="alert">
            {quantityError}
          </p>
        ) : game === null ? (
          <p>Start a game to estimate an order.</p>
        ) : quote === null ? null : quote.accepted ? (
          <div className="estimate">
            <p>Estimated fill price: {quote.fillPrice} cents</p>
            <p>Fee: {quote.fee} cents</p>
            <p>Spread cost: {quote.spreadCost} cents</p>
            <p>{ratioAfterText(quote.equity, quote.gross)}</p>
          </div>
        ) : (
          <p className="trade-alert" role="alert">
            {orderReasonText(quote.reason)}
          </p>
        )}
        {resultMessage !== null ? (
          <p
            className={resultMessage === 'Order accepted.' ? 'trade-ok' : 'trade-alert'}
            role={resultMessage === 'Order accepted.' ? 'status' : 'alert'}
          >
            {resultMessage}
          </p>
        ) : null}
      </form>
    </section>
  )
}
