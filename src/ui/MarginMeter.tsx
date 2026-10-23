import { useEffect } from 'react'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import {
  MARGIN_LIQUIDATION_RATIO_DENOMINATOR,
  MARGIN_LIQUIDATION_RATIO_NUMERATOR,
  MARGIN_WARNING_RATIO_DENOMINATOR,
  MARGIN_WARNING_RATIO_NUMERATOR,
} from '../sim/constants.ts'
import { tradingEquity } from '../sim/trading.ts'
import type { GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'

function markPercent(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error(`margin mark expected a positive ratio, received ${numerator} / ${denominator}`)
  }
  const percent = (numerator / denominator) * 100
  if (!Number.isFinite(percent)) throw new Error('margin mark is not finite')
  return percent
}

/** True when equity / gross is at or below numerator / denominator. */
function atOrBelowRatio(equity: number, gross: number, numerator: number, denominator: number): boolean {
  const left = equity * denominator
  const right = gross * numerator
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw new Error(
      `margin ratio comparison overflowed, equity=${String(equity)} gross=${String(gross)} ${numerator}/${denominator}`,
    )
  }
  return left <= right
}

function formatPercent(equity: number, gross: number): string {
  const percent = (equity / gross) * 100
  if (!Number.isFinite(percent)) throw new Error('margin percent is not finite')
  return `${percent.toFixed(2)}%`
}

const warningPercent = markPercent(MARGIN_WARNING_RATIO_NUMERATOR, MARGIN_WARNING_RATIO_DENOMINATOR)
const liquidationPercent = markPercent(MARGIN_LIQUIDATION_RATIO_NUMERATOR, MARGIN_LIQUIDATION_RATIO_DENOMINATOR)

export function MarginMeter({ game }: { game: GameState | null }) {
  const book = game === null ? null : tradingEquity(game, MARKET_DEFINITIONS)
  const gross = book?.gross ?? 0
  const equity = book?.equity ?? 0
  const open = book !== null && gross > 0
  let tone = 'margin-none'
  if (open) {
    if (atOrBelowRatio(equity, gross, MARGIN_LIQUIDATION_RATIO_NUMERATOR, MARGIN_LIQUIDATION_RATIO_DENOMINATOR)) {
      tone = 'margin-liquidation'
    } else if (atOrBelowRatio(equity, gross, MARGIN_WARNING_RATIO_NUMERATOR, MARGIN_WARNING_RATIO_DENOMINATOR)) {
      tone = 'margin-warning'
    } else {
      tone = 'margin-ok'
    }
  }
  const signature = book === null ? 'none' : open ? `${tone} equity=${equity} gross=${gross}` : 'no-ratio'

  useEffect(() => {
    debugLog('[ui]', `margin ${signature}`)
  }, [signature])

  const fillPercent = open ? Math.min(100, Math.max(0, (equity / gross) * 100)) : 0

  return (
    <section className={open ? `panel ${tone}` : 'panel'}>
      <h2>Margin</h2>
      {game === null ? (
        <p>Start a game to see the margin ratio.</p>
      ) : !open ? (
        <p>There is no margin ratio.</p>
      ) : (
        <>
          <p>
            Equity {equity} cents. Gross {gross} cents. Ratio {formatPercent(equity, gross)}.
          </p>
          <div className="margin-track" aria-hidden="true">
            <div className="margin-fill" style={{ width: `${fillPercent}%` }} />
            <span className="margin-mark" style={{ left: `${liquidationPercent}%` }} />
            <span className="margin-mark" style={{ left: `${warningPercent}%` }} />
          </div>
          <p>
            Warning mark at {warningPercent}%. Liquidation mark at {liquidationPercent}%.
          </p>
        </>
      )}
    </section>
  )
}
