import { useEffect, useState, type FormEvent } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { DEFAULT_LEVERAGE } from '../sim/constants.ts'
import { previewCopy } from '../sim/past.ts'
import { sessionPrice } from '../sim/session.ts'
import { interpretOrder, leverageOf, tradingEquity } from '../sim/trading.ts'
import { ORDER_SIDES, type GameState, type OrderSide } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { formatSignedUsd, formatUsd, parseUsdToCents } from './money.ts'
import { liquidationPrice, sharesForAmount, SIZE_MODES, SIZING_LEVERAGE, type SizeMode } from './sizing.ts'
import { accountSummary } from './account.ts'
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
      slippageCost: number
      equity: number
      gross: number
      required: number
      netShares: number
      /** Leverage of this asset's position after the order. */
      leverage: number
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
function quoteOrder(
  game: GameState,
  asset: string,
  side: OrderSide,
  quantity: number,
  fixedFill?: number,
  leverage?: number,
): OrderQuote {
  if (game.section !== 'market') return { accepted: false, reason: 'marketClosed' }
  let clone: GameState
  try {
    clone = previewCopy(game)
  } catch (error) {
    console.error('[ui] order estimate clone failed', error)
    throw error
  }
  if (clone === game) throw new Error('order estimate must not use the live game')
  const outcome = interpretOrder(clone, MARKET_DEFINITIONS, { type: 'order', asset, side, quantity, leverage }, fixedFill)
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
  const slippageCost = fill.quantity * (fill.slippage ?? 0)
  if (!Number.isSafeInteger(slippageCost)) {
    throw new Error(`slippage cost is not a safe integer, received ${String(slippageCost)}`)
  }
  const book = tradingEquity(clone, MARKET_DEFINITIONS)
  return {
    accepted: true,
    quantity,
    price: fill.price,
    fillPrice: fill.fillPrice,
    fee: fill.fee,
    spreadCost,
    slippageCost,
    equity: book.equity,
    gross: book.gross,
    required: book.required,
    netShares: clone.positions[asset]?.signedShares ?? 0,
    leverage: leverageOf(clone.positions[asset]),
  }
}

/** The fill price one share would get, used to turn dollars into shares. Falls back to the quote. */
function probeFillPrice(game: GameState, asset: string, side: OrderSide, leverage: number): number {
  const probe = quoteOrder(game, asset, side, 1, undefined, leverage)
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
  const fill = limitCents ?? probeFillPrice(game, asset, side, leverage)
  const quantity = sharesForAmount(mode, parsed.cents, leverage, fill)
  return quantity < 1 ? { ok: false, reason: 'underOneShare' } : { ok: true, quantity }
}

type OptionalUsd = { ok: true; cents: number | null } | { ok: false; reason: string }

function parseOptionalUsd(text: string, label: string): OptionalUsd {
  if (text.trim().length === 0) return { ok: true, cents: null }
  const parsed = parseUsdToCents(text, label)
  return parsed.ok ? { ok: true, cents: parsed.cents } : { ok: false, reason: parsed.reason }
}

/** What the account has now, before this order. Floating P&L is already inside equity. */
function AccountBox({ game, leverage }: { game: GameState; leverage: number }) {
  const account = accountSummary(game)
  return (
    <dl className="estimate account-box">
      <div title="Cash in the trading account. Negative means you are borrowing on margin.">
        <dt>Balance</dt>
        <dd>{formatUsd(account.balance, 'balance')}</dd>
      </div>
      <div title="Profit or loss on open positions at the current price. Not locked in until you close.">
        <dt>Floating P&amp;L</dt>
        <dd className={account.floating > 0 ? 'pnl-gain' : account.floating < 0 ? 'pnl-loss' : undefined}>
          {formatSignedUsd(account.floating, 'floating')}
        </dd>
      </div>
      <div title="What the account is worth now: balance plus open positions at the current price.">
        <dt>Equity</dt>
        <dd>{formatUsd(account.equity, 'equity')}</dd>
      </div>
      <div title="Margin the open positions tie up: each position's value divided by its leverage.">
        <dt>Margin used</dt>
        <dd>{formatUsd(account.required, 'margin used')}</dd>
      </div>
      <div title="Equity not tied up as margin. A new order of value V at leverage L uses V / L of it.">
        <dt>Free margin</dt>
        <dd>{formatUsd(account.freeMargin, 'free margin')}</dd>
      </div>
      <div title="The largest order value your free margin allows at the leverage selected below.">
        <dt>Max order at {leverage}x</dt>
        <dd>{formatUsd(Math.max(0, Math.floor(account.freeMargin * leverage)), 'max order')}</dd>
      </div>
    </dl>
  )
}

