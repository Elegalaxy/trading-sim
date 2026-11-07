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
| P1 | **Types, content, book creation; no behaviour.** `TraderDefinitions`, `TraderBook`, `MarketDefinitions.traders?`, `ParticipantState.book?`; `src/sim/traders.ts` (`assertTraderDefinitions`, `createTraderBook`); `src/content/traders.ts` placeholder numbers, not wired in. `save.ts` `checkParticipants` moves from `sameKeys` to `keysWithin` with an optional `book` shape check | `types.ts`, `traders.ts`, `content/traders.ts`, `save.ts`, tests | same seed same mix; mix normalised; save with and without `book` passes | `npm test` (fixtures untouched) | todo |
| P2 | **Core engine: value (anchor, carry, lag), noise AR(1), market makers, player flow, fill scale.** Branch in `stepMarketDay`. Extend `ParticipantFlowEvent.party` union; optional `anchor`, `depthScale`, `fillScale` on `PriceStepEvent`; update `log.ts`, the exhaustive switches in `summary.ts` and `batch.ts`. Event study `maxGapPercent` measures against the anchor. Harness flag `--model traders` uses `{...MARKET_DEFINITIONS, traders: TRADER_DEFINITIONS}` | `market.ts`, `traders.ts`, `types.ts`, `log.ts`, `summary.ts`, `cli.ts`, `batch.ts`, `eventStudy.ts` | without traders fixtures identical; capped day scales positions and carries the rest; session preview close equals End day close with traders; 50 seeds x 1,000 days value and noise only: mean daily log change of anchor and price within +-0.01% + premium | `npm test`; `npm run sim -- --seed abc --days 120 --batch 200 --strategy longIndex1x --model traders` | todo |
| P3 | **Information traders: news (surprise vs pricedIn), informed (with hand-off), consensus (hold and decay).** Build an event-type `Map` once per defs (WeakMap cache) instead of `defs.events.find` in loops | `traders.ts`, tests | calendar result equal to consensus moves less than a surprise; an unrumoured event reacts at about e x public impact; a true size below average reverts by day 5 | `npm test`; batch with `--model traders`, read event-study d0/after3 | todo |
| P4 | **Crowd, trend, contrarians, market-maker volatility thinning; keep `mood` updated** | `traders.ts`, tests | loop gain < 1 + kappa at every mix corner; 300 seeds x 120 days: no NaN, max abs(P/A - 1) < 35%; a false rumour pumps then unwinds; a hot true rumour can close red on its day | `npm test`; `--model traders` batches | todo |
| P5 | **Tuning and mix report.** `[sim] mix` lines (results by dominant type). Change only `src/content/traders.ts` until section 4 passes | `content/traders.ts`, `report.ts` | report line test | the section 4 batch with `--model traders` | todo |
| P6 | **Wire in and regenerate the fixture (isolated).** Add `traders` to `MARKET_DEFINITIONS`. Regenerate `tests/fixtures/demo-30-price-log.txt`. Test that every non-price line kind (`eventRoll`, `eventDirection`, `eventMagnitude`, `effectApplied`, `fairValueChange`, `envDrift`, `calendarItem`, `headline`, `rumourGenerated`, `noiseRoll`) matches the old file line by line. Noise and step7 fixtures pass untouched. Any other failing test must be an exact price number: update each with a one-line reason (expected: `content.test.ts`, `orderFlow.test.ts`, `socialFeed.test.ts`, `study.test.ts`, `strategies.test.ts`, UI tests using `MARKET_DEFINITIONS`) | `content/index.ts`, fixture, listed tests | pump-and-dump test still loses on average; idle equals idle; small orders equal idle | `npm test`; `git diff --stat tests/fixtures` shows only the price log | todo |
| P7 | **Old saves.** In `continueGame`, when `definitions.traders` is set and `market.participants.book` is missing: `createTraderBook(defs, save.seed, market)` with `activeFromDay = market.day + 2` and value positions seeded at their current target (no jump on load) | `store.ts`, `oldSaves.test.ts` | pre-P6 save loads; End day prints the session's last bar; the next day runs the new model | `npm test` | todo |
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
