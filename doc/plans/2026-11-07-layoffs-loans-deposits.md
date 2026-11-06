# Trading Sim: Layoffs, Loan Numbers and Fixed Deposits

Date: 2026-11-07
Status: plan approved by the user on 2026-11-07 (decisions in section 9), nothing built. Every number is a placeholder, provisional in this plan only.
Design source of truth: [../GAME_DESIGN.md](../GAME_DESIGN.md), section 6 (Money accounts, Jobs), section 8 (Being out) and section 12 (Bank loan, Later systems). This plan covers the `[LATER]` "Job loss through telegraphed layoffs", the `[OPEN]` loan numbers, and the `[LATER]`/`[OPEN]` "FD … lock periods, penalties, rates and limits". Section 9 lists every point where an option touches a `[CONFIRMED]` rule.
Format: like [2026-11-04-items-and-lifestyle.md](2026-11-04-items-and-lifestyle.md). Step ids are `N0`, `Y1…` (layoffs), `B1…` (bank loan) and `D1…` (deposits). Status values: `todo`, `done`, `verified`, `failed`, `blocked`.

## 1. Goal

Make the life layer push back:
- A job can be lost, with enough warning that the player can react.
- The bank loan becomes a real obligation with a schedule and a visible warning before anything is sold.
- Cash can be locked away for a better rate, at the cost of flexibility.

None of the three may touch the market, and a seed must still replay the same market.

## 2. Where it is today (read from the code on 2026-11-07)

### 2.1 Jobs (`src/sim/jobs.ts`, `src/content/jobs.ts`)
- Six menu entries, all monthly pay. Jobless pays $0. Shop assistant pays $600 (no course). Office clerk pays $1,100 (Basic course). Night-shift warehouse pays $1,300 (no course, 6 h sleep). Trading-floor assistant pays $1,000 (Finance). Freelance analyst pays $800 (Finance).
- A switch or quit waits `JOB_NOTICE_DAYS` = 3 (`interpretSetJob` sets `job.pending`). `applyDueJobChange` runs in `endDay` before the monthly cycle.
- Salary is prorated by `job.worked` and paid in `applyMonthlyCycle` (`paySalary`). The staff discount applies to the bill priced for the job that is active then.
- Nothing ends a job except the player. Jobs have no sector. The batch harness (`harness/batch.ts`) runs jobless. `harness/care.ts` runs every job.

### 2.2 Bank loan (`src/sim/loan.ts`, constants `LOAN_*`, `src/ui/LoanPanel.tsx`)
- One loan. A second draw is refused while the balance is above 0 (`loanOutstanding`), so there is no top-up.
- Limit = 2E + the active job's pay + 0.25E × (home tier + info-feed tier). Health and Equipment do not count. Limits:
  - Jobless: $2,000.
  - Shop: $2,600.
  - Office: $3,100.
  - Warehouse: $3,300.
  - Trading floor: $3,000.
  - Freelance: $2,800.
  - Each tier adds $250, up to +$1,250.
- Rate = max(0, policy + 4)/100. Policy starts at 4 (`content/environment.ts`), so the rate is 8% a year.
- Interest is **one full month** of interest, charged on each payday (`assessLoanInterest`), whatever day the loan was drawn. A loan drawn on day 29 pays a whole month on day 30.
- There is **no term and no principal schedule**. Repayment is free, any amount, any time.
- Unpaid interest stays pending that day. At End day, `settleMissedLoanInterest` sells whole positions, worst unrealized result first, then takes savings. If that is still short, the run is lost (`cannotPayLoanInterest`).
- A transfer into trading is refused when cash + savings would fall below the loan balance (`interpretCommand`, `belowLoanBalance`). **This already settles "whether loan money can be used for trading": it cannot.**
- The cover check for a bill counts unused loan room only when no loan is open (`monthly.ts` `measureCoverable`).
- **Bug:** `netWorthCents` (`fi.ts`) = cash + savings + trading equity. It does not subtract the loan. Borrowing $3,000 just before day 120 adds about 30 to the score.
- There is no warning before a forced sale. The only signal is a red line in the Loan panel on the payday itself.

