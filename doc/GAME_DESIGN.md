# Trading Simulation Living Game Design

Status: Active design. Direction and first-playable scope are confirmed. Most numbers and several rules are provisional defaults waiting for the user.  
Working title: Trading Sim (final title deferred)  
Portfolio brief: [docs/ideas/trading-simulation.md](../../docs/ideas/trading-simulation.md). Keep that brief aligned when this document's concept or status changes. The full idea index is [docs/ideas/README.md](../../docs/ideas/README.md).  
Options and rationale: [brainstorm/2026-10-21-core-design.md](brainstorm/2026-10-21-core-design.md). This document records the result and does not repeat the options. "Brainstorm §n" below points to a section there, and "Q n" points to a numbered open question there.

## How to read this document

Every rule carries a status tag. Do not treat a rule as decided unless it says `[CONFIRMED]`.

- `[CONFIRMED]` The user decided this. Changing it needs a new user decision.
- `[PROVISIONAL]` A default I proposed so the design is complete enough to plan. The user has not confirmed it. It can change without notice, and the first item in section 17 lists which to confirm first.
- `[LATER]` Confirmed to exist, but not in the first playable.
- `[OPEN]` No default yet.

All money amounts use `E`, the base monthly expenses at the lowest lifestyle. Every other number in this document is a tuning hypothesis, not a balance claim.

## 1. High Concept

A simulation about trading fictional stocks while managing a life. It is assumed to be single-player, which is still `[PROVISIONAL]` (Q 18).

1. `[CONFIRMED]` The market is simulated, not a replay. Prices move with volatility, and news, events, company moves and macro moves come from events that happen at per-day probability rates.
2. `[CONFIRMED]` The player trades and invests using price movement, news and other information. Information can be partial, wrong or biased.
3. `[CONFIRMED]` The player's job, joblessness and lifestyle are both the progression and the constraint. They set the time and capital available for trading.
4. `[CONFIRMED]` A run lasts about 30 minutes and is won by reaching financial independence (FI): passive income covers expenses, so the player could quit the job.
5. `[CONFIRMED]` Two stats, energy and stress, change what the player sees. The game uses them to simulate bad trading psychology.

## 2. Design Pillars

### The market is driven by probable events `[CONFIRMED]`

Price movement is simulated. Each asset has a hidden fair value that events move, and the price follows it. Events have per-day probabilities. The direction chances of an event depend on the event and on the environment (economy, policy).

### Information is part of the game `[CONFIRMED]`

What the player knows, and when, is part of the design. The player sees a macro calendar and rumours with source reliability. Rumours can be wrong. The player can also be misled by their own state, and the game tells them when that is happening.

### Life is the progression and the constraint `[CONFIRMED]`

A job, being jobless and lifestyle upgrades are how the player progresses. The same life layer sets trading time and usable capital.

### Bad psychology is simulated, and fairly `[PROVISIONAL]`

The pillar wording is mine. The rules it summarizes in section 9 (the stat purpose, telegraphing, the bias rule) are confirmed.

Overtrading, overleveraging and confirmation bias are the problems the stat system models. Distortion is telegraphed, capped and learnable. It never changes the market itself.

### Leverage is dangerous but bounded `[PROVISIONAL]`

The pillar wording is mine. The rules it summarizes in section 7 (5x cap, faster liquidation, losses never exceed the account, a wipe-out penalty) are confirmed.

High leverage is available, and losses cannot exceed the account. The game guarantees the cap by design, and a wipe-out has a cost, so extreme leverage is never free.

## 3. Player Role

- `[CONFIRMED]` The player trades and invests across fictional instruments, long and short.
- `[CONFIRMED]` The player manages their own money: salary, deposits into a trading account, monthly expenses, and a savings account.
- `[CONFIRMED]` The player chooses a job from a menu, or stays jobless, and upgrades lifestyle.
- `[PROVISIONAL]` The game is single-player (Q 18).
- `[CONFIRMED]` Each day is simulated as sections or hours, and the player can skip sections (section 4).

## 4. Time Model and Run Structure

### Time

