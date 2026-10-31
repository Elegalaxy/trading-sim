import { useEffect, useState } from 'react'
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
 * The symbol and a market list that stays open until it is toggled off.
 * Picking a row switches the chart at once, so one click changes the pair.
 * Prices are the quote at the clock. The change is against the session open.
 */
export function MarketList({ asset, game, onSelect }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="market-list">
      <button
        type="button"
        className="market-toggle"
        aria-expanded={open}
        aria-controls="market-list-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <strong>{asset}</strong> <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <ul id="market-list-panel" className="market-panel" aria-label="Markets">
          {MARKET_DEFINITIONS.assets.map((def) => {
            const price = game === null ? null : sessionPrice(game, def.id)
            const open0 = game?.session.bars[def.id]?.[0]?.open ?? null
            const pct = price === null || open0 === null || open0 <= 0 ? null : ((price - open0) / open0) * 100
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
      ) : null}
    </div>
  )
}
