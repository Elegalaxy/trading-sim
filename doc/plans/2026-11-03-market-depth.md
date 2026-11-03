# Trading Sim: Market Depth Plan

Date: 2026-11-03  
Status: draft. No step starts before the user answers the questions at the end (section 11). Every number here is a placeholder, provisional in this plan only.  
Design source of truth: [../GAME_DESIGN.md](../GAME_DESIGN.md), section 12 "Market depth ideas" (all `[OPEN]`). This plan does not change any `[CONFIRMED]` rule. Where an option would, it says so and lists it as a user decision.  
Format: steps follow [2026-10-22-first-playable.md](2026-10-22-first-playable.md). Step ids are `M0`, `M1`… so they do not collide with that plan's numbers. Allowed status values: `todo`, `done`, `verified`, `failed`, `blocked`.

## 1. Goal

Make the market harder to read in a learnable way. Difficulty should come from other market parties whose behaviour, taken together, produces familiar patterns (pre-news drift, pricing in, "buy the rumour, sell the news", overreaction, liquidity grabs around obvious levels). No pattern is scripted as a strategy. Alongside that: consensus for scheduled releases, liquidity and slippage for large orders, an always-on social feed, and a decision on the 8% cap.

## 2. Where the market is today

Read from the code on 2026-11-03.

- `stepMarketDay` (`src/sim/market.ts`): calendar outcome and due event effects move fair value (clipped to ±12% a day), then each stock moves `35% × (fair − price) + z × volatility × price`, capped at 8% of the previous close. The index is the equal-weight average, with the same cap. Then the environment drifts, day+3 is pre-rolled, and tomorrow's feed is published.
- Events are rolled 3 days ahead (`EVENT_LOOKAHEAD_DAYS`) onto `state.scheduled`. Calendar outcomes are rolled 3 days ahead onto `state.calendarRolls`. So the market state already knows the next 3 days of news. Rumours (info stream) use that schedule. Nothing else does.
- An event's total effect is spread over its duration (linear or front-loaded) and the price closes 35% of the gap a day. The measured headline edge (about 0.5% on the event day and 2.1% by day 3, 300 seeds) comes from those two lags: after a headline, fair value keeps moving and price keeps catching up.
- Streams: `market`, `events`, `info`, `distortion` from `createRng(seed)`. The session uses `createRng(seed + '#session')` and keeps only its `market` and `events` members (`intraday`, `volume`). Its `info` and `distortion` members are unused.
- The session previews the next market step on a `structuredClone` of the market, so anything that changes a close must live inside `stepMarketDay` and depend only on `MarketState` and definitions.
- Volume is display only: `SESSION_BASE_NOTIONAL_CENTS / open`, the same notional for every stock.
- Calendar releases are `above / inline / below` bands of the current (hidden) environment value. There is no consensus, and the headline reads "Growth release inline".
- `src/sim/distortion.ts` `stanceFor` finds a news item's direction by searching its text for the words "up" and "down". Since the 2026-11-03 fact wording ("NOVA earnings miss", "Inflation data hotter than expected"), real headlines and rumour claims contain neither, so stress no longer re-weights or hides real news. Only generated posts still appear. The tests pass because they build synthetic "NOVA earnings up" headlines. Step M1 fixes this first.

## 3. Rules every option must keep

- Same seed and same commands give the same run (`[CONFIRMED]`, section 10).
- Same seed gives the same market whatever the player's stats do (section 15 criterion 9, provisional). This plan also keeps the stronger rule the code already tests (`strategies.test.ts`: a trading bot and an idle bot see the same market hash): **no party reads player state.** Participant code takes `MarketState` and definitions only, never `GameState`, positions, resting orders or perception.
- New randomness uses its own derived streams, following the session precedent (`createRng(seed + '#name')`). The four main streams keep their draw order, so `demo-30-noise-roll.txt` and the `eventRoll` lines of `demo-30-step7-rolls.txt` stay byte-identical unless a step says otherwise.
- Fair value stays the truth that events move. Parties move price (through an offset the pull aims at), never fair value. This keeps the event, calendar, environment and rumour lines of the logs unchanged.
- The Guide stays a reference. Participants, consensus pricing and slippage appear in rough terms. Exact numbers appear only for player-controlled account rules (for example the slippage estimate on the order panel).
- Debug rule: every new mechanism writes typed log events (`src/sim/log.ts`) with its inputs, printed as `[DEBUG market] kind=…`.
- Layers (`tests/architecture.test.ts`): logic in `src/sim`, data in `src/content`, bots and reports in `src/harness`, shape checks in `src/persist`, panels in `src/ui`. All new files fit existing layers, so the architecture test needs no change.

## 4. Market participants (idea 1)

### 4.1 Options

User decision 2026-11-03: **B, real orders.** The recommendation below is kept for the record. M4 builds B: each party submits net demand in shares, price moves by that demand against the stock's depth (from M2), institutions are the party that buys below fair value and sells above it (replacing the fixed 35% pull), and noise traders replace the noise term. The damping and clamps in section 10 become required, not optional.