- `[CONFIRMED]` Time still advances one day at a time, inside a run of about 30 minutes.
- `[CONFIRMED]` A played day has three sections: sleep, work, and trading while the stock market is open (2026-10-22). This replaces the earlier time-slot budget.
- `[CONFIRMED]` Not enough sleep worsens the player's mental state. That state is the energy and stress stats (section 9). How many hours count as enough, and the size of the penalty, are open.
- `[CONFIRMED]` A job occupies the work section. Being jobless leaves that section free.
- `[CONFIRMED]` Managing other things does not occupy a section. Eating, drinking, upgrading or downgrading lifestyle, and similar actions are available while the day is playing.
- `[CONFIRMED]` Skipping is the gap after work when there is nothing to do. The day jumps ahead until the stock market opens.
- `[OPEN]` Clock times for sleep, work, and market open and close. Whether other empty gaps can be skipped, such as after the market closes. Whether management actions are available during work, or only outside it.
- `[PROVISIONAL]` With no job, the skip runs from the end of sleep until the market opens.
- `[PROVISIONAL]` A day has no intraday price movement. The player acts at the current prices, then the day ends. Prices, events and accounts update at the end of the day.
- `[PROVISIONAL]` During market hours the player can place any number of orders.
- `[PROVISIONAL]` Reading the news and verifying the true feed are management actions, available while the day is playing. Without reading the news, the player sees only the macro calendar and the single top headline.

### Run structure

- `[CONFIRMED]` Fixed-length runs of about 30 minutes.
- `[CONFIRMED]` First values to try: a run is 120 game days, and a game month is 30 days, so a run has 4 months. These can be tuned after play.
- `[PROVISIONAL]` Quiet days (no events, no margin warning, no scheduled item) can be skipped, in the same way as a section of a day.
- `[PROVISIONAL]` Monthly cycle, on each 30th day: salary is paid to cash, monthly expenses are charged, savings interest is paid.
- `[PROVISIONAL]` A run ends on an FI win, when the player is out (section 8), or at day 120.

## 5. Market Model

### Assets

- `[CONFIRMED]` Fictional stocks only at the start: about 4 stocks in 2 sectors, plus an index. A currency pair can be added later.
- `[PROVISIONAL]` Sector A is growth-sensitive. Sector B is rate-sensitive. Two stocks in each. Names are placeholders.
- `[PROVISIONAL]` The index is a weighted average of the four stocks. It is tradable like a stock, and has no company events.
- `[PROVISIONAL]` Whole shares only.

### Hidden fair value and price

- `[CONFIRMED]` Each asset has a hidden fair value. Events move it. The price follows it.
- `[PROVISIONAL]` Each day the price moves a fraction of the way toward fair value, plus noise from the asset's volatility. A daily price-move cap applies (section 7).
- `[PROVISIONAL]` A move above the cap is not lost. The rest of the gap stays between price and fair value and plays out over the following days.
- `[PROVISIONAL]` Event effects add to fair value, and have a magnitude, a duration and a decay shape. Effects stack, with a per-day limit on the total change in fair value.

### Events

- `[CONFIRMED]` Every event type has a per-day chance.
- `[CONFIRMED]` The direction chances of an event depend on the event itself and on the environment (economy, policy).
- `[CONFIRMED]` Event sources: news, general events, company moves, macro moves.
- `[PROVISIONAL]` An event type has: scope (one stock, one sector, or the whole market), a per-day chance, direction chances (up, down, no effect), a magnitude range, a duration and decay, and how it is shown (calendar, rumour, headline).
- `[PROVISIONAL]` First playable: about 15 to 25 event types, for example earnings beat or miss, product launch, scandal, management change, regulation, supply shock, demand shift, policy rate decision, growth data, inflation data.
- `[PROVISIONAL]` The player cannot change event rates.

### Macro calendar

- `[CONFIRMED]` The player sees a macro calendar.
- `[PROVISIONAL]` Scheduled items show their date in advance but not their outcome: a monthly policy rate decision (hold, up, down) and monthly growth and inflation releases.

### Rumours and source reliability

- `[CONFIRMED]` Rumours come with source reliability. Rumours can be wrong.
- `[PROVISIONAL]` A rumour names a source, a claimed event and a claimed direction. It arrives 1 to 3 days before the event it claims. Some rumours are false, and no event follows.
- `[PROVISIONAL]` Reliability is a coarse tier label (high, medium, low). Labels are honest, but each tier has a hidden hit rate.
- `[OPEN]` How the player learns the hit rates of sources (idea doc open question).
- `[PROVISIONAL]` Headlines confirm an event on the day it happens. The price is already partly moving.

