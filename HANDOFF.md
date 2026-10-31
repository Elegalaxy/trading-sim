# Handoff

2026-10-31. This file belongs in the trading sim repo. Remote `origin` is `https://github.com/Elegalaxy/trading-sim.git`, branch `main`. The parent folder `D:\Coding\project` is not a git repo. Do not `git init` it. Do not start Garden of Eden. Do not import `rpg/`.

## Architecture

- Portfolio briefs live one level up in `../docs/ideas/` (index: `../docs/ideas/README.md`). `rpg/` is that game's folder, not a shared genre folder. Each game is a sibling folder and its own git repo. Mechanics for this game go in `doc/GAME_DESIGN.md`. The brief `../docs/ideas/trading-simulation.md` changes only when the pitch, status, or relationship to the other ideas changes. Agent cheat sheet: `../AGENT_FLOW.md`.
- Stack (confirmed 2026-10-22): TypeScript, React, Vite. Simulation is plain TypeScript shared by the UI and a Node harness. Tests are Vitest. Saves are versioned JSON in `localStorage`.
- Layers, enforced by `tests/architecture.test.ts`: `sim` imports only `sim` (no `Math.random`, `Date`, `console`, storage, DOM, `node:`, content, UI, harness, persist). `content` may import sim types. `harness` may import sim and content. `persist` may import sim types. `ui` may import sim, content, persist. `src/main.tsx` is `entry`. UI must not import harness. Never remove `// admin code`. Dev admin marker `trading-sim-dev-admin-panel-k7q2m` must stay out of production `dist/`.
- Prices and money are integer cents inside `src/sim`. Player-facing unit is USD: `$1` = 100 cents, and the design's `1E` = `$1,000` = 100000 cents. Do not rescale the economy. Dollar inputs convert at the UI boundary (`src/ui/money.ts`).
- Three accounts stay separate: cash (food, lifestyle, courses, bills, loan repay), trading (orders and margin), savings (interest). Transfers are instant and free. A transfer into trading cannot leave cash + savings below the outstanding loan. Orders never spend cash.
- A played day is sleep, work, and market. Skip (`Open market`) stays on the same day and does not move prices. End day sleeps into the next day and moves prices. Market prints one close per day. There is no intraday tape and no market volume.
- Chart candles are display-only (`src/ui/candles.ts`). Open is the previous close. A single day's high and low are the ends of that move, so a day has no wick past the body. `1W` groups 7 printed days and `1M` groups 30; those groups can show a wick. `15m`, `1H`, and `4H` stay disabled. `Vol —` means volume is not printed. Do not invent wicks, volume, or intraday bars in the UI.
- Seeded and normal scores never mix. Saves: `trading-sim.save.v1`. Scores: `trading-sim.scores.v1`. Visual setting: `trading-sim.settings.v1` (`reduceVisualEffects`).
- Plan: `doc/plans/2026-10-22-first-playable.md`. Steps 1–25 are `done`. Step 26 is `todo`. Q3–Q16 stay open; the plan's defaults are in force. Do not invent mechanics. Record a real rule change in `doc/GAME_DESIGN.md` with a dated changelog line.

## Completed

Pushed on `main` through `efb4bfb` (`Stage 26`):

- Market: 4 fictional stocks, 2 sectors, index `M4X`. Hidden fair value, 16 provisional event types, macro calendar, rumours, day summary. Daily move cap 8%. Fee 0.1%. Margin warning 15%, liquidation 10%, order floor 20%, leverage cap 5x. Losses cannot exceed the account.
- Life: jobs, energy and stress, sleep, consumables, lifestyle and courses, one bank loan, monthly bill, FI win (passive income covers expenses for 5 checks from day 30). Run length 120 days, month 30 days. Failure is an uncovered expense bill. No automatic sale except margin liquidation and a missed loan payment.
- UI through Stage 25: start screen, primer, seeded/normal, autosave, Continue, separate scores, end screen, biased news with a tell, cosmetic blur/delay, reduce-visual-effects toggle, dev admin log.
- Harness: `hold`, `maxLongIndex`, `maxShortIndex`, `random`. A run stops when `runEnd` or a pending bill is set (`endedEarly`). Seed `demo`, 500 runs, 120 days: largest move 8%, fair-value clips 0, backstop write-off 0. `maxLongIndex` liquidated 491/500. `maxShortIndex` ended early 103 times, inspected cases were financial independence. Section 15 criteria 5 and 8 have that batch evidence.

