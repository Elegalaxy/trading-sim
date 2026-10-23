# Trading Sim: First Playable Implementation Plan

Date: 2026-10-22  
Status: draft. Steps 1 onward wait for the stack decision (Question 1). The steps are written for the recommended stack.  
Design source of truth: [../GAME_DESIGN.md](../GAME_DESIGN.md). Portfolio brief: [../../../docs/ideas/trading-simulation.md](../../../docs/ideas/trading-simulation.md).

How to use this plan: the implementer does one step at a time, in order. After each step, the implementer sets Status to `done` and adds a dated Progress line. The tester then sets `verified` or `failed`. Allowed status values: `todo`, `done`, `verified`, `failed`, `blocked`.

## 1. Goal

Build the first playable from GAME_DESIGN.md section 14, starting with a deterministic, seeded price-model sandbox and its admin log, and ending with a full 120-day run that has trading, the life layer, the loan, energy and stress, and both run modes.

## 2. Assumptions

### 2.1 Design assumptions

- GAME_DESIGN.md as of 2026-10-22 is the rulebook. `[CONFIRMED]` rules are implemented as written. `[PROVISIONAL]` rules are used as defaults and labeled provisional here. `[LATER]` items are not built. `[OPEN]` items get a placeholder labeled provisional in this plan only, and are listed in section 3.
- The player is a price taker. Orders never change prices, events, rumours or the feed. This makes a seeded market identical whatever the player does, which seeded mode needs (section 10). This is implied by the design but not written there.
- A day has no intraday price movement (section 4, provisional). The player acts at the day's prices. End-of-day processing runs in this order: apply event effects to fair value, step prices, charge daily borrow and margin interest, run the margin check and liquidation, accrue savings interest, update energy and stress, check FI, generate tomorrow's feed, pre-roll future events, build the day summary, then start the next day (monthly cycle on days 30, 60, 90, 120).
- The game never sells or transfers for the player, except the two confirmed cases: margin liquidation (section 7) and a missed loan payment (section 12).
- Random streams: `market` (price noise), `events` (event rolls, environment drift, calendar outcomes), `info` (rumours and headlines) and `distortion`. The design names market, events and distortion. The `info` stream is a technical addition so that rumour generation cannot shift event rolls. It is provisional.
- Money is stored as integer cents. Provisional unit: `E` = 1000.00, so 1E = 100000 cents. Prices are integer cents. Fair value is a float. Shares are whole.
- No git commands. The user creates the repo later.

### 2.2 Project layout (for the recommended stack)

`trading-sim/` is its own project with its own `package.json`. It never imports from `rpg/`. Patterns may be copied from the RPG (the `debug.ts` shape, the architecture test) as new files. Create files only when a step needs them.

```text
trading-sim/
  doc/                       design, brainstorm, plans (this file)
  package.json               scripts: dev, build, test, typecheck, sim, lint
  index.html, vite.config.ts, tsconfig*.json, .gitignore
  reports/                   harness CSV output (gitignored)
  tests/architecture.test.ts
  src/
    main.tsx
    sim/        pure deterministic rules: no React, DOM, storage, clock, console, Math.random
    content/    data only: assets, event types, sources, jobs, consumables, lifestyle
    harness/    Node CLI: single run, batch run, report
    persist/    localStorage save and scores
    ui/         React dashboard, store, debug.ts
```

Allowed imports: `sim` imports only `sim`. `content` imports `sim` types. `harness` imports `sim` and `content`. `persist` imports `sim` types. `ui` imports `sim`, `content` and `persist`. Step 2 enforces this.

### 2.3 Conventions every step follows

- Simulation: pure functions over plain JSON state. RNG state lives inside the state. Definitions (content) are passed in, not imported by `sim`.
- Debug prints:
  - The simulation never prints. Its data flow is a typed log: every roll, effect, price change, fill, fee, stat change and rejection is a log event with its inputs. `src/sim/log.ts` formats events as text.
  - The harness prints lines starting with `[sim]`.
  - The UI uses `debugLog(tag, ...)` from `src/ui/debug.ts`. It prints only in dev builds. Tags: `[ui]`, `[store]`, `[save]`, `[fx]`.
  - Tests may print `[DEBUG <area>]` lines.
- Input validation: harness arguments, UI inputs, commands and loaded saves are untrusted. Invalid commands produce a `commandRejected` log event with a reason. The simulation does not throw on them. Errors are never swallowed: CLI errors exit with code 1, and save errors show a UI message and call `console.error`.
- Provisional values live in `src/sim/constants.ts` or in `src/content/`, grouped under the GAME_DESIGN section they come from, so tuning never touches logic.
- Definition of done for every step:
  1. `npm run typecheck` and `npm test` pass in `trading-sim/`.
  2. A golden snapshot is updated (`npx vitest run -u`) only when the step intends to change outcomes. The Progress line says so.
  3. The step's debug prints exist.
  4. Code marked `// admin code` is never removed or altered.
  5. A dated Progress line is added.

### 2.4 Provisional values used by this plan

Every value here is a tuning placeholder, not a decision.

| Value | Placeholder | Design section | Step |
| --- | --- | --- | --- |
| Assets | 4 stocks: NOVA, BLSW (Sector A, growth), HRBU, KSR (Sector B, rate), plus index M4X | 5 | 4 |
| Start prices, daily volatility | 48.00 / 112.00 / 31.00 / 64.00; 2.2% / 1.8% / 1.0% / 1.4% | 5 | 4 |
| Pull toward fair value | 35% of the gap per day | 5 | 4 |
| Index | 1000 × average of (price ÷ start price), equal weights, no own noise | 5 | 4 |
| Event lookahead | events pre-rolled 3 days ahead | 5 | 6 |
| Fair value change limit | ±12% per asset per day, excess dropped and logged | 5 | 6 |
| Calendar dates | growth release day 10, inflation day 20, policy rate day 25 of each month, step 0.25% | 5 | 7 |
| Rumours | lead 1 to 3 days; hidden hit rates high 85%, medium 60%, low 35%; 6 sources | 5 | 8 |
| Starting money | 3E cash, 3E trading | 6 | 9 |
| Savings rate | policy rate minus 1.5%, floored at 0, paid monthly | 6 | 9 |
| Fee, spread | 0.1% per trade; spread 0.1% to 0.4% per asset, doubled on event days | 7 | 10 |
| Short borrow fee, margin interest | 0.01% to 0.03% a day; policy rate plus 3% a year | 7 | 10, 11 |
| Liquidation order | largest unrealized money loss first, until ratio is above 15% | 7 | 11 |
| Clock | sleep ends 07:00; work 08:00–12:00 or 08:00–16:00; market 17:00–21:00 | 4 | 15 |
| Base expenses | 1E a month | 6 | 16 |
| FI | realized only, 30-day window, 5-day hold, job need not be quit | 8 | 17 |
| Score | lost = 0; else net worth in E × 100, plus 10 per day left on a win | 8 | 17 |
| Jobs | GAME_DESIGN section 6 table; slots 1 = part-time, 2 = full-time; sleep 8h (night shift 6h, trading-floor 7h) | 6 | 18 |
| Stats | energy 80, stress 20; sleep need 7h; each missing hour −8 energy, +4 stress; drawdown +10, margin warning +8, wipe-out +25 stress | 9 | 19 |
| Consumables | Coffee, Herbal tea, Home-cooked meal, Night out; once per item per day | 9 | 19 |
| Read news, verify | 2 energy each | 4, 9 | 19, 22 |
| Lifestyle upfront cost | 2 × the added monthly cost | 6 | 20 |
| Loan | limit 2E + 1 × monthly pay + 0.25E per tier above base; rate policy + 4%; no term | 12 | 21 |
| Bias | intensity scales from stress 60 to 100; cap 25% of visible items at 100 | 9 | 22 |
| Cosmetic effects | blur up to 2px, display delay up to 400 ms, scaling from energy 40 to 0 | 9 | 23 |

## 3. Questions for the user

### Blocking

**Q1. Tech stack. Answered 2026-10-22: option A.** TypeScript + React + Vite. Simulation in plain TypeScript. Vitest for tests, a Node harness, versioned JSON saves in localStorage. No engine. Recorded as `[CONFIRMED]` in `GAME_DESIGN.md` section 13. The comparison below is kept as the record of the choice.

