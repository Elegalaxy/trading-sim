# Project Handoff State

- **Last Updated By:** Claude
- **Current Goal:** Finish Step 26: the two human playtests (seeded jobless and seeded employed). A partial employed run is recorded in the plan's Step 26 Progress (shop assistant, 10x, day 35 in about 20 minutes).
- **Recent Changes & Files Touched:**
  - Pushed on `main` through `6fa7cdd`: per-position leverage 1x to 50x, perp-style rules (liquidation checked after every 15-minute bar, 0.5% liquidation fee, funding in place of margin interest and the short borrow fee), high-leverage bots, resizable side panels.
  - Uncommitted UI work from playtest feedback (2026-11-03):
    - `src/ui/days.ts` (+ `days.test.ts`): `tradingDay` = `market.day + 1`, the day being traded, which matches the news and calendar. `playerDay` converts sim days logged during trading. `nextPayday` gives the next 30th-day close with estimated salary, bill and loan interest.
    - Top bar (`Dashboard.tsx`): "Day N of 120", a payday countdown chip (gold within 2 days, tooltip has the estimates) and a Guide button. `JobPanel`, `History` and `StartScreen` use the player day.
    - `src/ui/DayReport.tsx`: popup after End day with trading equity and cash change, energy and stress, money lines (salary, savings and loan interest, bill, funding, liquidation fees, forced sales), notes (pending bill, liquidation, margin warning, job change) and moves since the clock. "Show after every day" is stored in localStorage. Paydays and notes always open it. Built in `store.ts` (`run.report`, `reportStart`, `buildReport`), session only.
    - `src/ui/Guide.tsx`: guide book with topics (a day, reading the news, sectors and scope, how news moves prices, events table, calendar, rumours and psychology, orders and positions, leverage and margin, money and payday, energy and stress). `Primer.tsx` margin text updated to the per-position and perp rules.
    - `styles.css`: dialog styles, payday chip, top bar wraps instead of overlapping.
  - Last check: `npm test` 165 passed (28 files), typecheck and lint passed. Browser on seeded `demo` as shop assistant: Day 1 matches the news, the guide opens, the Day 1 report shows, and the Day 30 report shows salary +$600 and bill -$950, matching the countdown.
- **Active Decisions / Constraints:**
  - Jobs are meant to be asymmetric playstyles (user, 2026-11-03). Night warehouse cannot be fully offset by food. Consumable balance is deferred.
  - Known gap: the realized P&L ledger books trades under `market.day` (the day before the trading day) but funding and liquidations at the close under the new day, so the P&L tab's day rows mix two conventions. The sim was not changed.
  - Cents stay inside `src/sim`. `1E` = `$1,000`. Orders spend the trading account, not cash. Never remove `// admin code`. Do not import `rpg/`.
  - Section 15 criteria 5 and 8 have batch evidence. The rest wait on the two human runs.
- **Exact Next Step:** The user reviews the new popup and guide, then commits. They finish the employed run and play the seeded jobless run, then report real minutes, whether the runs felt different, whether price moves matched the feed, and whether the bias felt fair. Record that in Step 26 Progress and GAME_DESIGN section 15.
