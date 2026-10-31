import { MARKET_DEFINITIONS } from '../content/index.ts'
import { sessionPrice } from '../sim/session.ts'
import type { GameState } from '../sim/types.ts'
import { formatUsd } from './money.ts'

type Props = {
  asset: string
  game: GameState | null
  onSelect: (asset: string) => void
}

/**
 * A docked watchlist beside the chart. Always visible, so one click on a row
 * switches the pair. Prices are the quote at the clock. The change is against
 * the session open.
 */
export function MarketList({ asset, game, onSelect }: Props) {
  return (
    <section className="market-list" aria-label="Markets">
      <div className="market-head" aria-hidden="true">
        <span>Symbol</span>
        <span>Last</span>
        <span>Chg%</span>
      </div>
      <ul className="market-panel">
        {MARKET_DEFINITIONS.assets.map((def) => {
          const price = game === null ? null : sessionPrice(game, def.id)
          const open = game?.session.bars[def.id]?.[0]?.open ?? null
          const pct = price === null || open === null || open <= 0 ? null : ((price - open) / open) * 100
          return (
            <li key={def.id}>
              <button
                type="button"
                className="market-row"
                aria-pressed={def.id === asset}
                onClick={() => onSelect(def.id)}
              >
                <span className="market-name">{def.id}</span>
                <span className="market-price">{price === null ? '—' : formatUsd(price, def.id)}</span>
                <span className={pct === null ? 'market-change' : pct >= 0 ? 'market-change up' : 'market-change down'}>
                  {pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