function Estimate({
  quote,
  requiredBefore,
}: {
  quote: Extract<OrderQuote, { accepted: true }>
  requiredBefore: number | null
}) {
  const value = quote.quantity * quote.fillPrice
  const change = requiredBefore === null ? null : quote.required - requiredBefore
  const freeAfter = quote.equity - quote.required
  const liq = liquidationPrice(quote.equity, quote.required, quote.netShares, quote.price, quote.leverage)
  return (
    <dl className="estimate">
      <div>
        <dt>Quantity</dt>
        <dd>{quote.quantity}</dd>
      </div>
      <div>
        <dt>Leverage</dt>
        <dd>{quote.netShares === 0 ? '—' : `${quote.leverage}x`}</dd>
      </div>
      <div>
        <dt>Order value</dt>
        <dd>{formatUsd(value, 'value')}</dd>
      </div>
      <div title="Margin this order ties up (or frees, if it reduces a position): its value divided by the leverage.">
        <dt>Margin</dt>
        <dd>{change === null ? '—' : formatSignedUsd(change, 'margin change')}</dd>
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
      {quote.slippageCost === 0 ? null : (
        <div
          title="This order is large next to the trading in the current 15-minute bar, so it fills worse than the quote. A smaller order, or one placed when the market is busier, pays less."
        >
          <dt>Slippage</dt>
          <dd>{formatUsd(quote.slippageCost, 'slippage')}</dd>
        </div>
      )}
      <div title="Equity left over after this order's margin. Below zero the order is rejected.">
        <dt>Free margin after</dt>
        <dd>{formatUsd(freeAfter, 'free margin after')}</dd>
      </div>
      <div title="Equity as a share of margin used. 100% is fully used, 75% warns, 50% liquidates at the close.">
        <dt>Margin level after</dt>
        <dd>{quote.required === 0 ? '—' : `${((quote.equity / quote.required) * 100).toFixed(0)}%`}</dd>
      </div>
      <div>
        <dt>Est. liquidation price</dt>
        <dd>{liq === null ? '—' : formatUsd(liq, 'liquidation price')}</dd>
      </div>
    </dl>
  )
}

/** Share of the order an attached take profit or stop loss closes. 100 means the whole position. */
const EXIT_SIZES = [100, 75, 50, 25] as const
type ExitSize = (typeof EXIT_SIZES)[number]

/** Shares for a partial exit, or undefined for the whole position. */
function exitShares(size: ExitSize, quantity: number): number | undefined {
  return size === 100 ? undefined : Math.max(1, Math.floor((quantity * size) / 100))
}

function ExitSizeSelect({ id, label, value, onChange }: { id: string; label: string; value: ExitSize; onChange: (size: ExitSize) => void }) {
  return (
    <label htmlFor={id} className="exit-size">
      {label}{' '}
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const next = EXIT_SIZES.find((size) => String(size) === event.target.value)
          if (next !== undefined) onChange(next)
        }}
      >
        {EXIT_SIZES.map((size) => (
          <option key={size} value={size}>
            {size === 100 ? 'all' : `${size}% of order`}
          </option>
        ))}
      </select>
    </label>
  )
}

