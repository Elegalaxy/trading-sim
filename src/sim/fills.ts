// The fill ledger. One row for every trade the book made: a market order, a limit fill,
// a take profit or stop loss, a liquidation, and a forced sale for missed loan interest.
// It lives on `GameState.fills`, so a save keeps it and the History tab, the P&L tab and the
// chart marks all read the same rows. The ledger is a record only: nothing in the sim reads
// it back, and it draws no random stream. A preview (a scratch copy of the state) does not
// append to it.

import { SESSION_STEPS } from './constants.ts'
import { clockTime } from './session.ts'
import type { FillRecord, FillVia, GameState } from './types.ts'

/** Safety net for `assertGame`, not a game rule. */
export const FILLS_MAX = 20000

export type FillInput = {
  asset: string
  side: 'buy' | 'sell'
  quantity: number
  fillCents: number
  /** Every fee this fill paid, in cents (a liquidation adds its fee to the trade fee). */
  feeCents: number
  /** Closed-position P&L before the fee, or null when the fill only opened or added. */
  realizedCents: number | null
  /** Cents a share paid beyond the half spread, 0 when none. */
  slippageCents: number
  via: FillVia
  /** `HH:MM`. Defaults to the newest bar the player can see. */
  time?: string
  /** Defaults to the market day. */
  day?: number
}

/** The last bar of the session, where the close and the end-of-day sales happen. */
export function closeTime(): string {
  return clockTime(SESSION_STEPS - 1)
}

function visibleBarTime(state: GameState): string {
  return clockTime(Math.min(Math.max(state.session.clock - 1, 0), SESSION_STEPS - 1))
}

const VIAS: readonly FillVia[] = ['market', 'limit', 'takeProfit', 'stopLoss', 'liquidation', 'forcedSale']

/** Shape of the ledger: numbered 1, 2, 3… in order, with whole-cent amounts. */
export function assertFills(fills: unknown): asserts fills is FillRecord[] {
  if (!Array.isArray(fills)) throw new Error(`game fills must be an array, received ${typeof fills}`)
  if (fills.length > FILLS_MAX) throw new Error(`game fills hold ${fills.length} rows, over the limit of ${FILLS_MAX}`)
  fills.forEach((row: unknown, index) => {
    const at = `fill ${index + 1}`
    if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new Error(`${at} must be an object`)
    const fill = row as Record<string, unknown>
    if (fill.n !== index + 1) throw new Error(`${at} is numbered ${String(fill.n)}`)
    if (typeof fill.asset !== 'string' || fill.asset.length === 0) throw new Error(`${at} needs an asset`)
    if (typeof fill.time !== 'string' || !/^\d{2}:\d{2}$/.test(fill.time)) throw new Error(`${at} time must be HH:MM`)
    if (fill.side !== 'buy' && fill.side !== 'sell') throw new Error(`${at} side must be buy or sell`)
    if (!VIAS.includes(fill.via as FillVia)) throw new Error(`${at} has an unknown via ${String(fill.via)}`)
    for (const key of ['day', 'quantity', 'fillCents', 'feeCents', 'slippageCents'] as const) {
      if (!Number.isSafeInteger(fill[key])) throw new Error(`${at} ${key} must be a safe integer, received ${String(fill[key])}`)
    }
    if (fill.realizedCents !== null && !Number.isSafeInteger(fill.realizedCents)) {
      throw new Error(`${at} realizedCents must be a safe integer or null`)
    }
    if ((fill.quantity as number) <= 0 || (fill.fillCents as number) <= 0 || (fill.day as number) < 0) {
      throw new Error(`${at} has a non-positive quantity or price, or a negative day`)
    }
  })
}

export function recordFill(state: GameState, input: FillInput): void {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new Error(`fill quantity must be a positive safe integer, received ${String(input.quantity)}`)
  }
  if (!Number.isSafeInteger(input.fillCents) || input.fillCents <= 0) {
    throw new Error(`fill price must be a positive safe integer, received ${String(input.fillCents)}`)
  }
  const row: FillRecord = {
    n: state.fills.length + 1,
    asset: input.asset,
    day: input.day ?? state.market.day,
    time: input.time ?? visibleBarTime(state),
    side: input.side,
    quantity: input.quantity,
    fillCents: input.fillCents,
    feeCents: input.feeCents,
    realizedCents: input.realizedCents,
    slippageCents: input.slippageCents,
    via: input.via,
  }
  state.fills.push(row)
}