### Environment

- `[CONFIRMED]` The environment has three variables for now: growth, inflation and policy rate. It is designed to be expandable later (wars, news shocks, technology improvements).
- `[PROVISIONAL]` Each variable is a data entry, so more can be added without new code paths.
- `[PROVISIONAL]` Policy rate changes on calendar dates. Growth and inflation drift slowly and get nudged by events. The last released values are visible to the player.
- `[PROVISIONAL]` The environment changes event chances and direction chances through a lookup per event type. For example, high inflation raises the chance of a rate hike, and a rate hike hurts Sector B more than Sector A.
- `[PROVISIONAL]` The policy rate also sets the savings rate and, later, loan interest and margin borrowing cost.

## 6. Life Layer

### Money accounts

- `[CONFIRMED]` The player sees and types US dollars. The simulation keeps integer cents. $1 is 100 cents, so 1E is $1,000. Cash pays life costs. The trading account pays orders.
- `[CONFIRMED]` The first playable has three accounts: cash, a trading account and a savings account.
- `[CONFIRMED]` The savings account has low interest, no withdrawal limits, and instant free transfers.
- `[PROVISIONAL]` The savings rate is a small fixed spread below the policy rate.
- `[PROVISIONAL]` Transfers between cash, trading and savings are instant and free.
- `[PROVISIONAL]` Starting money is about 6E, split 3E in cash and 3E in the trading account. Tuning will set the real value.
- `[CONFIRMED]` Gains are not taxed at first.
- `[LATER]` FD and high-interest savings accounts (section 12).

### Jobs

- `[CONFIRMED]` There is a job menu from the start with 4 to 5 jobs. Each job has pay, hours of the day it occupies, one requirement and one perk.
- `[CONFIRMED]` Being jobless is allowed, and leaves all slots free.
- `[PROVISIONAL]` Jobs also carry an energy cost and a stress cost per day.
- `[PROVISIONAL]` The player can switch jobs freely, with a short notice period (3 days).
- `[PROVISIONAL]` Placeholder jobs:

| Job | Slots | Pay per month | Requirement | Perk | Energy and stress cost per day |
| --- | --- | --- | --- | --- | --- |
| Shop assistant (part-time) | 1 | 0.6E | None | Staff discount: 5% off monthly expenses | 5 and 2 |
| Office clerk | 2 | 1.1E | Basic course | Steady routine: stress recovers 10% faster | 10 and 8 |
| Night-shift warehouse | 2 | 1.3E | None | Quiet breaks: one free news read a day | 20 and 12 |
| Trading-floor assistant | 2 | 1.0E | Finance course | Industry contacts: one extra rumour source | 12 and 15 |
| Freelance analyst | 1 | 0.8E | Finance course | Analyst tools: fewer noise items in the feed | 6 and 6 |

### Expenses and lifestyle

- `[CONFIRMED]` Lifestyle can be upgraded, and lifestyle sets trading time and usable capital.
- `[CONFIRMED]` The player pays monthly expenses.
- `[PROVISIONAL]` Upgrades change trading tools and conditions, and raise monthly expenses.
- `[PROVISIONAL]` The lowest lifestyle costs 1E a month.
- `[PROVISIONAL]` First-playable upgrades:
  - Home (3 tiers): faster energy and stress recovery. Each tier adds about 0.15E a month.
  - Information feed (2 tiers): more rumour sources, and a cleaner feed. Each tier adds about 0.1E a month.
  - Courses (Basic, Finance): a one-time cost of about 0.5E each. They unlock job requirements and add no monthly cost.
- `[CONFIRMED]` The player can downgrade lifestyle as ordinary asset management, the same way they manage other assets (2026-10-22).
- `[CONFIRMED]` A downgrade does not return the money spent on the upgrade. It only lowers later bills.
- `[CONFIRMED]` A downgrade cannot be used at the moment a bill cannot be paid, to shrink that bill. The bill uses the lifestyle cost already in effect.

## 7. Trading Rules