| Option | For | Against |
| --- | --- | --- |
| **A. TypeScript + React + Vite. Simulation in plain TypeScript. Vitest for tests, tsx for a Node harness, versioned JSON saves in localStorage. No engine.** (recommended) | You already accepted and set up this toolchain for the RPG, so there is nothing new to learn. Dashboards (charts, feeds, tables, meters) are what HTML and React do best. One language for the simulation, the batch harness and the UI, so the same seeded rules run everywhere. Local save is built into the browser. Can be wrapped for desktop later. | No built-in charts, so a simple SVG chart is hand-written (or a library, Q2). Seeded results could differ across browser engines because of floating-point math. Mitigated by a state hash check in Step 13. |
| B. Python simulation and harness, with a Textual terminal dashboard | Fastest way to build a numbers sandbox and batch statistics. Seeded randomness is built in. | Terminal charts are crude. Blur and tint effects are hard. Hard to hand to playtesters. A graphical UI later would mean rewriting or bridging the rules. |
| C. Godot 4 with GDScript | Native desktop export, built-in seeded RNG, headless mode for batch runs. | Scenes are built in the editor GUI. Dashboard, table and chart UI is more work than HTML. A second toolchain beside the RPG. Scene files are harder to review as text. |

Recommendation: **A**. Chosen by the user on 2026-10-22.

### Non-blocking (answer before the named step; otherwise the recommendation is used)

- **Q2. Price chart (before Step 13).** Options: (a) hand-made SVG line chart of daily closes, (b) the lightweight-charts library, (c) Recharts. Recommended: (a). The game has one price per day and no candles in the first playable, so a library adds little.
- **Q3. Clock (before Step 15). `[OPEN]` in section 4.** Options: (a) sleep ends 07:00, work 08:00–12:00 (part-time) or 08:00–16:00 (full-time), skip, market 17:00–21:00, then End day; (b) the same, but each job sets its own work hours; (c) an evening market that starts right after the longest job. Recommended: (a). The clock is display only. The simulation tracks the section and the sleep hours.
- **Q4. What causes short sleep (before Step 18).** Options: (a) each job sets sleep hours, for example night shift 6h; (b) the player picks sleep length each day, which needs something to gain from staying up; (c) nothing in the first playable. Recommended: (a). It gives jobs a real cost without a new system.
- **Q5. When can the player end the day (before Step 15).** Options: (a) any time, which skips the rest of the day; (b) only during market hours. Recommended: (a). It keeps pacing at about two clicks a day.
- **Q6. Starting job (before Step 18).** Options: (a) the player picks from the menu, or jobless, at run start, with no notice period; (b) every run starts jobless. Recommended: (a).
- **Q7. Bill timing (before Step 16).** Options: (a) salary and the bill arrive at the start of each 30th day. The bill is paid automatically when cash covers it. Otherwise it is pending and must be paid before that day ends. (b) The bill is charged at the end of the 30th day and resolved the next day. Recommended: (a). The player gets that day's market section to sell, and day 120 needs no extra day.
- **Q8. Upfront cost of Home and Information feed upgrades (before Step 20).** The design implies an upfront cost ("does not return the money spent") but sets no amount. Options: (a) 2 × the added monthly cost, (b) no upfront cost, (c) a flat 0.5E. Recommended: (a).
- **Q9. Loan details (before Step 21). `[OPEN]` in section 12.** Limit: 2E + 1 × monthly job pay + 0.25E per lifestyle tier above base. Rate: policy rate + 4% a year, charged monthly. No fixed term, early repayment free. Warning: the payment is due at the start of the 30th day, and the forced sale runs at the end of that day if it is still unpaid. Can loan money fund trading? Options: (a) yes; (b) no, so a transfer into trading cannot take cash plus savings below the loan balance; (c) up to a limit. Recommended: (b). The confirmed purpose of the loan is paying bills, and (b) stops loan leverage stacking on 5x margin.
- **Q10. Consumable list (before Step 19). `[OPEN]` in section 9.** Placeholders: Coffee 0.01E, +15 energy. Herbal tea 0.01E, −12 stress. Home-cooked meal 0.02E, +8 energy and −6 stress. Night out 0.06E, −25 stress. Can each item be used (a) once per day or (b) without limit? Recommended: (a), so spamming items is not the answer.
- **Q11. Cost of reading the news and verifying (before Step 19).** The night-shift perk ("one free news read") only matters if reading costs something. Options: (a) 2 energy each, (b) free. Recommended: (a).
- **Q12. Fair value change over the daily limit (before Step 6).** Options: (a) dropped and logged, (b) carried to the next day like the price gap. Recommended: (a). It is simpler, and the batch report in Step 12 shows how often it happens.
- **Q13. End-of-day summary shows true data (Q 48, before Step 22).** Recommended: keep the design default (true data) and judge it in the Step 26 playtest.
- **Q14. When biased news is computed (before Step 22).** Options: (a) once at the start of each day from the positions held then, (b) again after every trade. Recommended: (a). It is stable and cheaper, and players cannot trade to reshuffle the feed.
- **Q15. Quiet-day skip (section 4, provisional).** Recommended: not built now. Add it only if the Step 26 playtest shows the run is too slow.
- **Q16. Money display.** Options: (a) plain numbers with 2 decimals, (b) a fictional currency sign, (c) multiples of E. Recommended: (a).

## 4. Steps

Milestones: Steps 1–8 are the deterministic price sandbox with its admin log, headless. Steps 9–12 add headless trading and a risk report. Steps 13–14 are the first playable sandbox (market only). Steps 15–21 add the life layer. Steps 22–23 add perception. Steps 24–26 wrap the run. Review the plan with the user after Step 14.

Working folder for all commands: `D:\Coding\project\trading-sim`.

---

### Step 1: Scaffold the trading-sim app

- Status: `done`
- Depends on: Q1 answered
- Files to create or change: `trading-sim/package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.harness.json`, `.gitignore`, `src/main.tsx`, `src/ui/App.tsx`, `src/ui/debug.ts`
- What changes:
  - Generate the Vite `react-ts` template in a temporary folder outside `trading-sim/`, then copy its files in. Never let a tool remove existing files, because `trading-sim/doc/` already exists.
  - Delete the demo assets and CSS. Move `App.tsx` to `src/ui/`. Add dev dependencies `vitest`, `tsx` and `@types/node`.
  - Add `tsconfig.harness.json` (Node types; includes `src/harness`, `src/sim`, `src/content`, `tests`). Exclude `src/harness` from `tsconfig.app.json`. Keep `strict`.
  - Scripts: `dev`, `build`, `lint` (from the template), `test` = `vitest run --passWithNoTests`, `typecheck` = `tsc -b`, `sim` = `tsx src/harness/cli.ts`.
  - `.gitignore`: `node_modules`, `dist`, `reports`.
  - `App` shows "Trading Sim – dev build".
  - Debug prints: `src/ui/debug.ts` exports `debugLog(tag, ...data)`, which calls `console.debug` only when `import.meta.env.DEV` is set. `App` calls `debugLog('[ui]', 'app mounted')`.
- Must not change: anything in `trading-sim/doc/` or `rpg/`. No imports from `rpg/`. No `git init`.
- Provisional values: none.
- Acceptance criteria: `npm install`, `npm run typecheck`, `npm test` and `npm run build` all succeed. `npm run dev` serves the page.
- Verification:
  - Run: `npm install`, `npm run typecheck`, `npm test`, `npm run build`.
  - User: run `npm run dev` and open the printed URL. You should see "Trading Sim – dev build", and `[ui] app mounted` in the browser console.
- Progress: 2026-10-22: Gave the dev-build line a light color on a dark background so it stays readable after the template CSS was removed.
- Progress: 2026-10-22: Scaffolded the Vite react-ts app. Files: package.json, package-lock.json, index.html, vite.config.ts, tsconfig.json, tsconfig.app.json, tsconfig.node.json, tsconfig.harness.json, .gitignore, .oxlintrc.json, README.md, src/main.tsx, src/ui/App.tsx, src/ui/debug.ts, src/harness/cli.ts. Checks: npm install succeeded; npm run typecheck succeeded; npm test succeeded (no test files, exit 0); npm run build succeeded; npm run lint succeeded; npm run dev printed http://localhost:5173/ and was stopped; npm run sim printed "The harness is not implemented." and exited 0.

### Step 2: Architecture boundary test

- Status: `done`
- Depends on: 1
- Files to create or change: `trading-sim/tests/architecture.test.ts`
- What changes:
  - The test walks `src/` and checks each layer against the import rules in section 2.2. It may be adapted from a copy of `rpg/tests/architecture.test.ts`; it is a copy, not an import.
  - In `src/sim` it also bans `Math.random`, `Date`, `performance.now`, `console`, browser storage, `process` and DOM globals.
  - Failures name the file, the line and the rule.
  - Debug prints: `[DEBUG architecture]` lines with the file count, each file's layer and imports, and the violation count.
- Must not change: app code.
- Provisional values: none.
- Acceptance criteria: the test passes on the current tree. A temporary `src/sim/probe.ts` that calls `Math.random()` makes it fail with the file, the line and the rule. Delete the probe afterwards.
- Verification:
  - Run: `npm test`.
  - User: read the `[DEBUG architecture]` lines in the test output and check that `src/ui/App.tsx` is listed with layer `ui`.