Uncommitted, on top of `efb4bfb` (do not commit unless asked):

- USD display and dollar inputs. Life spends disable when cash cannot cover them. The order ticket says orders use the trading account and disables Place order when the quote is rejected.
- Open market and End day sit together with different labels.
- Bybit-style shell: symbol bar, chart, right order rail, bottom subpanel (Positions, Life, News, Day book, Log).
- TradingView-style chart: grid, price axis, crosshair, hover legend `O H L C Vol —`, timeframes `15m` `1H` `4H` (disabled) and `1D` `1W` `1M` (enabled).
- After that edit: `npm test` 114 passed, `npm run typecheck` passed. Files: `src/ui/money.ts`, `src/ui/candles.ts`, `src/ui/PriceChart.tsx`, `src/ui/Dashboard.tsx`, `src/ui/styles.css`, the other UI money strings, and `doc/GAME_DESIGN.md` (2026-10-24 changelog). `src/sim` was not changed.

## Current bugs and gaps

- The Bybit layout and hover legend were not confirmed in the browser. The check was interrupted. Treat the layout as unproven until someone starts a run, ends several days, hovers a candle, and switches `1D` / `1W` / `1M`.
- The user asked to point at a candle and see volume and intraday timeframes. Those series do not exist. The chart shows `Vol —` and disables `15m`, `1H`, and `4H`. That is incomplete relative to the request, and it is not a sim defect. Adding them is a design change, not a styling change.
- Daily candles still look like bodies without wicks. That matches the one-close-per-day model. Only grouped `1W` and `1M` bars can grow a wick.
- Step 26 is not done. The two human playtests were not played. Section 15 criteria 1, 2, 3, 4, 6, 7, 9, and 10 have no human evidence.
- `src/persist/save.test.ts` day-120 hash `70dd4383687c3aaf` was measured before the 16-event expansion. Do not treat it as the current hash.
- `../docs/ideas/README.md` still says this implementation is "design only". The code exists. Update that row only when the portfolio pitch or status is being edited on purpose.
- This browser profile may still hold `trading-sim.settings.v1` with reduce visual effects on, a day-2 seeded `demo` save, and scores seeded `demo` 200 and normal `8FxWcmwc` 200. A damaged save was written during an earlier check and may already have been replaced.

## Next steps

1. From this folder, run `npm run dev` if `http://localhost:5173/` is down. Start a seeded `demo` jobless run. End the day until at least 8 closes exist.
2. Confirm the page is one viewport: symbol bar, candle chart, order rail on the right, bottom subpanel open on Positions. Life, News, and Day book must still be reachable from that subpanel. Open market and End day must stay distinct.
3. Hover a candle and read the legend. It must show dollar O, H, L, C and `Vol —`. Press `1W` and confirm the bar count drops and the legend day range spans more than one day. `15m`, `1H`, and `4H` must stay disabled.
4. With cash at `$0.00` and trading still funded, confirm food and course buttons are disabled and a 1-share buy still fills. A quantity the trading account cannot cover must disable Place order.
5. Stop there unless the user decides to print real volume or intraday prices. If they do, write it in `doc/GAME_DESIGN.md` before changing `src/sim`. Do not fake those numbers in `src/ui/candles.ts`.
6. Leave Step 26 as `todo` until the user reports two timed runs (one seeded jobless, one seeded employed): real minutes, whether they felt different, whether a move matched the news and day summary, and whether biased news felt fair. Record that in the plan Progress line and section 15.
7. Commit and push only if asked. Commit in this repo only. Do not commit `rpg/` or the parent folder. `gh` is not on PATH; `git push origin main` is the push that works. No force-push.
