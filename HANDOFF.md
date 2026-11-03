# Project Handoff State

- **Last Updated By:** Claude
- **Current Goal:** Step 26 playtests (seeded jobless and seeded employed) are still open; a partial employed run is in the plan's Step 26 Progress. Uncommitted: partial TP/SL, the calendar leak fix, fact-based headline wording and the guide rewrite.
- **Recent Changes & Files Touched (uncommitted, on top of `298acf2`):**
  - Partial and multi-level exits (another session): `PositionExit` = `{ side, levels: ExitLevel[] }`, up to 4 per kind, commands `addExit`/`cancelExit`, `upgradeResting` for old saves (`src/sim/resting.ts`, `types.ts`, `trading.ts`, `game.ts`, `store.ts`, `Positions.tsx`, `OrderPanel.tsx`, `Dashboard.tsx`, `resting.test.ts`).
  - Calendar leak: the panel showed outcomes rolled three days ahead. `playerCalendar` in `src/ui/days.ts` hides an outcome until its day (`CalendarPanel.tsx`, `CalendarPanel.test.ts`).
  - Fact wording (user decision): `EventTypeDefinition.directionWords` maps price direction to a fact word. `directionWord` in `src/sim/events.ts` is used by headlines and by rumour claims in `feed.ts`. Content: earnings beat/miss, raises/cuts guidance, raises/cuts its dividend, inflation/growth data hotter/cooler or stronger/weaker than expected, market mood turns upbeat/gloomy. `tests/fixtures/demo-30-price-log.txt` updated (text only, no RNG change).
  - Guide rewrite (`src/ui/Guide.tsx`): rough terms for market behaviour (small/medium/large, short/medium/long, leans good/bad), exact numbers only for account rules. New pages: What the news means, Companies (fictional profiles for NOVA, BLSW, HRBU, KSR, M4X), Market psychology (general concepts, never says how this market behaves).
  - `doc/GAME_DESIGN.md`: section 5 wording and calendar rules, section 11 guide principles and day report, section 12 "Market depth ideas" (social feed "Y", player price impact with size and liquidity, market participants, expectations and pricing in, the 8% cap), changelog.
  - Checks: `npm test` 177 passed (29 files), typecheck and lint pass. Browser: guide pages render. A run stepped from day 30 shows new wording, and the day-40 growth outcome stays hidden until day 40.
- **Active Decisions / Constraints:**
  - The guide is a reference, not a strategy. Do not publish exact event sizes, calendar effects, hit rates or stat thresholds in it.
  - Jobs are asymmetric playstyles. Consumable balance is deferred.
  - Dev server: after editing sim files while the app is open, Vite can serve a stale module (this time `feed.ts` without its new import). Restart the server if End day throws an import or ReferenceError.
  - Known gaps: the save check does not catch a session or perception day that differs from the market day. The P&L tab mixes two day conventions. Calendar headlines still read "Growth release inline".
  - Cents stay inside `src/sim`. Never remove `// admin code`. Do not import `rpg/`.
- **Exact Next Step:** The user reviews and commits. Then: decide the open market-depth ideas in GAME_DESIGN section 12, and finish the two Step 26 playtests (record minutes, feel, feed-vs-price match and bias fairness in Step 26 Progress and section 15).
