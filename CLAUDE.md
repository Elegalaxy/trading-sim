@HANDOFF.md

## Two-Way Handoff Sync
1. Always check `HANDOFF.md` before starting work to pick up where Cursor (Grok/Sol) left off.
2. After completing a milestone or when I say "handoff", overwrite `HANDOFF.md` (max 50 lines) with files changed, key decisions, and the next step for Cursor.
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

`README.md` is the unmodified Vite template; ignore it. The design source of truth is `doc/GAME_DESIGN.md` (rules carry `[CONFIRMED]` / `[PROVISIONAL]` / `[LATER]` / `[OPEN]` tags — don't change a `[CONFIRMED]` rule without a user decision). Plans and option analysis are in `doc/plans/` and `doc/brainstorm/`. All money is integer cents.

## Architecture

A deterministic, seeded trading/life sim (React 19 + Vite + TypeScript, Vitest). The code is split into five layers under `src/`, and **`tests/architecture.test.ts` enforces the import rules** by scanning every source file (a file outside a layer also fails). When adding code, respect:

- `src/sim` — pure game rules. May import only other `src/sim` files (tests may also import `vitest`). Banned in non-test files: `Math.random`, `Date`, `performance.now`, `console`, browser storage, `process`, DOM globals/`fetch`, React, `node:*`. All randomness goes through the seeded named streams in `rng.ts`.
- `src/content` — data definitions (assets, events, jobs, lifestyle, calendar, social posts…), assembled into `MARKET_DEFINITIONS` in `content/index.ts`. May import sim types; no UI, persist, harness, or I/O.
- `src/harness` — Node CLI (`cli.ts`), batch runner and bot strategies for balance testing. Must not import `ui` or `persist`.
- `src/persist` — versioned save (`save.ts`, key `trading-sim.save.v1`) and high scores. May import only sim types (not content), not ui/harness.
- `src/ui` — React components plus `store.ts`, a `useSyncExternalStore` session store wrapping the sim. Must not import `harness`.
- `src/main.tsx` is the app entry (not a layer). Nothing may import from the sibling `rpg/` project.

### Sim flow

Player time goes through two entry points in `src/sim/game.ts`: `applyCommand` (player actions) and `endDay` (steps the market once, then margin interest, short borrow, margin check/liquidation, savings accrual, energy/stress update; every 30th day runs the monthly cycle — bills, job changes — then the FI check). A day is divided into sections (sleep → work → market, see `day.ts`); orders are only accepted in the market section; End day is blocked while a bill is pending or the run has ended. Runs last 120 days. Orders never move prices; the hidden fair value moves via events and the price follows it. The `GameState` is plain JSON (saved directly), and `stateHash` (`hash.ts`) is used for determinism checks.

Intraday: `src/sim/session.ts` builds 16 fifteen-minute bars per asset at the start of each day by previewing the next market step on a copy of the market. `applyCommand({type:'tick'})` moves the clock, and orders fill at the quote at the clock (`quoteMarket`). The close, margin check and liquidation are still once a day in `endDay`. Session streams live on `GameState.session`, not on the market, so market hashes and fixtures do not depend on them.

Resting orders: `src/sim/resting.ts` holds limit orders and per-position take profit and stop loss on `GameState.resting`. They are checked bar by bar on `tick` and for the rest of the day in `endDay`, fill at their own price with no spread, and never touch the market.

Perception layer: energy/stress distort what the player sees (`distortion.ts`, `feed.ts`), never the market itself.

### Determinism and fixtures

Same seed + same commands must produce the same run. Golden files in `tests/fixtures/` (price logs, noise rolls) are read by `market.test.ts`, `events.test.ts` and `content.test.ts`; changing RNG draw order or content numbers will break them, so treat that as a deliberate change and regenerate/verify intentionally.

### Conventions

Unit tests sit next to source as `*.test.ts`. Files open with a short header comment explaining the module's rules; keep that style. Debug output uses `[DEBUG …]`-prefixed lines (see `src/ui/debug.ts`; tests write via fd 1 so Vitest doesn't hide it).

## Handoff

Before edits, read `HANDOFF.md`. After a task, overwrite it in place (under 50 lines) with Last Updated By, Current Goal, Recent Changes and files touched, Active Decisions / Constraints, and Exact Next Step. Do not append.