- **A. Value offsets (recommended).** Each party adds a signed offset, in percent of fair value, to a per-stock *anchor*. The pull aims at `anchor = fair value + Σ offsets` instead of at fair value. The 35% pull itself stands for institutions and value money. Offsets decay and are logged per party. Small, stable, easy to tune and to explain in a debug line.
- **B. Order flow and depth.** Each party submits net demand in shares, and price clears against per-stock depth. Closer to a real market and more emergent, but harder to keep stable (feedback loops, runaway trends) and harder to tune in 120-day runs. Worth revisiting if A feels mechanical.
- **C. Pattern templates** (for example "after a true rumour, add +x% then −y%"). Rejected: this scripts strategies, which the user does not want.

### 4.2 Recommended parties (option A)

Each party reacts to information, not to pattern names. Patterns appear when parties overlap.

| Party | Reads | Behaviour | Pattern it feeds |
|---|---|---|---|
| Institutions | fair value | the existing 35% pull toward the anchor | mean reversion after overshoots |
| Informed money (whales) | `state.scheduled` (the 3-day schedule) | for some events, pushes the anchor toward the coming effect, a growing share each day before it | pre-news drift, pricing in |
| News traders | today's headlines, `state.active` | on a headline, price in a share of the effect's remaining (not yet applied) delta, sometimes more than all of it, then fade the excess | faster reaction, overreaction then reversal |
| Retail crowd | rumours of every source, headlines, recent returns | per-stock mood that rises on bullish rumours and runs, falls on bearish ones; mood is an offset. A rumour's share of mood leaves when it resolves (headline or no-show) | buy the rumour, sell the news; false-rumour pump and unwind; crowding in small caps |
| Momentum bots | the last few closes | follow the short trend, exit on a reversal | trends that persist, then snap |
| Stop hunters (intraday only, M9) | public levels: round prices, prior day's high and low | push a session wick through the level and back | liquidity grabs; stops at obvious levels get hit |
| Government | index drawdown | `[LATER]` default. Option: a "policy put" that tilts the next policy decision after a large index fall. It touches calendar chances, so it changes the events stream and the fixtures | support after crashes |

How the patterns arise, in words:

- **Pre-news drift and pricing in.** Informed money moves the anchor before a scheduled event. On the event day fair value catches up with an anchor that is already partly there, so the visible move is smaller.
- **Buy the rumour, sell the news.** The crowd buys a bullish rumour (any source tier, true or false). On the headline the rumour's share of mood leaves, while news traders add the event. If the crowd was bigger than the news-trader reaction, a good headline closes red.
- **False-rumour pump.** No headline comes, so the rumour share leaves and the price falls back to the anchor.
- **Overreaction.** News traders price in more than the remaining effect when the crowd is hot, and the excess decays.
- **Liquidity grabs.** Session wicks reach obvious levels and come back, so a stop there fills and the price recovers.

Size matters: per-stock size and liquidity (section 6) scale the parties. Small, illiquid stocks get a stronger crowd and weaker institutions. Large ones the reverse.

### 4.3 Regimes

At run start the participants stream draws a regime: crowd heat, informed leak strength, news-trader efficiency, each inside a content range. Crowd heat drifts slowly with the index trend. Regimes make patterns conditional, so a run where "sell the news" pays and one where it does not are both possible. That matches the Guide's line that the player combines concepts "when market conditions support it". Regimes are never shown. The batch report breaks results down by regime.

### 4.4 Determinism and layers

- Stream: `createRng(seed + '#participants').market`, stored on `MarketState.participants.stream`. It has to be on `MarketState` so the session preview clones it and the close it previews is the close End day prints.
- Draw order, fixed and documented in the module header: regime drift, then per stock in definition order (crowd jitter, momentum jitter), then one leak roll per event newly scheduled this step, in `scheduled` order, after `rollEventsForDay`. Calendar items never get a leak roll (they are covered by consensus, section 5).
- Files: `src/sim/participants.ts` (pure, signature `(market: MarketState, defs: MarketDefinitions)`), `src/content/participants.ts` (party weights, regime ranges, a per-event-type `leak` share, crowd scale by size), `MarketDefinitions.participants?`. With `participants` absent the step behaves exactly as today, which is how unit tests can still pin the old model.
- Never reads `GameState`. Add a test in `participants.test.ts` that the module source does not mention `GameState`, `positions` or `resting`, in the style of the architecture test.

### 4.5 Fixtures

- `demo-30-price-log.txt` changes: `priceStep` and `indexStep` numbers, plus new `participant…` lines. Regenerate on purpose, and add an assertion that every line of the other kinds (`eventRoll`, `eventDirection`, `eventMagnitude`, `effectApplied`, `fairValueChange`, `envDrift`, `calendarItem`, `headline`, `rumourGenerated`, `noiseRoll`) is identical to the old fixture. That proves only prices moved.
- `demo-30-noise-roll.txt` and the compared lines of `demo-30-step7-rolls.txt` stay the same.
- `stateHash(market)` changes for every seed (new state key). Saves from before the step fail the shape check; the precedent is "rejected as damaged" (Steps 28 and 32).

## 5. Expectations and consensus (idea 2)

### 5.1 Calendar releases

Options for the consensus:

- **C1. Deterministic from released data (recommended).** Consensus is the most likely outcome in the chance table at the band of the *last released* value (policy: at the last released inflation and growth). No draw. Forecasters lag the hidden drift, so surprises come from drift since the last release, which a reader of the event flow can sometimes infer. Shown on the calendar from when the outcome is rolled (3 days ahead), as "Expected: stronger / in line / weaker" and "Expected: hold / hike / cut".
- **C2. Noisy forecasters.** Consensus is drawn per item on a new `#consensus` stream with a hit rate. More variety, more tuning, one more stream.
- **C3. Consensus as a range.** Show the full chance spread ("most expect in line, some expect weaker"). More information for the player; risks becoming exact numbers in the UI.