### Orders and costs

- `[CONFIRMED]` The player can go long and short.
- `[CONFIRMED]` Trades cost a percentage fee plus a spread.
- `[PROVISIONAL]` Orders are market orders that fill at the current price during a trade session. No limit or stop orders in the first playable.
- `[PROVISIONAL]` The fee is a global percentage per trade. The spread is set per asset and widens on event days.
- `[PROVISIONAL]` Short positions pay a per-asset daily borrow fee. Leveraged positions pay daily interest on the borrowed amount, at the policy rate plus a margin. Both reduce trading profit.

### Leverage and margin

- `[CONFIRMED]` Leverage has a cap of 5x in the first playable, and liquidation is faster than a gentle margin call.
- `[PROVISIONAL]` The cap applies to every asset equally.
- `[PROVISIONAL]` Margin ratio is account equity divided by total position value. At 5x the ratio starts at 20%.
- `[CONFIRMED]` A warning appears at a 15% ratio, shown on a visible margin meter. Liquidation happens when the end-of-day ratio is 10% or lower.
- `[PROVISIONAL]` Liquidation closes the worst-performing position first, and continues until the ratio is back above the warning level.

### Loss cap guarantee

- `[CONFIRMED]` Losses cannot exceed the account. There is no negative-balance debt.
- `[CONFIRMED]` The guarantee has two parts: a daily price-move cap tied to the leverage limit, and a small backstop. The third part, a ladder penalty on a wipe-out, was removed on 2026-10-22 because there is no failure ladder (section 8).
- `[CONFIRMED]` Daily price-move cap: a single day's price change is limited to 8%, below the 10% liquidation ratio, with room for fees and spread. An adverse move no larger than the ratio cannot take equity below zero before the end-of-day check.
- `[PROVISIONAL]` Backstop: equity is floored at zero, and any rounding or spread shortfall is written off. The design test is that the backstop is never used beyond rounding.
- `[PROVISIONAL]` A wipe-out is a liquidation that leaves the trading account below 10% of its value at the start of the day. It does not end the run. It drains the trading account and adds a stress spike. The run ends only under section 8.
- `[PROVISIONAL]` The loss cap check is done once per day at the end-of-day check. Intraday checks are not part of the first playable.

## 8. Goal and Failure

### Financial independence win

- `[CONFIRMED]` The win condition is financial independence: all passive income (trading profit and interest), averaged over the last in-game month, covers expenses.
- `[PROVISIONAL]` Salary does not count as passive income. This is implied by "passive", but not stated by the user.
- `[PROVISIONAL]` Passive income over the last 30 days is the net trading result (realized profit minus losses, fees, spread, and borrow and margin interest) plus savings interest received.
- `[PROVISIONAL]` Unrealized profit does not count, so leverage cannot fake a win.
- `[PROVISIONAL]` Expenses are the current lifestyle's monthly cost. Buying upgrades raises the bar.
- `[PROVISIONAL]` The condition must hold for 5 days in a row before the win triggers.
- `[PROVISIONAL]` The job does not have to be quit for the win. This is a rule to confirm, because "so the player can quit" could also mean quitting is required.
- `[PROVISIONAL]` The rolling average and its window are shown on screen, with the expenses it must cover.
- `[PROVISIONAL]` Score: on a win, higher for earlier days and larger net worth. Without a win, based on net worth at the end. Bankruptcy scores lowest. Scoring details are open.

### Being out

- `[CONFIRMED]` There is no multi-step downgrade ladder. The earlier "soft ladder" decision is replaced (2026-10-22).
- `[CONFIRMED]` The run ends as a loss when the player has no usable money left and cannot pay the next expenses.
- `[CONFIRMED]` The game does not sell or transfer for the player. To cover a bill the player chooses: sell positions, withdraw from another account, or take a bank loan (section 12). If they still cannot cover it, the run ends.
- `[PROVISIONAL]` In the first playable the other account is savings. FD and high-interest savings are later, and become further places to withdraw from.
- `[CONFIRMED]` Lifestyle can be downgraded at other times. It is not one of the choices for covering a bill that is already short.

## 9. Energy, Stress, and Perception

This is the largest first-playable system after trading. Options and the reasoning are in Brainstorm §3.9.

### Stats

