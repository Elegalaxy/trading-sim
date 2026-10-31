import { useEffect, useState } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { sessionPrice } from '../sim/session.ts'
import type { GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { formatSignedUsd, formatUsd, parseUsdToCents } from './money.ts'
import { reasonText } from './reasons.ts'
import { dispatch } from './store.ts'

type PositionRow = {
  asset: string
  side: 'long' | 'short'
  shares: number
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

/**
 * Long P&L is (price - average) * shares.
 * Short P&L is (average - price) * abs(shares).
 * average is costCents / abs(signedShares).
 */
function unrealizedCents(price: number, signedShares: number, costCents: number): number {
  const shares = Math.abs(signedShares)
  if (!Number.isSafeInteger(shares) || shares <= 0) {
    throw new Error(`position shares must be a positive safe integer, received ${String(signedShares)}`)
  }
  if (!Number.isSafeInteger(price) || price <= 0) {
    throw new Error(`position price must be a positive safe integer, received ${String(price)}`)
  }
  if (!Number.isSafeInteger(costCents) || costCents < 0) {
    throw new Error(`position cost must be a safe integer >= 0, received ${String(costCents)}`)
  }
  const average = costCents / shares
  const pnl = signedShares > 0 ? (price - average) * shares : (average - price) * shares
  if (!Number.isFinite(pnl)) throw new Error(`unrealized P&L is not finite for ${String(signedShares)} shares`)
  const cents = Math.round(pnl)
  if (!Number.isSafeInteger(cents) || Math.abs(pnl - cents) > 1e-3) {
    throw new Error(`unrealized P&L ${String(pnl)} is not a whole number of cents`)
  }
  return cents
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


function dollarsText(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2)
}

type Message = { ok: boolean; text: string }
type ExitCents = { ok: true; cents: number | null } | { ok: false; reason: string }

function parseExit(text: string, label: string): ExitCents {
  if (text.trim().length === 0) return { ok: true, cents: null }
  const parsed = parseUsdToCents(text, label)
  return parsed.ok ? { ok: true, cents: parsed.cents } : { ok: false, reason: parsed.reason }
}

/** Inline take profit and stop loss editor for one position. An empty box clears that exit. */
function ExitsEditor({
  asset,
  tp,
  sl,
  onDone,
}: {
  asset: string
  tp: number | null
  sl: number | null
  onDone: (message: Message) => void
}) {
  const [tpText, setTpText] = useState(dollarsText(tp))
  const [slText, setSlText] = useState(dollarsText(sl))

  function onSet(): void {
    const nextTp = parseExit(tpText, 'Take profit')
    const nextSl = parseExit(slText, 'Stop loss')
    if (!nextTp.ok) return onDone({ ok: false, text: nextTp.reason })
    if (!nextSl.ok) return onDone({ ok: false, text: nextSl.reason })
    const cmd: { type: 'setExits'; asset: string; tpCents?: number | null; slCents?: number | null } = {
      type: 'setExits',
      asset,
    }
    if (nextTp.cents !== tp) cmd.tpCents = nextTp.cents
    if (nextSl.cents !== sl) cmd.slCents = nextSl.cents
    const outcome = dispatch(cmd)
    onDone(
      outcome.accepted
        ? { ok: true, text: `${asset} exits updated.` }
        : { ok: false, text: `${asset}: ${reasonText(outcome.reason ?? 'rejected')}.` },
    )
  }

  return (
    <div className="exits-editor">
      <label>
        Take profit ${' '}
        <input value={tpText} onChange={(event) => setTpText(event.target.value)} inputMode="decimal" autoComplete="off" />
      </label>
      <label>
        Stop loss ${' '}
        <input value={slText} onChange={(event) => setSlText(event.target.value)} inputMode="decimal" autoComplete="off" />
      </label>
      <button type="button" onClick={onSet}>
        Set
      </button>
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
                const tp = exit?.tpCents ?? null
                const sl = exit?.slCents ?? null
                const tpText = tp === null ? '—' : formatUsd(tp, 'take profit')
                const slText = sl === null ? '—' : formatUsd(sl, 'stop loss')
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
                  <td>{row.side}</td>
                  <td>{row.shares}</td>
                  <td>{formatAverage(row.costCents, row.shares)}</td>
                  <td>{formatUsd(row.price, 'price')}</td>
                  <td className={row.pnl > 0 ? 'pnl-gain' : row.pnl < 0 ? 'pnl-loss' : undefined}>
                    {formatSignedUsd(row.pnl, 'unrealized')}
                  </td>
                  <td>{tp === null && sl === null ? '—' : `${tpText} / ${slText}`}</td>
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
                          <ExitsEditor
                            key={`${tp ?? ''}-${sl ?? ''}`}
                            asset={row.asset}
                            tp={tp}
                            sl={sl}
                            onDone={(result) => {
                              setMessage(result)
                              if (result.ok) setEditing(null)
                            }}
                          />
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