Pricing in: in the days before a release, the anchor moves toward the expected effect of the consensus outcome (weight growing as the day approaches). On the day, fair value takes the actual effect and the consensus offset leaves, so the visible move is roughly actual minus expected. A release that matches consensus barely moves the price.

Wording: the calendar headline judges the outcome against consensus: "Growth data stronger than expected", "Growth data as expected", "Policy rate hike, as expected". This also fixes the known gap "Growth release inline". The release's effect on fair value is unchanged (it is still keyed by outcome). Only the anchor and the text change.

Determinism: C1 draws nothing. Headline text lines in the price log change, and prices change through the anchor.

### 5.2 Earnings

- **E1. Keep random earnings events (recommended for now).** Expectations come from the crowd: a stock that ran up into a beat has mood already priced in, so the beat can close red. No content change.
- **E2. Scheduled earnings dates per stock with a consensus**, as a new calendar kind (for example one report per stock per 30-day month, staggered). Closer to real markets and gives earnings-season patterns. It removes or reshapes the random `earningsBeat` type, which changes the events stream draw order, so `demo-30-step7-rolls.txt` and the price log both change. A separate, later step (M8) if the user wants it.

## 6. Player price impact, size and liquidity (idea 3)

### 6.1 Data

Each stock gets `sharesOutstanding` (market cap = shares × price, shown on the Guide's company page and the asset header) and `liquidityNotionalCents` (average daily traded value). Session volume uses the per-stock figure instead of the one global constant. The volume stream draws are unchanged; only the scale differs. That ends "volume is cosmetic" (a provisional rule), because volume becomes the liquidity a fill is measured against.

### 6.2 Options

| Option | What it does | Seeded replay | Cost |
|---|---|---|---|
| **I1. Slippage only (recommended)** | A fill pays extra beyond the half spread: `impact ≈ k × daily volatility × √(shares ÷ bar volume)`, free below a small share of the bar | market path identical for any orders; all fixtures unchanged | small: one function in `trading.ts`, an estimate in the order panel |
| I2. Intraday decaying impact | as I1, plus the player's own later bars in the session are shifted by a decaying impact; the close is unchanged | daily market identical; session bars depend on the player | moderate; opens a self-manipulation loop (push the price into one's own limit) that needs a guard |
| I3. Permanent impact | the order moves the close and so the market | breaks "same market whatever the player does", the bot hash test, and the session preview (the close is no longer known at day start) | large; also lets a player move a seeded challenge |

Recommendation I1. It hits only large orders, which today means high leverage. At 50x a $3,000 account controls about $150,000, about one 15-minute bar of a stock's volume, so slippage would bite exactly where the backstop tail is fat (the `shortNova50` tail in GAME_DESIGN section 16).

Choices inside I1, for the user:

- Market orders and liquidations pay slippage (recommended). Stops pay it too (a stop is a market order once touched; recommended). Take profits and limit orders fill at their own price.
- Limit orders larger than a share of the bar's volume: fill fully (v1, recommended) or fill partly and keep the rest resting (later).

### 6.3 Determinism and fixtures

No draws: impact is a function of the order, the bar volume (already seeded) and the asset. No golden fixture changes. Unit tests with exact fill cents stay valid if the free threshold covers their small orders. New log event `slippage` with order size, bar volume and cents paid. Save shape: none for I1 (asset data lives in content).

## 7. Social feed "Y" (idea 4)

### 7.1 Design

- **Always on.** Each played day carries a short feed of retail posts, separate from news. Posts come from personas (hype, doom, "I heard", bag holder, joker) defined in content with calm and loaded text variants.
- **A window on the crowd, not a cause.** Post sentiment per stock is sampled from the crowd mood of section 4. Posts and crowd pressure share a cause (mood), so reading posts tells the player how crowded a trade is (useful as a contrarian signal) while posts still never change the market.
- **Faster than news, less reliable.** Two kinds of early post:
  - Whispers about scheduled events, lead up to 3 days (the same window rumours use), with a hit rate below the low rumour tier. A true whisper is more likely on an event informed money is leaking, so price may already be moving.
  - Intraday chatter stamped with a session time ("NOVA dumping, anyone know why?"), reacting only to bars that have printed. A post stamped at bar *i* may read bars up to *i* and the schedule, never later bars or the previewed close. Posts after the clock are hidden, like bars.
- **Stress.** Within the existing bias rule: posts that agree with the player's positions are promoted, posts against them are hidden, and agreeing posts switch to their loaded text. Each counts as a distorted item, carries the tell, and the generate action stays as it is.
- **Cap.** The cap is applied per channel: up to 25% of news items and up to 25% of posts, each scaled by stress. Without this, a long post list would raise the number of news items that can be distorted. Verify shows both channels unfiltered.

### 7.2 Determinism and layers