- `[CONFIRMED]` There are two separate stats, energy and stress.
- `[PROVISIONAL]` Both run from 0 to 100. Energy starts at 80 and stress at 20.
- `[CONFIRMED]` Food and drink are consumables. They cost money. Using one does not take a section of the day.
- `[CONFIRMED]` Some restore energy, some restore stress, and some restore both. Each item has its own restore amounts and its own cost.
- `[OPEN]` The item list: names, costs, and the energy and stress each one restores.
- `[CONFIRMED]` Not enough sleep worsens energy and stress (section 4).
- `[PROVISIONAL]` Daily change: energy falls by the job's energy cost and by a short-sleep penalty. Stress rises by the job's stress cost and by that same penalty. Consumables are the recovery. The Home lifestyle bonus to recovery is on hold until the item list exists.
- `[PROVISIONAL]` Stress also rises on a large daily drawdown (5% or more of the trading account) and on a margin warning day.
- `[PROVISIONAL]` The warning state starts below energy 40 or above stress 60. Effects scale from the threshold to the extreme.

### Long-term targets and first-playable subset

- `[CONFIRMED]` The long-term targets are four kinds of distortion:
  - Numbers: prices and P&L shown wrong.
  - News: misread, fake or missing.
  - Candles: a wrong or ghost candle.
  - UI: blur, delays and order misclick-style errors.
- `[CONFIRMED]` First playable (option P3): both stats, a meter with a visible tell, cosmetic effects, and biased news and posts.
- `[LATER]` Number distortion, candle distortion and UI order errors.
- `[PROVISIONAL]` The data model holds all four types, so they can be switched on one at a time.
- `[PROVISIONAL]` Which stat drives what: stress drives biased news. Energy drives the cosmetic effects (blur and short display-only delays). Later, energy drives number and candle errors, and stress drives order errors and overtrading urges.

### Telegraphing

- `[CONFIRMED]` Distortion is telegraphed: a visible warning state, and the distortion has a subtle tell.
- `[PROVISIONAL]` The warning state is an always-visible meter for each stat that changes color in the warning zone.
- `[PROVISIONAL]` The tell is one consistent small icon and tint on any distorted item, the same for every distortion type, and the primer explains it.

### Bias rule

- `[CONFIRMED]` Biased news favors the player's open positions.
- `[PROVISIONAL]` In practice, long positions get more bullish items and short positions get more bearish ones.
- `[CONFIRMED]` Only a capped share of items is re-weighted.
- `[CONFIRMED]` The macro calendar is always unbiased.
- `[CONFIRMED]` A verify action shows the true feed.
- `[PROVISIONAL]` The cap is at most 25% of the visible feed items at maximum stress, and it scales with stress. It covers every item that was re-weighted, hidden or generated.
- `[PROVISIONAL]` Re-weighting means changing which items are shown and in what order. Generated social posts are display-only content with a visible source tag and low reliability. They are never market events.
- `[PROVISIONAL]` Verify is a management action, available while the day is playing, and shows that day's unbiased feed. It does not occupy a section.
- `[LATER]` The same rule and cap apply to the direction and percentage hints shown with the book.

### Fairness measures

- `[PROVISIONAL]` Display-only principle: distortion never changes events, fair values, prices or fill rules. In the first playable this holds fully. The one later exception is UI order errors, which change the order the player submits (Q 43). The rule then reads "the market, events and fill rules are never changed".
- `[PROVISIONAL]` Distortion uses its own random stream, so a seeded market is identical whatever the stats do.
- `[PROVISIONAL]` An admin log records, for every distorted item, the true value and the shown value.
- `[PROVISIONAL]` Accessibility toggles exist for visual effects (blur, shake, delays).
- `[PROVISIONAL]` These four measures were carried over from the working design (Brainstorm §3.9) and are not yet explicitly confirmed by the user.

## 10. Run Modes

- `[CONFIRMED]` There are two modes. Seeded mode is a repeatable challenge. Non-seeded mode is normal play. Scores are kept separately.
- `[CONFIRMED]` The simulation must be reproducible from a seed.
- `[PROVISIONAL]` Any seed code can be entered in seeded mode, and retries are allowed with a separate best score.
- `[PROVISIONAL]` Non-seeded mode picks a random seed. Every run stores its seed, and the seed is shown at the end of every run.
- `[PROVISIONAL]` Separate random streams for the market, events and distortion.

