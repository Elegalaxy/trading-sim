# Price model: traders against depth

Format: like [2026-11-03-market-depth.md](2026-11-03-market-depth.md). Step ids `P0` to `P9`. Status values: `todo`, `done`, `verified`, `failed`, `blocked`. Approved by the user on 2026-11-08 with the defaults in section 6.

## 1. Goal
Price is set mainly by many trader types buying and selling against depth. News is information they react to, measured as surprise against what is already priced in. Fair value stays as a weaker hidden anchor. The return on simply holding is about flat, slightly positive, and the harness can check it.

Why now: harness runs (seed abc, 100 runs, 120 days, $3,000) showed `maxShortIndex` median $4,717 (mean $8,534, best $74k) while `maxLongIndex` median $230, `followHeadlines` $3,110, `buyRumour` $2,874, `random` $2,816, `fadeHeadlines` $2,166. Estimate from `src/content/events.ts` and `calendar.ts`: expected fair-value drift about -0.25% a day per stock (about -25% a run), from down-weighted sector events (supplyShock, inputCostShock 0.65 down, regulation 0.55 down), stock events (scandal 0.75, lawsuit 0.7) and the policy table (hike 0.35 vs cut 0.15). P0 must confirm this before anything changes.

## 2. Model spec

**Units.** Prices stay integer cents. A trader position is a dimensionless float in depth units: position in cents divided by the stock's depth (`depthCents(def, p)`, exists). A trade of dq moves the price by about dq x price. Positions are model quantities like `fairValue`, not money.