- Stream: `createRng(seed + '#social').market`, stored on `GameState.social` (like `session`), not on the market. Social draws can then never change `stateHash(market)`.
- Generation: in `src/sim/social.ts`, called from `game.ts` after the market step and after `buildSession`. It reads `MarketState` (mood, schedule) and the session bars read-only. Persona text lives in `src/content/socialPosts.ts` (extended). `distortion.ts` gains a `restyle` action and a per-channel cap.
- Perception and the distortion stream are unchanged in kind. Distortion draws change in count because there are more candidates, which no fixture records.
- Fixtures: none of the three market fixtures. `distortion.test.ts` and `feed.test.ts` gain cases. Saves: a new `social` key, so old saves are rejected or upgraded.

## 8. The 8% daily move cap (idea 5)

The cap is `[CONFIRMED]` in section 7 (loss cap guarantee). Any change below needs a user decision. The intraday band (12%) and the fair-value daily limit (12%) are separate and provisional.

| Option | Effect |
|---|---|
| **K1. Keep 8% for every stock (recommended for now)** | No change. The reason it exists is weaker since per-position leverage and bar-by-bar liquidation, so it now works mainly as a circuit breaker and as the rule that turns big news into multi-day moves. |
| K2. Widen (10–12%) | Fewer capped days and fewer multi-day carries after large news, so less of the "ride the capped move" predictability (section 16 risk). Equity protection relies more on bar liquidation and the 0.5% fee. |
| K3. Per-stock, tied to volatility (for example the larger of 8% and 4 × daily volatility) | Keeps 8% as a floor. Only the most volatile names would widen. Pure `max(8%, …)` never tightens HRBU or KSR. |
| K4. Replace with an intraday halt | A stock that moves past a band in the session stops trading for the rest of the day; the rest carries to tomorrow. Most realistic, most UI and rules work. |

Recommendation: keep K1 while participants are built, and measure the share of capped stock-days before and after (M0 and M11). Overreaction can push that share up. If it rises past roughly 3% of stock-days, bring K3 to the user. Fixtures: K1 none. K2 and K3 change `priceStep` and `indexStep` lines (the `capped` flag and moves) on capped days only.

## 9. Steps

Each step follows the definition of done in the first-playable plan, section 2.3 (typecheck, tests, intended snapshot updates only, debug prints). Steps M0 to M3 do not change the market and can ship on their own.

### Step M0: Event-study report and baseline

- Status: `done`
- Depends on: none
- Files to create or change: `src/harness/strategies.ts`, `src/harness/report.ts`, `src/harness/batch.ts`, `src/harness/cli.ts`, `src/harness/strategies.test.ts`
- What changes: an event-study report: average signed move around each headline by day offset −3 to +5, split by event type, scope and whether a true rumour preceded it; the move on a false rumour's claimed day; the share of capped stock-days. New bots `followHeadlines` (enter after a headline in its fact direction, exit 3 days later), `fadeHeadlines`, `buyRumour`. Record the current numbers (about 0.5% on the day and 2.1% by day 3 for stock headlines) as the baseline in Progress.
- Must not change: any `src/sim` or `src/content` file, any fixture.
- Verification: `npm run sim -- --seed abc --days 120 --batch 300 --strategy followHeadlines` prints the report; numbers match the measurement quoted in section 2 within noise.
- Progress: 2026-11-03: `src/harness/eventStudy.ts` prints `[sim] study` lines after every batch report, whatever the strategy (it reads only the market log, the stored feed and closes). `d<k>` is the signed move from the close before the event day to close N+k; `after<k>` is from close N, the first price a headline reader can trade at. Bots `followHeadlines`, `fadeHeadlines`, `buyRumour` trade the visible, unbiased feed at 1x, a fifth of equity per trade. Two new tests in `strategies.test.ts` (bots close on time and leave the market hash equal to an idle run; study lines are printed). npm test 182 passed, typecheck and lint passed. No sim, content or fixture change.
  Baseline, seed `abc`, 300 runs of 120 days (start trading equity $3,000):

  | Group | n | d−3 | d0 | d1 | d3 | d5 | after1 | after3 | after5 |
  |---|---|---|---|---|---|---|---|---|---|
  | stock headlines | 51,234 | +0.06 | +0.53 | +1.24 | +2.15 | +2.52 | +0.71 | +1.63 | +2.01 |
  | sector events | 24,816 | −0.15 | +0.48 | +1.14 | +2.33 | +3.03 | +0.66 | +1.86 | +2.56 |
  | market events | 28,452 | −0.03 | +0.32 | +0.81 | +1.68 | +1.97 | +0.50 | +1.37 | +1.67 |
  | policy decision | 4,800 | −0.14 | +0.57 | +0.97 | +1.40 | +1.63 | +0.41 | +0.85 | +1.08 |
  | inflation release | 4,800 | −0.35 | +0.42 | +0.73 | +1.17 | +1.59 | +0.32 | +0.77 | +1.19 |
  | growth release | 4,800 | +0.30 | +0.30 | +0.46 | +0.53 | +0.46 | +0.16 | +0.23 | +0.16 |

  Percent, signed the way the news points; standard error of d3 is 0.02 to 0.07. By type, the largest post-headline drift is scandal (after3 +3.7) and lawsuit (+2.5), the smallest buyback (+0.6). Stock headlines with a true rumour before them move the same as those without (d3 2.16 vs 2.07): nothing prices news in today. Types that only point one way (buyback, product launch, contract award, scandal, lawsuit) show the price falling about 0.4% over the 3 days before, in both directions; two-way types show nothing. That looks like the market's average drift, not information; a drift-adjusted column would confirm it.
  Rumours, from the close when generated to the claimed day: true ones +0.5% (+1.76% two days later) at every tier; false ones about 0. Capped stock-days: 0.08% (112 of 144,000).
  Bots, final trading equity p10 / p50 / p90: `hold` $3,000 / $3,000 / $3,000; `followHeadlines` $3,191 / $3,504 / $3,860 (no losing decile at 1x); `fadeHeadlines` $1,762 / $1,949 / $2,132; `buyRumour` $2,367 / $2,624 / $2,862 (the false ~40% and the round trips cost more than the true ones earn). No liquidations.

