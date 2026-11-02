import { MARKET_DEFINITIONS } from '../content/index.ts'
import { sessionPrice } from '../sim/session.ts'
import type { GameState } from '../sim/types.ts'
import { accountSummary, unrealizedCents } from './account.ts'
import { formatSignedUsd, formatUsd } from './money.ts'
import type { TradeRecord } from './store.ts'

function tone(cents: number): string | undefined {
  return cents > 0 ? 'pnl-gain' : cents < 0 ? 'pnl-loss' : undefined
}

function Stat({ label, cents, signed = true }: { label: string; cents: number; signed?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={signed ? tone(cents) : undefined}>{signed ? formatSignedUsd(cents, label) : formatUsd(cents, label)}</dd>
    </div>
  )
}

/**
 * Realized comes from the saved daily ledger (closed P&L minus fees, borrow and interest).
 * Floating is the open positions at the current quote. Trade counts and per-asset rows read
 * the fills of this browser session.
 */
export function PnlSummary({ game, history }: { game: GameState | null; history: readonly TradeRecord[] }) {
  if (game === null) {
    return (
      <section className="panel">
        <h2>P&amp;L</h2>
        <p>Start a game to see the P&amp;L summary.</p>
      </section>
    )
  }
  const account = accountSummary(game)
  const realizedTotal = game.realized.reduce((sum, row) => sum + row.cents, 0)
  const today = game.realized.find((row) => row.day === game.market.day)?.cents ?? 0
  const closed = history.filter((row) => row.realizedCents !== null)
  const wins = closed.filter((row) => (row.realizedCents ?? 0) > 0)
  const losses = closed.filter((row) => (row.realizedCents ?? 0) < 0)
  const fees = history.reduce((sum, row) => sum + row.feeCents, 0)
  const rate = closed.length === 0 ? null : Math.round((wins.length / closed.length) * 100)
  const best = closed.reduce((top, row) => Math.max(top, row.realizedCents ?? 0), 0)
  const worst = closed.reduce((low, row) => Math.min(low, row.realizedCents ?? 0), 0)
  const perAsset = MARKET_DEFINITIONS.assets
    .map((def) => {
      const realized = history.reduce((sum, row) => (row.asset === def.id ? sum + (row.realizedCents ?? 0) : sum), 0)
      const position = game.positions[def.id]
      const floating =
        position === undefined || position.signedShares === 0
          ? 0
          : unrealizedCents(sessionPrice(game, def.id), position.signedShares, position.costCents)
      return { asset: def.id, realized, floating, traded: history.some((row) => row.asset === def.id) || position !== undefined }
    })
    .filter((row) => row.traded)
  const days = game.realized.slice(-8).reverse()
  const tradeText = closed.length === 0 ? '—' : `${closed.length} · ${wins.length} won, ${losses.length} lost${rate === null ? '' : ` · ${rate}%`}`
  return (
    <section className="panel">
      <h2>P&amp;L</h2>
      <dl className="pnl-stats">
        <Stat label="Floating P&L" cents={account.floating} />
        <Stat label="Realized today" cents={today} />
        <Stat label="Realized total" cents={realizedTotal} />
        <Stat label="Net (realized + floating)" cents={realizedTotal + account.floating} />
        <Stat label="Fees paid (session)" cents={fees} signed={false} />
        <div>
          <dt>Closed trades</dt>
          <dd>{tradeText}</dd>
        </div>
        <Stat label="Best trade" cents={best} />
        <Stat label="Worst trade" cents={worst} />
      </dl>
      <div className="pnl-tables">
        {perAsset.length > 0 ? (
          <table className="positions-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Realized (session)</th>
                <th>Floating</th>
              </tr>
            </thead>
            <tbody>
              {perAsset.map((row) => (
                <tr key={row.asset}>
                  <td>{row.asset}</td>
                  <td className={tone(row.realized)}>{formatSignedUsd(row.realized, 'asset realized')}</td>
                  <td className={tone(row.floating)}>{formatSignedUsd(row.floating, 'asset floating')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {days.length > 0 ? (
          <table className="positions-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Realized, net of fees</th>
              </tr>
            </thead>
            <tbody>
              {days.map((row) => (
                <tr key={row.day}>
                  <td>{row.day}</td>
                  <td className={tone(row.cents)}>{formatSignedUsd(row.cents, 'day realized')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  )
}
