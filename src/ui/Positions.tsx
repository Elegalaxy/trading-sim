import { useEffect } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import type { GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'

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
  if (costCents % shares === 0) return String(costCents / shares)
  return (costCents / shares).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function formatSignedCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`unrealized P&L must be a safe integer, received ${String(cents)}`)
  }
  if (cents > 0) return `+${cents}`
  return String(cents)
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
    const price = game.market.assets[def.id]?.priceCents
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

export function Positions({ game }: { game: GameState | null }) {
  const rows = game === null ? [] : positionRows(game)
  const signature =
    game === null ? 'none' : rows.map((row) => `${row.asset} ${row.side} ${row.shares} pnl=${row.pnl}`).join(', ')

  useEffect(() => {
    debugLog('[ui]', `positions ${signature === '' ? 'flat' : signature}`)
  }, [signature])

  return (
    <section className="panel">
      <h2>Positions</h2>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.asset}>
                  <td>{row.asset}</td>
                  <td>{row.side}</td>
                  <td>{row.shares}</td>
                  <td>{formatAverage(row.costCents, row.shares)} cents</td>
                  <td>{row.price} cents</td>
                  <td className={row.pnl > 0 ? 'pnl-gain' : row.pnl < 0 ? 'pnl-loss' : undefined}>
                    {formatSignedCents(row.pnl)} cents
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
