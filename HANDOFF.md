# Project Handoff State

- **Last Updated By:** Claude
- **Current Goal:** Market depth (GAME_DESIGN section 12), plan `doc/plans/2026-11-03-market-depth.md`. M0 and M1 are done. Next are M2 (stock size and liquidity) and M3 (slippage). Step 26 playtests are still open.
- **Recent Changes & Files Touched (uncommitted, on top of `e1ddc28`):**
  - Step M0: `src/harness/eventStudy.ts` (new) prints `[sim] study` lines after every batch: signed moves around each effect (d−3…d5 from the close before the event day, after1/3/5 from the event-day close), rumour moves to the claimed day, capped stock-day share. Wired in `src/harness/batch.ts`.
  - New bots in `src/harness/strategies.ts`: `followHeadlines`, `fadeHeadlines`, `buyRumour` (visible unbiased feed, 1x, a fifth of equity, `BotMemory` for exit days; `actDay` takes optional `memory`). Tests in `strategies.test.ts`.
  - Plan: user answers recorded (Q1 real orders, Q2 yes, Q3 a little, Q4 consensus from released values, Q5 random earnings, Q7 yes, Q9 keep 8%, Q10 later, Q11 reject old saves, Q12 M0–M3 first). Section 4.1 now says M4 builds order flow. M0 Progress holds the baseline table.
  - Baseline (seed abc, 300×120 days): stock headlines d0 +0.53%, d3 +2.15%, after3 +1.63%; true rumours +0.5% to the claimed day, false ~0; capped stock-days 0.08%. `followHeadlines` median $3,504 from $3,000 at 1x, `fadeHeadlines` $1,949, `buyRumour` $2,624.
  - Checks: npm test 182 passed (29 files), typecheck and lint pass. No sim, content or fixture change.
- **Active Decisions / Constraints:**
  - Open with the user: Q6 (player orders joining the order flow later, which needs "same seed and same commands, same market"), Q8 (whether distorted posts, or news too, may drop the `[CONFIRMED]` tell while verify still shows the true feed).
  - No market party may read player state. New randomness uses derived streams (`seed#name`).
  - The guide is a reference, not a strategy: no exact event sizes, hold lengths, hit rates or thresholds.
  - The 8% daily cap is `[CONFIRMED]`. Old saves may be rejected as damaged (testers only).
  - Dev server can serve a stale sim module after edits; restart on import or ReferenceError.
  - Cents stay inside `src/sim`. Never remove `// admin code`. Do not import `rpg/`.
- **Exact Next Step:** Commit M0. Get the user's answers on Q6 and Q8. Then Step M2 (per-stock `sharesOutstanding` and liquidity, per-stock session volume, Guide company size), then M3 (slippage).