### Step M1: Bias direction from the event, not the text

- Status: `done`
- Depends on: none
- Files to create or change: `src/sim/types.ts` (`direction` on `HeadlineItem` and `RumourItem`), `src/sim/feed.ts`, `src/sim/market.ts` (`firedHeadlines`), `src/sim/distortion.ts` (`stanceFor`), `src/sim/distortion.test.ts`, `src/persist/save.ts`
- What changes: news items carry their event's price direction. `stanceFor` uses it, so stress re-weights and hides real fact-worded news again. New test using real content headlines ("NOVA earnings miss" hidden for a long at stress 100).
- Must not change: any random draw. The price log fixture, unless the headline log format gains the field (prefer not).
- Verification: tests; a seeded run at stress 100 with a NOVA long shows a hidden bearish NOVA headline in the admin log.
- Progress: 2026-11-03: `direction` is optional on both item types, so calendar headlines and saved feeds without it fall back to the old text search; no save change was needed. Log formats unchanged, all three fixtures pass untouched. New tests in `distortion.test.ts`, `feed.test.ts` and `content.test.ts`. The content test (seed `demo`, 30 days, real wording, stress 100, a position against each news item) found 0 bias actions before the fix and 63 re-weights and 186 hides after it. npm test 180 passed (29 files), typecheck and lint passed. Not checked in the browser.

### Step M2: Stock size and liquidity

