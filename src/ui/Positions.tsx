import { useEffect, useState } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { sessionPrice } from '../sim/session.ts'
import { leverageOf } from '../sim/trading.ts'
import type { ExitKind, ExitLevel, GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { formatSignedUsd, formatUsd, parseUsdToCents } from './money.ts'
import { unrealizedCents } from './account.ts'
import { reasonText } from './reasons.ts'
import { dispatch, parsePositiveInteger } from './store.ts'

type PositionRow = {
  asset: string
  side: 'long' | 'short'
  shares: number
  leverage: number
  costCents: number
  price: number
  pnl: number
}

function formatAverage(costCents: number, shares: number): string {
  if (!Number.isSafeInteger(costCents) || !Number.isSafeInteger(shares) || shares <= 0) {
    throw new Error(`entry average expected a safe cost over positive shares, received ${costCents} / ${shares}`)
  }
  if (costCents % shares === 0) return formatUsd(costCents / shares, 'entry average')
  const dollars = costCents / shares / 100
  if (!Number.isFinite(dollars)) throw new Error(`entry average is not finite for ${costCents} / ${shares}`)
  return `$${dollars.toFixed(4)}`
}

function positionRows(game: GameState): PositionRow[] {
  const known = new Set(MARKET_DEFINITIONS.assets.map((def) => def.id))
  for (const id of Object.keys(game.positions)) {
    if (!known.has(id)) throw new Error(`position ${id} is not an asset`)
  }
  const rows: PositionRow[] = []
  for (const def of MARKET_DEFINITIONS.assets) {
    const position = game.positions[def.id]
    if (position === undefined) continue
    const price = sessionPrice(game, def.id)
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new Error(`position ${def.id} price must be a positive safe integer, received ${String(price)}`)
    }
    const shares = Math.abs(position.signedShares)
    const side = position.signedShares > 0 ? 'long' : 'short'
    rows.push({
      asset: def.id,
      side,
      shares,
      leverage: leverageOf(position),
      costCents: position.costCents,
      price,
      pnl: unrealizedCents(price, position.signedShares, position.costCents),
    })
  }
  return rows
}

type Action = 'close' | 'half' | 'flip'

/** The order that closes, halves or reverses a position. Null when it makes no sense. */
function actionOrder(row: PositionRow, action: Action): { side: 'buy' | 'sell'; quantity: number } | null {
  const side = row.side === 'long' ? 'sell' : 'buy'
  if (action === 'close') return { side, quantity: row.shares }
  if (action === 'half') {
    const quantity = Math.floor(row.shares / 2)
    return quantity < 1 ? null : { side, quantity }
  }
  return { side, quantity: row.shares * 2 }
}


type Message = { ok: boolean; text: string }

const KIND_LABEL: Record<ExitKind, string> = { takeProfit: 'TP', stopLoss: 'SL' }

/** Levels of one position, take profits then stop losses, each nearest the price first. */
function sortedLevels(levels: readonly ExitLevel[], side: 'long' | 'short'): ExitLevel[] {
  const rank = (level: ExitLevel) => (level.kind === 'takeProfit' ? 0 : 1)
  return levels.slice().sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    // A long's targets rise from the price and its stops fall from it. A short's the other way.
    const up = (a.kind === 'takeProfit') === (side === 'long')
    return up ? a.priceCents - b.priceCents : b.priceCents - a.priceCents
  })
}

function sharesText(quantity: number | null): string {
  return quantity === null ? 'all' : `${quantity} sh`
}

/** `TP $50.00 (4 sh), $52.00 (all) / SL $46.00 (all)` for the table cell. */
function levelsSummary(levels: readonly ExitLevel[], side: 'long' | 'short'): string {
  if (levels.length === 0) return '—'
  const sorted = sortedLevels(levels, side)
  const part = (kind: ExitKind) => {
    const items = sorted.filter((level) => level.kind === kind)
    if (items.length === 0) return `${KIND_LABEL[kind]} —`
    return `${KIND_LABEL[kind]} ${items.map((level) => `${formatUsd(level.priceCents, 'exit')} (${sharesText(level.quantity)})`).join(', ')}`
  }
  return `${part('takeProfit')} / ${part('stopLoss')}`
}

/**
 * Take profit and stop loss levels for one position. Each level closes its shares, or the
 * whole position when the shares box is empty. Up to four of each kind.
 */
