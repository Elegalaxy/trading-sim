# Project Handoff State

- **Last Updated By:** Claude
- **Current Goal:** Finish Step 26: the two human playtests, one seeded jobless and one seeded employed. Step 28 (intraday session and volume) is built but not committed.
- **Recent Changes & Files Touched:**
  - Pushed on `main` through `a87f37f` (Stage 27: USD display, terminal-style trade screen). Steps 1–25 and 28 are `done`. Step 26 is `todo`.
  - Uncommitted Step 28: `src/sim/session.ts` and `session.test.ts` (new), `game.ts`, `trading.ts`, `types.ts`, `constants.ts`, `log.ts`, `market.ts` (one export), `src/persist/save.ts`, `src/ui/candles.ts`, `PriceChart.tsx`, `DayTimeline.tsx`, `Dashboard.tsx`, `Positions.tsx`, `store.ts`, `styles.css`, plus `doc/GAME_DESIGN.md` (Intraday session section) and the plan's Step 28.
  - After that: `npm test` 126 passed (23 files), typecheck and lint passed. `npm run sim -- --batch 100 --strategy random`: largest move 8%, write-off 0. Browser check on seeded `demo`: 15m, 1H, 1D and 1W legends show dollar OHLC and volume, and the clock buttons work.
- **Active Decisions / Constraints:**
  - Cents stay inside `src/sim`. `$1` = 100 cents. `1E` = `$1,000`. Orders spend the trading account, not cash.
  - A day has a 17:00 to 21:00 session of 16 fifteen-minute bars. `GameState.session` holds the bars, the clock and its own two streams. Bars are built at day start by previewing the next market step on a copy, so End day prints exactly the close the session ended on. Orders fill at the quote at the clock. `{type:'tick', steps}` moves the clock. Margin, interest, borrow fees and liquidation are still once a day at the close.
  - Volume is cosmetic and does not touch prices, spread or fills. `4H` is dropped. Day 120 is flat. Old saves fail the shape check and show the damaged-save message.
  - Open market stays on the same day. End day moves prices. Do not start Garden of Eden or import `rpg/`. Never remove `// admin code`.
  - Section 15 criteria 5 and 8 have batch evidence. Criteria 1, 2, 3, 4, 6, 7, 9, and 10 wait on two human runs. The old day-120 hash `70dd4383687c3aaf` predates the 16-event list.
- **Exact Next Step:** Commit Step 28 if the user agrees, then ask the user to play the two timed runs for Step 26. Open items from the design: whether the clock step should cost energy or stress, and whether news can reveal the close early (both default to no).