- Status: `done`
- Depends on: none
- Files to create or change: `src/sim/types.ts` (`AssetDefinition`), `src/sim/market.ts` (validation), `src/sim/session.ts` (per-stock volume scale), `src/content/assets.ts`, `src/ui/Guide.tsx` (company page: large or small, liquid or thin), asset header in `src/ui/Dashboard.tsx`, `doc/GAME_DESIGN.md` (with the user's decision on volume)
- What changes: `sharesOutstanding` and `liquidityNotionalCents` per stock. Volume scales per stock. Market cap is shown.
- Must not change: session stream draws, closes, any fixture.
- Verification: session tests updated for new volume numbers only; `stateHash(market)` unchanged for seed `demo`.
- Progress: done 2026-11-04. Fields are optional on `AssetDefinition` and validated when present (index may not set shares). Session volume uses `liquidityNotionalCents ?? SESSION_BASE_NOTIONAL_CENTS`. NOVA 40M shares and $1M a day, BLSW 90M and $4M, HRBU 150M and $3M, KSR 25M and $0.8M (placeholders). Header shows `Mkt cap`. A session test checks that volume scales 8x and that market hash and closes do not move. All fixtures pass unchanged.

### Step M3: Slippage (temporary impact)

- Status: `done`
- Depends on: M2
- Files to create or change: `src/sim/trading.ts` (`quoteFill`), `src/sim/resting.ts` (stops), `src/sim/margin.ts` (liquidation fills), `src/sim/constants.ts`, `src/sim/log.ts`, `src/sim/trading.test.ts`, `src/ui/OrderPanel.tsx` (estimate), `src/ui/Guide.tsx` (account rule, exact), `src/harness/report.ts`
- What changes: option I1. Large market orders, stops and liquidations fill worse in proportion to size against bar volume. `closeWholePosition` is shared with the loan's forced sale (`loan.ts`) and the bill-shortfall preview (`monthly.ts`), so the preview must use the same slippage as the real sale.
- Must not change: market path, hashes, fixtures; fills of orders below the free threshold.
- Verification: strategies hash test still equal; batch rerun of `longNova50` and `shortNova50` reports the new tail and backstop use next to the section 16 table.
- Progress: done 2026-11-04. `slippageCents` and `fillBarVolume` in `trading.ts`; `quoteFill` takes the bar volume; `closePartOfPosition` takes a `stopVolume` that `triggerExits` passes for stops, and liquidation, loan and bill preview use the same path with no change. Free below 5% of the bar, `price × volatility × sqrt(share − 5%)`, cap 20%, index volatility floor 1%. `orderFill` has an optional `slippage` (cents a share), logged only when above 0. M4X gets `liquidityNotionalCents`. Tests that sit on the buying-power edge or hand-set bars use deep liquidity or large bar volume. New `src/sim/slippage.test.ts`. Batch rerun is in GAME_DESIGN section 16: 50x backstop use rose (liquidations pay slippage), flagged as an open question.

### Step M4: Participant framework and informed money

- Status: `done`
- Depends on: M0 (baseline), user answers 1–3
- Files to create or change: `src/sim/participants.ts`, `src/sim/participants.test.ts`, `src/sim/market.ts` (anchor in the price step, `createMarket` seeds the stream), `src/sim/types.ts`, `src/sim/log.ts`, `src/content/participants.ts`, `src/content/events.ts` (per-type `leak`), `src/content/index.ts`, `src/persist/save.ts`, `tests/fixtures/demo-30-price-log.txt`
- What changes: `MarketState.participants` (stream, regime, per-stock offsets). The pull aims at the anchor. Informed money leaks scheduled events. One `participantOffset` log line per stock per day with each party's share.
- Must not change: the four main streams, fair value, the event, calendar, environment and rumour log lines (asserted line by line), the "no player state" rule.
- Verification: fixture regenerated on purpose; noise and step7 fixtures pass untouched; event study shows pre-news drift on leaked types only; random bot mean final equity within about 5% of M0.
- Progress: done 2026-11-04. Built as real orders (user decision B), narrower than the Files list: `src/sim/participants.ts` (regime and leak draws on `createRng(seed + '#participants').market`, `informedFlow`, `depthCents`), `MarketDefinitions.participants` (`depthDays` 10, informed capital $150k, regime 0.5 to 1.5, magnitude reference 5%), `EventTypeDefinition.leak`, `MarketState.participants?` (optional, absent when the definitions have none), a `participantFlow` log line and an optional `flow` on `priceStep`. Institutions and noise traders stay the existing pull and noise formulas, because their demand form is algebraically the same; no party code reads `GameState` (tested). Informed money trades the two days before an event (an event is first seen two days out). `move = price x demand / depth`.
- Result (seed abc, 300 runs): pre-news drift now shows, 0.3% over the two days before a stock headline (earnings 0.6%, lawsuit 0.9%, scandal 0.8%); the day-0 move fell from 0.53% to 0.40% and by day 3 from 2.15% to 1.84%. Capped stock-days unchanged (0.07%). Random bot median final equity $2,923 against $2,935 without participants. `followHeadlines` median $3,392 (M0: $3,504). The `demo-30-price-log.txt` fixture was regenerated; its non-price lines are identical to the old file, and the noise and step-7 fixtures pass untouched.

### Step M5: News traders

- Status: `done`
- Depends on: M4
- Files to create or change: `src/sim/participants.ts`, `src/content/participants.ts`, tests, price log fixture
- What changes: on a headline, news traders price in a regime-dependent share of the remaining effect, sometimes above 1, decaying. This is the knob that sets the post-headline edge.
- Verification: event study day +1 to +3 drift falls toward the target the user picks (question 3); overshoot-then-reversal visible on some seeds.
- Progress: done 2026-11-04. `newsFlow` in `sim/participants.ts`: on each day a stock has an effect applied, `move = news x (fair + pending effect - price)`, where `pending` is what its active effects still have to apply and `news` is the run's efficiency (regime draw after the informed one, 0.4 to 0.7 in `content/participants.ts`). It lands on the day fair value first moves, before the headline is readable. `ParticipantState.news`, `ParticipantFlowEvent.party` is `informed` or `news`, `priceStep.flow` is the sum. Depth does not scale it (public news).
- Result (seed abc, 300 runs): stock headlines `after3` 1.45% to 0.77% (1x hold, costs are about 0.5% a round trip); day 0 move 0.40% to 1.83%, so the move is now in the price by day 2. `followHeadlines` median $2,992 (M0 $3,504, M4 $3,392): break-even, as chosen in Question 3. `fadeHeadlines` $2,261, random $2,864 (M4 $2,923). Efficiency 0.3 to 0.6 left `followHeadlines` at $3,110, 0.5 to 0.9 at $2,815 with 2.3% of stock-days capped. Capped stock-days rose from 0.07% to 1.3% at the chosen range (event days hit the 8% cap more often, flagged for M11).
- Finding: `buyRumour` median rose from $2,624 (M0) to $3,069 and a true rumour now runs 1.9% to its claim day (was 0.55%), because news traders move the price more on the event day while false rumours stay flat. The edge moved from headlines to rumours, as the plan's risks section predicted. M6 (retail crowd) is the party meant to add sell-the-news and a false-rumour pump.

### Step M6: Retail crowd and momentum bots

- Status: `done`
- Depends on: M5
- Files to create or change: `src/sim/participants.ts`, `src/content/participants.ts`, tests, price log fixture
- What changes: per-stock crowd mood from rumours (all sources), headlines and recent returns; rumour shares leave on resolution; momentum bots. Crowd scale by size.
- Verification: event study shows rumour-day run-ups and false-rumour unwinds; capped-day share recorded; no run-away trends over 300 seeds (largest offset logged).
- Progress: done 2026-11-04. `startPartyDay`, `crowdFlow`, `momentumFlow` in `sim/participants.ts`. `ParticipantState` gains `heat` (crowd regime, third draw), `shares` (event id to signed belief), `chase`, `mood`, `closes`. The crowd reads the feed the player reads (`state.feed` for today), adds `tierWeight` (low 0.3, medium 0.6, high 1) per rumour signed by its claimed direction, headlines add `headlineWeight` 0.15 that fades 50% a day, and it trades capital $60k x heat x the change in total mood. A rumour's share is deleted on its event day (a false rumour has an id for a day that never fires), so the crowd sells into the news and unwinds a false rumour. Trend followers: $30k x clamp(3-day move / 3%). Neither draws. Capital is in dollars, so a thin stock moves more (NOVA $60k is 0.6% per unit of mood, BLSW 0.15%). The batch study now reports `maxGapPercent` and `maxFlowPercent`.
- Result (seed abc, 300 runs): capped stock-days 1.2% (unchanged from M5; first try with crowd $200k gave 4.7%, so the crowd was cut to $60k). Largest gap between price and fair value 11.2%, largest one-step flow 11.5% (trimmed by the 8% cap): no run-away. `followHeadlines` median $3,124 (M5 $2,992, so slightly positive), headline `after3` 1.03%. `buyRumour` median $2,900 (M5 $3,069, M0 $2,624). True rumours run 1.6% to their claim day (M5 1.9%), false ones -0.09% and flat two days later: pumped then unwound. Random bot $2,873. Fixture regenerated, non-price lines identical.

### Step M7: Calendar consensus

- Status: `done`
- Depends on: M4, user answer 4
- Files to create or change: `src/sim/calendar.ts` (consensus from released values), `src/sim/market.ts` (`calendarHeadline`), `src/sim/participants.ts` (consensus offset), `src/sim/types.ts` (`UpcomingCalendarItem.expected`), `src/ui/CalendarPanel.tsx`, `src/ui/days.ts`, `src/content/calendar.ts` (wording), price log fixture
- What changes: option C1. The calendar shows the consensus; headlines read against it; the anchor prices it in.
- Must not change: calendar outcome rolls and their effect on fair value; `playerCalendar` still hides outcomes until their day.
- Progress: done 2026-11-04 on branch `market-depth-m7`. `consensusOutcome`, `outcomeWord`, `calendarHeadlineText` in `sim/calendar.ts`; `CalendarRoll.expected` (stored at the roll), `UpcomingCalendarItem.expected`, `CalendarItemEvent.expected` (not in the log line). `consensusFlow` in `sim/participants.ts` (new definitions `consensus`: $300k, 3% reference), a fifth party `consensus`. `playerCalendar` keeps `expected` while hiding roll and outcome; the calendar panel prints `expected` and, on the day, `result`; the Guide has a line. The effect keyed by outcome and every roll are unchanged.
- Result (seed abc, 300 runs): calendar releases move less on the day (growth day-0 0.90% to 0.81%, inflation 0.88% to 0.77%, policy 1.29% to 1.21%) and run up a little before (growth `d-3` 0.31 to 0.20). It is modest because the consensus is mostly `inline`, whose own effect is small. Capped days and the largest gap are unchanged (1.2%, 11.4%). Fixture: exactly the three calendar headline lines differ besides prices.

### Step M8 (only if the user picks E2): Scheduled earnings

- Status: `todo`
- Depends on: M7
- What changes: earnings dates per stock with consensus, replacing or reshaping `earningsBeat`. All three fixtures are checked; step7 and the price log are regenerated on purpose.

### Step M9: Liquidity grabs in the session

- Status: `done`
- Depends on: M2
- Files to create or change: `src/sim/session.ts` (third session stream from the unused `info` member of `#session`), `src/sim/types.ts`, `src/persist/save.ts`, `src/sim/session.test.ts`
- What changes: on some days a bar's wick reaches a public level (round price, prior day's high or low) and returns. Levels come from public prices only, never from `state.resting`.
- Must not change: closes, `intraday` and `volume` draws, the 12% band, any fixture.
- Verification: test that two games with different resting orders get identical bars.
- Progress: done 2026-11-04 on branch `market-depth-m7`. `SessionState.streams.levels` (from the `info` member of `#session`), `applyGrab` in `sim/session.ts` (three floats per stock per day: chance 25%, bar, level). Levels: the next round price above the bar's high or below its low, and the high and low of the participants' recent closes, within 1.5% of the open; the wick overshoots by 0.1%. Only a bar's high or low widens, so no close, path or other stream moves. Persist rejects a session without `levels`. Tests: some bars grab a round price over 60 days, and two games with different resting orders get identical bars for 10 days. No market fixture changed.