**State.** New optional `ParticipantState.book?: TraderBook` on `MarketState` (so the session preview's `structuredClone` covers it).
```ts
type TraderType = 'value'|'noise'|'informed'|'news'|'consensus'|'crowd'|'trend'|'contrarian'
type TraderBook = {
  activeFromDay: number
  mix: Record<TraderType, number>        // per-run weights, drawn once
  efficiency: number                     // news traders, per run
  carry: Record<string, number>          // anchor multiplier per stock, starts 1
  seenAnchor: Record<string, number>     // value traders' lagged anchor
  pos: Record<string, Record<TraderType, number>>
  eventPos: Record<string, number>       // `${eventId}|${asset}|${type}`
  vol: Record<string, number>            // EWMA of |daily return|
  lastFlow: Record<string, number>       // yesterday's net non-noise flow
}
```

**Anchor.** Events still change `fairValue` exactly as today (`applyDueEffects`, calendar untouched; all event, effect and fair-value log lines stay byte-identical). Anchor `A = fairValue x carry`. Each day `carry *= 1 - expectedDrift(def, env) + premium`. `expectedDrift` is pure, in new `src/sim/drift.ts`: for each event type reaching the stock, `adjustForEnvironment(type, env).chance x (up - down) x (min + max) / 2 / 100`, plus the calendar's expected effect per day (outcome chances from `lookupPolicyChances` and the release cells at current bands, times the sector effect, divided by `daysPerMonth`). `premium` starts at +0.02% a day. Value traders see `seenAnchor`, an EMA of A with a 3-day half-life. Events reach the price only through traders' beliefs.

**Flow to price.** Per stock each step:
1. Each type k: target position `Q_k`, trade `dq_k = rate_k x (Q_k - pos_k)`.
2. Net demand `D = sum dq_k + playerFlow / depth` (player flow is today's `orderFlow` argument).
3. Market makers take the other side: `depthScale = clamp(1 / (1 + volSens x max(0, vol / dailyVolatility - 1)), 0.4, 1)`.
4. `rawMove = price x D / depthScale`; rounding and the 8% cap use the existing `applyCappedMove`.
5. Fill scale `s = cappedMove / rawMove` (1 when not capped); `pos_k += s x dq_k`. An unfilled part is still wanted tomorrow.
6. The index is unchanged (built from the stocks).

**Trader types** (weight `W_k = base_k x mix_k`):

| Type | Reads | Target `Q_k` | Rate |
| --- | --- | --- | --- |
| value | `seenAnchor`, price | g = seenAnchor/P - 1; dead band 1%; `W x clamp(g'/10%, +-1)`, 3x slope beyond 20% gap, capped at +-3W | 0.5 |
| noise | the market stream's `z` (same one draw per stock, in order) | AR(1): `Q = 0.7 x pos + sigma_n x z`, sigma_n from `dailyVolatility x noiseShare` | 1 |
| informed | `leaked`, `scheduled` | before the event `sign x W x min(1, mag/5) x ramp`; after it hold 1 day, decay to 0 over 3 | 0.7 |
| news | applied effects, calendar items | event day, per (event, asset): `surprise = publicImpact - pricedIn`, `publicImpact = sign x (min + max)/2` (true size hidden), `pricedIn = sum eventPos` of informed, crowd, consensus. Target `e x surprise`, hold 3 days, decay over 3 | 1 |
| consensus | `calendarRolls[].expected` | expected outcome's effect, ramped over the 2 days before; held through the release, decay over 4 days | 0.7 |
| crowd | feed rumours and headlines, 5-day return, 10-day drawdown | `W x heat x mood`; mood = rumour shares + headline chase + 0.5 x clamp(ret5/5%) (buys tops); if drawdown < -8% and mood > 0, mood = -0.5 (capitulates); clamp +-1.5. A rumour's share leaves on its day (sells the news) | 0.6 |
| trend | last 5 closes | `W x clamp(ret5/4%, +-1)` | 0.5 |
| contrarian | ret5, crowd mood, `lastFlow` | `-W x [clamp((abs(ret5) - 4%)/4%, 0, 1) x sign(ret5) + 0.3 x mood + 0.5 x clamp(lastFlow/2%, +-1)]` | 0.5 |
| market makers | `vol`, net flow | depth scale above; inventory implied | - |

`participants.mood` is still written each day (social feed), `closes` still kept (liquidity grabs). `assignLeaks` and the `#participants` stream are unchanged.

**Patterns that should emerge.** Buy the rumour, sell the news (crowd share leaves on the event day while news traders only buy `e x (impact - pricedIn)`); good news falls when `publicImpact < pricedIn`; overshoot and reversion (e > 1 or true size below average, value traders correct); drift after news (true size above average); crowd tops and bottoms.

**Per-run mix.** All types exist every run. `createTraderBook(defs, seed, market)` draws one float per type in fixed order, then one for e, from `createRng(seed + '#traders').market`. `mix_k` in `[min_k, max_k]`, normalised so `sum base_k x mix_k` is the same every run. e in [0.5, 1.3]. No per-day draws; the four main streams keep their order, so `demo-30-noise-roll.txt` and `demo-30-step7-rolls.txt` stay unchanged.

**Stability.** Every target is clamped. The loop gain of the self-reinforcing terms `(trend W/4% + crowd chase) x rate` must stay below `1 + kappa`, kappa = value W / (band x 1), target kappa about 3. A unit test checks every corner of the mix ranges.

**Intraday.** Parties trade once a day. The session stays a bridge from open to the previewed close; `addOrderFlow` re-previews with the player's flow. The 8% cap still applies close to close. The 12% bar band, liquidity grabs, resting orders and per-bar liquidation are unchanged.

## 3. Build steps
Each step leaves typecheck, lint and tests green. The new path runs only when `defs.traders !== undefined && book !== undefined && state.day >= book.activeFromDay`; otherwise `stepMarketDay` runs today's code, so fixtures do not move until P6.

| Id | What | Files | Tests | Verify | Status |
| --- | --- | --- | --- | --- | --- |
| P0 | **Measure drift; no market change.** (a) Drift section in the event study: per asset mean daily % change, mean log change, mean and median 120-day change with standard error; per stock mean daily fair-value change; analytic `expectedDrift`. (b) `src/sim/drift.ts` (pure, not yet used by the market). (c) Bots `longIndex1x` and `shortIndex1x`: open once at 1x with full equity, hold. (d) Record a baseline in this plan's Progress: every bot, liquidations and backstop for longNova10/20/50 and shortNova50, share of capped days, the event study, how long `margin.test.ts` takes | `src/harness/eventStudy.ts` (drift lines also print from here, `report.ts` unchanged), `strategies.ts`, `strategies.test.ts`, `src/sim/drift.ts`, `src/content/drift.test.ts` (a sim test may not import content) | analytic drift equals a hand sum for one stock; new bots hold and leave the market hash equal to an idle run | `npm test`; `npm run sim -- --seed abc --days 120 --batch 300 --strategy shortIndex1x` (and longIndex1x, hold, maxShortIndex, every other bot) | verified |
| P1 | **Types, content, book creation; no behaviour.** `TraderDefinitions`, `TraderBook`, `MarketDefinitions.traders?`, `ParticipantState.book?`; `src/sim/traders.ts` (`assertTraderDefinitions`, `createTraderBook`); `src/content/traders.ts` placeholder numbers, not wired in. `save.ts` `checkParticipants` moves from `sameKeys` to `keysWithin` with an optional `book` shape check | `types.ts`, `traders.ts`, `content/traders.ts`, `save.ts`, tests | same seed same mix; mix normalised; save with and without `book` passes | `npm test` (fixtures untouched) | done |
| P2 | **Core engine: value (anchor, carry, lag), noise AR(1), market makers, player flow, fill scale.** Branch in `stepMarketDay`. Extend `ParticipantFlowEvent.party` union; optional `anchor`, `depthScale`, `fillScale` on `PriceStepEvent`; update `log.ts`, the exhaustive switches in `summary.ts` and `batch.ts`. Event study `maxGapPercent` measures against the anchor. Harness flag `--model traders` uses `{...MARKET_DEFINITIONS, traders: TRADER_DEFINITIONS}` | `market.ts`, `traders.ts`, `types.ts`, `log.ts`, `summary.ts`, `cli.ts`, `batch.ts`, `eventStudy.ts` | without traders fixtures identical; capped day scales positions and carries the rest; session preview close equals End day close with traders; 50 seeds x 1,000 days value and noise only: mean daily log change of anchor and price within +-0.01% + premium | `npm test`; `npm run sim -- --seed abc --days 120 --batch 200 --strategy longIndex1x --model traders` | done |
| P3 | **Information traders: news (surprise vs pricedIn), informed (with hand-off), consensus (hold and decay).** Build an event-type `Map` once per defs (WeakMap cache) instead of `defs.events.find` in loops | `traders.ts`, tests | calendar result equal to consensus moves less than a surprise; an unrumoured event reacts at about e x public impact; a true size below average reverts by day 5 | `npm test`; batch with `--model traders`, read event-study d0/after3 | done |
| P4 | **Crowd, trend, contrarians, market-maker volatility thinning; keep `mood` updated** | `traders.ts`, tests | loop gain < 1 + kappa at every mix corner; 300 seeds x 120 days: no NaN, max abs(P/A - 1) < 35%; a false rumour pumps then unwinds; a hot true rumour can close red on its day | `npm test`; `--model traders` batches | done |
| P5 | **Tuning and mix report.** `[sim] mix` lines (results by dominant type). Change only `src/content/traders.ts` until section 4 passes | `content/traders.ts`, `report.ts` | report line test | the section 4 batch with `--model traders` | done |
| P6 | **Wire in and regenerate the fixture (isolated).** Add `traders` to `MARKET_DEFINITIONS`. Regenerate `tests/fixtures/demo-30-price-log.txt`. Test that every non-price line kind (`eventRoll`, `eventDirection`, `eventMagnitude`, `effectApplied`, `fairValueChange`, `envDrift`, `calendarItem`, `headline`, `rumourGenerated`, `noiseRoll`) matches the old file line by line. Noise and step7 fixtures pass untouched. Any other failing test must be an exact price number: update each with a one-line reason (expected: `content.test.ts`, `orderFlow.test.ts`, `socialFeed.test.ts`, `study.test.ts`, `strategies.test.ts`, UI tests using `MARKET_DEFINITIONS`) | `content/index.ts`, fixture, listed tests | pump-and-dump test still loses on average; idle equals idle; small orders equal idle | `npm test`; `git diff --stat tests/fixtures` shows only the price log | done |
| P7 | **Old saves.** In `continueGame`, when `definitions.traders` is set and `market.participants.book` is missing: `createTraderBook(defs, save.seed, market)` with `activeFromDay = market.day + 2` and value positions seeded at their current target (no jump on load) | `store.ts`, `oldSaves.test.ts` | pre-P6 save loads; End day prints the session's last bar; the next day runs the new model | `npm test` | done |
| P8 | **Optional (question 3): market makers widen the spread.** `spreadWidens` / `halfSpreadCents` scale with `book.vol` | `trading.ts`, tests, Guide | spread rises on a volatile day; order-panel estimate matches the fill | batch: random bot and liquidation numbers again | deferred |
| P9 | **Docs.** GAME_DESIGN sections 5, 12, 16 and changelog (only rules the user decided); Guide "Who else trades" in rough terms; HANDOFF; browser check: seeded run, a session, a reload | `GAME_DESIGN.md`, `Guide.tsx`, `HANDOFF.md` | - | `npm run build`; manual run | todo |

## 4. Acceptance targets (seed abc, 300 runs, 120 days, $3,000 trading equity)
- **Drift.** Per stock mean daily change in [0, +0.04]% and mean 120-day index change in [0, +4]%.
- **Index bots.** `longIndex1x` median >= $2,950; `shortIndex1x` median <= $3,050. `maxShortIndex` median $2,600 to $3,400, mean below $3,600, no longer the best bot. `maxLongIndex` median within 25% of `maxShortIndex`.
- **News bots.** `followHeadlines` median $3,000 to $3,300. `fadeHeadlines` below $2,900. `buyRumour` $2,700 to $3,100. `random` $2,750 to $2,950.
- **Leverage.** Liquidations per run for longNova10/20/50 and shortNova50 at 0.7x to 1.5x of P0. Backstop use at 50x at most 1.5x of P0, none at 5x.
- **Stability.** Capped stock-days <= 3%, at most 3 capped days in a row, p99 of abs(P/A - 1) <= 20%, realised volatility per stock 0.8x to 1.5x `dailyVolatility`.
- **Patterns.** True-rumoured positive headlines that close red on their day 20% to 45%; stock headlines `after3` +0.2% to +1.0%; runs with e > 1 show a reversal from d1 to d5.
- **Speed.** `margin.test.ts` does not use participants. Add a 50-seed traders variant of the 5x guarantee with a 60 s budget. A 300-run batch takes at most 1.3x P0's time.

## 5. Risks
- **Bubbles, crashes, runaway feedback:** clamped targets, value deep slope, contrarians, loop-gain test (P4), abs(P/A - 1) and capped-streak targets (P5), results by mix.
- **Anchor too weak or too strong:** measured through the event study and the 1x index bots.
- **Determinism:** no per-day draws; stocks in definition order; `eventPos` keys sorted; all state on `MarketState`. Covered by preview-equals-step and same-seed hash tests.
- **Bot results shift:** expected; P5 tunes, P6 records new numbers.
- **Fixture churn:** only P6 changes a fixture, with the line-kind assertion.
- **Save upgrade mid-day:** `activeFromDay` keeps today's previewed close.
- **Day summary:** "What moved prices" (`[CONFIRMED]`, section 11) needs the new party kinds in the `summary.ts` switch (P2).

## 6. Decisions (user, 2026-11-08)
User decisions: keep a weak anchor; parties react to each other's flow; all types in every run with per-run mixes. Approved with the planner's defaults:
1. `[CONFIRMED]` section 5 "Each asset has a hidden fair value. Events move it. The price follows it." becomes: "Each asset has a hidden fair value that events move. Traders set the price by buying and selling against depth. Value traders pull it toward fair value, slowly and weakly, and news reaches the price through what traders expect." The 8% cap stays; "the rest of the gap stays between price and fair value" becomes "orders that do not fill are still wanted tomorrow". The day summary shows only what was public.
2. Drift fix: the carry, content unchanged.
3. Premium +0.02% a day.
4. Market makers thin depth now; spreads widen only after a playtest (P8 deferred).
5. Mix hidden from the player; wide ranges (for example crowd 0.3x to 2.5x). News efficiency 0.5 to 1.3.
6. Old saves switch to the new model from the next day.
7. Keep the old party code for tests and old saves; remove in a later cleanup.

## Progress

### P0 baseline (verified 2026-11-08; no market change, `tests/fixtures` untouched)
Seed abc, 300 runs, 120 days, $3,000 trading equity, current model. Final trading equity in dollars. Liq = liquidations per run. Backstop = runs with a backstop write-off / total written off. Batch time is wall clock for 300 runs on this PC (one batch at a time).

| Bot | Mean | Median | p10 | p90 | Min | Max | Liq/run | Backstop runs / total | Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hold | 3,000 | 3,000 | 3,000 | 3,000 | 3,000 | 3,000 | 0 | 0 | 24 s |
| random | 2,892 | 2,874 | 1,983 | 3,783 | 263 | 5,753 | 0.003 | 0 | 34 s |
| followHeadlines | 3,151 | 3,134 | 2,760 | 3,540 | 2,348 | 4,277 | 0 | 0 | 44 s |
| fadeHeadlines | 2,157 | 2,148 | 1,913 | 2,418 | 1,586 | 2,805 | 0 | 0 | 44 s |
| buyRumour | 2,907 | 2,898 | 2,554 | 3,254 | 2,266 | 3,891 | 0 | 0 | 54 s |
| maxLongIndex | 378 | 205 | 54 | 793 | 45 | 4,921 | 2.760 | 0 | 27 s |
| maxShortIndex | 10,322 | 5,342 | 1,437 | 26,347 | 322 | 126,299 | 1.360 | 0 | 28 s |
| longIndex1x | 2,377 | 2,354 | 2,048 | 2,740 | 1,741 | 3,257 | 0 | 0 | 29 s |
| shortIndex1x | 3,437 | 3,456 | 3,054 | 3,790 | 2,489 | 4,083 | 0 | 0 | 30 s |
| longNova10 | 251 | 3 | 1 | 375 | 1 | 14,271 | 5.067 | 0 | 32 s |
| longNova20 | 32 | 0 | 0 | 1 | 0 | 6,541 | 2.690 | 129 / $20,245 | 59 s |
| longNova50 | 29 | 0 | 0 | 0 | 0 | 8,836 | 0.997 | 299 / $465,492 | 57 s |
| shortNova50 | 3,052 | 0 | 0 | 0 | 0 | 54,707 | 0.910 | 273 / $423,217 | 63 s |

Notes: the 1x index bots hold whole index shares only ($1,000 each), so with $3,000 they hold 2 shares (about two thirds of equity); their dollar results are about two thirds of the full-equity effect. Section 4 targets should be read with that in mind (a 3-share position does not pass the spread and fee check). maxShortIndex runs end early in some seeds (32,707 of 36,000 index-days). Wipe-outs: longNova20 283, longNova50 299, shortNova50 273; none elsewhere. longNova50 and shortNova50 medians are 0.

Capped days: any asset capped on a day = 4.82% of run-days (1,735 of 36,000); capped stock-days = 1.245% (1,793 of 144,000). The section 4 target (stock-days <= 3%) uses the second number. Largest gap price to fair 12.6%; study maxGapPercent 11.44.

Drift (hold bot, 300 runs, 36,000 days per asset). Daily numbers in percent.

| Asset | Mean daily | Mean log daily | Mean 120-day change | SE | Median 120-day change | Fair value mean daily | Analytic expectedDrift |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NOVA | -0.2313 | -0.2887 | -25.87% | 1.33 | -28.70% | -0.2721 | -0.2373 |
| BLSW | -0.2212 | -0.2676 | -24.38% | 1.29 | -27.01% | -0.2502 | -0.2373 |
| HRBU | -0.2941 | -0.3219 | -28.77% | 1.32 | -31.27% | -0.3039 | -0.2823 |
| KSR | -0.2894 | -0.3267 | -29.34% | 1.25 | -32.45% | -0.3083 | -0.2823 |
| M4X (index) | -0.2648 | -0.2796 | -27.09% | 0.84 | -28.17% | n/a | n/a |

Finding: the drift estimate is confirmed. Fair value falls about 0.25% a day per stock (measured -0.25 to -0.31, analytic -0.24 to -0.28, same order and both sector B lower than A), and the price follows it: mean 120-day change is -24% to -29% per stock and -27% for the index. The analytic value sits 0.01 to 0.04 points above the measured mean; likely causes are the environment wandering away from its start bands (the analytic average uses each day's environment) and stacked effects, to be checked at P2 when carry is applied. Section 4 drift targets (+0 to +0.04% a day, 0 to +4% per 120 days) are therefore about 25 points away.

Event study, hold bot (signed % of close; d0 = headline day close against the day before, after3 = close N+3 against close N): stock n=51,234 d0 +1.506, d3 +2.519, after3 +1.034 (se.d3 0.026); stock:rumoured d0 +1.431, after3 +1.095; stock:unrumoured d0 +1.823, after3 +0.776; sector n=24,816 d0 +1.654, after3 +1.453; market n=28,452 d0 +1.168, after3 +1.031; rumour:true:high toClaim +1.572.

Speed: `src/sim/margin.test.ts` takes 15.9 s alone (14.8 s of tests, 5 tests); the whole suite takes about 9 s of wall time in parallel. A 300-run batch takes 24 s (hold) to 63 s (shortNova50).

Added in P0: `src/sim/drift.ts` `expectedDrift(defs, asset, env)` (signed fractional fair-value change per day; 0 for an index), `[sim] study drift` lines in `studyLines`, bots `longIndex1x` and `shortIndex1x`.

### P1 (done 2026-11-08; no behaviour change, `tests/fixtures` untouched)
Added `TRADER_TYPES`, `TraderType`, `TraderDefinitions`, `TraderBook`, optional `MarketDefinitions.traders` and `ParticipantState.book` in `types.ts`; `src/sim/traders.ts` (`assertTraderDefinitions`, `createTraderBook`, mix clamped to range and scaled by bisection so sum of base x mix equals sum of base); placeholder `src/content/traders.ts` (not in `MARKET_DEFINITIONS`); `save.ts` `checkParticipants` uses `keysWithin` plus a `book` shape check. Tests: `src/sim/traders.test.ts`, `src/content/traders.test.ts`, `save.test.ts`. Full suite 343 tests pass. `hash.ts` unchanged (`JSON.stringify` drops an absent `book`).

### P2 (done 2026-11-08; `tests/fixtures` untouched, full suite 357 tests pass, typecheck and lint clean)
Added: `planTraderStock`, `commitTraderStock`, `traderModelOn`, `valueTarget`, `depthScaleFor` at the end of `src/sim/traders.ts`; `priceWithTraders` in `market.ts` (runs only when `defs.traders`, `defs.participants` and `participants.book` exist and `state.day >= book.activeFromDay`; else today's code); `createMarket` creates the book when `defs.traders` and `defs.participants` are set (so `createGame` does); optional `anchor`, `depthScale`, `fillScale` on `PriceStepEvent` (logged by `log.ts`; `depthScale` only below 1, `fillScale` only when the cap bound); `ParticipantFlowEvent.party` gained `value`, `noise`, `trend`, `contrarian`; `eventStudy.ts` `maxGapPercent` measures against `anchor` when present; `src/harness/model.ts` plus `--model current|traders` in `cli.ts` (single and batch) and `batch.ts`. In the traders path `pull` is the value traders' move, `noise` the noise traders' move, `flow` the player's, `gapAfter` is anchor minus price. `summary.ts` and `batch.ts` needed no change (their switches already list `participantFlow` without reading `party`). Tests: `src/sim/tradersModel.test.ts` (switch, streams unchanged, determinism, capped day scales positions and keeps the rest wanted, preview close equals End day with orders), `src/content/tradersModel.test.ts` (real content; 50 seeds x 1,000 days drift).

Findings (read before P3):
1. **Placeholder scale.** `src/content/traders.ts` bases were 100x too large: value 3 means a day's wanted trade of 150% of the price. Rescaled (value 0.1, others 0.03, trend and contrarian 0.015). Noise ignores its base: its size is `dailyVolatility x noiseShare x mix.noise`.
2. **Cumulative positions bound the price.** With `dq = rate x (Q - pos)` and a trade moving the price by dq, log price is the sum of all positions. So value traders alone cannot move the price more than `valueMaxMultiple x W` (about 0.3) from where the other types leave it, and in steady state the price closes only `10W/(1+10W)` (about half at W = 0.1) of an anchor move. Stability of the value loop needs `r(1 + 10W) < 2` (W < 0.3 at rate 0.5; the deep slope makes it tighter). In P3 the news and informed positions decay back to zero, which reverts their price moves unless value (or something) holds them. Needs a decision before P3: either larger value weight (limited by stability), or value traders re-base (trade on gap, not on `Q - pos`), or let news positions persist. Left as specified.
3. **Drift test.** The plan's "+-0.01% plus premium" for the anchor cannot hold with the current `drift.ts`: over 50 seeds x 1,000 days x 4 stocks the realised fair-value mean is -0.306%/day against an analytic -0.275% (events alone without the calendar: -0.257 vs -0.236), so the carry under-cancels by about 0.03 points; a mean of log changes also sits 0.016 below the simple mean (daily sd 1.78%). Anchor mean log change measured -0.0276%/day against a premium of +0.02%; the price's -0.0294%. The test pins the anchor within 0.07 below / 0.01 above the premium and the price within 0.01 of the anchor. Fix options: find the `drift.ts` bias, or add the log correction to the carry.

Verify (seed abc, 200 runs, 120 days, `--model traders`): `longIndex1x` final equity p10 2,757 / p50 2,922 / p90 3,124 ($; two $1,000 shares of $3,000), 16.8 s; `hold` 3,000 (16.3 s). No NaN, no run ended early, no liquidations, no fair-value clips. Capped stock-days 3.39% (3,253 / 96,000, target <= 3%), any-asset capped day share 10.5%; largest daily move 8.00%; price-to-anchor gap average 8.2%, largest 126.7%, study maxGapPercent 115.6 (target p99 <= 20%, so the anchor is far too weak at W = 0.1; tune at P5 once finding 2 is settled). Drift of the held index and stocks (hold, 24,000 days each): mean daily change +0.011 to +0.022% per stock, +0.007% index; mean 120-day change -0.3% to +1.3% per stock, +0.6% index (acceptance target: in [0, +4]%; stock means within standard error). Speed unchanged (16 s per 200-run batch against about 24 s per 300 runs at P0).


### P2b (done 2026-11-08; follow-up to P2 findings 2 and 3; `tests/fixtures` untouched, 359 tests pass, typecheck and lint clean)
1. **Value traders trade the gap.** `planTraderStock`: `dq.value = rate x valueTarget(weight, price, seenAnchor)`, so demand each day is proportional to the price-to-anchor gap (dead band, linear to full weight, steeper beyond the deep gap, capped at `valueMaxMultiple`), not the difference to a stored position. `pos.value` is now only a running total. An unfilled part (cap) stays wanted because the gap persists. The value pull is `rate x W / valueFullGap` of the gap per day (0.25 to 0.75 over the mix range), so other types' moves are corrected, not only offset. Stability tests in `src/content/tradersModel.test.ts` ("value loop stability", mix 0.5 to 1.5, noise mix 0.5 to 1.5, 8% cap): value alone converges from gaps of 10% to 300% with at most one sign crossing and ends inside the dead band; value + AR(1) noise over 6,000 days keeps the gap under 25% and its spread does not grow between halves.
2. **Carry bias.** Cause found in `events.ts` `applyDueEffects`, not in `drift.ts`: an event's `totalDelta` is fixed cents set from the fair value on the event day, so later decay shares are divided by a different fair value. Measured over 30 seeds x 1,000 days x 4 stocks: realised simple change -0.3093 %/day; same deltas divided by the event-day base -0.2848; analytic -0.2706 (the 0.014 left is sampling error). So the realised drift is 0.0245 points below the nominal (fair value that fell makes later shares of a down event larger and of an up event smaller; no code bug, no clip: `fairValueClipCount` 0). Mean log change is a further 0.016 below the simple mean. Fix: optional `TraderDefinitions.carryCorrectionPerDay` (added to the carry's daily factor, documented in `types.ts`), 0.0005 in `content/traders.ts` (0.0245 + 0.016 = 0.04 measured, 0.05 used). Anchor mean log change, 100 seeds x 1,000 days: NOVA +0.017, BLSW +0.031, HRBU +0.016, KSR +0.012 against the premium +0.02; price within 0.001 of anchor. The P2 drift test is tightened to anchor within 0.02 of the premium (was 0.07 below / 0.01 above) and price within 0.01 of the anchor.

Verify (seed abc, 200 runs, 120 days, `--model traders`, hold and longIndex1x give the same market): drift per stock mean daily change NOVA +0.037, BLSW +0.055, HRBU +0.061, KSR +0.044 %, index +0.064 % (SE of each about 0.02; target [0, +0.04]: NOVA passes, the others are above by less than one SE; the simple mean sits 0.016 above the log mean by construction, so +0.036 is the expected value); mean 120-day change +7.8, +10.1, +11.9, +9.2 % per stock, +9.8 % index (SE 2.3; target 0 to +4%, above because of the premium, the 0.016 convexity and a mean of products). Price-to-anchor gap (200 seeds x 120 days x 4 stocks, 96,000 stock-days): mean 3.94 %, p50 3.41, p90 7.94, **p99 12.57** (target <= 20: met), p99.9 15.99, max 24.02; event study maxGapPercent 30.48 (at an event day). Capped stock-days **0 %** (target <= 3%: met; the earlier 3.39 % came from the oversized value swings). Largest daily move 7.33 %. No NaN, no early end, no liquidations, no fair-value clips. longIndex1x final equity p10 2,620 / p50 3,071 / p90 3,656 ($; two shares of $3,000). 17 s per batch. Premium/tuning still P5.

### P3 (done 2026-11-08; `tests/fixtures` untouched, 375 tests pass, typecheck and lint clean; traders model only)
Added to `src/sim/traders.ts`: `eventTypeMap` (WeakMap cache per defs), `startTraderDay` (once per step, before the stocks are priced) and the types `TraderEventTrade`, `TraderDay`; `planTraderStock` takes the day's trades, `commitTraderStock` books them. `market.ts` reads `dueToday` (scheduled events firing today) before `applyDueEffects` and passes it with today's calendar items; `priceWithTraders` now logs `informed`, `news` and `consensus` flows (their `events` list the event ids). No new state fields: per (event, stock, type) the full-size target is `book.eventPos["id|asset|type|target"]` and the position `"id|asset|type"` (keys walked sorted; finished pairs are deleted, so `save.ts` needed no change).
- **informed** (leaked events only, same `assignLeaks` ids): target `sign x W x min(1, mag/5)`, factor 1/3, 2/3, 1 over the 3 days before, full through the event day and 1 day more, then 3 days of decay. **consensus**: target = the expected outcome's sector effect (no W), factor 1/2, 1 over the 2 days before, full on the release day, 4 days of decay. **news**: on the event day `e x (publicImpact - pricedIn)`, `publicImpact` = event type's (min+max)/2 with the sign, or the release's actual effect; `pricedIn` = informed + crowd + consensus positions on that (event, stock) before today's trades; full for 3 days from the event day, then 3 days of decay. `mix.news` and `mix.consensus` are not used (as written in the spec).
- **Decision (needs your OK): unwinding is absorbed.** With plain decay, an average-size event gave back its whole news move as the news traders left (the P2 structural issue): price V-shaped to about 0 by day 5 and then crept back as value traders caught up. A position that is being wound back to zero after its hold (`absorbed`) now books in full but adds no demand (and is not scaled by the cap): value traders and the anchor decide where the price settles. Event-driven positions are therefore flows that build the move; the fair-value change in the anchor holds it. Measured with one 5% event at the average size (8 seeds, 1.5-day anchor lag): +4.95% on the day, +4.11% on day 2, +4.69% on day 10; true 1%: +4.5% then +1.3% (reverts); true 11%: +5.9% then +10% (keeps drifting).
- **Content changes (placeholders):** `anchorHalfLifeDays` 3 to 1.5 (at 3 value traders sold every fresh news move against a stale anchor: the average event gave back a third by day 2) and `volSens` 1 to 0.25 (at 1 market-maker thinning fed on the news days' own volatility: capped stock-days 13.4% at 60 runs; 0.5 gave 7.1%, 0.25 gives 2.8%). Both are for P5 to retune.
- Tests: `src/sim/tradersInfo.test.ts` (event-type map, unrumoured event reacts about e x 5% on its day, keys cleared, true size below/average/above, no full reversion, informed up and down, leak leaves less for news traders, same-seed hash, cloned market), `src/content/tradersInfo.test.ts` (release equal to consensus vs surprise, consensus keys built and cleared, 120-day hash, session preview equals End day over 40 days).

Verify (seed abc, 200 runs, 120 days, `--model traders`, same market for every bot): capped stock-days **2.85%** (target <= 3%), largest daily move 8.00%, price-to-fair gap average 1.9%, largest 17.3%, study maxGapPercent 14.7 (target p99 <= 20), no NaN, no early end, no fair-value clips, ~28 s per batch. Drift: index mean 120-day change +9.2% (SE 1.6; premium and convexity as at P2b).
Final trading equity ($3,000 start, 200 runs): hold 3,000; followHeadlines p10/p50/p90 2,015 / 2,316 / 2,688, mean 2,348; fadeHeadlines 2,548 / 2,908 / 3,321; buyRumour 2,846 / 3,256 / 3,729, mean 3,274 (old model, 300 runs: follow 3,134, fade 2,148, buyRumour 2,898). The news bots have flipped: following headlines now loses, fading is about flat. Targets (follow 3,000 to 3,300, fade < 2,900, buyRumour 2,700 to 3,100) are for P5.
Event study (hold, signed % of close; old model in brackets, 300 runs unless noted):

| Group | d0 | d1 | d3 | d5 | after1 | after3 | after5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| stock (n=34,256) | +2.33 (+1.51) | +1.88 | +1.72 | +1.96 | -0.46 | **-0.62 (+1.03)** | -0.38 |
| stock:rumoured | +2.34 (+1.43) | +1.87 | +1.72 | +1.94 | -0.48 | -0.63 (+1.10) | -0.41 |
| stock:unrumoured | +2.30 (+1.82) | +1.93 | +1.73 | +2.05 | -0.37 | -0.58 (+0.78) | -0.25 |
| scope:sector | +2.77 | +2.07 | +1.74 | +1.94 | -0.71 | -1.05 | -0.85 |
| scope:market | +2.28 | +1.77 | +1.62 | +1.77 | -0.51 | -0.66 | -0.52 |
| calendar growth (n=3,200) | +1.13 (+0.76, 60 runs) | +1.09 | +1.22 | +1.38 | -0.03 | +0.11 (+0.39) | +0.26 |
| calendar inflation | +0.91 (+0.81) | +0.72 | +0.57 | +0.90 | -0.21 | -0.36 (+0.52) | -0.03 |
| calendar policy | +1.29 (+1.24) | +1.14 | +0.91 | +0.91 | -0.15 | -0.40 (+0.34) | -0.40 |

Rumoured true events close at +2.6% by the claim day (old +1.57 for high tier), +1.9% two days later.
Open points for P4/P5: (1) stock `after3` is -0.6 against the +0.2 to +1.0 target: day 0 is about e x the average size (2.3%) and the anchor, which lags and gets its size over the event's duration, then pulls the price back to about 1.7% before it recovers; shorter lag (1: after3 -0.39), a lower efficiency range or a faster value pull should move it. (2) informed and leaked events change day 0 very little (rumoured and unrumoured are alike): informed `W` (0.03 x mix) is small next to the news size. (3) The dominant early cost is stacking: many events reach one stock in the same days, so 5 to 10 news positions are held at once; flows stay under the cap at the current numbers but raw moves of 10% to 25% occur on pile-up days when depth is thinned. (4) The model's mean 120-day index change is still about +9%.


### P4 (done 2026-11-08; `tests/fixtures` untouched, 383 tests pass, typecheck and lint clean; traders model only)
Added to `src/sim/traders.ts`: crowd, trend and contrarian targets in `planTraderStock` (as spec section 2), `loopGains`, `normalisedMix` exported. New optional `TraderBook.history` (the last closes per stock, the book's own, so `participants.closes` and old-model hashes stay as they were; `save.ts` accepts it as optional) and optional `crowdReturnWeight` (0.5) and `crowdCapitulatedMood` (-0.5) in `TraderDefinitions`. `market.ts` now logs the three new parties. `startPartyDay` still writes `participants.mood`, `shares`, `chase` and `closes` each day (it runs before the trader step), so the social feed and liquidity grabs are unchanged. The crowd reads `participants.mood` (rumour shares by source tier + headline chase; a share is deleted on its claimed day) and adds 0.5 x clamp(ret5/5%), the capitulation rule (10-day drawdown < -8% and mood > 0 gives -0.5) and the +-1.5 clamp. Trend uses the last 5 closes; contrarians use ret5, the crowd mood and `book.lastFlow`.
- **Crowd legs.** The crowd's holding is split into one leg per rumoured event (`${event}|${stock}|crowd` in `eventPos`, built at the crowd's rate toward W x heat x share) and the rest (return chase, headline chase, capitulation). The legs add up to the spec's single `dq.crowd = rate x (W x heat x mood - pos)`. News traders read the legs as priced in (P3 wiring), so a hot true rumour has a small or negative surprise on its day. A leg is dropped when its share leaves (claimed day), so the crowd sells the news; a false rumour unwinds the same way.
- Market makers: `depthScaleFor` and the vol EWMA (updated in `commitTraderStock`) were already in; `volSens` stays 0.25 (capped stock-days 2.3%).
- **Content changes (placeholders):** crowd `base` 0.03 to 0.015 (at 0.03 one rumour leaving moved NOVA 9% in a day and capped both runs of the P3 calendar test); `anchorHalfLifeDays` 1.5 to 0.75 (see below).
- Tests: `src/content/tradersCrowd.test.ts`: loop gain at all 256 mix corners x both heat ends (worst self gain / (1 + value pull) = 0.57; bound 0.9 asserted), 300 seeds x 120 days (finite, max abs(P/A - 1) < 35%), a false rumour pumps and then falls below the unrumoured run (mean of 40 seeds), a hot true rumour closes red on its day and its leg is cleared, trend / contrarian / capitulation signs, thinning and the vol EWMA, mood and closes still written, determinism and preview equals End day over 30 days.

**Why a headline reverted (P3 open point 1), and what was changed.** Measured on isolated stock events (151 events, signed % of the previous close, P4 numbers before the fix): day 0 news +1.22, crowd -0.56 (sells the news, as designed for rumoured events), value -0.15; day 1 value -0.21 and contrarian -0.18. The anchor is fair value, which an event moves over 2 to 5 days, and value traders saw it through a 1.5-day half-life EMA, so on the days after the news they sold against an anchor that had taken only its first share of the event (price minus anchor flips sign on day 1 while the lagged copy is still below the price). So the reversion is the lag (value) plus contrarians fading yesterday's news flow. Fix inside the model: `anchorHalfLifeDays` 1.5 to 0.75. Sweep (100 runs, hold, stock group, crowd on): half-life 1.5 gives after1 -0.25 / after3 +0.01; 0.75 gives -0.06 / +0.35; 0.4 gives +0.07 / +0.47 but capped stock-days 3.1% (over the 3% target). Contrarian flow weight 0.5 to 0.25 to 0 moved after3 only to +0.35 / +0.33 / +0.29 (small), so it stays at 0.5. Not touched: stability tests, efficiency range, news hold and decay.

**Verify** (seed abc, 200 runs, 120 days, `--model traders`, $3,000; old model = P0 baseline, 300 runs). Final trading equity in dollars:

| Bot | Mean | p10 | Median | p90 | Min | Max | Liq/run | Old median | Target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hold | 3,000 | 3,000 | 3,000 | 3,000 | 3,000 | 3,000 | 0 | 3,000 | |
| followHeadlines | 2,789 | 2,464 | 2,775 | 3,157 | 1,921 | 3,646 | 0 | 3,134 | 3,000 to 3,300 (missed) |
| fadeHeadlines | 2,449 | 2,123 | 2,438 | 2,749 | 1,837 | 3,433 | 0 | 2,148 | < 2,900 (met) |
| buyRumour | 2,919 | 2,487 | 2,881 | 3,356 | 2,122 | 3,942 | 0 | 2,898 | 2,700 to 3,100 (met) |
| random | 2,769 | 2,080 | 2,784 | 3,352 | 732 | 4,620 | 0.015 | 2,874 | 2,750 to 2,950 (met) |
| longIndex1x | 3,063 | 2,553 | 3,017 | 3,544 | 2,249 | 4,384 | 0 | 2,354 | >= 2,950 (met) |
| shortIndex1x | 2,702 | 2,153 | 2,750 | 3,242 | 1,363 | 3,572 | 0.035 | 3,456 | <= 3,050 (met) |
| maxShortIndex | 1,315 | 201 | 660 | 3,299 | 112 | 13,182 | 2.93 | 5,342 | 2,600 to 3,400 (low) |
| maxLongIndex | 3,501 | 407 | 1,920 | 7,930 | 113 | 32,646 | 1.38 | 205 | within 25% of maxShort (not met) |

The news bots are no longer flipped: follow beats fade (P3: follow 2,316, fade 2,908). Follow is still about $225 under its target (spread and fees eat a post-headline drift of +0.35% at 3 days). maxShortIndex and maxLongIndex are far from their targets and are P5 work (50x on the index liquidates 1.4 to 2.9 times a run; 7 and 20 runs end early). Backstop use is 0 and no wipe-outs in these bots (the leveraged Nova bots were not in this request). Capped stock-days 2.26% (target <= 3%), any-asset capped day share 7.95%, largest daily move 8.00%, price-to-fair gap average 1.94% / largest 26.9%, study maxGapPercent 21.6 (one event day), no NaN, no fair-value clips, no hold run ended early. A 200-run hold batch takes 28 s.

Event study (hold, 200 runs, signed %; old model in brackets from P0/P3 or a 100-run batch):

| Group | d0 | after1 | after3 | after5 |
| --- | --- | --- | --- | --- |
| stock (n=34,256) | +1.28 (+1.47) | -0.03 (+0.89) | **+0.35** (+1.07; P3 -0.62) | +0.51 (+1.03) |
| stock:rumoured | +1.00 (+1.38) | +0.01 | +0.45 (P3 -0.63) | +0.62 |
| stock:unrumoured | +2.45 (+1.85) | -0.18 | -0.05 (P3 -0.58) | +0.05 |
| scope:sector | +1.70 | -0.39 | -0.09 (P3 -1.05) | +0.12 |
| scope:market | +1.10 | -0.18 | +0.22 (P3 -0.66) | +0.42 |
| calendar growth | +1.24 | -0.03 | +0.20 (P3 +0.11) | +0.35 |
| calendar inflation | +0.99 | -0.24 | -0.32 (P3 -0.36) | -0.09 |
| calendar policy | +1.42 | -0.03 | -0.22 (P3 -0.40) | -0.31 |

Rumours (toClaim, claim+2, signed % of close): true high +1.28 / +1.61 (old high +1.57 to claim), true medium +1.34 / +1.70, true low +1.50 / +1.81; false high -0.08 / -0.27, false medium +0.01 / -0.09, false low -0.03 / -0.07.

Stock `after3` +0.35 is inside the target (+0.2 to +1.0). Patterns: rumoured events show a smaller day 0 than unrumoured ones (+1.00 against +2.45: the crowd sold into the news and priced-in is subtracted); true-rumoured positive stock headlines close red on their day 42.2% of the time (80 seeds x 120 days, 5,246 events with an up crowd leg; target 20% to 45%; with a leg above 1% of depth 53%; unrumoured 21.5%); false rumours go nowhere. Drift of the held stocks: mean 120-day change +7.8, +9.9, +11.3, +8.2% (index +9.3%, SE 1.6), unchanged from P3 and above the 0 to +4% target. The pre-news d-3 is -0.95 for stocks (old model -0.39): not changed by P4's fix, not investigated.

Open points for P5: (1) followHeadlines under target, leveraged index bots far off; (2) efficiency range and informed weight (rumoured day 0 is small); (3) hot-rumour red share 53% against 45%: crowd base and tier weights; (4) pre-news d-3 of -0.95; (5) index mean 120-day drift +9%; (6) any-asset capped day share 7.95% while stock-days are 2.3%.


### P5 (done 2026-11-08; only `src/content/traders.ts` changed in the model; `tests/fixtures` untouched, 386 tests pass, typecheck and lint clean)
**Report.** `src/harness/report.ts`: `dominantTraderType` (the type whose mix sits highest inside its own range) and `mixLines`; `RunRecord` gained optional `dominant` and `cappedDays` (set by `batch.ts` only when the run has a trader book). The batch prints `[sim] mix dominant=<type> n= medianFinalEquityCents= liquidations= cappedDays= cappedDayShare=` after the report lines, one per type. Test: `src/harness/report.test.ts`. Test edits forced by content: `traders.test.ts` reads the efficiency bounds from the content; the P2b drift test in `tradersModel.test.ts` now expects the anchor at `premium + (carryCorrection - 0.0005)` because the correction was lowered on purpose.

**Changes (old -> new, why).**
| Parameter | Old | New | Reason |
| --- | --- | --- | --- |
| `carryCorrectionPerDay` | 0.0005 | 0.0001 | index and stock drift was +8 to +11% per 120 days; the correction was sized for an anchor at the premium, the targets want about 0 |
| `premiumPerDay` | 0.0002 | 0.0002 (tried 0.0001, 0.00015) | final value kept: with the lower correction stock means were slightly under 0 at 0.00015 |
| `types.news.rate` | 1 | 0.7 | news traders took the whole move on day 0; spreading it over two days cut realised volatility (HRBU 3.3x to 2.1x of `dailyVolatility`) and capped days (0.25% of stock-days), and left a post-headline drift for `followHeadlines` |
| `efficiencyMin` / `efficiencyMax` | 0.5 / 1.3 | 0.4 / 1.2 | with rate 0.7 the old range was a little high; 0.3 to 0.8 overshot (after3 +1.16, follow 3,215) |
| `types.informed.base` | 0.03 | 0.02 | pre-news run-up (d-3) was -0.95 against old -0.39; now -0.67 |
| `types.crowd.base` | 0.015 | 0.012 | same run-up; the crowd's rumour leg sells the news less hard, red-on-day share 53% to 44.5% with a big leg |
| `noiseShare` | 0.5 | 0.4 | NOVA realised volatility 0.96x to 0.93x, KSR to 1.41x; 0.3 would put NOVA at 0.82x |
Not changed: value base, `anchorHalfLifeDays`, `volSens`, crowd tier weights (no effect worth the risk), consensus, trend, contrarian. Sweeps that changed nothing useful: cutting crowd, trend, contrarian and informed to near zero left index volatility at 1.87% and `maxShortIndex` median at 895.

**Final numbers** (seed abc, 300 runs, 120 days, `--model traders`, $3,000; $ final trading equity). Bot rows are from the batch at `premiumPerDay` 0.00015 except the four re-run at 0.0002 (hold, longIndex1x, shortIndex1x, followHeadlines).
| Target | Result | Status |
| --- | --- | --- |
| Per stock mean daily change in [0, +0.04]% | NOVA -0.006, BLSW +0.016, HRBU +0.009, KSR +0.000 (SE about 0.02) | met within SE (NOVA just below 0) |
| Index mean 120-day change in [0, +4]% | +2.54% (SE 1.17), per stock +1.4 to +3.7% | met |
| longIndex1x median >= 2,950 | 2,921 (mean 2,948 at 0.0002; 2,909 at 0.00015) | missed by $29 |
| shortIndex1x median <= 3,050 | 2,889 | met |
| maxShortIndex median 2,600 to 3,400, mean < 3,600, not the best bot | median 1,164, mean 2,284, not the best bot | median missed |
| maxLongIndex within 25% of maxShortIndex | median 1,548 vs 1,164 (33%), mean 2,718 vs 2,284 | missed |
| followHeadlines 3,000 to 3,300 | 3,067 (mean 3,080 at 0.0002) | met |
| fadeHeadlines < 2,900 | 2,251 | met |
| buyRumour 2,700 to 3,100 | 2,845 | met |
| random 2,750 to 2,950 | 2,857 | met |
| Liquidations per run vs P0 (0.7 to 1.5x) | longNova10 3.34 (0.66x), longNova20 2.08 (0.77x), longNova50 0.98 (0.98x), shortNova50 0.92 (1.01x) | met except longNova10 (0.04 under) |
| Backstop at 50x <= 1.5x of P0; none at 5x | longNova50 $457k (0.98x), shortNova50 $440k (1.04x), longNova20 $25.8k (1.27x); maxLong/maxShort 0 | met |
| Capped stock-days <= 3% | 0.22% (any-asset capped day share 0.84%) | met |
| At most 3 capped days in a row | 2 (100 runs) | met |
| p99 of abs(P/A - 1) <= 20% | 6.75% (max 14.4%; study maxGapPercent 14.6) | met |
| Realised volatility per stock 0.8 to 1.5x `dailyVolatility` | NOVA 0.93, BLSW 1.12, HRBU 2.13, KSR 1.41; index 1.31% a day | HRBU missed |
| True-rumoured positive headlines red on their day 20 to 45% | 34.1% (44.5% with a crowd run-up above 1%) | met |
| Stock headline `after3` +0.2 to +1.0% | +0.90 (rumoured +0.92, unrumoured +0.78) | met |
| e > 1 shows a reversal from d1 to d5 | no reversal (cumulative signed move at d1 / d5: e > 1 +1.66 / +2.22; e <= 1 +1.16 / +2.03) | missed |
| Pre-news d-3 (old model -0.39) | -0.67 stocks, -0.38 market | closer, not equal |
Speed: a 300-run hold batch takes about 45 s, the same order as P0's 24 s for 300 runs on the old model (the traders path is heavier; not measured against the 1.3x budget).

**By dominant type** (hold, 300 runs): capped-day share is highest where crowd (1.22%) or trend (1.22%) dominate and lowest where consensus (0.51%) or news (0.58%) dominate. `maxShortIndex` median equity by dominant type runs from $798 (informed) to $1,655 (value); `maxLongIndex` from $989 (consensus) to $2,400 (informed).

**What remains unmet and why.**
1. `maxShortIndex` and `maxLongIndex` medians ($1,164 / $1,548 against 2,600 to 3,400). These bots re-open at 5x each day, so volatility drag and liquidations (2.2 and 1.3 per run) decide the result. Index volatility is 1.3% a day, set by sector and market events, which the trader parameters only shape: removing crowd, trend, contrarian and informed left it at 1.87% (was 1.9%), and news rate 0.5 with efficiency 0.3 to 0.8 gave 1.25% with a median of only 1,167. Long beating short by a third comes from the +2.5% index drift and the borrow fee. Reaching the target needs lower event sizes or index volatility, which is content outside `traders.ts` (events, calendar) or a decision on the targets.
2. HRBU realised volatility 2.1x (KSR 1.4x, BLSW 1.1x). HRBU has `dailyVolatility` 1.0% but its news moves are 2 to 3% a day, the same as the old model (2.3x), and trader weights are not scaled per stock. Needs a per-stock scale in the sim or smaller events for HRBU.
3. longIndex1x median 2,921 against 2,950: the two goals (index drift at most +4% a year-run, median of two index shares at least 2,950) pull against each other; the mean is 2,948.
4. Reversal for e > 1: efficiency up to 1.5 was tried and the price still reaches the anchor from below (the average event is full size at e about 1.1); a reversal needs e of about 2 or a hold-and-decay on news positions, which is a sim change.
5. longNova10 liquidations 0.66x of P0 (target 0.7x): lower volatility on NOVA; not worth raising noise for.
6. Pre-news run-up of -0.67 against -0.39: informed and crowd build ahead of a rumoured event by design (buy the rumour); going lower weakens the crowd and informed patterns.

### P6 (done 2026-11-08; 387 tests pass, typecheck and lint clean)
- `src/content/index.ts`: `traders: TRADER_DEFINITIONS` in `MARKET_DEFINITIONS` (also exported). `src/harness/model.ts`: `definitionsFor('current')` strips `traders`; `'traders'` keeps them. `--model current` runs (checked with a small batch).
- `tests/fixtures/demo-30-price-log.txt` regenerated (only fixture changed; noise-roll and step7 fixtures pass untouched).
- New test in `content.test.ts`: a 30-day run with traders and one without produce identical non-price lines (everything except priceStep, indexStep, participantFlow), and all ten listed kinds appear. Compares against the old model run, not a stored copy, so no extra fixture file.
- Tests updated: `traders.test.ts` (asserts traders are now wired in); `tradersModel.test.ts` "leaves the current market unchanged" (strips `traders` from `MARKET_DEFINITIONS` to get the old model, since the shipped set now has them). No other test needed a number change: pump-and-dump, idle equals idle and small orders equal idle pass as written.

### P7 (done 2026-11-08; `tests/fixtures` untouched)
`continueGame` (`src/ui/store.ts`) gives a save with `definitions.traders` and no `participants.book` a book from `createOldSaveBook` (`src/sim/traders.ts`, wraps `createTraderBook`). The session is built on `market.day` and previews the step to `day + 1`, so `activeFromDay = market.day + 2`: the next End day prints the session's last bar with the old code, the one after runs the traders model. `seenAnchor` starts at the session's previewed close (the price the model sees on its first day), so value traders have no gap to trade and nothing jumps; positions 0, carry 1, history empty. A save that has a book is untouched. Tests in `src/ui/oldSaves.test.ts` (save played with traders removed from the rules, as a pre-P6 save was): book fields, End day close equals the previewed close and logs no anchor, the next day logs an anchor, same-seed hash, existing book unchanged.