## 11. Teaching and Feedback

- `[CONFIRMED]` The first playable teaches with a one-screen primer and an end-of-day "what moved prices" summary. The book is later (section 12).
- `[PROVISIONAL]` The primer covers the basic news-to-price rules, sentiment, how rumour reliability works, the margin meter, and the warning state and tell.
- `[PROVISIONAL]` The summary shows which events fired, which assets moved and by how much. It does not show the hidden fair value.
- `[PROVISIONAL]` The summary shows true data even when the player's view is distorted. This makes it a free verify channel and weakens distortion, so the user may prefer that it costs a slot or is limited (Q 48).
- `[PROVISIONAL]` The summary shows every day, or only on days with events.
- `[PROVISIONAL]` Debug and admin: a data-flow log of every event, roll, effect and price change (developer view).

## 12. Bank Loan and Later Systems

### Bank loan

The loan was going to wait for a later version. On 2026-10-22 it became one of the three ways to pay a bill, so it is in the first playable.

- `[CONFIRMED]` The player can borrow from a bank loan, one loan at a time.
- `[CONFIRMED]` The limit is set by job and lifestyle.
- `[CONFIRMED]` Interest follows the policy rate.
- `[CONFIRMED]` Missed interest forces selling: trading positions (worst-performing first), then savings. It does not downgrade lifestyle. A missed payment is a bill the player cannot cover, and lifestyle downgrade is not a way to pay one (section 6).
- `[OPEN]` Loan size, term, the margin over the policy rate, early repayment, whether loan money can be used for trading, and the warning before a forced sale.

### Later systems

- `[LATER]` FD and high-interest savings accounts. `[OPEN]` Their lock periods, penalties, rates and limits.
- `[LATER]` The in-game book: teaches news-event impact, including sentiment and some rare cases. After the book, either the player judges direction alone or the game shows the possible directions. `[OPEN]` Which of those two (Q 27 and 32). Hint direction and percentage can also be skewed by bad stats.
- `[LATER]` Number distortion, candle distortion and UI order errors (section 9).
- `[LATER]` Job loss through telegraphed layoffs.
- `[LATER]` Meta-progression: there is none in the first playable, and unlocks may come later.
- `[LATER]` A currency pair as a new asset.

## 13. Presentation and Technical Direction

- `[PROVISIONAL]` The trade screen is a terminal: a candle chart, an order rail, and a bottom subpanel for positions, life, news, and the day book. A candle's open is the previous close. Its high and low are the ends of the printed move, so one day has no wick past the body. 1W groups 7 days and 1M groups 30, and those groups can show a wick. 15m, 1H, and 4H are not printed. Volume is not printed.
- `[PROVISIONAL]` A short "this is a simulation, not financial advice" note.
- `[CONFIRMED]` Stack: TypeScript, React, and Vite (2026-10-22). The simulation is plain TypeScript, shared by the game and a Node harness. Tests use Vitest. Saves are versioned JSON in browser localStorage. The project stays in `trading-sim/` and does not import `rpg/`.
- `[PROVISIONAL]` Platform is a local browser app. Desktop wrapping is later.
- `[CONFIRMED]` Developer rule: new functionality exposes its data flow with debug output (the admin log in sections 9 and 11).

## 14. First Playable Scope

### Primary question

`[PROVISIONAL]` Is it fun to read incomplete, sometimes biased information and decide whether to work, read, or trade, while money, a loan, and your own mental state pull against each other?

### Content

- `[CONFIRMED]` About 4 fictional stocks in 2 sectors, plus an index.
- `[CONFIRMED]` A job menu of 4 to 5 jobs, or being jobless.
- `[CONFIRMED]` Cash, trading and savings accounts.
- `[CONFIRMED]` Shorting and 5x leverage.
- `[PROVISIONAL]` About 15 to 25 event types and one macro calendar.

### Included systems