- Progress: 2026-10-22: Added tests/architecture.test.ts. Temporary src/sim/probe.ts failed with src/sim/probe.ts:1: src/sim must not use Math.random, then the probe and the empty src/sim directory were removed. Checks: npm test passed (files=4, src/ui/App.tsx layer ui, violations=0); npm run typecheck passed; npm run lint passed.

### Step 3: Seeded RNG with named streams

- Status: `done`
- Depends on: 2
- Files to create or change: `src/sim/rng.ts`, `src/sim/rng.test.ts`, `src/sim/types.ts`
- What changes:
  - A string seed is hashed to 32 bits and expanded with splitmix32 into sfc32 states, one per named stream: `market`, `events`, `info`, `distortion`. Each state is a plain JSON object of four integers.
  - Functions: `nextFloat`, `nextInt(min, max)`, `nextNormal` (Box–Muller), `pickWeighted`. Each advances only the stream it is given.
  - `nextNormal` must not keep hidden module-level state. Any cached value lives in the stream object.
  - Debug prints: the test prints `[DEBUG rng] seed=<s> stream=<name> first=<5 values>`.
- Must not change: nothing else exists yet.
- Provisional values: none.
- Acceptance criteria:
  - The same seed gives the same sequence on every stream.
  - Drawing from one stream does not change another stream's sequence.
  - A state copied with `JSON.parse(JSON.stringify(...))` mid-sequence continues identically.
  - Sanity: 10,000 floats average between 0.48 and 0.52. 10,000 normals have a mean within ±0.05 and a standard deviation between 0.95 and 1.05.
- Verification:
  - Run: `npm test`.
  - User: check that the `[DEBUG rng]` lines show the same first values on two test runs.
- Progress: 2026-10-22: Added src/sim/types.ts (stream names, four-integer sfc32 state, optional Box–Muller spare), src/sim/rng.ts (FNV-1a string hash, splitmix32 into market/events/info/distortion, nextFloat, inclusive nextInt, nextNormal, pickWeighted), and src/sim/rng.test.ts. Checks: npm test passed twice (2 files, 8 tests, architecture violations=0, seed demo first floats matched); npm run typecheck passed; npm run lint passed.

### Step 4: Assets, hidden fair value, and the daily price step

- Status: `done`
- Depends on: 3
- Files to create or change: `src/sim/types.ts`, `src/sim/constants.ts`, `src/sim/market.ts`, `src/sim/market.test.ts`, `src/sim/log.ts`, `src/sim/hash.ts`, `src/content/assets.ts`, `src/content/index.ts`
- What changes:
  - `createMarket(defs, seed)` builds `MarketState`: day, streams, assets (price in cents, hidden fair value), and a per-day log array.
  - `stepMarketDay(state, defs)` moves each stock's price: a pull toward fair value plus noise (`market` stream, scaled by the asset's daily volatility), with the move capped at 8% (confirmed). The part of the gap the cap holds back stays between price and fair value and plays out on later days (provisional).
  - The index is computed from the four stocks. It has no noise or events of its own.
  - Fair value does not change yet (no events).
  - `stateHash(state)` returns a short hash of the JSON state, for determinism checks.
  - Debug prints: log events `noiseRoll` (asset, z) and `priceStep` (asset, previous price, fair value, pull, noise, raw move, capped move, capped flag, new price, gap after), plus `indexStep`. `formatEvent` in `log.ts` turns each event into one text line.
- Must not change: the RNG stream design from Step 3.
- Provisional values: asset list and names, start prices, volatility, pull fraction, index formula (section 2.4). The 8% cap is confirmed.
- Acceptance criteria:
  - Golden snapshot: seed `demo`, 30 days, formatted log.
  - Across 10 seeds × 120 days, no daily move is larger than 8%.
  - Test with fair value set 30% above price: day 1 moves exactly 8%, and the remaining gap is still present on day 2.
  - The index never moves more than 8% in a day.
  - The same seed gives the same `stateHash` after 120 days.
- Verification:
  - Run: `npm test`.
  - User: open the snapshot file and check that each `priceStep` line shows the fair value, the pull, the noise and the capped move.
- Progress: 2026-10-22: Added the daily price step. Files: src/sim/types.ts, src/sim/constants.ts, src/sim/hash.ts, src/sim/log.ts, src/sim/market.ts, src/sim/market.test.ts, src/content/assets.ts, src/content/index.ts, tests/fixtures/demo-30-price-log.txt. Rounding: half away from zero, then clamp to floor(price × 8 / 100) cents. Checks: npm test passed (3 files, 14 tests, architecture violations=0); npm run typecheck passed; npm run lint passed.

### Step 5: Harness CLI: the sandbox admin log

- Status: `done`
- Depends on: 4
- Files to create or change: `src/harness/cli.ts`
- What changes:
  - `npm run sim -- --seed demo --days 30` prints a header line `[sim] seed=demo days=30 assets=...`, then each day's formatted log, then a table of daily closes and the final `stateHash`.
  - `--quiet` prints only one close line per day.
  - `--asset NOVA` filters log lines to one asset.
  - Validation: `--days` is an integer from 1 to 1000. `--seed` is 1 to 32 characters from `A–Z a–z 0–9 -`. `--asset` must exist. Bad input prints an error and exits with code 1.
  - Debug prints: the `[sim]` lines above are the debug output.
- Must not change: `src/sim` behavior.
- Provisional values: none new.
- Acceptance criteria: two runs with the same arguments give identical output. A different seed gives different prices. `--days 0`, `--days abc` and `--asset XYZ` each exit 1 with a clear message.
- Verification:
  - Run: `npm run sim -- --seed demo --days 10` twice, then `npm run sim -- --seed other --days 10 --quiet`.
  - User: run the same commands. The first two outputs should match line for line. No `capped move` value should be above 8%.
- Progress: 2026-10-22: Replaced the src/harness/cli.ts stub with the sandbox admin log (createMarket, stepMarketDay, formatEvent, stateHash). Checks: `npm run sim -- --seed demo --days 10` twice, both exit 0, stdout matched line for line, stateHash=7bcf649214163c08; `npm run sim -- --seed other --days 10 --quiet` exit 0, stateHash=868c548da9f40aa6, day-1 NOVA 4705 versus demo 4793; `--days 0`, `--seed demo --days abc`, and `--seed demo --days 10 --asset XYZ` each exit 1 with a one-line stderr error and no stack trace; 50 cappedMove lines in the demo 10-day log, none capped=true, largest absolute move 246 cents on previous 4932 (under 8%); npm test passed (3 files, 14 tests); npm run typecheck passed; npm run lint passed.

### Step 6: Environment and per-day event rolls

- Status: `done`
- Depends on: 5
- Files to create or change: `src/sim/environment.ts`, `src/sim/events.ts`, `src/sim/events.test.ts`, `src/sim/market.ts`, `src/sim/types.ts`, `src/sim/constants.ts`, `src/sim/log.ts`, `src/content/environment.ts`, `src/content/events.ts`, `src/content/content.test.ts`, `src/harness/cli.ts`
- What changes:
  - The environment is a list of data entries: growth, inflation and policy rate. Growth and inflation drift slowly (`events` stream). The policy rate changes only through the calendar (Step 7).
  - Eight placeholder event types (staged content; Step 26 grows the list): earnings beat or miss, product launch, scandal, management change, regulation (sector), supply shock (sector), demand shift (sector), sentiment swing (market). Each has a scope, a per-day chance, direction chances (up, down, none), a magnitude range (% of fair value), a duration, a decay shape (front-loaded or linear), a headline template, and environment modifiers that shift the chance and the direction chances.
  - At the end of day N, events for day N+3 are rolled and stored as scheduled. Days 1–3 are rolled at creation. On their day, scheduled events become active effects. The lookahead is there so that rumours (Step 8) can mention upcoming events.
  - Active effects add to fair value each day by their decay schedule. Effects stack. The total change per asset per day is limited; the excess is dropped and logged (Q12).
  - A content test checks that chances are between 0 and 1, direction chances sum to 1, and magnitudes and durations are positive.
  - Debug prints: log events `envDrift`, `eventRoll` (type, target, roll, chance after environment, fired), `eventDirection` (roll, chances, environment shift, result), `eventMagnitude`, `effectApplied` (asset, effect, day index, delta), `fairValueChange` (asset, before, total, clipped, after). The harness gets `--events-only` to hide price lines.