export function OrderPanel({ game, asset }: { game: GameState | null; asset: string }) {
  const [side, setSide] = useState<OrderSide>('buy')
  const [mode, setMode] = useState<SizeMode>('quantity')
  const [chosenLeverage, setChosenLeverage] = useState<number>(DEFAULT_LEVERAGE)
  const [orderType, setOrderType] = useState<OrderType>('market')
  const [limitText, setLimitText] = useState('')
  const [tpText, setTpText] = useState('')
  const [slText, setSlText] = useState('')
  const [tpSize, setTpSize] = useState<ExitSize>(100)
  const [slSize, setSlSize] = useState<ExitSize>(100)
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

  // Adding to an open position keeps its leverage, so the buttons lock to it.
  const held = game?.positions[asset]
  const addsToHeld = held !== undefined && ((held.signedShares > 0 && side === 'buy') || (held.signedShares < 0 && side === 'sell'))
  const leverage = addsToHeld ? leverageOf(held) : chosenLeverage
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
      ? quoteOrder(game, asset, side, sizing.quantity, limitCents ?? undefined, leverage)
      : null
  const quoteKey =
    quote === null
      ? ''
      : quote.accepted
        ? `accepted ${asset} ${side} ${quantity} fill=${quote.fillPrice} fee=${quote.fee} spreadCost=${quote.spreadCost} slippageCost=${quote.slippageCost} equity=${quote.equity} gross=${quote.gross}`
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
    const tpQuantity = tpCents === null ? undefined : exitShares(tpSize, sizing.quantity)
    const slQuantity = slCents === null ? undefined : exitShares(slSize, sizing.quantity)
    if (orderType === 'limit') {
      const placed = dispatch({
        type: 'limitOrder',
        asset,
        side,
        quantity: sizing.quantity,
        limitCents,
        tpCents,
        slCents,
        ...(tpQuantity === undefined ? {} : { tpQuantity }),
        ...(slQuantity === undefined ? {} : { slQuantity }),
        leverage,
      })
      setResultMessage(placed.accepted ? 'Limit order placed.' : orderReasonText(placed.reason ?? 'rejected'))
      return
    }
    const outcome = dispatch({ type: 'order', asset, side, quantity: sizing.quantity, leverage })
    if (outcome.accepted) {
      // Whole-position exits go through setExits, partial ones are added as levels.
      const commands: object[] = []
      const whole: { tpCents?: number; slCents?: number } = {}
      if (tpCents !== null && tpQuantity === undefined) whole.tpCents = tpCents
      if (slCents !== null && slQuantity === undefined) whole.slCents = slCents
      if (Object.keys(whole).length > 0) commands.push({ type: 'setExits', asset, ...whole })
      if (tpCents !== null && tpQuantity !== undefined) {
        commands.push({ type: 'addExit', asset, kind: 'takeProfit', priceCents: tpCents, quantity: tpQuantity })
      }
      if (slCents !== null && slQuantity !== undefined) {
        commands.push({ type: 'addExit', asset, kind: 'stopLoss', priceCents: slCents, quantity: slQuantity })
      }
      for (const command of commands) {
        const exits = dispatch(command)
        if (!exits.accepted) {
          setResultMessage(`Order filled, but the exits were not set: ${orderReasonText(exits.reason ?? 'rejected')}`)
          return
        }
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
        {game !== null ? <AccountBox game={game} leverage={leverage} /> : null}
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
        <div className="size-modes leverage-modes" role="group" aria-label="Leverage">
          {SIZING_LEVERAGE.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={leverage === item}
              disabled={addsToHeld}
              onClick={() => setChosenLeverage(item)}
            >
              {item}x
            </button>
          ))}
        </div>
        {addsToHeld ? <p className="day-note">Adding to your open {asset} position, so it keeps {leverage}x.</p> : null}
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
          <ExitSizeSelect id="order-tp-size" label="TP closes" value={tpSize} onChange={setTpSize} />
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
          <ExitSizeSelect id="order-sl-size" label="SL closes" value={slSize} onChange={setSlSize} />
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
            Orders use the trading account, not cash. Equity is balance plus floating P&amp;L. Each position needs its value
            divided by its leverage as margin, and the sum of all margins cannot exceed equity.
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
          <Estimate quote={quote} requiredBefore={game === null ? null : accountSummary(game).required} />
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
