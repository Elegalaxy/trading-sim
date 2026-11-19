@HANDOFF.md

# CLAUDE.md

Guidance for Claude Code in this repository. Machine-wide rules (agent routing, the UI/UX guide, worktrees) live in `~/.claude/CLAUDE.md` and are not repeated here.

## Workflow

- **Worktrees:** follow the machine-wide worktree rule. Never edit the shared main checkout for implementation work.
- **Commit and push each finished stage:** when a stage, plan part or main function is finished (typecheck, tests and lint pass), run `git fetch origin`, rebase onto `origin/main`, commit, and push to `origin/main` before starting the next one. One commit per finished piece. Never force-push. Tell implementers this rule in every brief.
- **Handoff (shared with Cursor):** read `HANDOFF.md` before starting work; Cursor may have changed things. Overwrite it only after a milestone or when the user says "handoff": under 50 lines, with Last Updated By, Current Goal, Recent Changes and files touched, Active Decisions / Constraints, and Exact Next Step. Replace, do not append.

## Docs are the source of truth

- `doc/GAME_DESIGN.md`: rules and numbers. Rules carry `[CONFIRMED]` / `[PROVISIONAL]` / `[LATER]` / `[OPEN]` tags. Don't change a `[CONFIRMED]` rule without a user decision.
- `doc/plans/`: step-by-step plans. When finishing a step, set its Status and add a dated Progress line. Option analysis is in `doc/brainstorm/`.
- Portfolio brief: `../docs/ideas/trading-simulation.md`. Keep it and `../docs/ideas/README.md` aligned when the concept, scope or status changes.
- `README.md` is the unmodified Vite template; ignore it.

## Commands

```bash
npm run dev                 # Vite dev server
npm run build               # tsc -b && vite build
npm run typecheck           # tsc -b (three projects: app, node, harness)
npm run lint                # oxlint
npm test                    # vitest run (all tests)
npx vitest run src/sim/margin.test.ts          # one test file
npx vitest run -t "some test name"             # one test by name
npm run sim -- --seed abc --days 30 [--quiet] [--asset <id>] [--events-only] [--feed]
npm run sim -- --seed abc --days 120 --batch 200 --strategy <name>   # batch risk report
```

## Architecture

A deterministic, seeded trading/life sim (React 19 + Vite + TypeScript, Vitest). The code is split into five layers under `src/`, and **`tests/architecture.test.ts` enforces the import rules** by scanning every source file (a file outside a layer also fails). When adding code, respect:

- `src/sim`: pure game rules. May import only other `src/sim` files (tests may also import `vitest`). Banned in non-test files: `Math.random`, `Date`, `performance.now`, `console`, browser storage, `process`, DOM globals/`fetch`, React, `node:*`. All randomness goes through the seeded named streams in `rng.ts`.
- `src/content`: data definitions (assets, events, jobs, lifestyle, calendar, social posts…), assembled into `MARKET_DEFINITIONS` in `content/index.ts`. May import sim types; no UI, persist, harness, or I/O.
- `src/harness`: Node CLI (`cli.ts`), batch runner and bot strategies for balance testing. Must not import `ui` or `persist`.
- `src/persist`: versioned save (`save.ts`, key `trading-sim.save.v1`) and high scores. May import only sim types (not content), not ui/harness.
- `src/ui`: React components plus `store.ts`, a `useSyncExternalStore` session store wrapping the sim. Must not import `harness`.
- `src/main.tsx` is the app entry (not a layer). Nothing may import from sibling game projects.

### Sim flow

Player time goes through two entry points in `src/sim/game.ts`: `applyCommand` (player actions) and `endDay` (steps the market once, then margin interest, short borrow, margin check/liquidation, savings accrual, energy/stress update; every 30th day runs the monthly cycle — bills, job changes — then the FI check). A day is divided into sections (sleep → work → market, see `day.ts`); orders are only accepted in the market section; End day is blocked while a bill is pending or the run has ended. Runs last 120 days. Orders never move prices; the hidden fair value moves via events and the price follows it. The `GameState` is plain JSON (saved directly), and `stateHash` (`hash.ts`) is used for determinism checks.

Intraday: `src/sim/session.ts` builds 16 fifteen-minute bars per asset at the start of each day by previewing the next market step on a copy of the market. `applyCommand({type:'tick'})` moves the clock, and orders fill at the quote at the clock (`quoteMarket`). The close, margin check and liquidation are still once a day in `endDay`. Session streams live on `GameState.session`, not on the market, so market hashes and fixtures do not depend on them.

Resting orders: `src/sim/resting.ts` holds limit orders and per-position take profit and stop loss on `GameState.resting`. They are checked bar by bar on `tick` and for the rest of the day in `endDay`, fill at their own price with no spread, and never touch the market.

Perception layer: energy/stress distort what the player sees (`distortion.ts`, `feed.ts`), never the market itself.

## Conventions

- Same seed + same commands must produce the same run. Golden files in `tests/fixtures/` (price logs, noise rolls) are read by `market.test.ts`, `events.test.ts` and `content.test.ts`; changing RNG draw order or content numbers will break them, so treat that as a deliberate change and regenerate/verify intentionally.
- All money is integer cents.
- Unit tests sit next to source as `*.test.ts`. Files open with a short header comment explaining the module's rules; keep that style.
- Debug output uses `[DEBUG …]`-prefixed lines (see `src/ui/debug.ts`; tests write via fd 1 so Vitest doesn't hide it).