- `[CONFIRMED]` A skippable day, and food and drink consumables.
- `[CONFIRMED]` Hidden fair value, per-day event chances, macro calendar, and rumours with source reliability.
- `[CONFIRMED]` Environment with growth, inflation and policy rate.
- `[CONFIRMED]` Percentage fee plus spread.
- `[CONFIRMED]` Leverage with faster liquidation and the loss cap guarantee.
- `[CONFIRMED]` A bank loan as one way to pay a bill, alongside selling positions and withdrawing from savings.
- `[CONFIRMED]` FI win over a one-month rolling window, and a loss when the next expenses cannot be paid.
- `[CONFIRMED]` Energy and stress with a meter and visible tell, cosmetic effects, and biased news and posts.
- `[CONFIRMED]` Seeded and non-seeded modes with separate scores.
- `[CONFIRMED]` One-screen primer and an end-of-day summary.
- `[PROVISIONAL]` Lifestyle upgrades (Home, Information feed, Courses).
- `[PROVISIONAL]` An admin log of data flow, including true versus shown values.

### Deferred from the first playable

- FD and high-interest savings accounts
- The book, hint direction and percentage, and rare cases
- Number distortion, candle distortion and UI order errors
- Job loss through layoffs
- Meta-progression and unlocks
- Currency pair or other new assets
- Limit and stop orders
- Endless or sandbox mode
- Desktop wrapping. The browser stack and localStorage saves are confirmed in section 13.

## 15. First Playable Success Criteria

`[PROVISIONAL]` The first playable is successful when a player can:

1. Say why a price moved after the fact, using the news feed and the end-of-day summary.
2. Face a real daily choice between work, reading the news, resting and trading.
3. Complete a run in about 30 minutes.
4. Play a jobless run and an employed run, and find both viable and different.
5. See the margin meter and a liquidation coming, and understand a liquidation after it happens.
6. Notice the warning state and the tell, and use verify to see the true feed.
7. Recognize their own confirmation bias at least once, and say the game showed it fairly.
8. Reach FI in a skilled run, and fail in an average run, without it feeling arbitrary.
9. Replay a seeded run and get the same market whatever the stats do.
10. Report that the game is interesting enough to replay.

## 16. Major Design Risks

### Price feels random, not learnable

The game needs signal in a noisy market. Hidden fair value, readable event rules, honest reliability tiers, the primer and the end-of-day summary are the mitigations.

### Price feels too predictable

A daily price-move cap means a big event plays out over several days, so the player can ride the move after a capped day. Noise, partly priced-in news, false rumours and overlapping events should keep it open. Test for it.

### Exploits

Free trading, trading loops, a free option on extreme leverage, and farming small gains are all possible. The fee plus spread, the borrow costs, the wipe-out penalty and the daily move cap are the mitigations.

### Leverage plus distortion in a 30-minute run

5x leverage, faster liquidation and stress effects can end a run in one bad day. Safeguards: the margin meter, the daily move cap, a simulation script that runs many seeded days and reports blow-up rates, and capped distortion while highly leveraged (all provisional).

### Bias that feels rigged

If the bias rule is hidden or too strong, players feel cheated rather than taught. The stated rule, the cap, the tell, the warning state and the verify action are the mitigations.

### Summary versus distortion

If the end-of-day summary always shows true data, it undercuts distortion. This needs a decision (Q 48).

### FI is gamed or unreachable

A one-month window can be met by one lucky month. The realized-only rule, net trading result and a hold period are the mitigations. Tuning may still make FI too easy or too hard.

### Job versus trading is a dominated choice

If one option is always best, the life layer has no tension. Tune pay, slots and the stat costs, and playtest both paths.

### Pacing

120 days in 30 minutes leaves about 15 seconds a day. Four slots of decisions per day may be too many. Fast-forward on quiet days is the mitigation.

### Information overload

A feed, a calendar, rumours, two stat meters, a margin meter and accounts can overwhelm. Few assets, filters, the day summary and the primer help.

### Scope

The first playable is already large (leverage, stats, jobs, accounts, two modes). New systems must wait for the planner's staging.

### Determinism with distortion

If distortion shares a random stream with the market, seeds stop being repeatable. A separate stream is the rule.

## 17. Open Questions

### Confirm first

These are provisional defaults that shape other systems. The user should confirm or change them, in this order:

