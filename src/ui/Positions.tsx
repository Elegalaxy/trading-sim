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

/** Profit or loss of closing `shares` of the row at `price`, before fees. */
function pnlAt(row: PositionRow, price: number, shares: number): number {
  const average = row.costCents / row.shares
  return Math.round((row.side === 'long' ? price - average : average - price) * shares)
}

function percentFrom(price: number, reference: number): string {
  const pct = ((price - reference) / reference) * 100
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
}

/** A price `percent` away from the quote in the direction that kind of exit sits. */
function stepPrice(row: PositionRow, kind: ExitKind, percent: number): number {
  const up = (kind === 'takeProfit') === (row.side === 'long')
  return Math.max(1, Math.round(row.price * (1 + (up ? percent : -percent) / 100)))
}

/** Why this level cannot be placed, in words, or null. Same rule as the sim. */
function sideProblem(row: PositionRow, kind: ExitKind, price: number): string | null {
  const above = price > row.price
  const below = price < row.price
  const name = kind === 'takeProfit' ? 'take profit' : 'stop loss'
  const wantAbove = (kind === 'takeProfit') === (row.side === 'long')
  if (wantAbove && !above) return `A ${row.side}'s ${name} must be above the price (${formatUsd(row.price, 'price')}).`
  if (!wantAbove && !below) return `A ${row.side}'s ${name} must be below the price (${formatUsd(row.price, 'price')}).`
  return null
}

type Draft = { text: string; cents: number | null; error: string | null }

function readDraft(text: string, label: string): Draft {
  if (text.trim().length === 0) return { text, cents: null, error: null }
  const parsed = parseUsdToCents(text, label)
  return parsed.ok ? { text, cents: parsed.cents, error: null } : { text, cents: null, error: parsed.reason }
}

