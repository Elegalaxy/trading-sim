# Project Handoff State

- **Last Updated By:** Claude
- **Current Goal:** Market depth (GAME_DESIGN section 12). The plan is `doc/plans/2026-11-03-market-depth.md` (steps M0–M12, 12 user questions at the end). Step M1 (bias direction fix) is done. Step 26 playtests are still open.
- **Recent Changes & Files Touched (uncommitted, on top of `acd1d67`):**
  - New plan `doc/plans/2026-11-03-market-depth.md`: market parties as value offsets toward an anchor, calendar consensus from released values, slippage-only price impact, social feed "Y" on its own `#social` stream, keep the 8% cap and measure capped-day share.
  - Step M1 bug fix: since the fact wording, `stanceFor` in `src/sim/distortion.ts` searched the text for "up"/"down", so stress never hid or promoted real news (only generated posts). Now `HeadlineItem` and `RumourItem` carry an optional `direction` (`src/sim/types.ts`), set from the scheduled event in `market.ts` (`firedHeadlines`) and `feed.ts` (true rumours from the event, false rumours from the claimed slot). Copies in `feed.ts` and `distortion.ts` keep it. Items without it (calendar headlines, old saves) fall back to the text search.
  - Tests: `distortion.test.ts` (fact wording with `direction`), `feed.test.ts` (every headline and rumour carries a direction matching its fact word), `content.test.ts` (real content, seed `demo`, 30 days: bias hides and promotes real news; without the fix it did nothing).
  - No RNG change and no log format change; all three golden fixtures unchanged. `stateHash(market)` values change because feed items gain a field.
  - Checks: `npm test` 180 passed (29 files), typecheck and lint pass. Not checked in the browser (needs stress above 60 with an open position).
- **Active Decisions / Constraints:**
  - No market party may read player state (positions, resting orders, perception). New randomness uses derived streams (`seed#name`), like the session.
  - The guide is a reference, not a strategy. Do not publish exact event sizes, calendar effects, hit rates or stat thresholds in it.
  - The 8% daily cap is `[CONFIRMED]`; changing it needs a user decision.
  - Dev server: after editing sim files while the app is open, Vite can serve a stale module. Restart if End day throws an import or ReferenceError.
  - Known gaps: the save check does not catch a session or perception day that differs from the market day. The P&L tab mixes two day conventions. Calendar headlines still read "Growth release inline" (plan step M7).
  - Cents stay inside `src/sim`. Never remove `// admin code`. Do not import `rpg/`.
- **Exact Next Step:** The user answers the 12 questions in the market-depth plan and commits. Then step M0 (event-study report and headline/rumour bots in `src/harness`, record the baseline), then M2 and M3. Step 26 playtests are still open.
