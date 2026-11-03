import { formatSignedUsd, formatUsd } from './money.ts'
import type { TradeRecord } from './store.ts'
import { playerDay } from './days.ts'

const VIA_LABEL: Record<TradeRecord['via'], string> = {
  market: 'Market',
  limit: 'Limit',
  takeProfit: 'Take profit',
  stopLoss: 'Stop loss',
}

/** Every fill of this browser session, newest first. */
export function History({ history }: { history: readonly TradeRecord[] }) {
  if (history.length === 0) {
    return (
      <section className="panel">
        <h2>History</h2>
        <p>No fills yet. Fills show here as you trade. History is kept for this browser session only.</p>
      </section>
    )
  }
  return (
    <section className="panel">
      <h2>History</h2>
      <div className="table-wrap">
        <table className="positions-table history-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Day</th>
              <th>Time</th>
              <th>Asset</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Fee</th>
              <th>Realized</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {history
              .slice()
              .reverse()
              .map((row) => (
                <tr key={row.n}>
                  <td>{row.n}</td>
                  <td>{playerDay(row.day)}</td>
                  <td>{row.time}</td>
                  <td>{row.asset}</td>
                  <td className={row.side === 'buy' ? 'side-long' : 'side-short'}>{row.side}</td>
                  <td>{row.quantity}</td>
                  <td>{formatUsd(row.fillCents, 'fill')}</td>
                  <td>{formatUsd(row.feeCents, 'fee')}</td>
                  <td className={row.realizedCents === null ? undefined : row.realizedCents >= 0 ? 'pnl-gain' : 'pnl-loss'}>
                    {row.realizedCents === null ? '—' : formatSignedUsd(row.realizedCents, 'realized')}
                  </td>
                  <td>{VIA_LABEL[row.via]}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