function centsText(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Take profit and stop loss for one position. Both can be entered at once, each with quick
 * steps from the price, and the form shows how far each is and what it would make or lose.
 * Each level closes its shares, or the whole position when the shares box is empty.
 * Up to four of each kind.
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
  const [tpText, setTpText] = useState('')
  const [slText, setSlText] = useState('')
  const [sharesInput, setSharesInput] = useState('')
  const asset = row.asset
  const tp = readDraft(tpText, 'Take profit')
  const sl = readDraft(slText, 'Stop loss')
  const sharesParsed = sharesInput.trim().length === 0 ? null : parsePositiveInteger(sharesInput, 'Shares')
  const shares = sharesParsed === null ? row.shares : sharesParsed.ok ? Math.min(sharesParsed.value, row.shares) : row.shares
  const tpProblem = tp.error ?? (tp.cents === null ? null : sideProblem(row, 'takeProfit', tp.cents))
  const slProblem = sl.error ?? (sl.cents === null ? null : sideProblem(row, 'stopLoss', sl.cents))
  const sharesProblem =
    sharesParsed !== null && !sharesParsed.ok
      ? sharesParsed.reason
      : sharesParsed !== null && sharesParsed.ok && sharesParsed.value > row.shares
        ? `The position has ${row.shares} shares.`
        : null
  const ready = (tp.cents !== null || sl.cents !== null) && tpProblem === null && slProblem === null && sharesProblem === null
  const average = Math.round(row.costCents / row.shares)

  function onAdd(): void {
    if (!ready) return
    const quantity = sharesParsed !== null && sharesParsed.ok ? sharesParsed.value : undefined
    const added: string[] = []
    for (const [kind, cents] of [
      ['takeProfit', tp.cents],
      ['stopLoss', sl.cents],
    ] as const) {
      if (cents === null) continue
      const outcome = dispatch({ type: 'addExit', asset, kind, priceCents: cents, ...(quantity === undefined ? {} : { quantity }) })
      if (!outcome.accepted) {
        const done = added.length > 0 ? ` ${added.join(' and ')} added.` : ''
        return onDone({ ok: false, text: `${asset} ${KIND_LABEL[kind]}: ${reasonText(outcome.reason ?? 'rejected')}.${done}` })
      }
      added.push(`${KIND_LABEL[kind]} ${formatUsd(cents, 'exit')}`)
    }
    setTpText('')
    setSlText('')
    setSharesInput('')
    onDone({ ok: true, text: `${asset} ${added.join(' and ')} added.` })
  }

  function preview(draft: Draft, problem: string | null) {
    if (problem !== null) return <span className="exit-warn">{problem}</span>
    if (draft.cents === null) return <span className="day-note">None</span>
    const pnl = pnlAt(row, draft.cents, shares)
    return (
      <span className="exit-preview" title={`${percentFrom(draft.cents, row.price)} from the price, about ${formatSignedUsd(pnl, 'exit pnl')} before fees.`}>
        {percentFrom(draft.cents, row.price)} · <span className={pnl >= 0 ? 'pnl-gain' : 'pnl-loss'}>{formatSignedUsd(pnl, 'exit pnl')}</span>
      </span>
    )
  }

  const steps: Record<ExitKind, readonly number[]> = { takeProfit: [2, 5, 10], stopLoss: [2, 5, 10] }
  // Break-even only makes sense once the price has moved past the entry in the position's favour.
  const breakEvenOk = sideProblem(row, 'stopLoss', average) === null

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
      <p className="day-note" title="Each level closes its shares at its own price, with no spread.">
        {row.side === 'long' ? 'Long' : 'Short'} {row.shares} {asset} · entry {formatAverage(row.costCents, row.shares)} · price{' '}
        {formatUsd(row.price, 'price')}
      </p>
      {levels.length > 0 ? (
        <ul className="exit-levels">
          {sortedLevels(levels, row.side).map((level) => {
            const closes = level.quantity ?? row.shares
            const pnl = pnlAt(row, level.priceCents, closes)
            return (
              <li key={level.id}>
                <span className={level.kind === 'takeProfit' ? 'pnl-gain' : 'pnl-loss'}>
                  {KIND_LABEL[level.kind]} {formatUsd(level.priceCents, 'exit')}
                </span>
                <span className="exit-preview">
                  {percentFrom(level.priceCents, row.price)} · <span className={pnl >= 0 ? 'pnl-gain' : 'pnl-loss'}>{formatSignedUsd(pnl, 'exit pnl')}</span>
                  {level.quantity === null ? null : <span className="day-note"> ({level.quantity} sh)</span>}
                </span>
                <button type="button" onClick={() => onRemove(level)}>
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      <div className="exit-form">
        {(
          [
            ['takeProfit', 'Take profit', tp, tpProblem, setTpText],
            ['stopLoss', 'Stop loss', sl, slProblem, setSlText],
          ] as const
        ).map(([kind, title, draft, problem, setText]) => (
          <div key={kind} className={`exit-row ${kind === 'takeProfit' ? 'exit-tp' : 'exit-sl'}`}>
            <label>
              <span>{title} $</span>
              <input
                value={draft.text}
                onChange={(event) => setText(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="none"
                aria-invalid={problem !== null}
              />
            </label>
            <div className="size-modes" role="group" aria-label={`${title} steps`}>
              {steps[kind].map((percent) => (
                <button key={percent} type="button" onClick={() => setText(centsText(stepPrice(row, kind, percent)))}>
                  {kind === 'takeProfit' ? '+' : '−'}
                  {percent}%
                </button>
              ))}
              {kind === 'stopLoss' ? (
                <button
                  type="button"
                  disabled={!breakEvenOk}
                  title={breakEvenOk ? 'Stop at the entry price.' : 'The price has not moved past the entry yet.'}
                  onClick={() => setText(centsText(average))}
                >
                  Break-even
                </button>
              ) : null}
            </div>
            {preview(draft, problem)}
          </div>
        ))}
        <div className="exit-row">
          <label>
            <span>Shares</span>
            <input
              value={sharesInput}
              placeholder={`all ${row.shares}`}
              onChange={(event) => setSharesInput(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={sharesProblem !== null}
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
            <button type="button" onClick={() => setSharesInput('')}>
              All
            </button>
          </div>
          {sharesProblem !== null ? <span className="exit-warn">{sharesProblem}</span> : <span className="day-note">Both levels use this size.</span>}
        </div>
        <button type="button" className="exit-submit" onClick={onAdd} disabled={!ready}>
          {tp.cents !== null && sl.cents !== null ? 'Add TP and SL' : sl.cents !== null ? 'Add SL' : 'Add TP'}
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