function ExitsEditor({
  row,
  levels,
  onDone,
}: {
  row: PositionRow
  levels: readonly ExitLevel[]
  onDone: (message: Message) => void
}) {
  const [kind, setKind] = useState<ExitKind>('takeProfit')
  const [priceText, setPriceText] = useState('')
  const [sharesInput, setSharesInput] = useState('')
  const asset = row.asset

  function onAdd(): void {
    const price = parseUsdToCents(priceText, kind === 'takeProfit' ? 'Take profit' : 'Stop loss')
    if (!price.ok) return onDone({ ok: false, text: price.reason })
    let quantity: number | undefined
    if (sharesInput.trim().length > 0) {
      const parsed = parsePositiveInteger(sharesInput, 'Shares')
      if (!parsed.ok) return onDone({ ok: false, text: parsed.reason })
      quantity = parsed.value
    }
    const outcome = dispatch({ type: 'addExit', asset, kind, priceCents: price.cents, ...(quantity === undefined ? {} : { quantity }) })
    if (!outcome.accepted) return onDone({ ok: false, text: `${asset}: ${reasonText(outcome.reason ?? 'rejected')}.` })
    setPriceText('')
    setSharesInput('')
    onDone({ ok: true, text: `${asset} ${KIND_LABEL[kind]} added.` })
  }

  function onRemove(level: ExitLevel): void {
    const outcome = dispatch({ type: 'cancelExit', asset, id: level.id })
    onDone(
      outcome.accepted
        ? { ok: true, text: `${asset} ${KIND_LABEL[level.kind]} ${formatUsd(level.priceCents, 'exit')} removed.` }
        : { ok: false, text: `${asset}: ${reasonText(outcome.reason ?? 'rejected')}.` },
    )
  }

  return (
    <div className="exits-editor">
      {levels.length > 0 ? (
        <ul className="exit-levels">
          {sortedLevels(levels, row.side).map((level) => (
            <li key={level.id}>
              <span className={level.kind === 'takeProfit' ? 'pnl-gain' : 'pnl-loss'}>
                {KIND_LABEL[level.kind]} {formatUsd(level.priceCents, 'exit')}
              </span>{' '}
              closes {level.quantity === null ? 'the rest' : `${level.quantity} of ${row.shares}`}
              <button type="button" onClick={() => onRemove(level)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="day-note">No exits yet.</p>
      )}
      <div className="exit-add">
        <div className="size-modes" role="group" aria-label="Exit kind">
          {(['takeProfit', 'stopLoss'] as const).map((item) => (
            <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)}>
              {item === 'takeProfit' ? 'Take profit' : 'Stop loss'}
            </button>
          ))}
        </div>
        <label>
          Price ${' '}
          <input value={priceText} onChange={(event) => setPriceText(event.target.value)} inputMode="decimal" autoComplete="off" />
        </label>
        <label>
          Shares{' '}
          <input
            value={sharesInput}
            placeholder="all"
            onChange={(event) => setSharesInput(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
        <div className="size-modes" role="group" aria-label="Part of the position">
          {[25, 50, 75].map((percent) => (
            <button
              key={percent}
              type="button"
              disabled={row.shares < 2}
              onClick={() => setSharesInput(String(Math.max(1, Math.floor((row.shares * percent) / 100))))}
            >
              {percent}%
            </button>
          ))}
        </div>
        <button type="button" onClick={onAdd}>
          Add
        </button>
      </div>
    </div>
  )
}

export function Positions({
  game,
  onSelect,
  selected,
}: {
  game: GameState | null
  onSelect?: (asset: string) => void
  selected?: string
}) {
  const [message, setMessage] = useState<Message | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const rows = game === null ? [] : positionRows(game)
  const signature =
    game === null ? 'none' : rows.map((row) => `${row.asset} ${row.side} ${row.shares} pnl=${row.pnl}`).join(', ')

  useEffect(() => {
    debugLog('[ui]', `positions ${signature === '' ? 'flat' : signature}`)
  }, [signature])

  const canTrade = game !== null && game.runEnd === null && game.section === 'market'

  function run(row: PositionRow, action: Action): boolean {
    const order = actionOrder(row, action)
    if (order === null) return false
    const outcome = dispatch({ type: 'order', asset: row.asset, side: order.side, quantity: order.quantity })
    if (!outcome.accepted) {
      setMessage({ ok: false, text: `${row.asset}: ${reasonText(outcome.reason ?? 'rejected')}.` })
      return false
    }
    return true
  }

  function onAction(row: PositionRow, action: Action): void {
    if (run(row, action)) {
      const label = action === 'close' ? 'closed' : action === 'half' ? 'halved' : 'reversed'
      setMessage({ ok: true, text: `${row.asset} ${label}.` })
    }
  }

  function onCloseAll(): void {
    let failed = 0
    for (const row of rows) if (!run(row, 'close')) failed += 1
    if (failed === 0) setMessage({ ok: true, text: 'All positions closed.' })
  }

  return (
    <section className="panel">
      <h2>
        Positions
        {rows.length > 0 ? (
          <button type="button" className="close-all" onClick={onCloseAll} disabled={!canTrade}>
            Close all
          </button>
        ) : null}
      </h2>
      {game !== null && game.resting.orders.length > 0 ? (
        <div className="open-orders">
          <h3>Open orders</h3>
          <ul>
            {game.resting.orders.map((order) => (
              <li key={order.id}>
                <span>
                  {order.side === 'buy' ? 'Buy' : 'Sell'} {order.quantity} {order.asset} limit{' '}
                  {formatUsd(order.limitCents, 'limit')}
                  {order.tpCents === null ? '' : ` · TP ${formatUsd(order.tpCents, 'take profit')}`}
                  {order.slCents === null ? '' : ` · SL ${formatUsd(order.slCents, 'stop loss')}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const outcome = dispatch({ type: 'cancelOrder', id: order.id })
                    setMessage(
                      outcome.accepted
                        ? { ok: true, text: 'Order cancelled.' }
                        : { ok: false, text: reasonText(outcome.reason ?? 'rejected') },
                    )
                  }}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!canTrade && rows.length > 0 ? <p className="day-note">Open the market to close or change a position.</p> : null}
      {game === null ? (
        <p>Start a game to see positions.</p>
      ) : rows.length === 0 ? (
        <p>No open positions.</p>
      ) : (
        <div className="table-wrap">
          <table className="positions-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Side</th>
                <th>Shares</th>
                <th>Lev</th>
                <th>Entry average</th>
                <th>Price</th>
                <th>Unrealized</th>
                <th>TP / SL</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((row) => {
                const exit = game?.resting.exits[row.asset]
                const levels = exit !== undefined && exit.side === row.side ? exit.levels : []
                return [
                <tr key={row.asset} aria-selected={row.asset === selected}>
                  <td>
                    {onSelect === undefined ? (
                      row.asset
                    ) : (
                      <button type="button" className="link-button" onClick={() => onSelect(row.asset)} title="Show this chart">
                        {row.asset}
                      </button>
                    )}
                  </td>
                  <td className={row.side === 'long' ? 'side-long' : 'side-short'}>{row.side}</td>
                  <td>{row.shares}</td>
                  <td>{row.leverage}x</td>
                  <td>{formatAverage(row.costCents, row.shares)}</td>
                  <td>{formatUsd(row.price, 'price')}</td>
                  <td className={row.pnl > 0 ? 'pnl-gain' : row.pnl < 0 ? 'pnl-loss' : undefined}>
                    {formatSignedUsd(row.pnl, 'unrealized')}
                  </td>
                  <td className="exit-summary">{levelsSummary(levels, row.side)}</td>
                  <td className="manage">
                    <button type="button" onClick={() => onAction(row, 'close')} disabled={!canTrade}>
                      Close
                    </button>
                    <button type="button" onClick={() => onAction(row, 'half')} disabled={!canTrade || row.shares < 2} title="Close half">
                      1/2
                    </button>
                    <button type="button" onClick={() => onAction(row, 'flip')} disabled={!canTrade} title="Reverse to the other side">
                      Flip
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(editing === row.asset ? null : row.asset)}
                      disabled={!canTrade}
                      aria-expanded={editing === row.asset}
                      title="Set take profit and stop loss"
                    >
                      TP/SL
                    </button>
                  </td>
                </tr>,
                ...(editing === row.asset
                  ? [
                      <tr key={`${row.asset}-exits`}>
                        <td colSpan={9}>
                          <ExitsEditor row={row} levels={levels} onDone={setMessage} />
                        </td>
                      </tr>,
                    ]
                  : []),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
      {message !== null ? (
        <p className={message.ok ? 'trade-ok' : 'trade-alert'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