- Must not change: the price step formula. The `market` stream must be consumed exactly as in Step 4, so the `noiseRoll` lines for a seed are unchanged.
- Provisional values: the event list and every number in it, the environment start values and drift, the 3-day lookahead, the ±12% fair value limit.
- Acceptance criteria:
  - Over 10,000 simulated days, each type fires within ±10% of its expected rate.
  - With a fixed environment that favors "down", the down share rises as expected.
  - No asset's fair value moves more than the limit in one day.
  - The `noiseRoll` lines for seed `demo` match the Step 4 snapshot. The golden snapshot is updated on purpose; say so in Progress.
- Verification:
  - Run: `npm test`, `npm run sim -- --seed demo --days 30 --events-only`.
  - User: find a fired event in the output and follow it: its roll, its direction, the fair value change on the following days, and the price moving toward the new fair value.
- Progress: 2026-10-22: Added environment drift and eight provisional event types. Growth starts at 2 with drift 0.01, inflation at 3 with drift 0.01, and the policy rate at 4 with drift 0 (percent). Per-target daily chances: earnings 0.08, product launch 0.05, scandal 0.04, management change 0.05, regulation 0.06, supply shock 0.05, demand shift 0.06, sentiment swing 0.10. Magnitudes, durations, decay shapes, and environment modifiers are provisional. The golden price log was updated because fair value now moves. noiseRoll lines were checked against Step 4. Checks: npm test passed (5 files, 26 tests); npm run typecheck passed; npm run lint passed; `npm run sim -- --seed demo --days 30 --events-only` passed, stateHash=ef5ddf1096ed860e.

### Step 7: Macro calendar

- Status: `done`
- Depends on: 6
- Files to create or change: `src/sim/calendar.ts`, `src/sim/calendar.test.ts`, `src/content/calendar.ts`, `src/sim/market.ts`, `src/sim/types.ts`, `src/sim/log.ts`
- What changes:
  - Monthly scheduled items: growth release, inflation release, policy rate decision (hold, up or down). Their dates are known in advance. `upcomingCalendar(state, days)` lists them.
  - The outcome is rolled on the `events` stream with the same 3-day lookahead. Policy chances depend on inflation and growth through a lookup. A rate change updates the policy rate.
  - Releases publish the current growth and inflation values. Each outcome creates effects through a lookup; for example, a rate hike hurts Sector B more than Sector A.
  - The calendar is always unbiased. Later steps must never pass it through distortion.
  - Debug prints: `calendarItem` log events (kind, day, roll, outcome, environment before and after) plus the effects it creates.
- Must not change: Step 6 event rules. The `market` stream consumption.
- Provisional values: calendar days, the 0.25% rate step, the lookup tables.
- Acceptance criteria:
  - Over 120 days, each item appears on its scheduled day in every month.
  - With high inflation, hikes are more likely than with low inflation.
  - In a unit test, a hike gives a larger negative fair value effect on Sector B than on Sector A.
- Verification:
  - Run: `npm test`, `npm run sim -- --seed demo --days 60 --events-only`.
  - User: check for a `calendarItem` line on day 25 and day 55, and the policy rate before and after.
- Progress: 2026-10-22: Added the macro calendar. Growth release day 10, inflation day 20, policy decision day 25 of each 30-day month. Outcomes are one events-stream float, drawn after that day's ordinary event rolls, with the 3-day lookahead. Policy step is 0.25 percentage points, floored at 0. A hike is -1.5% fair value on sector A and -4% on sector B, clipped with other effects at ±12%. The golden full log was updated on purpose: calendar draws on the events stream change which ordinary events fire and change price lines. noiseRoll lines were checked against Step 4 and did not change. Checks: npm test passed (6 files, 32 tests, architecture violations=0); npm run typecheck passed; npm run lint passed; `npm run sim -- --seed demo --days 60 --events-only` passed. Day 25 policy 4->4.25 (up). Day 55 policy 4.25->4.25 (hold).

### Step 8: News feed, rumours, source reliability, and the day summary

- Status: `done`
- Depends on: 7
- Files to create or change: `src/sim/feed.ts`, `src/sim/feed.test.ts`, `src/sim/summary.ts`, `src/sim/summary.test.ts`, `src/content/sources.ts`, `src/sim/market.ts`, `src/sim/types.ts`, `src/sim/log.ts`, `src/harness/cli.ts`
- What changes:
  - At the end of day N, the feed for day N+1 is generated on the `info` stream:
    - A headline for every event and calendar outcome that fired on day N.
    - Rumours: pick a source, then roll true or false against the source's hidden hit rate. A true rumour names a scheduled event 1 to 3 days ahead. A false rumour names an event, target and direction that are not scheduled.
    - A top headline: the headline with the largest magnitude.
  - Sources: six placeholders, two per tier (high, medium, low), each with a visibility requirement: `base`, `infoFeed1`, `infoFeed2` or `jobContacts`. Low-tier false rumours are flagged `noise`.
  - The full feed is always generated for every source. `visibleFeed(feed, player)` filters it without drawing random numbers. Jobs (Step 18) and lifestyle (Step 20) change only the filter, so they never change the seeded feed.
  - `daySummary(dayLog)` is a pure function. It lists the events that fired and each asset's % move. It never shows fair value. It is shown every day (provisional).
  - Debug prints: log events `headline` (event id) and `rumourGenerated` (source, tier, truth roll, true or false, claim, lead days, target event id). The harness gets `--feed`, which prints each day's feed and summary.
- Must not change: the `market` and `events` streams. The `noiseRoll` and `eventRoll` lines for seed `demo` must equal the Step 7 output.
- Provisional values: hit rates, number of sources, rumour rate, lead time, the "every day" summary.
- Acceptance criteria:
  - Over 20 seeds × 120 days, each tier's measured hit rate is within ±5 points of its hidden rate.
  - Every true rumour's event fires on the claimed day.
  - The summary never contains fair value.
  - `visibleFeed` does not touch any RNG state (test: state hash before and after).
- Verification:
  - Run: `npm test`, `npm run sim -- --seed demo --days 20 --feed`.
  - User: find a rumour in the feed, then find the event it claims a few days later, or check that none came because it was false.
- Progress: 2026-10-22: Added the day-ahead feed, six sources, and daySummary. Provisional rumour rate: 1 attempt per source per day (6). Sources: cityDesk and floorWire (high 85%), sectorNote and marketBrief (medium 60%), streetTalk and openChatter (low 35%). The feed is generated after the day+3 pre-roll. Lead is 1 to 3 days after the generation day. A truth roll with nothing scheduled in that window is not emitted and is not counted. Feed lines are in the day log, so the default log shows them; --feed adds the day summary and does not hide event lines. The golden log gained headline and rumour lines. noiseRoll and eventRoll lines were checked against the Step 7 log and did not change. Summary lines were not added to the golden log. Checks: npm test passed (8 files, 40 tests, architecture violations=0; tier rates high 84.74%, medium 59.96%, low 34.99%); npm run typecheck passed; npm run lint passed; `npm run sim -- --seed demo --days 20 --feed` passed, stateHash=0b5063108dcec5a1.

### Step 9: Accounts and transfers

- Status: `done`
- Depends on: 8
- Files to create or change: `src/sim/game.ts`, `src/sim/accounts.ts`, `src/sim/accounts.test.ts`, `src/sim/types.ts`, `src/sim/constants.ts`, `src/sim/log.ts`, `src/harness/cli.ts`
- What changes:
  - `GameState` wraps `MarketState` and adds the player: cash, trading account balance and savings, in cents.
  - `applyCommand(state, defs, cmd)` and `endDay(state, defs)` become the only entry points for the harness and the UI.
  - `transfer` command between cash, trading and savings: instant and free (confirmed for savings, provisional for the rest).
  - Savings interest accrues daily and is paid on each 30th day.
  - Debug prints: log events `transfer`, `commandRejected` (command, reason), `savingsAccrual` and `savingsInterestPaid`. The harness prints one `[sim] accounts` line per day.
- Must not change: market, events or feed outcomes. No player command may change them.
- Provisional values: starting money 3E and 3E, E = 1000.00, savings rate = policy rate − 1.5% floored at 0.
- Acceptance criteria:
  - Transfers move exact amounts.
  - Negative, zero, non-integer, NaN, over-balance and unknown-account transfers are rejected with a logged reason and change nothing.
  - Interest matches the formula.
  - A run with transfers and a run without have identical market, event and feed logs.
- Verification:
  - Run: `npm test`, `npm run sim -- --seed demo --days 31`.
  - User: check that the `accounts` line shows savings interest arriving on day 30.