### Step M10: Social feed "Y"

- Status: `done`
- Depends on: M1, M6
- Files to create or change: `src/sim/social.ts`, `src/sim/social.test.ts`, `src/sim/distortion.ts` (per-channel cap, `restyle`), `src/sim/game.ts`, `src/sim/types.ts`, `src/content/socialPosts.ts`, `src/persist/save.ts`, a feed panel in `src/ui/`, `src/ui/Guide.tsx`
- What changes: section 7 of this plan.
- Must not change: `stateHash(market)`; the bias cap per channel; the tell on every distorted post.
- Verification: market hash equal with social on and off; at stress 100 at most 25% of each channel is distorted; whisper hit rate measured below the low rumour tier.
- Progress: done 2026-11-04 on branch `market-depth-m7`. `sim/social.ts` (`createSocial`, `buildSocialDay`, `shownPosts`, `bentPostCount`), `SocialDefinitions`/`SocialPost`/`SocialState` in types, `MarketDefinitions.social`, `GameState.social` (optional), content in `content/socialFeed.ts`, built in `game.ts` after the session (create and each day). Stream `createRng(seed + '#social').market`. Posts panel under the news in `NewsFeed.tsx`; the day report count includes bent posts; Guide line. Stress: hide posts against a position and promote posts for it to the loaded wording, up to `distortionCap(visible posts, stress)`, in feed order and with no draw; no tell (Q8 decision); verify shows the calm feed. This is a simpler route than the plan's `restyle` action in `distortion.ts`: the news channel and its stream are untouched.
- Result: market hash and session bars identical with the feed on and off (tested over 25 days); whisper hit rate 0.28 over 12 seeds x 30 days (lowest rumour tier 0.35); 10.7 posts a day of which 3.8 whispers; chatter hidden until the clock reaches it; at most a quarter of posts bent at stress 100, none at 60.

