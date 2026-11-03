# Trading Sim: Save the Fill History

Date: 2026-11-04  
Status: all questions answered 2026-11-04 (A; H4 yes, after H3; old saves load with an empty ledger; no mid-day saves). H1 to H3 are done (M3 is committed). H4 is next, and the chart marks wait on it. Numbers here are placeholders.  
Design source of truth: [../GAME_DESIGN.md](../GAME_DESIGN.md). This plan changes no `[CONFIRMED]` rule.  
Format: like [2026-11-03-market-depth.md](2026-11-03-market-depth.md). Step ids are `H1`, `H2`… Status values: `todo`, `done`, `verified`, `failed`, `blocked`.

## 1. Goal

After a reload, the History tab, the P&L tab and the Buy, Sell, TP and SL marks on the chart should show the whole run, not only what happened since the page opened.

## 2. How it works today

Read from the code on 2026-11-04.

- `run.history` (`TradeRecord[]` in `src/ui/store.ts`) is built in the UI by `collectFills`, which pattern-matches the sim's log. It looks at `orderFill` events, then the next three events for a `realized` row and a `resting` "filled" row (to tell a limit fill apart), and at `resting` take-profit and stop-loss fills.
- `continueGame` starts with `history: []`, so a reload loses every row. The same is true of `closes` (the 15-minute bars of past days, so a reloaded chart shows one candle per past day), `equity` (the Equity tab curve) and `marks`.
- **Two kinds of fill never reach the history at all:**
  - Liquidations (`margin.ts`, a `liquidation` event with no `orderFill`).
  - Forced sales for missed loan interest (`loan.ts`, a `forcedSale` event).
  - So the History and P&L tabs miss realized losses and fees exactly when they matter most.
- The game saves only at End day, at a new run and when the run ends (`persistIfNeeded`), never after a single order. A reload in the middle of a day goes back to the start of that day for the state, so the saved history must match that same point.
- `persist` may import sim types only (`tests/architecture.test.ts`). `TradeRecord` lives in `ui`, so `persist` cannot check it as things stand.

## 3. Options

**A. The sim keeps the ledger (recommended).** `GameState` gets `fills: FillRecord[]`. Each place that fills a trade appends one row:
- `trading.ts`: player orders.
- `resting.ts`: limit fills, TP and SL.
- `margin.ts`: liquidations, with their fee.
- `loan.ts`: forced sales.

The row carries asset, day, `HH:MM`, side, quantity, fill price, fee, realized P&L and `via` (`market`, `limit`, `takeProfit`, `stopLoss`, `liquidation`, `forcedSale`), plus slippage once M3 lands.

The save already stores `GameState`, so the ledger is saved and restored with no extra code. The History tab, P&L tab and chart marks read `game.fills`, and `collectFills` is deleted. The harness can use the same rows for reports.

- Good: one source of truth; liquidations and forced sales show up; no log pattern-matching; deterministic (same seed and commands give the same rows).
- Cost: it touches the same sim files as M3 (slippage), so it must wait until M3 is committed. `stateHash` of the game changes (no fixture stores a game hash; `tests/` has none, to be rechecked in H1). Old saves need a small upgrade.

**B. Save the UI history beside the state.** Add an optional `history` field to the save envelope. `TradeRecord` moves to `persist` (the UI imports it from there), and `persist` checks its shape. `collectFills` stays.

- Good: no sim change, no clash with M3, about half the work.
- Cost: it keeps the fragile log matching and still misses liquidations and forced sales unless `collectFills` learns those too. The harness cannot see it.

**C. Rebuild from a command replay.** Store the commands and replay them on load. This is rejected: it is slow over 120 days, and it would also need every sim version to replay old commands the same way.

## 4. Steps (option A)

| Step | Work | Status |
| --- | --- | --- |
| H1 | `FillRecord` type in `types.ts`, `GameState.fills`, `assertGame` checks. Append rows at the four fill sites, not inside `closeWholePosition` (its callers include the bill preview in `monthly.ts`, which works on a scratch state that shares objects with the real one; the scratch must get its own `fills: []`). Tests: an order, a limit fill, a TP, an SL, a partial exit, a liquidation (with fee) and a forced sale each add exactly one row with the right `via` and realized P&L. A same-seed same-commands run gives identical rows. Confirm no fixture stores a game hash. | done. `src/sim/fills.ts` (`recordFill`, `assertFills`), `src/sim/fills.test.ts` (12 tests). No fixture stores a game hash. The cover check in `monthly.ts` gets `fills: []`. A liquidation row's fee is the trade fee plus the liquidation fee. |
| H2 | `save.ts`: `'fills'` in `STATE_KEYS`, shape check per row. Old saves without `fills` load with an empty ledger through an upgrade step like `upgradeResting` (see Q3). Test: save, load, rows are equal; an old save loads. | done. `fills` is optional in `inspectSave` and `continueGame` fills it in. Test in `save.test.ts`. |
| H3 | UI: History, P&L and chart marks read `game.fills`. Remove `collectFills` and `TradeRecord`. History labels for liquidation and forced sale; the chart marks them in their own colour. Browser check: trade, take a TP, end the day, reload, and every row and mark is still there. | done for History and P&L (checked: a trade, End day, reload, the row is there). `TradeRecord`, `collectFills` and the unused `marks` are removed from `store.ts`. The chart marks do not show after a reload yet, because the reloaded chart has no candle for past days; that is H4. |
| H4 (Q2) | Also save the chart's 15-minute bars of past days and the equity curve. See Q2 for size. | todo |
| H5 | Guide line ("History keeps the whole run, including liquidations"), changelog, HANDOFF. | partly done: changelog and HANDOFF. The Guide has no History text yet; add it with H4. |

Order: H1 to H3 start after M3 (slippage) is committed, because they share `trading.ts`, `resting.ts` and `margin.ts`.

## 5. Size

A busy run has a few hundred fills, about 150 bytes each in JSON, so tens of kilobytes. That is small next to the save today. H1 adds an assert that the ledger stays under 20,000 rows as a safety net, not a game rule.

Q2 is bigger: 5 assets × 16 bars × 120 days is 9,600 bars, about 0.5 MB. That still fits inside the usual 5 MB localStorage limit, but it is the largest part of the save.

## 6. Questions for the user

1. **A or B?** Recommended: A. It also fixes the missing liquidation and forced-sale rows. **Answer (2026-11-04): A, the sim ledger.**
2. **Save the chart and equity curve too (H4)?** Without it, a reloaded chart shows one candle per past day on 15m and 1H, and the Equity tab starts again from the reload. Recommended: yes, as a separate step after H3. **Answer: yes, after H3.**
3. **Old saves.** Should they load with an empty history (recommended, a small upgrade step), or be rejected as damaged as with the study change? **Answer: load with an empty ledger.**
4. **Mid-day saves (out of scope unless you say so).** A reload in the middle of a day loses that day's orders, because the game saves only at End day. Should the game also save after each accepted command? It is cheap, but it changes what a reload means: today a reload can undo a bad trade from the current day. **Answer: no change; saves stay at End day.**