- Progress: 2026-10-22: Added player accounts, instant free transfers, and provisional savings interest. Files: src/sim/game.ts, src/sim/accounts.ts, src/sim/accounts.test.ts, src/sim/types.ts, src/sim/constants.ts, src/sim/log.ts, src/harness/cli.ts. Cash and trading start at 3E (300000 cents); savings starts at 0. endDay steps the market once, then accrues. Interest uses the post-step policy rate and pays on each 30th day. Account events stay off MarketState, so the market hash is unchanged. The harness prints those events after the market log and one accounts line per day. The golden market log was not updated. Checks: npm test passed (9 files, 48 tests, architecture violations=0); npm run typecheck passed; npm run lint passed; `npm run sim -- --seed demo --days 31` passed, stateHash=1452738638ca5532. noiseRoll, eventRoll, calendarItem, headline, and rumourGenerated lines matched the previous demo run, including a real-content run that also transferred. Day 30 accounts line: cash=300000 trading=300000 savings=0 accrual=0 paid=0. Funded test payment=211 cents.

### Step 10: Orders: long and short, with fee and spread

- Status: `done`
- Depends on: 9
- Files to create or change: `src/sim/trading.ts`, `src/sim/trading.test.ts`, `src/sim/game.ts`, `src/sim/types.ts`, `src/sim/constants.ts`, `src/content/assets.ts`, `src/sim/log.ts`
- What changes:
  - `order` command: market order for whole shares, buy or sell, on any stock or the index.
  - One net position per asset: positive is long, negative is short.
  - Fills: buy at price plus half the spread, sell at price minus half the spread. The fee is a percentage of the notional (confirmed: percentage fee plus spread). The spread doubles on event days, meaning the asset has a headline in today's feed or a calendar item today (provisional).
  - No leverage yet: total position value cannot exceed equity.
  - Shorts pay a daily borrow fee at the end of the day.
  - A realized result ledger per day (realized P&L minus fees and borrow fees) is kept for the FI check in Step 17.
  - Debug prints: log events `orderFill` (asset, side, quantity, price, half spread, fill price, fee), `borrowFee`, `realized` (asset, amount).
- Must not change: the market. Orders never change prices.
- Provisional values: fee 0.1%, spreads, event-day widening, borrow fees, market orders only.
- Acceptance criteria:
  - Buying and selling the same quantity on the same day loses exactly two fees plus the full spread.
  - A short gains when the price falls.
  - Zero, negative or fractional quantity, an unknown asset, and too little buying power are each rejected with a logged reason.
  - Market logs are identical with and without trades.
- Verification:
  - Run: `npm test`.
  - User: read the `orderFill` lines in the test output and check that the fill price equals price ± half spread.
- Progress: 2026-10-22: Added market orders, provisional fee, spread, and short borrow. Files: src/sim/trading.ts, src/sim/trading.test.ts, src/sim/game.ts, src/sim/types.ts, src/sim/constants.ts, src/content/assets.ts, src/sim/log.ts, src/sim/accounts.test.ts. Fee is 0.1% of fill notional. Spreads and borrow rates are integer ppm on the asset (optional on the type, so market fixtures were not edited): NOVA 4000/300, BLSW 3000/200, HRBU 1000/100, KSR 2000/150, M4X 1500/100. Half spread and fee round half away from zero; event-day doubling happens before that rounding. No leverage: after the fill, gross at the quoted price must be <= equity, and trading cash must stay >= 0. Equity is trading cash plus signed shares times the quoted price. Borrow runs in endDay after the market step, on the post-step day, and an unpaid remainder is logged without a loan. The realized ledger is closed-position P&L minus fees and the full assessed borrow fee. Accounts tests that used `order` as a non-transfer example now use `eat`. The golden market log was not updated. Checks: npm test passed (10 files, 56 tests, architecture violations=0); npm run typecheck passed; npm run lint passed. Round trip of 10 NOVA: buy fill 4810 = 4800 + 10, sell fill 4790 = 4800 - 10, loss 296 cents. Seed demo market lines matched with and without trades (noiseRoll, eventRoll, calendarItem, headline, rumourGenerated), quietHash=ba43369cc235c769.

### Step 11: Leverage, margin, liquidation, and the loss-cap backstop

- Status: `done`
- Depends on: 10
- Files to create or change: `src/sim/margin.ts`, `src/sim/margin.test.ts`, `src/sim/trading.ts`, `src/sim/game.ts`, `src/sim/constants.ts`, `src/sim/log.ts`
- What changes:
  - Buying power up to 5x equity (confirmed). An order that would push the margin ratio (equity ÷ total position value) below 20% is rejected.
  - Daily interest on the borrowed amount.
  - End-of-day check after the price step:
    - A ratio below 15% sets the margin warning flag (confirmed).
    - A ratio at or below 10% liquidates (confirmed): worst-performing first, until the ratio is above 15% or no positions remain (provisional). Liquidation fills at the close, with spread and fee.
  - Backstop: equity is floored at zero, and any shortfall is written off and logged.
  - A wipe-out is flagged when the trading account ends below 10% of its value at the start of the day. Its stress spike is added in Step 19.
  - Debug prints: log events `marginCheck` (equity, position value, ratio), `marginWarning`, `liquidation` (asset, quantity, fill, ratio after), `backstopWriteOff` (amount), `wipeOut`, `marginInterest`.
- Must not change: fee, spread and fill rules from Step 10.
- Provisional values: margin interest, liquidation order and stop point, the wipe-out definition. 5x, 15% and 10% are confirmed.
- Acceptance criteria:
  - A 5x long with one forced −8% day ends above 10% with no liquidation and positive equity.
  - Two forced −8% days liquidate.
  - A 5x short with a forced +8% day stays above 10%.
  - Over 200 seeds of max-leverage play, backstop write-offs never exceed rounding (1 cent per position).
- Verification:
  - Run: `npm test`.
  - User: read the test output for the two-day −8% case and follow `marginCheck`, `liquidation`, then `marginCheck` again.
- Progress: 2026-10-23: Added the 5x cap, margin interest, end-of-day liquidation, the zero-equity backstop, and the wipe-out flag. Files: src/sim/margin.ts, src/sim/margin.test.ts, src/sim/trading.ts, src/sim/trading.test.ts, src/sim/game.ts, src/sim/constants.ts, src/sim/log.ts, src/sim/types.ts, src/sim/accounts.ts. An order is rejected below a 20% ratio; exactly 20% is allowed. Trading cash may be negative. End of day, after prices and before savings: interest at max(0, policy + 3)% / 365 on the loan, the existing short borrow fee, the margin check, liquidation of the worst unrealized loss until the ratio is above 15%, then the backstop. A wipe-out is only a log flag. One forced −8% long: equity=177339, ratio=0.13080876, no liquidation. Two forced −8% days: marginCheck equity=68742 ratio=0.05511083, liquidation NOVA quantity=307 fill=4055, marginCheck equity=65041 positionValue=0. Short +8%: equity=177094, ratio=0.11127574. 200 seeds × 120 days at the index cap: liquidationDays=0, maxWriteOff=0. The golden market log was not updated. Checks: npm test passed (11 files, 61 tests, architecture violations=0); npm run typecheck passed.

### Step 12: Batch harness and risk report

- Status: `done`
- Depends on: 11
- Files to create or change: `src/harness/cli.ts`, `src/harness/batch.ts`, `src/harness/strategies.ts`, `src/harness/report.ts`
- What changes:
  - Example: `npm run sim -- --batch 500 --strategy maxLongIndex --days 120`.
  - Strategies (harness only, through public commands): `hold` (no trades), `maxLongIndex`, `maxShortIndex`, `random`. `random` uses its own harness RNG seeded from the run seed, never the simulation streams.
  - The report prints `[sim] report` lines and writes a CSV to `reports/`. It covers: largest daily move, share of capped days, average and largest price-to-fair-value gap, fair value clip count, liquidations and wipe-outs per run, total backstop write-off, and final equity at the 10th, 50th and 90th percentiles.
  - This is the "simulation script that reports blow-up rates" safeguard from section 16.
  - Debug prints: `[sim] batch run=<i> seed=<s> strategy=<name> finalEquity=<x> liquidations=<n>` per run, then the report.
- Must not change: `src/sim`.
- Provisional values: none new. The report measures the earlier ones.
- Acceptance criteria: 500 runs finish in under 60 seconds. The largest daily move is at most 8%. Backstop write-off is at most rounding. The CSV opens in a spreadsheet.
- Verification:
  - Run: the example command for each strategy.
  - User: read the report. Note the liquidation rate for `maxLongIndex` and the share of capped days; these feed the "price feels random or predictable" risk.
- Progress: 2026-10-23: Added the batch harness and risk report. Files: src/harness/cli.ts, src/harness/batch.ts, src/harness/strategies.ts, src/harness/report.ts. `npm run sim -- --seed demo --batch 500 --strategy <name> --days 120` passed the 60s limit: hold 5.713s, maxLongIndex 5.229s, maxShortIndex 5.325s, random 5.510s. Largest daily move 8.000000% (on the cap; BLSW day 100 of run 86). Capped-day share 0.002617 (157 of 60000 run-days). Both are the same for every strategy. Liquidation rate (runs with at least one liquidation): hold 0, maxLongIndex 0.968 (484/500), maxShortIndex 0.468 (234/500), random 0. Total backstop write-off 0. Fair-value clip count 0. Two maxLongIndex invocations printed the same output. npm test passed (11 files, 61 tests); npm run typecheck passed. The golden market log was not updated.