1. The consumable list: names, costs, and how much energy and stress each item restores (section 9).
2. Loan numbers: size, term, and the margin over the policy rate (section 12).
3. FI details: realized only, net result, hold of 5 days, and whether the job must be quit (Q 24).
5. Liquidation order, and whether a wipe-out has any penalty beyond the lost equity (section 7).
7. Which stat drives which effect, the 25% bias cap and the verify cost (Q 38, 39).
8. The tell and the fairness measures (Q 41, 15h).
9. Whether the end-of-day summary shows true data (Q 48).
10. The placeholder jobs, lifestyle upgrades and starting money (Q 28).
11. Seed mode details (Q 47) and environment dynamics (Q 42).

### Can stay open

- Savings rate, fee and spread values (Q 25, 30).
- Starting capital, as a tuning value. The 4-slot day is replaced (section 4).
- How the player learns rumour source hit rates.
- Concrete event type list and per-day chances.
- Art and UI details, and the final title.
- Platform details beyond the local browser app, and the save-file schema (Q 22). The stack is confirmed in section 13.
- The later systems in section 12.

## 18. Next Design Step

1. The user reviews the provisional defaults in section 17, in the order listed, and confirms or changes them. Confirmed items change their tag here and are logged in the brainstorm doc's Decisions.
2. Execute the first-playable plan, [plans/2026-10-22-first-playable.md](plans/2026-10-22-first-playable.md), one step at a time, starting with Step 1. The stack is confirmed in section 13.
3. Return to this document to resolve questions that the plan or a simulation run surfaces.

Balance values are testable starting hypotheses. Provisional rules are not decisions.

## 19. Changelog

- 2026-10-24: The trade screen uses a chart, an order rail, and a bottom subpanel. Chart open, high, low, and close come from the daily closes already stored. 1W and 1M group those days. Intraday timeframes and volume are not printed.
- 2026-10-24: The player-facing unit is US dollars ($1 = 100 stored cents; 1E = $1,000). Open market stays on the same day and does not move prices. End day sleeps into the next day and moves prices. Cash at $0.00 cannot pay food, lifestyle, courses, bills, or a loan repayment. An order still uses the trading account.
- 2026-10-22: Confirmed the stack: TypeScript, React, and Vite. The simulation is plain TypeScript, tests use Vitest, and saves are versioned JSON in localStorage. The app stays in `trading-sim/` and does not import `rpg/`.
- 2026-10-22: Wrote the first-playable plan, [plans/2026-10-22-first-playable.md](plans/2026-10-22-first-playable.md). It recommends a tech stack for the user to decide and uses placeholder values, labeled provisional in the plan only, for open items such as the clock, sleep, consumables and loan numbers. No rule in this document changed. Section 18 now points at the plan.
- 2026-10-22: A played day is sleep, work, and trading while the market is open. Not enough sleep worsens energy and stress. Eating, drinking, and lifestyle changes are available while the day is playing and do not occupy a section. Skipping jumps from the end of work, when there is nothing to do, until the stock market opens.
- 2026-10-22: A lifestyle downgrade only lowers later bills. It does not return the money spent on the upgrade.
- 2026-10-22: Lifestyle can be downgraded as ordinary asset management. It cannot be used to shrink a bill that is already short, and a missed loan payment does not force a lifestyle downgrade.
- 2026-10-22: Paying a bill is the player's choice: sell positions, withdraw from another account, or take a bank loan. Lifestyle cannot be downgraded to shrink the bill. Food and drink are consumables that cost money and do not take part of the day; items restore energy, stress, or both, each with its own amounts and cost. The bank loan moves into the first playable because it is one of those choices.
- 2026-10-22: Replaced the failure ladder. The run ends when the player has no usable money and cannot pay the next expenses. Stress recovery is a simple food and drink system. A day is simulated as skippable sections or hours, replacing the time-slot budget. Accepted 120 game days and a 30-day month as the first trial. Confirmed the 15% margin warning, 10% liquidation, and 8% daily price-move cap. Removed the wipe-out ladder penalty.
- 2026-10-21: First draft. Confirmed decisions from the brainstorm (batches 1 to 6, plus the loss cap guarantee and the bank loan moving to a later version) are tagged `[CONFIRMED]` or `[LATER]`. Everything else is tagged `[PROVISIONAL]` or `[OPEN]`.
