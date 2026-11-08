# Project Handoff State

- **Last Updated By:** Claude
- **Current Goal:** Plan `doc/plans/2026-11-08-price-model.md` is built (P0-P7, P9 docs). P8 (spreads widen with volatility) is deferred. Left: playtest, balance, and the misses below. Earlier plans (layoffs/loans/deposits, market depth, fill history, items/lifestyle) are built.
- **Price model (the live market now):**
  - Eight trader types trade once a day against depth with a hidden per-run mix (`src/sim/traders.ts`, numbers in `src/content/traders.ts`, `TRADER_DEFINITIONS` is in `MARKET_DEFINITIONS`). Own stream `${seed}#traders`; `TraderBook` on `participants.book`.
  - Anchor = fairValue x carry; value traders trade the price-to-anchor gap; news traders trade surprise (public impact minus priced in); crowd legs per rumour in `eventPos`; unwinding positions are absorbed; market makers thin depth with volatility. Events, calendar and fair value code unchanged.
  - Old saves: `createOldSaveBook` in `continueGame`; old model closes the current day, new model starts `market.day + 2`.
  - Harness: `--model current|traders` (`current` strips `traders`); batch prints `[sim] mix` lines.
  - Only `tests/fixtures/demo-30-price-log.txt` was regenerated (P6); a test checks all non-price line kinds match a no-traders run.
- **Number-only inputs:** `src/ui/numberInput.ts` (`wholeNumberText`, `moneyText`) used by order, deposit, account and loan boxes.
- **Earlier systems:** layoffs (`#layoffs` stream, rumour 60% real, `notice.real` hidden from UI), loan (`loan.ts`), fixed deposits (`deposits.ts`); saves key `trading-sim.save.v1`, new keys optional.
- **Known misses (P5, seed abc, 300 runs):** `maxShortIndex` median $1,164 (target 2,600-3,400) and `maxLongIndex` 33% above it; HRBU realised vol 2.1x base (needs per-stock scale or smaller HRBU events); `longIndex1x` $2,921 (target 2,950); `longNova10` liquidations 0.66x old; pre-news d-3 -0.67; no reversal when news efficiency > 1.
- **Constraints:** GAME_DESIGN price rules reworded with user approval (section 5, changelog 2026-11-08). Hand-built GameState needs `fills: []`, `past: []`. Cents stay in `src/sim`. Never remove `// admin code`. Do not import `rpg/`. Every commit is followed by push to `main`. Dev server can serve stale modules; restart on ReferenceError. `.claude/launch.json` untracked.
- **Unchecked in the UI:** deposit maturity, loan forced-sale banner with a deposit, ticker reduced-motion/focus pause, BillBanner severance line, loading an old save into the traders model.
- **Exact Next Step:** The user plays a seeded run and reports price feel and balance (index bots, HRBU volatility). Then decide on P8, per-stock trader scaling, and the unchecked UI items.