### 2.3 Savings (`src/sim/accounts.ts`)
- Rate = max(0, policy − 1.5)/100, which is 2.5% a year at the start. It accrues daily on `accruedSavingsCents` and is paid into savings on each payday (`payAccruedSavings`).
- Savings interest counts as passive income (`savingsInterestReceived` → `applyFiCheck`).
- Savings has no limits and instant transfers (`[CONFIRMED]`). There is no locked product.

### 2.4 Scale check (all from the content files)
- Bill: $1,000 base, up to $1,850 at every tier.
- The FI bar is the same lifestyle cost.
- Savings interest on $3,000 for 30 days at 2.5% = **$6.16**.
- So any interest product with real-world rates is pocket change next to a $1,000 bill. This matters for deposits (section 6).

## 3. Rules every option must keep
- No change to the market, events, prices or fills. New randomness uses its own derived stream (`createRng(`${seed}#…`)`, like `social.ts` and `session.ts`), so market hashes and `tests/fixtures/*` stay unchanged.
- The game does not sell or transfer for the player to pay a **bill** (`[CONFIRMED]`). The loan's forced sale is the one exception, and it is already `[CONFIRMED]`.
- One loan at a time. The limit is set by job and lifestyle. Interest follows the policy rate (`[CONFIRMED]`).
- Lifestyle is never downgraded to pay anything (`[CONFIRMED]`).
- Salary is not passive income. Interest is (`[PROVISIONAL]`, section 8).
- Cents stay inside `src/sim`. Every effect logs a typed event (debug rule, section 13).
- Old saves must load. New `GameState` fields are **optional** (the `social?` / `orderFlow?` pattern), so the hand-built test states (and the scratch state in `monthly.ts`) need no edit.

## 4. Layoffs

### 4.1 Options

**A. Fixed schedule.** Each job has a set chance of a layoff on each payday, announced N days ahead, always true. Simple, but nothing to read and no link to the market.

**B. Restructuring rumour, settled later, driven by the economy (recommended).**
1. On the growth-release day of each month, the employer may start a rumour.
2. Ten days later it is confirmed or dropped.
3. Ten days after that, on the payday, a confirmed cut ends the job.

The chance rises after a weak growth print and when the employer's sector is falling. That gives "trade the sector" a meaning: a warehouse worker can short sector A as a hedge.

**C. Like B, but the confirm/drop outcome reacts to the market between the rumour and the decision.** It is more "alive", but the player cannot tell why the outcome went one way. Rejected for now.

### 4.2 Rules for option B
- **Which jobs:** every job with an employer.
  - Shop assistant: sector A (consumer spending follows growth).
  - Night-shift warehouse: sector A (logistics).
  - Office clerk: sector B (bank/insurance back office, rate-sensitive).
  - Trading-floor assistant: sector B.
  - **Freelance analyst is exempt.** There is no employer to cut, which makes it a safe-but-modest choice (question 2).
- **Days:** the roll day is market day `d` with `d % 30 === 10` and `d + 20 < RUN_LENGTH_DAYS`. That is days 10, 40 and 70, the same day as the monthly growth release. The decision day is `d + 10` (20, 50, 80). The layoff day is `d + 20` (30, 60, 90, all paydays). Day 100 is not a roll day, because its cut would fall on day 120, when the run is sealed.
- **Draws:** on every roll day, always exactly **two** floats from the layoff stream: `warnRoll` and `truthRoll`. This happens even when jobless or exempt, so a job choice never shifts later rolls, and an old save can be fast-forwarded exactly (section 7). No draw on any other day.
- **Chance per roll day**, clamped to 0 … 0.40:
  - Base chance by job: shop 0.10, warehouse 0.12, office 0.06, trading floor 0.10.
  - Today's `growthRelease` outcome from `market.calendarRolls` (kind `growthRelease`, `day === d`): `below` +0.08, `above` −0.04, `inline` or missing 0.
  - Sector move: the average across the sector's stocks of `price today / close 20 days earlier − 1`. The close comes from `state.past` (the row with `day === d − 20`), or the asset's `startPriceCents` when `d − 20 ≤ 0`. A missing row gives 0. ≤ −5% adds +0.10, ≥ +5% subtracts 0.04.
- **Warning:** if `warnRoll < chance`, the player's active job is in the table and no notice is open, a notice opens with `real = truthRoll < 0.60`. `real` is hidden like a rumour's `truth`; the UI must not read it. Stage `rumour`.
- **Decision day:** a real notice moves to `confirmed`. A false one is dropped (event `layoffDropped`, notice cleared).
- **Layoff day.** This runs in `endDay` **before** `applyDueJobChange`, so a switch that takes effect that same morning still counts as a layoff.
  - If the active job is the notice's job: pay severance = round(0.5 × monthly pay) to cash (`severancePaid`). Set `jobId = 'jobless'`, then log `laidOff` plus a normal `jobChanged` (from → jobless) so the existing Day report and job UI react. Add the job to `employer.barred`, so it cannot be rejoined for the rest of the run (question 3). Clear the notice.
  - If the player already left (a switch before that day): `layoffAvoided`, no severance, notice cleared.
  - Days worked are already recorded, so that payday's prorated salary is paid normally by the monthly cycle that runs right after. The bill is priced for whichever job is active after `applyDueJobChange`. A laid-off shop assistant loses the staff discount on that bill. The loan limit drops by the lost pay (an open balance is not called in).
- **Pending switch:** it is kept and still fires on its day. A request to a barred job is rejected with `rehireBlocked`.
- **Courses and perks:** nothing new. Being jobless already frees the daytime study slot (faster courses, more research). Perks go with the job: the warehouse's free read and the trading floor's contacts.
- **FI:** unchanged. Severance is not passive income.
- **Stress:** +8 stress on the decision day when a notice is confirmed (question 7, decided yes). Cause `layoffNotice`, logged as a stat event. A dropped notice adds none.
- **Distortion:** employer notices are never bent or hidden by stress. They are not part of `market.feed`, like the macro calendar.

### 4.3 Balance sanity check

The chance that a notice turns into a real cut per roll day is `chance × 0.6`. There are three roll days per run, assuming the player stays in the job.

| Job | Base chance | Any warning in the run | Laid off in the run (neutral economy) | Laid off (weak print and sector −5%) |
| --- | --- | --- | --- | --- |
| Shop | 0.10 | 27% | 17% | 0.28 → 42% |
| Warehouse | 0.12 | 32% | 20% | 0.30 → 45% |
| Office | 0.06 | 17% | 10% | 0.24 → 37% |
| Trading floor | 0.10 | 27% | 17% | 0.28 → 42% |
| Freelance | 0 | 0 | 0 | 0 |

Cost of a warehouse layoff on day 60, if the player switches to shop work:
- The pay gap is $700 a month over 60 days = −$1,400, plus about 3 days of notice.
- Severance is +$650.
- Net is about −$750 to −$800, about 0.8 of a base bill.

Without the no-rehire rule, the player could rejoin after the notice and lose almost nothing, so the rule is what gives a layoff weight. A Step Y4 harness run checks these rates; the target is within ±5 points of the table.

## 5. Bank loan numbers

### 5.1 Size
Keep the `[CONFIRMED]`-shaped formula unchanged: 2E + active pay + 0.25E per Home/Feed tier. It covers about two base bills when jobless and up to 4.55E at most. No new cap.

### 5.2 Interest
Keep policy + 4 points (8% at the start). Change the charge to **daily accrual** (`balance × rate / 365`, rounded half away from zero, into `loan.accruedInterestCents`), the same as savings, and collect it on the payday. This fixes the full-month charge on a one-day loan.

Cost check: $3,300 for 90 days at 8% ≈ $65 in total.

### 5.3 Term and repayment: options
- **A. Keep interest-only, open-ended.** The only change is that net worth subtracts the balance. Smallest, but the loan stays free money until day 120.
- **B. Instalments over up to 3 paydays (recommended).**
  - On a draw (balance 0 → above 0), `paymentsLeft` = the number of paydays after the draw day and at least 7 days away, capped at 3.
  - Each payday the payment is the accrued interest plus `ceil(balance / paymentsLeft)` of principal (the last one is the whole balance). `paymentsLeft` then drops by 1.
  - A draw after day 113 has no payday left: `paymentsLeft = 0`. The balance then just counts against net worth at the seal.
  - Early repayment is **free** and lowers later instalments; `paymentsLeft` is not changed. Paying off clears the schedule.
- **C. A single repayment 60 days after the draw.** Simple, but a single cliff, and it often lands on the same payday as a bill.

Burden check for B:
- Warehouse worker, max loan $3,300 drawn on day 1: three payments of about $1,100 plus $20/$15/$7 of interest on days 30, 60 and 90.
- Add a $1,000 bill and the month costs $2,100 against $1,300 of pay.
- So a full loan has to be planned for. That is the intended tension. Smaller loans are easy.

### 5.4 Missed payment
Unchanged mechanism, now for the whole payment. Cash pays it in the morning when cash covers it. Otherwise it is pending until End day, which sells:
1. positions, worst first;
2. then savings;
3. then deposits (breaking each with its penalty, the one that matures last first, Step D2).

If it is still short, the run is lost. This extends the `[CONFIRMED]` "missed interest forces selling" to missed principal (question 4). If the player repays principal by hand while a payment is pending, the pending principal is capped at the balance.

### 5.5 Warning before a forced sale (the open item)
1. **5 days ahead** (`LOAN_WARNING_DAYS = 5`): from payday − 5, show the next payment (the estimate `estimatedPaymentCents(state)`) and the payday.
   - Loan panel: a key-value row.
   - Day report: a line every day while cash is below the estimate (amber).
2. **On the payday**, when a payment is pending: a `LoanDueBanner` next to the bill banner.
   - It shows what End day will sell, in order, with amounts. The new `previewLoanSale(state, defs)` runs `settleMissedLoanInterest` on `previewCopy(state)` (`past.ts`).
   - Actions, cheapest first: "Withdraw savings", "Break deposit" (penalty shown), "Sell manually" hint.
3. **End day confirm:** while a payment is pending and the preview sells something, the End day button in `DayTimeline.tsx` needs a second click ("Sell NOVA, KSR and $X savings?"). Use the same inline confirm pattern as the lifestyle confirm button.

### 5.6 Other rules
- **Net worth (bug fix, Step N0):** subtract `balanceCents + interestDueCents + accruedInterestCents`.
- **Layoffs:** the limit falls with pay, and nothing is called in.
- **Bills:** order on a payday stays salary → savings interest → loan payment → bill. A loan payment that cash covers is taken before the bill, as today.

## 6. Fixed deposits

### 6.1 Rate scale: options
- **A. Real-world-like annual rates, fixed at opening (recommended).** Annual rate = max(0, policy − 1.5 + bonus)/100, with bonus +1 / +2 / +3 points for 30 / 60 / 90 days. At policy 4 that is 3.5% / 4.5% / 5.5%. Simple interest, paid at maturity.
  - $3,000 for 90 days earns **$40.68**, against $18.49 in savings.
  - The deposit is a **commitment device and a rate lock** (policy can move on days 25, 55 and 85), not an income source. FI stays a trading goal.
- **B. Game-scaled rates** (for example 3% per 90 days, about 12% a year). $3,000 earns $90. At $30,000+ deposits start to carry the FI bar, which opens a no-trading win. Rejected unless the user wants it (question 5).

### 6.2 Rules (option A)
- **Terms:** 30, 60 or 90 days. The rate is fixed at opening from that day's policy. Minimum $100. At most 3 open deposits.
- **Funding:** opened from cash or savings with the `openDeposit {amountCents, termDays, from: 'cash'|'savings'}` command. It is refused while a bill or loan payment is pending (`billPending` / `loanPaymentPending`), so a deposit cannot be used to dodge either.
- **Maturity:** in `endDay` after savings accrual. Every deposit with `maturityDay <= market.day` pays principal + interest (round(principal × rate × termDays / 365)) **into savings**. No auto-rollover. The interest counts as passive income on that day: `savingsInterestReceived` also sums `depositMatured.interestCents`.
- **Early break:** `breakDeposit {id}`, whole deposit only. The player gets principal − 2% (`DEPOSIT_BREAK_PENALTY_PPM = 20_000`) into savings, and accrued interest is lost. Breaking costs more than the deposit would have earned: $60 against $40.68 on $3,000 for 90 days. Not counted in FI.
- **Bills:** the cover check adds `depositsCents` = the sum of break values. The player can still break a deposit to pay a bill, so locked money never ends a run by itself. The bill banner offers "Break deposit" after "Withdraw savings".
- **Loan:** deposits are the last thing a forced sale takes (5.4). The transfer-into-trading rule still counts only cash + savings, so a deposit cannot be used to dodge it.
- **Margin/equity:** not part of trading equity, no effect.
- **Net worth:** principal + interest earned so far, pro rata (round(principal × rate × min(elapsed, term) / 365)).
- **Run end:** a deposit may mature after day 120. The UI says so ("matures after the run"), and net worth uses the pro-rata value.
- **Layoffs:** nothing new. "Save cash" is the player's response.

## 7. Data model, save compatibility, determinism

### 7.1 Types (`src/sim/types.ts`)
```ts
// Layoffs
export type LayoffJobRisk = { jobId: string; sector: SectorId; baseChance: number }
export type LayoffDefinitions = {
  jobs: readonly LayoffJobRisk[]          // a job not listed is exempt
  growthBelow: number; growthAbove: number // +0.08, -0.04
  sectorFall: number; sectorRise: number   // +0.10, -0.04
  sectorMovePercent: number                // 5
  maxChance: number                        // 0.40
  trueChance: number                       // 0.60
}
MarketDefinitions.layoffs?: LayoffDefinitions   // omitted = no layoffs, no draws
export type LayoffNotice = { jobId: string; warnedDay: number; decisionDay: number; layoffDay: number; real: boolean; stage: 'rumour' | 'confirmed' }
export type EmployerState = { stream: RngStream; notice: LayoffNotice | null; barred: string[] }
GameState.employer?: EmployerState

// Loan (all optional; missing = 0)
BankLoan.accruedInterestCents?: number
BankLoan.principalDueCents?: number   // pending principal, alongside interestDueCents
BankLoan.paymentsLeft?: number

// Deposits
export type Deposit = { id: number; principalCents: number; openedDay: number; termDays: 30 | 60 | 90; annualRate: number; maturityDay: number }
GameState.deposits?: { nextId: number; open: Deposit[] }
```

New events (into `AccountLogEvent`, and the command ones into `CommandLogEvent` plus the `assertPending` kind list in `game.ts`):
- Layoffs: `layoffWarning`, `layoffConfirmed`, `layoffDropped`, `layoffAvoided`, `laidOff`, `severancePaid`.
- Loan: `loanAccrual`, and an optional `principalCents` on `loanInterestDue` / `loanInterestPaid` (old logs lack it).
- Deposits: `depositOpened`, `depositBroken` (with `forced: boolean`), `depositMatured`.
- `CoverableCheckEvent.depositsCents?`. The sum check in `assertPending` must add `?? 0`.

### 7.2 Save (`src/persist/save.ts`, `src/ui/store.ts` `continueGame`)
- `checkState`: add `'employer'` and `'deposits'` to the optional keys.
- The loan check moves from `sameKeys(LOAN_KEYS)` to `keysWithin(LOAN_KEYS, ['accruedInterestCents','principalDueCents','paymentsLeft'])`.
- Shape checks for `employer` (stream via `checkStream`) and for `deposits`.
- `continueGame`:
  - **employer:** if `definitions.layoffs` is set and the save has none, use `createEmployer(save.seed)` and fast-forward it by 2 draws for every roll day `≤ game.market.day`. This gives the exact stream state the run would have had.
  - **deposits:** missing becomes `{nextId: 1, open: []}`.
  - **loan:** with a balance above 0 and no `paymentsLeft`, set it from the rule in 5.3 as if drawn today.
- Add one more old-save test in `src/ui/oldSaves.test.ts`.

### 7.3 Determinism and fixtures
- **Layoffs:** a new stream `createRng(`${seed}#layoffs`).market`, never touching `market.streams`. Market hashes, `tests/fixtures/*` and the batch harness (jobless) are unchanged.
- **Loan and deposits:** no randomness.
- **Expected deliberate test updates:** `loan.test.ts` and `monthly.test.ts` (full-month interest becomes daily accrual plus instalments), `fi.test.ts` (net worth minus the loan), and any test asserting the exact payday event list.
- `harness/care.ts` passes `{ ...defs, layoffs: undefined }` so its report stays comparable to the L6 numbers.

## 8. Steps

Independent chains:
- N0 stands alone.
- Y1–Y5 (layoffs) are independent of B and D.
- B1–B3 (loan) come before D2, which edits the forced-sale chain in `loan.ts`.
- D1 and D3 are independent of B.
- G1 is last.

After every step run `npm run typecheck`, `npm run lint` and `npm test`.

| Step | What | Files | Verify |
| --- | --- | --- | --- |
| N0 | `netWorthCents` subtracts `loan.balanceCents + interestDueCents (+ accruedInterestCents ?? 0)`. Test: a $1,000 loan leaves net worth unchanged after the draw. | `src/sim/fi.ts`, `fi.test.ts` | `npx vitest run src/sim/fi.test.ts` |
| Y1 | `LayoffDefinitions` type, `src/content/layoffs.ts` (numbers in 4.2), wired into `MARKET_DEFINITIONS.layoffs`. Pure `layoffChance(state, defs, jobId, day): number` and `isLayoffRollDay(day)` in a new `src/sim/layoffs.ts` with a header comment. Tests: base per job, growth-print and sector modifiers, clamp, exempt job = 0, missing past row = 0. Also check in a test that `upcomingCalendar` puts `growthRelease` on 10/40/70. | `types.ts`, `content/layoffs.ts`, `content/index.ts`, `sim/layoffs.ts`, `sim/layoffs.test.ts` | `npx vitest run src/sim/layoffs.test.ts` |
| Y2 | `EmployerState`, `createEmployer(seed)`, `assertEmployer`. `applyEmployerDay(state, defs)` called in `endDay` after `applyEndOfDayStats` and before `applyDueJobChange`: on a roll day 2 draws, maybe open a notice; on a decision day confirm or drop. `createGame` creates it when `defs.layoffs` is set. `assertGame` checks it. Tests: always 2 draws per roll day (also when jobless); same seed + commands = same notices; no draw on other days. | `sim/layoffs.ts`, `sim/game.ts`, tests | as above + `npm test` |
| Y3 | Stress +8 on confirm (decision day) in `applyEmployerDay`, with a test. Layoff day inside `applyEmployerDay`: severance, `jobId = 'jobless'`, `laidOff` + `jobChanged`, `barred`, `layoffAvoided` when the player left. `interpretSetJob` rejects `rehireBlocked`. Tests: severance amount; salary for days worked still paid by the monthly cycle; a pending switch effective the same day still gets severance and then switches; the loan limit falls; the bill uses the new job. | `sim/layoffs.ts`, `sim/jobs.ts`, tests | `npx vitest run src/sim/layoffs.test.ts src/sim/jobs.test.ts` |
| Y4 | Save and load: optional `employer`, fast-forward in `continueGame`. Harness `--layoffs N`: N seeds, each job held all run, prints warnings, real cuts, avg layoff day and the share with a weak growth print. `care.ts` strips `layoffs`. | `persist/save.ts`, `ui/store.ts`, `harness/layoffs.ts`, `harness/cli.ts`, `harness/care.ts`, `oldSaves.test.ts` | `npm run sim -- --seed abc --days 120 --layoffs 200`; rates within ±5 points of 4.3 |
| Y5 | UI, section 10.1. Debug lines for the new events in `log.ts`. | `JobPanel.tsx`, `NewsFeed.tsx`, `CalendarPanel.tsx`, `DayReport.tsx`, `src/sim/log.ts` | Browser, seed `demo`, warehouse job: run to day 10/40/70 until a notice; check the card, the calendar entry and the day report |
| B1 | Loan schedule: `accrueLoanInterest` in `endDay` after `settleSavings`. On a draw set `paymentsLeft`. `assessLoanInterest` turns into the payment (interest + principal, `principalCents` on the events). `payPendingInterest` lowers the balance. Constants `LOAN_MAX_PAYMENTS = 3`, `LOAN_FIRST_PAYMENT_MIN_DAYS = 7`, `LOAN_DAYS_PER_YEAR = 365`. Save optional keys and the old-loan upgrade. Tests: daily accrual; draw on day 29 → first payment day 60; 3 payments clear the balance; early repayment lowers later payments; a missed payment sells positions then savings; a draw on day 115 has 0 payments and counts against net worth. | `sim/loan.ts`, `sim/constants.ts`, `sim/game.ts`, `types.ts`, `persist/save.ts`, `ui/store.ts`, `loan.test.ts`, `monthly.test.ts` | `npx vitest run src/sim/loan.test.ts src/sim/monthly.test.ts` |
| B2 | `estimatedPaymentCents(state, defs)` and `previewLoanSale(state, defs)` (on `previewCopy`). Tests: the preview equals the real End day sale, and the real state is not changed. | `sim/loan.ts`, `loan.test.ts` | same |
| B3 | Loan UI and warnings (10.2). | `LoanPanel.tsx`, new `LoanDueBanner.tsx`, `Dashboard.tsx`, `DayTimeline.tsx`, `DayReport.tsx` | Browser: take a loan, step to payday with cash below the payment, see the 5-day warning, the banner preview, and the End day confirm; check the sale matches the preview |
| D1 | `src/sim/deposits.ts`: `interpretOpenDeposit`, `interpretBreakDeposit`, `settleDeposits` (maturity, called in `endDay` after savings), `depositValueCents`, `depositBreakValueCents`. Constants `DEPOSIT_TERMS_DAYS`, `DEPOSIT_TERM_BONUS_PERCENT`, `DEPOSIT_BREAK_PENALTY_PPM`, `DEPOSIT_MIN_CENTS`, `DEPOSIT_MAX_OPEN`. Commands wired in `applyCommand`. Interest counted in FI. Net worth includes deposits. Optional save key. Tests: rate fixed at opening; maturity into savings; FI receives the interest; break penalty; refusals (min, max 3, pending bill or payment, insufficient funds). | `sim/deposits.ts`, `deposits.test.ts`, `constants.ts`, `game.ts`, `fi.ts`, `types.ts`, `save.ts`, `store.ts` | `npx vitest run src/sim/deposits.test.ts src/sim/fi.test.ts` |
| D2 | Deposits in the cover check (`depositsCents`, break value) and as the last step of the loan forced sale (`forced: true`, latest maturity first). Tests: a bill is coverable only through a deposit, and the run does not end; a forced sale reaches a deposit after savings. | `monthly.ts`, `loan.ts`, `game.ts` (`assertPending` sum), tests | `npx vitest run src/sim/monthly.test.ts src/sim/loan.test.ts` |
| D3 | Deposits UI (10.3). The bill banner and the loan banner offer "Break deposit". | `Accounts.tsx` (or a new `Deposits.tsx`), `BillBanner.tsx`, `LoanDueBanner.tsx` | Browser: open 30/60/90, step to maturity, break one, pay a bill by breaking |
| G1 | Docs. `GAME_DESIGN.md`: section 6 Jobs (layoffs), section 12 loan numbers and FD as `[PROVISIONAL]`, and a change-log line. Guide pages: "Job security" on the Jobs page, loan schedule and deposits on the account page; exact numbers for account rules, rough terms for layoff odds. Overwrite `HANDOFF.md`. | `doc/GAME_DESIGN.md`, `src/ui/Guide.tsx`, `HANDOFF.md` | Read-through; `npm test` |

## 9. Decisions (user, 2026-11-07)
All seven questions were answered. Q1 yes. Q2 yes (freelance exempt). Q3 recommended (severance 0.5 month, no rehire). Q4 recommended (3 instalments, forced sale on a miss). Q5 recommended first (real-world-like rates; revisit after playtest). Q6 recommended (deposits cover bills and are last in a forced sale). Q7 yes (stress +8 on a confirmed notice).

Original questions:
1. **Net worth subtracts the loan (N0).** It is a bug fix, but it lowers scores of runs that ended with a loan. OK?
2. **Freelance analyst exempt from layoffs?** Recommended: yes, as its job-security trade-off.
3. **Layoff weight:** severance 0.5 month plus no rehire at that employer for the run (recommended), or severance 0.25 with rehire after 30 days?
4. **Loan instalments (5.3 B):** this extends the `[CONFIRMED]` "missed interest forces selling" to missed principal. Accept 3 paydays with a forced sale on a miss, or keep interest-only (option A)?
5. **Deposit rates:** real-world-like (A, about $40 on $3,000 for 90 days, a discipline and rate-lock tool) or game-scaled (B, a possible no-trading FI path)?
6. **Deposits count toward covering a bill** (break value) and are the last step of a loan forced sale. OK? The alternative is locked = untouchable, which can end a run while money exists.
7. **Stress from a layoff notice** (for example +8 on the decision day)? Decided yes.

## 10. UI changes (existing tokens and components only, see the global UI guide)

### 10.1 Layoffs
- **JobPanel:** each job card gets a "Layoff risk" badge (`Badges.tsx`: none / low / medium from the base chance, neutral chip with a text label) and a sector tag.
- **Notice card at the top of the Job card**, as key-value rows:
  - Status (Rumour / Confirmed), with an amber edge for rumour and red for confirmed, plus an icon and text, never colour alone.
  - Decision day and the countdown.
  - Last day.
  - Severance amount (tabular figures).
  - A one-line hint: "Switching before the last day forfeits severance."
- **NewsFeed:** a pinned, unbiased "Employer" item while a notice is open.
- **CalendarPanel:** an optional `employer` prop adds "Restructuring decision" and "Last day" rows.
- **DayReport:** lines for warning, confirm, drop, avoided, laid off and severance. A layoff day always opens the report (it emits `jobChanged`).
- **BillBanner:** on the layoff payday, one secondary line: "Your job at X ended today. Severance $Y paid."

### 10.2 Loan
- **LoanPanel**, as a key-value list:
  - Balance.
  - Limit / unused.
  - Rate.
  - Interest so far (accrued).
  - Next payment: amount + day + "n of m".
  - Payments left.
  - The take form shows the schedule before confirming ("3 payments of about $1,100 on days 30, 60, 90").
- **Amber warning row** from 5 days ahead when cash is below the next payment.
- **LoanDueBanner** on the payday. It shows:
  - the amount due and the shortfall;
  - an ordered table of what End day sells, right-aligned amounts;
  - the actions.
- **End day confirm** (DayTimeline) when a sale will happen.

### 10.3 Deposits
- In the Accounts panel, a "Fixed deposits" block.
- **Open form:** amount, a 30/60/90 segmented control showing each term's rate and the interest at maturity, a source selector (cash / savings), and the primary "Lock" button. When disabled it says why (minimum, max 3, bill or loan payment pending).
- **Table:** amount, rate, matures (day, plus "after the run" when > 120), interest at maturity. Numbers right-aligned, tabular.
- **Row action "Break":** a secondary action with an inline confirm showing "You get $X (−$Y penalty, interest lost)".
- **Empty state:** "No deposits. Lock cash for 30 to 90 days for a better rate."

## 11. Test plan
- **Unit tests next to source:** `layoffs.test.ts`, `deposits.test.ts`, updated `loan.test.ts`, `monthly.test.ts`, `fi.test.ts`, `jobs.test.ts`, `save.test.ts`, `oldSaves.test.ts` (an old save with an open loan, no `employer`, no `deposits`, loads, and its stream equals a fresh run's stream at the same day).
- **Determinism:** a test that runs the same seed twice with a job and identical commands and compares the `employer` state and log. A test that a jobless run and a warehouse run of the same seed have identical market hashes (`stateHash(state.market)`) on every day.
- **Architecture:** `tests/architecture.test.ts` passes. The new sim files import only `src/sim`, and the content file only sim types.
- **Harness:** `npm run sim -- --seed abc --days 120 --layoffs 200` (rates in 4.3). `npm run sim -- --seed abc --days 120 --batch 200 --strategy <name>` gives the same result as before (jobless, no loans). The `--care 30` output is unchanged from before the change.
- **Browser check (seed `demo`), one pass after Y5, B3 and D3:** a warehouse run to a notice; a loan to a forced-sale preview; a deposit opened, matured and broken; reload in between to check saves.

## 12. Optional follow-ups (not in the steps)
- A loan payment holiday after a layoff.
- High-interest savings (the other `[LATER]` account).
- Industry contacts hinting at restructuring earlier.
- Partial deposit breaks.
- Counting Health/Equipment in the loan limit.