### Step 13: Read-only dashboard, day advance, and admin log panel

- Status: `done`
- Depends on: 12, Q2
- Files to create or change: `src/ui/store.ts`, `src/ui/App.tsx`, `src/ui/Dashboard.tsx`, `src/ui/PriceChart.tsx`, `src/ui/NewsFeed.tsx`, `src/ui/CalendarPanel.tsx`, `src/ui/DaySummary.tsx`, `src/ui/AdminLog.tsx`, `src/ui/debug.ts`, `src/ui/styles.css`
- What changes:
  - A hand-written store (React `useSyncExternalStore`) holds `GameState` and the definitions, and exposes `dispatch(cmd)` and `endDay()`.
  - A temporary seed field, replaced in Step 24. Default seed from `crypto.getRandomValues`.
  - Panels:
    - SVG line chart of daily closes for the selected asset, last 60 days.
    - Macro calendar.
    - Top headline. A "Read news" button reveals the full visible feed. It is free until Step 19.
    - End-of-day summary shown after End day.
  - Admin log panel: only in dev builds. Today's formatted log, filterable by event kind, with fair values. This is the developer view from section 11.
  - Debug prints: `[store] dispatch <cmd> -> accepted|rejected <reason>`, `[store] endDay day=<n> events=<k> hash=<stateHash>`, `[ui] seed=<s>`.
- Must not change: `src/sim`.
- Provisional values: chart window of 60 days.
- Acceptance criteria:
  - Ending 10 days grows the chart and shows a summary each day.
  - The same seed shows the same prices as `npm run sim` for that seed, and the `[store] endDay` hash matches the harness hash on day 10. This checks that the browser and Node produce the same results.
  - The admin log panel is absent from `npm run build` output.
- Verification:
  - Run: `npm run typecheck`, `npm test`, `npm run build`.
  - User: run `npm run dev`, enter seed `demo`, press End day 10 times. Compare the day-10 hash in the console with `npm run sim -- --seed demo --days 10 --quiet`. Open the admin panel and find an event roll.
- Progress: 2026-10-23: Added the read-only dashboard. Files: src/ui/store.ts, src/ui/App.tsx, src/ui/Dashboard.tsx, src/ui/PriceChart.tsx, src/ui/NewsFeed.tsx, src/ui/CalendarPanel.tsx, src/ui/DaySummary.tsx, src/ui/AdminLog.tsx, src/ui/styles.css. The store calls createGame and endDay only, and keeps daily closes itself. Seed demo day-10 stateHash=17ad2ed590c04463 from both `npm run sim -- --seed demo --days 10 --quiet` and the store path (browser console `[store] endDay day=10 events=62 hash=17ad2ed590c04463`, day-10 closes NOVA=4622 BLSW=10569 HRBU=3171 KSR=6988 M4X=100534). The dev-only admin marker is absent from dist/. The dev server still shows the admin log. Checks: npm run typecheck passed; npm test passed (11 files, 61 tests, architecture violations=0); npm run lint passed; npm run build passed. The golden market log was not updated.

### Step 14: Trading, accounts, and the margin meter in the UI

- Status: `todo`
- Depends on: 13
- Files to create or change: `src/ui/OrderPanel.tsx`, `src/ui/Positions.tsx`, `src/ui/Accounts.tsx`, `src/ui/MarginMeter.tsx`, `src/ui/store.ts`, `src/ui/styles.css`
- What changes:
  - Order entry: asset, buy or sell, whole-share quantity. Before submitting, it shows the estimated fill, fee, spread cost and margin ratio after the trade.
  - Positions with unrealized P&L.
  - Accounts with a transfer form.
  - Margin meter with the 15% warning and 10% liquidation marks.
  - Rejection reasons are shown on screen. UI inputs are validated before dispatch: integers only, positive, within limits.
  - This step completes the market sandbox milestone. Pause here for a user review of the plan.
  - Debug prints: `[store] order ...` and `[store] transfer ...` with accepted or rejected, through `dispatch`.
- Must not change: `src/sim`.
- Provisional values: none new.
- Acceptance criteria: the player can go long and short at up to 5x. The meter changes color at 15%. A liquidation shows in the day summary. Invalid input shows a message and dispatches nothing.
- Verification:
  - Run: `npm run typecheck`, `npm test`.
  - User: on seed `demo`, open a 5x position, end days until the meter warns, keep going, and read the liquidation in the summary. Try quantity `-3` and `1.5` and see the rejection.
- Progress:

### Step 15: Day sections, provisional clock, and skip

- Status: `todo`
- Depends on: 14, Q3, Q5
- Files to create or change: `src/sim/day.ts`, `src/sim/day.test.ts`, `src/sim/game.ts`, `src/sim/types.ts`, `src/sim/constants.ts`, `src/sim/log.ts`, `src/ui/DayTimeline.tsx`, `src/ui/store.ts`, `src/harness/strategies.ts`
- What changes:
  - The day has three sections (confirmed): `sleep`, `work`, `market`. The day starts at the end of sleep, showing the sleep hours.
  - `skip` command: from the end of work, or from the end of sleep when jobless (provisional), to market open (confirmed).
  - Orders are rejected outside the `market` section with reason `marketClosed`. Management actions (transfer, read news, and later eat, drink, lifestyle) work in every section (provisional; the design leaves this open).
  - End day is allowed in any section (Q5).
  - The clock is display only. Everyone is jobless until Step 18.
  - Harness strategies call `skip` before trading.
  - Debug prints: log events `sectionChange` (from, to, clock) and `skip` (from, to). `[store] skip`.
- Must not change: end-of-day processing. Market outcomes.
- Provisional values: the clock (Q3), and a jobless skip from the end of sleep.
- Acceptance criteria: an order before market open is rejected. `skip` moves to the market section. The timeline shows sleep, work and market with clock times. Step 12 batch results are unchanged apart from the extra `skip` calls.
- Verification:
  - Run: `npm test`, `npm run sim -- --batch 50 --strategy maxLongIndex`.
  - User: start a day, try to buy before market open and see the rejection, press Skip, then buy.
- Progress:

### Step 16: Monthly cycle, bills, and the shortfall choice

- Status: `todo`
- Depends on: 15, Q7
- Files to create or change: `src/sim/monthly.ts`, `src/sim/monthly.test.ts`, `src/sim/game.ts`, `src/sim/types.ts`, `src/sim/constants.ts`, `src/sim/log.ts`, `src/ui/BillBanner.tsx`, `src/ui/store.ts`
- What changes:
  - At the start of each 30th day: salary (0 until Step 18) goes to cash, the savings interest payout from Step 9 moves into this cycle, and the expenses bill comes due. The amount is fixed at that moment.
  - If cash covers the bill, it is paid automatically. Otherwise the bill is pending, and a banner shows the shortfall and the choices: sell positions (in the market section), withdraw from savings, or take a loan (shown disabled until Step 21). A `payBill` command pays from cash.
  - End day is blocked while a bill is pending.
  - Loss check, at bill time and after every command while the bill is pending: cash + savings + trading equity after closing everything (fees and spread included) + unused loan limit (0 until Step 21). If that is less than the bill, the run ends lost (confirmed).
  - The game never sells or transfers to pay the bill (confirmed).
  - Debug prints: log events `salaryPaid`, `billDue` (amount, cash), `billPaid`, `billPending`, `coverableCheck` (each part, total, bill), `runEnded` (reason). `[store] bill ...`.
- Must not change: the market. Margin rules.
- Provisional values: base expenses 1E, bill timing (Q7).
- Acceptance criteria:
  - Auto-pay when cash covers the bill.
  - A pending bill blocks End day.
  - Paying after withdrawing from savings unblocks it.
  - A state whose coverable money is below the bill ends the run at once.
  - A test asserts that no position or savings balance changes unless a player command caused it.
- Verification:
  - Run: `npm test`.
  - User: move all cash to trading before day 30, reach day 30, see the banner, withdraw from savings, pay, and continue.
- Progress:

### Step 17: FI tracking, run end, and score