### Step M13: Player orders join the order flow

- Status: `todo`
- Depends on: M3, M6
- What changes: the player's net shares in a bar join the parties' demand, so a large order moves the price for the rest of the session and into the close. After each fill the day's close is previewed again with the player's flow included and the remaining bars are rebuilt from the clock to that close, reusing the day's pre-drawn session normals so no new draws happen. Slippage (M3) then becomes the cost inside the bar.
- Must not change: same seed and same commands give the same run. A run with no orders, or only orders below a size threshold, gives today's market.
- Verification: the strategies hash test becomes "idle bot equals idle bot, and small orders equal idle"; a pump-and-dump bot (buy big, sell into its own push) loses money over 300 seeds; the market hash differs only after a large order.
- Decision recorded: GAME_DESIGN section 15 criterion 9 and section 10 seeded mode are reworded to "same seed and same commands, same market" when this step lands.

### Step M11: Cap review

- Status: `todo`
- Depends on: M6
- What changes: compare capped-day share with M0. If the user picks K2, K3 or K4, implement it as its own change with a fixture regeneration.

### Step M12: Design doc, Guide and playtest

- Status: `todo`
- Depends on: the steps the user takes
- Files to create or change: `doc/GAME_DESIGN.md` (sections 5, 7, 9, 12, changelog, only rules the user decided), `src/ui/Guide.tsx` (rough terms: who trades, consensus, slippage as an account rule)
- Verification: a seeded playtest records whether patterns felt readable, unfair or invisible.

## 10. Risks

- **Patterns read as random.** Offsets stack, and the player cannot see who moved the price. Mitigation: the admin log line per party, the event-study report, and posts as a visible view of the crowd.
- **The edge just moves.** Killing the headline drift may make rumour fading the new formula. The event study per regime is the check.
- **Run-away offsets.** Crowd and momentum can feed each other. Clamp each offset and the anchor's distance from fair value.
- **Informed money reading the schedule feels like cheating.** It is the same knowledge rumours already use. The leak share per type keeps it bounded.
- **Fixture churn.** M4 to M7 each regenerate the price log. The line-kind assertion in M4 keeps each regeneration honest.

## 11. Questions for the user

1. Participant model: value offsets toward an anchor (recommended), or order flow against depth?
2. May informed money read the 3-day event schedule, as rumours do? Should calendar items never leak (recommended)?
3. After M5, how much post-headline edge should remain: none, a little (recommended), or today's?
4. Consensus for calendar releases: from last released values with no randomness (recommended), noisy forecasters, or a shown range?
5. Earnings: keep random earnings events for now (recommended), or scheduled earnings dates with consensus (regenerates all event fixtures)?
6. Price impact: slippage only (recommended), intraday decaying impact, or permanent impact? Should stops and liquidations pay slippage (recommended yes)?
7. Volume stops being cosmetic and becomes the liquidity measure. Agree?
8. Social feed: bias cap per channel (recommended), and does loaded wording count as a distorted item with the tell (recommended yes)?
9. The 8% cap is `[CONFIRMED]`: keep it while participants are built (recommended), widen it, or move to per-stock limits?
10. Government as a party: later (recommended), or a policy put after index crashes now?
11. Saves from before M4 and M10: reject as damaged (as in Steps 28 and 32), or write an upgrade?
12. Order: start with M0 to M3 (measurement, bias fix, liquidity, slippage), which do not change the market, before participants?

### Answers (2026-11-03)

- 1: B, real orders (section 4.1).
- 2: yes. Informed money reads the 3-day schedule; calendar items never leak.
- 3: a little. Target for M5: `followHeadlines` at 1x ends near break-even to slightly positive after costs, at any hold of 1 to 5 days (M0 baseline: median +17% a run). The Guide keeps "a few days" and never states a hold.
- 4: C1, consensus from last released values, no randomness.
- 5: E1, random earnings events for now. M8 is not planned.
- 6: yes. After the order-flow parties exist, the player's orders join the same flow (Step M13). The seeded rule becomes "same seed and same commands, same market". M3 (slippage) stays first.
- 7: yes. Volume becomes the liquidity measure (changes the provisional "volume is cosmetic" rule in M2).
- 8: yes to a cap per channel that scales with stress. The user chose to drop the per-item tell for both news and posts; verify still shows the true feed and the stress meter keeps its warning state. This changes the `[CONFIRMED]` telegraphing rule in GAME_DESIGN section 9, which has not been edited yet. Suggested with it: the end-of-day report says how many items stress filtered that day, so the player can still learn about their own bias after the fact.
- 9: keep the 8% cap (K1) while participants are built; revisit in M11.
- 10: government party later.
- 11: reject old saves as damaged. There are no real players yet, only testers, who restart.
- 12: yes. Next are M0, M2 and M3; M1 is done.
