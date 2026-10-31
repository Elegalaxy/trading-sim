import { useEffect, useState, type FormEvent } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { MARGIN_MIN_RATIO_DENOMINATOR, MARGIN_MIN_RATIO_NUMERATOR } from '../sim/constants.ts'
import { sessionPrice } from '../sim/session.ts'
import { interpretOrder, tradingEquity } from '../sim/trading.ts'
import { ORDER_SIDES, type GameState, type OrderSide } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { formatUsd, parseUsdToCents } from './money.ts'
import { liquidationPrice, sharesForAmount, SIZE_MODES, SIZING_LEVERAGE, type SizeMode } from './sizing.ts'
import { reasonText } from './reasons.ts'
import { dispatch, parsePositiveInteger } from './store.ts'

type OrderQuote =
  | {
      accepted: true
      quantity: number
      price: number
      fillPrice: number
      fee: number
      spreadCost: number
      equity: number
      gross: number
      netShares: number
    }
  | { accepted: false; reason: string }

type OrderType = 'market' | 'limit'

const MODE_LABEL: Record<SizeMode, string> = { quantity: 'Quantity', cost: 'Cost', value: 'Value' }

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
    case 'underOneShare':
      return 'That amount is under one share.'
    default: {
      const text = reasonText(reason)
      return text === reason ? reason : `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
    }
  }
}

/** Fill, fee, spread, and the book after the trade. The clone is not the live game. */
function quoteOrder(game: GameState, asset: string, side: OrderSide, quantity: number, fixedFill?: number): OrderQuote {
  if (game.section !== 'market') return { accepted: false, reason: 'marketClosed' }
  let clone: GameState
  try {
    clone = structuredClone(game)
  } catch (error) {
    console.error('[ui] order estimate clone failed', error)
    throw error
  }
  if (clone === game) throw new Error('order estimate must not use the live game')
  const outcome = interpretOrder(clone, MARKET_DEFINITIONS, { type: 'order', asset, side, quantity }, fixedFill)
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
    quantity,
    price: fill.price,
    fillPrice: fill.fillPrice,
    fee: fill.fee,
    spreadCost,
    equity: book.equity,
    gross: book.gross,
    netShares: clone.positions[asset]?.signedShares ?? 0,
  }
}

/** The fill price one share would get, used to turn dollars into shares. Falls back to the quote. */
function probeFillPrice(game: GameState, asset: string, side: OrderSide): number {
  const probe = quoteOrder(game, asset, side, 1)
  return probe.accepted ? probe.fillPrice : sessionPrice(game, asset)
}

type Sizing = { ok: true; quantity: number } | { ok: false; reason: string }

function sizeOrder(
  game: GameState | null,
  asset: string,
  side: OrderSide,
  mode: SizeMode,
  amountText: string,
  leverage: number,
  limitCents: number | null,
): Sizing {
  if (mode === 'quantity') {
    const parsed = parsePositiveInteger(amountText, 'Quantity')
    return parsed.ok ? { ok: true, quantity: parsed.value } : { ok: false, reason: parsed.reason }
  }
  const parsed = parseUsdToCents(amountText, MODE_LABEL[mode])
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  if (game === null) return { ok: false, reason: 'notStarted' }
  const fill = limitCents ?? probeFillPrice(game, asset, side)
  const quantity = sharesForAmount(mode, parsed.cents, leverage, fill)
  return quantity < 1 ? { ok: false, reason: 'underOneShare' } : { ok: true, quantity }
}

type OptionalUsd = { ok: true; cents: number | null } | { ok: false; reason: string }

function parseOptionalUsd(text: string, label: string): OptionalUsd {
  if (text.trim().length === 0) return { ok: true, cents: null }
  const parsed = parseUsdToCents(text, label)
  return parsed.ok ? { ok: true, cents: parsed.cents } : { ok: false, reason: parsed.reason }
}

function Estimate({ quote, leverage }: { quote: Extract<OrderQuote, { accepted: true }>; leverage: number }) {
  const value = quote.quantity * quote.fillPrice
  const cost = Math.ceil(value / leverage)
  const buyingPower = Math.max(
    0,
    quote.equity * MARGIN_MIN_RATIO_DENOMINATOR - quote.gross * MARGIN_MIN_RATIO_NUMERATOR,
  ) / MARGIN_MIN_RATIO_NUMERATOR
  const accountLeverage = quote.equity > 0 ? quote.gross / quote.equity : null
  const liq = liquidationPrice(quote.equity, quote.gross, quote.netShares, quote.price)
  return (
    <dl className="estimate">
      <div>
        <dt>Quantity</dt>
        <dd>{quote.quantity}</dd>
      </div>
      <div>
        <dt>Value (after leverage)</dt>
        <dd>{formatUsd(value, 'value')}</dd>
      </div>
      <div>
        <dt>Cost at {leverage}x (before leverage)</dt>
        <dd>{formatUsd(cost, 'cost')}</dd>
      </div>
      <div>
        <dt>Fill price</dt>
        <dd>{formatUsd(quote.fillPrice, 'fill price')}</dd>
      </div>
      <div>
        <dt>Fee</dt>
        <dd>{formatUsd(quote.fee, 'fee')}</dd>
      </div>
      <div>
        <dt>Spread cost</dt>
        <dd>{formatUsd(quote.spreadCost, 'spread')}</dd>
      </div>
      <div>
        <dt>Account leverage after</dt>
        <dd>{accountLeverage === null ? '—' : `${accountLeverage.toFixed(2)}x of 5x`}</dd>
      </div>
      <div>
        <dt>Margin ratio after</dt>
        <dd>{quote.gross === 0 ? '—' : `${((quote.equity / quote.gross) * 100).toFixed(2)}%`}</dd>
      </div>
      <div>
        <dt>Buying power left</dt>
        <dd>{formatUsd(Math.floor(buyingPower), 'buying power')}</dd>
      </div>
      <div>
        <dt>Est. liquidation price</dt>
        <dd>{liq === null ? '—' : formatUsd(liq, 'liquidation price')}</dd>
      </div>
    </dl>
  )
}

export function OrderPanel({ game, asset }: { game: GameState | null; asset: string }) {
  const [side, setSide] = useState<OrderSide>('buy')
  const [mode, setMode] = useState<SizeMode>('quantity')
  const [leverage, setLeverage] = useState<number>(1)
  const [orderType, setOrderType] = useState<OrderType>('market')
  const [limitText, setLimitText] = useState('')
  const [tpText, setTpText] = useState('')
  const [slText, setSlText] = useState('')
  const [amountText, setAmountText] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const section = game?.section ?? null
  const [trackedGame, setTrackedGame] = useState(game)
  const [trackedSection, setTrackedSection] = useState(section)
  const [trackedAsset, setTrackedAsset] = useState(asset)
  if (trackedGame !== game || trackedSection !== section || trackedAsset !== asset) {
    setTrackedGame(game)
    setTrackedSection(section)
    setTrackedAsset(asset)
    setResultMessage(null)
    setLimitText('')
    setTpText('')
    setSlText('')
  }

  const typed = amountText.trim().length > 0
  const limitParsed = orderType === 'limit' ? parseUsdToCents(limitText, 'Limit price') : null
  const limitCents = limitParsed !== null && limitParsed.ok ? limitParsed.cents : null
  const tpParsed = parseOptionalUsd(tpText, 'Take profit')
  const slParsed = parseOptionalUsd(slText, 'Stop loss')
  const sizing = sizeOrder(game, asset, side, mode, amountText, leverage, limitCents)
  const priceError =
    limitParsed !== null && !limitParsed.ok
      ? limitParsed.reason
      : !tpParsed.ok
        ? tpParsed.reason
        : !slParsed.ok
          ? slParsed.reason
          : null
  const showPriceError = priceError !== null && (attempted || limitText.length > 0 || tpText.length > 0 || slText.length > 0)
  const amountError = !sizing.ok && (attempted || typed) ? orderReasonText(sizing.reason) : null
  const quantity = sizing.ok ? sizing.quantity : 0
  const quote =
    game !== null && sizing.ok && (orderType === 'market' || limitCents !== null)
      ? quoteOrder(game, asset, side, sizing.quantity, limitCents ?? undefined)
      : null
  const quoteKey =
    quote === null
      ? ''
      : quote.accepted
        ? `accepted ${asset} ${side} ${quantity} fill=${quote.fillPrice} fee=${quote.fee} spreadCost=${quote.spreadCost} equity=${quote.equity} gross=${quote.gross}`
        : `rejected ${asset} ${side} ${quantity} ${quote.reason}`

  useEffect(() => {
    if (amountError === null) return
    debugLog('[ui]', `order input rejected: ${amountError}`)
  }, [amountError])

  useEffect(() => {
    if (quoteKey === '') return
    debugLog('[ui]', `order estimate ${quoteKey}`)
  }, [quoteKey])

  function onSide(value: string): void {
    if (!isOrderSide(value)) {
      console.error(`[ui] rejected side ${JSON.stringify(value)}`)
      return
    }
    setSide(value)
    setResultMessage(null)
  }

  function onMode(value: SizeMode): void {
    setMode(value)
    setAmountText('')
    setAttempted(false)
    setResultMessage(null)
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setAttempted(true)
    if (priceError !== null) {
      setResultMessage(null)
      return
    }
    if (!sizing.ok) {
      setResultMessage(null)
      console.error(`[ui] rejected order size ${JSON.stringify(amountText)}: ${sizing.reason}`)
      debugLog('[ui]', `order rejected before dispatch: ${sizing.reason}`)
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
    const tpCents = tpParsed.ok ? tpParsed.cents : null
    const slCents = slParsed.ok ? slParsed.cents : null
    if (orderType === 'limit') {
      const placed = dispatch({ type: 'limitOrder', asset, side, quantity: sizing.quantity, limitCents, tpCents, slCents })
      setResultMessage(placed.accepted ? 'Limit order placed.' : orderReasonText(placed.reason ?? 'rejected'))
      return
    }
    const outcome = dispatch({ type: 'order', asset, side, quantity: sizing.quantity })
    if (outcome.accepted) {
      if (tpCents !== null || slCents !== null) {
        const exits = dispatch({ type: 'setExits', asset, tpCents, slCents })
        setResultMessage(
          exits.accepted ? 'Order accepted.' : `Order filled, but the exits were not set: ${orderReasonText(exits.reason ?? 'rejected')}`,
        )
        return
      }
      setResultMessage('Order accepted.')
      return
    }
    setResultMessage(orderReasonText(outcome.reason ?? 'rejected'))
  }

  const resultSucceeded = resultMessage === 'Order accepted.' || resultMessage === 'Limit order placed.'

  return (
    <section className="panel">
      <h2>Order</h2>
      <form className="trade-form" onSubmit={onSubmit}>
        <p className="order-asset">
          Trading <strong>{asset}</strong>
        </p>
        <div className="side-toggle" role="group" aria-label="Side">
          {ORDER_SIDES.map((item) => (
            <button
              key={item}
              type="button"
              className={item === 'buy' ? 'side-buy' : 'side-sell'}
              aria-pressed={side === item}
              onClick={() => onSide(item)}
            >
              {item === 'buy' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>
        <div className="size-modes" role="group" aria-label="Order type">
          {(['market', 'limit'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={orderType === item}
              onClick={() => {
                setOrderType(item)
                setResultMessage(null)
              }}
            >
              {item === 'market' ? 'Market' : 'Limit'}
            </button>
          ))}
        </div>
        {orderType === 'limit' ? (
          <label htmlFor="order-limit">
            Limit price ${' '}
            <input
              id="order-limit"
              value={limitText}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setLimitText(event.target.value)
                setResultMessage(null)
              }}
            />
          </label>
        ) : null}
        <div className="size-modes" role="group" aria-label="Size by">
          {SIZE_MODES.map((item) => (
            <button key={item} type="button" aria-pressed={mode === item} onClick={() => onMode(item)}>
              {MODE_LABEL[item]}
            </button>
          ))}
        </div>
        <div className="size-modes" role="group" aria-label="Leverage for cost and value">
          {SIZING_LEVERAGE.map((item) => (
            <button key={item} type="button" aria-pressed={leverage === item} onClick={() => setLeverage(item)}>
              {item}x
            </button>
          ))}
        </div>
        <label htmlFor="order-amount">
          {mode === 'quantity' ? 'Quantity (shares)' : mode === 'cost' ? `Cost in $ (x${leverage})` : 'Value in $'}{' '}
          <input
            id="order-amount"
            value={amountText}
            inputMode={mode === 'quantity' ? 'numeric' : 'decimal'}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setAmountText(event.target.value)
              setResultMessage(null)
            }}
          />
        </label>
        <div className="exit-inputs">
          <label htmlFor="order-tp">
            Take profit ${' '}
            <input
              id="order-tp"
              value={tpText}
              placeholder="optional"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTpText(event.target.value)}
            />
          </label>
          <label htmlFor="order-sl">
            Stop loss ${' '}
            <input
              id="order-sl"
              value={slText}
              placeholder="optional"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setSlText(event.target.value)}
            />
          </label>
        </div>
        <button
          type="submit"
          className={side === 'buy' ? 'submit-buy' : 'submit-sell'}
          disabled={game?.runEnd != null || (quote !== null && !quote.accepted)}
        >
          {side === 'buy' ? 'Buy' : 'Sell'} {asset}
          {orderType === 'limit' ? ' limit' : ''}
        </button>
        {game !== null ? (
          <p className="day-note">
            Orders use the trading account ({formatUsd(game.accounts.tradingCents, 'trading')}), not cash. Leverage
            here only sizes the order. The real limit is 5x across the account.
          </p>
        ) : null}
        {showPriceError ? (
          <p className="trade-alert" role="alert">
            {priceError}
          </p>
        ) : amountError !== null ? (
          <p className="trade-alert" role="alert">
            {amountError}
          </p>
        ) : game === null ? (
          <p>Start a game to estimate an order.</p>
        ) : quote === null ? null : quote.accepted ? (
          <Estimate quote={quote} leverage={leverage} />
        ) : (
          <p className="trade-alert" role="alert">
            {orderReasonText(quote.reason)}
          </p>
        )}
        {resultMessage !== null ? (
          <p
            className={resultSucceeded ? 'trade-ok' : 'trade-alert'}
            role={resultSucceeded ? 'status' : 'alert'}
          >
            {resultMessage}
          </p>
        ) : null}
      </form>
    </section>
  )
}