- Status: `todo`
- Depends on: 16
- Files to create or change: `src/sim/fi.ts`, `src/sim/fi.test.ts`, `src/sim/game.ts`, `src/sim/log.ts`, `src/ui/FiMeter.tsx`, `src/ui/RunEnd.tsx`, `src/ui/store.ts`
- What changes:
  - Passive income per day: the realized result net of fees, spread, borrow fees and margin interest, plus savings interest received. Unrealized profit and salary do not count.
  - A rolling 30-day sum is compared with current monthly expenses.
  - The win triggers after the condition holds on 5 consecutive end-of-day checks, from day 30. The job need not be quit.
  - The run ends with an FI win, a loss (Step 16), or at the end of day 120.
  - A score is computed. The FI meter shows the window, passive income and expenses. The end screen shows outcome, reason, day, net worth, score and seed.
  - Debug prints: log event `fiCheck` (window days, passive income, expenses, streak). `[store] runEnded`.
- Must not change: bill and margin rules.
- Provisional values: everything in section 8 except "averaged over the last in-game month", and the score formula.
- Acceptance criteria: unrealized gains do not count. Salary does not count. The win fires on the 5th consecutive day, not the 4th. Day 120 ends the run.
- Verification:
  - Run: `npm test`.
  - User: play a seed to day 120, or use a test fixture that reaches FI, and read the end screen.
- Progress:

### Step 18: Jobs

- Status: `todo`
- Depends on: 17, Q4, Q6
- Files to create or change: `src/content/jobs.ts`, `src/sim/jobs.ts`, `src/sim/jobs.test.ts`, `src/sim/game.ts`, `src/sim/monthly.ts`, `src/sim/day.ts`, `src/ui/JobPanel.tsx`, `src/ui/store.ts`
- What changes:
  - The five placeholder jobs from GAME_DESIGN section 6, plus jobless.
  - Slots map to hours: 1 slot is part-time, 2 slots is full-time. Each job sets sleep hours (Q4). The job occupies the work section.
  - Pay is the monthly pay × days employed that month ÷ 30, paid in the monthly cycle.
  - The requirement is a course flag. Course-gated jobs show as locked until Step 20.
  - Switching or quitting takes effect after a 3-day notice. The starting job is picked at run start (Q6).
  - Perks:
    - Staff discount: 5% off the bill.
    - Industry contacts: adds the `jobContacts` source to `visibleFeed`.
    - Analyst tools: hides `noise` items.
    - Steady routine and Quiet breaks: stored now, applied in Step 19.
  - The energy and stress costs are stored now and applied in Step 19.
  - Debug prints: log events `jobChangeRequested`, `jobChanged`, `salaryPaid` (job, days, amount), `perkApplied`. `[store] job ...`.
- Must not change: the generated feed. Perks only change visibility.
- Provisional values: the whole job table, the slot-to-hours mapping, sleep hours, proration, notice period.
- Acceptance criteria: salary is correct for a mid-month switch. Locked jobs are rejected with a reason. Feed generation and the state hash, without the player block, are identical for every job.
- Verification:
  - Run: `npm test`.
  - User: start as Shop assistant, see the work section 08:00–12:00, switch to Night-shift warehouse, and see it take effect 3 days later with 6h sleep.
- Progress:

### Step 19: Energy, stress, sleep, and consumables

- Status: `todo`
- Depends on: 18, Q10, Q11
- Files to create or change: `src/sim/stats.ts`, `src/sim/stats.test.ts`, `src/content/consumables.ts`, `src/sim/game.ts`, `src/sim/feed.ts`, `src/ui/StatMeters.tsx`, `src/ui/Consumables.tsx`, `src/ui/store.ts`
- What changes:
  - Two stats from 0 to 100 (confirmed: two separate stats).
  - End-of-day changes:
    - The job's energy and stress costs.
    - The short-sleep penalty (confirmed that it exists; the amounts are provisional).
    - Stress spikes on a large drawdown, a margin warning day and a wipe-out.
  - Consumables: a `consume` command pays from cash, does not take a section (confirmed), restores energy, stress or both (confirmed), and can be used once per item per day (Q10). The Steady routine perk multiplies stress restore by 1.1.
  - Reading the news costs energy. The Quiet breaks perk makes the first read each day free.
  - Meters are always visible and change color in the warning state (energy below 40 or stress above 60).
  - The Home recovery bonus stays on hold, as the design says.
  - Debug prints: log events `statChange` (stat, before, cause, delta, after), `consume` (item, cost, deltas), `newsRead` (cost). `[store] consume ...`.
- Must not change: market, events and feed generation.
- Provisional values: all stat numbers and the placeholder item list (section 2.4).
- Acceptance criteria: a full-time job with no food lowers energy by the job cost each day. A 6h-sleep job adds the penalty. Items are rejected with too little cash or on a second use the same day. Stats stay between 0 and 100.
- Verification:
  - Run: `npm test`.
  - User: work Night-shift warehouse for 5 days without eating and watch the energy meter reach the warning color, then buy Coffee and see it rise.
- Progress:

### Step 20: Lifestyle upgrades, downgrades, and courses

- Status: `todo`
- Depends on: 19, Q8
- Files to create or change: `src/content/lifestyle.ts`, `src/sim/lifestyle.ts`, `src/sim/lifestyle.test.ts`, `src/sim/monthly.ts`, `src/sim/game.ts`, `src/ui/LifestylePanel.tsx`, `src/ui/store.ts`
- What changes:
  - Home has 3 tiers and Information feed has 2 tiers. Each upgrade has an upfront cost (Q8) and adds monthly cost. Information feed tier 1 adds a medium source to the visible feed. Tier 2 adds a high source and hides `noise` items.
  - Courses (Basic, Finance) are one-time purchases that unlock job requirements.
  - Downgrades are allowed any time (confirmed). They refund nothing and only lower later bills (confirmed). A pending bill keeps its amount (confirmed).
  - Monthly expenses = base + tier costs − the staff discount.
  - Debug prints: log events `lifestyleChange` (category, from, to, upfront, new monthly expenses), `coursePurchased`. `[store] lifestyle ...`.
- Must not change: the generated feed. Only visibility changes.
- Provisional values: tier costs, upfront cost, Information feed effects, course cost 0.5E.
- Acceptance criteria:
  - An upgrade raises the next bill.
  - A downgrade lowers the next bill and refunds nothing.
  - A downgrade while a bill is pending leaves the pending amount unchanged.
  - A course unlocks the gated job.
- Verification:
  - Run: `npm test`.
  - User: buy Home tier 1, see the projected bill rise, downgrade, and see that cash did not come back.
- Progress:

### Step 21: Bank loan

- Status: `todo`
- Depends on: 20, Q9
- Files to create or change: `src/sim/loan.ts`, `src/sim/loan.test.ts`, `src/sim/monthly.ts`, `src/sim/accounts.ts`, `src/sim/game.ts`, `src/ui/LoanPanel.tsx`, `src/ui/BillBanner.tsx`, `src/ui/store.ts`
- What changes:
  - One loan at a time (confirmed). The limit is set by job and lifestyle (confirmed). The rate follows the policy rate (confirmed). The numbers come from Q9.
  - `takeLoan` puts money in cash. `repayLoan` is allowed any time.
  - Interest is due at the start of each 30th day. It is paid automatically from cash if possible. Otherwise it is pending, with a visible warning. At the end of that day, if still unpaid, a forced sale runs: positions worst-performing first, then savings (confirmed). Lifestyle is never downgraded (confirmed). If it is still short, the run ends lost.
  - The coverable check in Step 16 now includes the unused loan limit. The bill banner's loan choice is enabled.
  - Trading-transfer rule from Q9 (b): a transfer into trading cannot take cash plus savings below the loan balance.
  - Debug prints: log events `loanTaken`, `loanRepaid`, `loanInterestDue`, `loanInterestPaid`, `forcedSale` (asset or savings, amount), `runEnded`. `[store] loan ...`.
- Must not change: the bill rule that the game never sells to pay expenses. Only missed loan interest forces sales.
- Provisional values: all loan numbers and the transfer rule.
- Acceptance criteria:
  - A second loan is rejected.
  - Unpaid interest triggers a forced sale in the confirmed order and never changes lifestyle.
  - A bill can be paid with a loan.
  - The transfer rule blocks moving loan money into trading.
- Verification:
  - Run: `npm test`.
  - User: reach day 30 short of cash, take the loan from the bill banner, pay, then on day 60 leave the interest unpaid and read the forced sale in the summary.
- Progress:

### Step 22: Biased news, verify, and the tell

