import { useEffect, useState } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { sessionPrice } from '../sim/session.ts'
import type { GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { formatSignedUsd, formatUsd } from './money.ts'
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

function reasonText(reason: string): string {
  if (reason === 'insufficientBuyingPower') return 'too little buying power'
  if (reason === 'insufficientTradingCash') return 'too little trading cash'
  if (reason === 'marketClosed') return 'the market is not open'
  return reason
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
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
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
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
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
                  </td>
                </tr>
              ))}
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
