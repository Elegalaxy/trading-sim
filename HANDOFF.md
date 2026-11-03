# Project Handoff State

- **Last Updated By:** Claude
- **Current Goal:** Fill history (`doc/plans/2026-11-04-save-fill-history.md`) is finished except one Guide line. H1 to H3 (the fill ledger) are on `main` (`e256d83`). H4 (saved chart candles and equity) is built on the worktree branch `worktree-h4-save-chart`, uncommitted, branched from `e256d83`. Market depth M4 and M5 are on `main` from the other session; this branch does not have M5 yet.
- **H4, what changed (worktree `.claude/worktrees/h4-save-chart`):**
  - New `src/sim/past.ts` (`recordPastDay`, `assertPast`, `previewCopy`) and `past.test.ts` (6 tests).
  - `GameState.past: PastDay[]` (`types.ts`): one row per closed day with `day` (market day after the close), `prices`, `bars` (the session that led into the close, per asset) and `equityCents`. `endDay` in `game.ts` adds it after the market step. It is a record only; nothing in the sim reads it.
  - `save.ts`: `past` is optional in `inspectSave` (old saves load) and its rows are checked; `continueGame` in `store.ts` starts it empty for old saves and runs `assertPast`.
  - UI: `run.closes` and `CloseRow` are gone. `Dashboard.tsx` builds the chart from `game.past`. On load the Equity tab starts from one point per past day (`clock: 0`); intraday points of past days are not kept.
  - Performance: `previewCopy` (a state copy without `past` and `fills`) is used by the order preview in `resting.ts` and `OrderPanel.tsx`; the margin test's `cloneGame` also leaves them out. Without that, the 200-seed margin test went from 8 s to 94 s.
  - Size: about 650 KB of JSON at day 119.
  - Checks: typecheck and lint pass, `npm test` 224 passed (35 files). Browser (seed `demo`, port 5175): a trade, End day twice, reload; the Buy mark shows on 1D and 15m and the Equity line keeps days 1 to 3.
- **Merging this branch:** it changes `types.ts`, `save.ts`, `game.ts`, `store.ts`, `resting.ts`, `monthly.ts` and `HANDOFF.md`, which the other session also edits. Merge `main` into the branch (or the branch into `main`) and keep both sets of hunks; `GameState` literals in tests need `past: []` too.
- **Active Decisions / Constraints:**
  - Fill history: sim ledger and closed-day record, old saves load empty, no mid-day saves. The intraday equity of past days is not kept.
  - The 15-minute clock step costs nothing (`[CONFIRMED]`). Liquidations keep paying slippage. Win rule: open losses count (`[PROVISIONAL]`).
  - `GameState.fills` and `GameState.past` are required: any hand-built GameState needs `fills: []` and `past: []`.
  - The dev server serves stale modules after edits; restart on a ReferenceError. It may pick another port. `.claude/launch.json` is untracked, so a worktree needs its own copy (and a `node_modules` junction).
  - Cents stay inside `src/sim`. Never remove `// admin code`. Do not import `rpg/`.
- **Exact Next Step:** The user reviews this branch and says "commit". Then merge it with `main` (after the other session's M5 is in), and add the History line to the Guide if wanted. The Step 26 playtests are still open.