- Status: `todo`
- Depends on: 21, Q13, Q14
- Files to create or change: `src/sim/distortion.ts`, `src/sim/distortion.test.ts`, `src/content/socialPosts.ts`, `src/sim/game.ts`, `src/ui/NewsFeed.tsx`, `src/ui/Tell.tsx`, `src/ui/AdminLog.tsx`, `src/ui/store.ts`
- What changes:
  - At the start of each day, `shownFeed(visibleFeed, positions, stress, distortionStream)` builds what the player sees. Stress drives it (provisional).
  - Bias favors open positions (confirmed): for a long, bullish items on that asset are promoted and bearish ones hidden, and the reverse for a short. Generated social posts are display-only, have a source tag and low reliability, and are never market events.
  - Cap: at most 25% of visible items at stress 100, scaling from stress 60 (the confirmed rule is a capped share; the numbers are provisional).
  - The macro calendar is never passed through this (confirmed).
  - Each distorted item is marked, and the UI shows the same small icon and tint on all of them (the tell).
  - The `verify` command shows today's true visible feed (confirmed) and costs energy (Q11).
  - Debug prints: log event `distortion` (item, action reweight/hide/generate, true value, shown value) for every distorted item. This is the admin true-versus-shown record. The admin panel shows them. `[store] verify`.
- Must not change: market, events, `info` feed generation, the calendar, fills.
- Provisional values: the stress scaling, the 25% cap, the verify cost, once-a-day computation.
- Acceptance criteria:
  - Distorted items never exceed the cap.
  - At stress 60 or below, nothing is distorted.
  - The calendar is identical with and without distortion.
  - Determinism test: the same seed and commands with stress forced to 0 and to 100 give identical market, event and feed logs and identical prices.
  - Verify shows exactly the true visible feed.
- Verification:
  - Run: `npm test`.
  - User: hold a long, push stress above 60 (night shift, no tea), read the news, spot tinted items, press Verify, and compare.
- Progress:

### Step 23: Cosmetic effects and the accessibility toggle

- Status: `todo`
- Depends on: 22
- Files to create or change: `src/ui/effects.ts`, `src/ui/StatMeters.tsx`, `src/ui/Settings.tsx`, `src/ui/PriceChart.tsx`, `src/ui/NewsFeed.tsx`, `src/ui/styles.css`
- What changes:
  - Energy drives blur on the chart and feed and a short display-only delay on panel updates, scaling from energy 40 down to 0 (energy driving them is provisional).
  - Affected panels show the tell icon.
  - A "Reduce visual effects" toggle turns off blur and delay but keeps meters and tells. It is stored in localStorage under `trading-sim.settings.v1`.
  - Display only: no simulation calls.
  - Debug prints: `[fx] energy=<e> blur=<px> delay=<ms> reduced=<bool>` when the values change.
- Must not change: `src/sim`.
- Provisional values: blur and delay sizes and the scaling.
- Acceptance criteria: no effect at energy 40 or above. Maximum effect at energy 0. The toggle disables effects and survives a reload. Number inputs and order submission are never delayed.
- Verification:
  - Run: `npm run typecheck`, `npm test`.
  - User: let energy drop below 40, see the blur and tell, turn on the toggle, reload, and see it still on.
- Progress:

### Step 24: Start screen: modes, seed, and primer

- Status: `todo`
- Depends on: 23
- Files to create or change: `src/ui/StartScreen.tsx`, `src/ui/Primer.tsx`, `src/ui/App.tsx`, `src/ui/store.ts`
- What changes:
  - Mode select: Seeded (enter any seed, validated as 1 to 32 characters from `A–Z a–z 0–9 -`) or Normal (seed from `crypto.getRandomValues`). The seed shows in the header during the run.
  - Starting job pick (Q6).
  - One-screen primer covering news-to-price rules, sentiment, rumour reliability tiers, the margin meter, the warning state and the tell, plus "this is a simulation, not financial advice". The content is provisional.
  - Replaces the temporary seed field from Step 13.
  - Debug prints: `[ui] newRun mode=<m> seed=<s> job=<j>`.
- Must not change: `src/sim`.
- Provisional values: primer text.
- Acceptance criteria: an invalid seed shows a message and does not start. Two seeded runs with the same seed show the same day-1 prices. Normal mode shows a different seed each time.
- Verification:
  - Run: `npm run typecheck`, `npm test`.
  - User: start Seeded `demo` twice and compare prices, try seed `bad seed!`, then start Normal.
- Progress:

### Step 25: Local save, end-of-run screen, and separate scores

- Status: `todo`
- Depends on: 24
- Files to create or change: `src/persist/save.ts`, `src/persist/save.test.ts`, `src/persist/scores.ts`, `src/ui/RunEnd.tsx`, `src/ui/StartScreen.tsx`, `src/ui/store.ts`
- What changes:
  - Autosave at the start of each day as versioned JSON `{ version: 1, savedAt, mode, state }` under `trading-sim.save.v1`. The start screen shows Continue.
  - Loading validates the version, the shape and that numbers are finite. A bad save shows a message, calls `console.error`, and is not used.
  - Scores live under `trading-sim.scores.v1`, kept separate by mode (confirmed). Seeded mode keeps the best score per seed, and retries are allowed. Normal mode keeps a top 10.
  - The end screen shows outcome, reason, day, net worth, score and seed.
  - Debug prints: `[save] saved day=<n> bytes=<b>`, `[save] loaded day=<n>`, `[save] rejected reason=<r>`, `[save] score mode=<m> seed=<s> score=<x>`.
- Must not change: `src/sim`.
- Provisional values: score formula (from Step 17).
- Acceptance criteria:
  - Saving mid-run, loading and continuing gives the same state hash at day 120 as an uninterrupted run.
  - A corrupted save is rejected with a message.
  - Seeded and normal scores never mix.
- Verification:
  - Run: `npm test`.
  - User: play to day 12, reload the page, press Continue, and see day 12. Finish a seeded and a normal run and check that both score lists are separate.
- Progress:

### Step 26: Event content fill and the first full playtest

- Status: `todo`
- Depends on: 25
- Files to create or change: `src/content/events.ts`, `src/content/sources.ts` (only if needed), this plan's Progress lines
- What changes:
  - Grow the event list from 8 to about 16 placeholder types (within the provisional 15 to 25), using the examples in section 5: inflation data shock, growth data shock, demand shift per sector, supply shock per sector, and so on. The content test from Step 6 covers them.
  - Run the batch report for every strategy.
  - The user plays one seeded jobless run and one seeded employed run.
  - Record the results against GAME_DESIGN section 15 criteria 1 to 10 in Progress, plus any design questions that came up. The parent agent moves those into GAME_DESIGN.md.
  - Debug prints: no new behavior. Existing logs and reports are the evidence.
- Must not change: logic in `src/sim`. Tuning numbers only change on purpose and are noted in Progress.
- Provisional values: all new event types.
- Acceptance criteria: the content test passes. The batch report shows a largest daily move of at most 8% and backstop write-off at most rounding. Both playtest runs finish, and the run length is recorded in real minutes.
- Verification:
  - Run: `npm test`, `npm run sim -- --batch 500 --strategy random --days 120`.
  - User: play both runs and report the real time taken, whether the jobless and employed runs felt different, whether a price move could be explained from the feed and summary, and whether the bias felt fair.
- Progress:

## 5. Risks, and what would reveal them early

- **Plan size.** 26 steps is a lot for a solo developer. *Reveal:* the review after Step 14. If the market alone is not interesting there, fix the price model before building the life layer.
- **Price feels random or too predictable.** *Reveal:* the Step 12 report (share of capped days, price-to-fair-value gap) and the user's Step 14 play. Many capped days means big moves are easy to ride. A large noise-to-gap ratio means news hardly matters.
- **Leverage blows up runs.** *Reveal:* liquidation and wipe-out rates for `maxLongIndex` in Step 12, and again once stats exist (Step 19).
- **Seeds differ between browser and Node.** Box–Muller uses `Math.log` and `Math.cos`. *Reveal:* the hash comparison in Step 13. If they differ, use a table-based or integer-only normal draw.
- **Stats spiral with no natural recovery.** The design makes consumables the only recovery, so a full-time job may drain energy in a few days. *Reveal:* Step 19 tests and the Step 26 playtest. If it is too harsh, the fix is a design decision for GAME_DESIGN.md, not a code workaround.
- **A pending bill traps the player.** End day is blocked while a bill is pending. *Reveal:* Step 16 tests must prove that every pending state either has a payable path or ends the run.
- **Visibility changes move the seed.** If jobs, lifestyle or perks change what is generated rather than what is shown, seeded runs diverge between players. *Reveal:* the hash-equality tests in Steps 8, 18 and 20.
- **Bias feels rigged, or the summary undercuts it.** *Reveal:* Step 22 cap tests and the Step 26 playtest questions. Q13 stays open until then.
- **Pacing.** 120 days in 30 minutes leaves about 15 seconds a day, with at least two clicks a day (Skip, End day). *Reveal:* real minutes recorded in Step 26. The fallback is the provisional quiet-day skip (Q15).
- **Provisional numbers change often.** *Mitigation:* all of them live in `constants.ts` or `content/` (section 2.3), so a change is a data edit plus an intended snapshot update.
