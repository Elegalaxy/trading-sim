# Trading simulation: core design brainstorm

- Date: 2026-10-21
- Session: 1 (scoping the core design and surfacing key decisions)
- Status: brainstorm. Decisions are in section 5. Later revisions live in `trading-sim/doc/GAME_DESIGN.md`. Where the two disagree, the design doc is current.
- Related: [docs/ideas/trading-simulation.md](../../../docs/ideas/trading-simulation.md)

## 1. Question

What should the core design of the trading simulation be, across six areas (time model, starting market, event and news system, life layer, goal and structure, first playable), so that the developer can pick directions and move to planning?

## 2. Context

### Concept as stated

A simulation where the player trades market pairs. Prices move with simulated volatility. News, events, company moves, and macro-economic moves all come from events that occur at set probability rates. The player trades based on movements, news, and info. The player can have a job or be jobless, which affects available trading time and usable capital, and has an upgradable lifestyle.

### Stated goals (used to compare options)

These come from the idea doc pillars and the user's concept.

- **G1. Probable events drive the market.** Simulated, not a real-exchange replay.
- **G2. Information is part of the game.** What the player knows, and when, matters.
- **G3. Life is progression and constraint.** Job, joblessness, and lifestyle are what the player advances, and they set trading time and capital.
- **G4. Solo developer.** Small scope, no tech stack yet, no code yet.
- **G5. Learnable, not just random.** Not stated by the user. This is my addition, flagged here so it can be rejected. A trading game where outcomes feel like a coin flip has no skill, so the design should let a player get better at reading the situation.

### Project facts

- Single-developer project. `trading-sim/` is empty except `doc/`.
- One git repo per game, created later by the user.
- Idea doc status is `active`. Its open questions overlap with this session. Nothing in this brainstorm conflicts with the idea doc or the rules.
- The RPG design doc uses numbered sections, pillars, a "first playable" section with a primary question and success criteria, and open questions and risks. This doc follows a similar shape, and the future `GAME_DESIGN.md` for this game can reuse it.

### Terminology flag

The concept says "market pairs". A pair can mean an FX-style pair (currency A against currency B) or just "a tradable instrument". This changes the asset options. It is listed as the first question in section 7.

## 3. Options

Every area has options that genuinely differ, a recommendation, and a note on what would change it. Costs are rough solo-developer effort: S is days, M is a couple of weeks, L is a month or more.

### 3.1 Time model

How game time flows, and how it meets job hours (the time the player has available to trade).

| Option | What it is | Fit to goals | Cost | Main risk | Rules out |
| --- | --- | --- | --- | --- | --- |
| A. Real-time (1:1) | The market ticks live. The job blocks real hours (for example, you cannot trade 9 to 5). | Strong realism. Poor fit to G3 because the life layer becomes waiting. | M | Players wait around. Sessions are tied to the real clock. | Short sessions, fast career progression |
| B. Accelerated continuous clock | A game day lasts a few real minutes, with pause and speed controls. Work hours are windows when the market runs but trading is blocked or limited. | Live tension. Good for G1 and G2. Time pressure is felt directly. | M | Real-time pressure punishes slow readers. Input and balance are harder to tune. | Deep thinking per decision unless pause is free |
| C. Day-by-day turns with a time budget | Each day has N time slots (for example 4). A job spends slots. Remaining slots buy actions: check news, research, trade. The day then resolves and prices update. | Best fit to G3: hours become a visible budget. Easy to read. Deterministic to debug. | S | Can feel like a spreadsheet. Intraday price action is lost. | Scalping and fast reaction skill |
| D. Hybrid: turn days, with a short live "market window" | Turn-based days, but the unblocked part of the day plays as an accelerated live session. A job shrinks or removes that window. | Combines G3 clarity with live trading feel. | L | Two systems to build and balance. | Cheap first playable |
| E. Accelerated clock plus offline progress | Like B, but the market and life continue while the game is closed, with limit and stop orders acting for the player. | Makes "I'm at work" real. Pairs with the RPG's offline design if it exists. | L | Hard to balance. Needs persistence. Offline results can feel unfair. | Easy debugging, strict determinism |

**How each interacts with job hours**

- A and B: the job is a time window where trading is disabled or limited. The player must pre-place orders (limit and stop). That is a good skill expression but needs an order system.
- C: the job removes slots. It is the most legible and the simplest to build.
- D: the job shrinks or removes the live window. Unblocked days run the live window, and blocked days only allow pre-set orders.
- E: the job is the real-world absence.

**Recommendation: C (day turns with a time budget) for the first playable, and keep the data model compatible with D.** It makes the job-versus-trading constraint obvious (G3), it is the cheapest (G4), and it makes the price model easy to test. Intraday movement can come later as D.

**What would change it:** if the developer wants a live-feeling trading game, B or D. If the developer wants a game played in short bursts across a day, E.

**Smaller related choices**

- Does a day include an overnight price gap? Recommendation: yes. It makes information received after hours matter.
- Do weekends and market holidays exist? Recommendation: skip them at first.
- Is there an "end day" button, or do actions run out automatically? Recommendation: an explicit button.

### 3.2 Starting market

Which assets exist at the start, how many, and real or fictional tickers.

| Option | What it is | Fit to goals | Cost | Main risk | Rules out |
| --- | --- | --- | --- | --- | --- |
| A. Small fictional stock market | 4 to 8 fictional companies in 2 to 3 sectors, plus one index. Company moves and sector news map naturally. | Strong G1 and G2. Company moves are easy to model. | S | Less "pairs" feel. | FX or crypto flavour at the start |
| B. Fictional currency pairs | 2 to 3 fictional countries, 2 to 3 pairs between them. Macro moves (rates, growth, inflation) directly drive price. | Fits "pairs" literally. Macro system is the star. | M | "Company moves" has no home. Hard for non-FX players to read. | Company-level events |
| C. Mixed fictional mini-economy | Stocks in a fictional country, one currency pair, one commodity. Macro affects all of them differently. | Richest for G2 and the full concept. Shows every named driver. | L | Too much to balance and to read at the start. | Cheap first playable |
| D. Real tickers, simulated prices | Real names (for example well-known stocks), invented prices and events. | Instant familiarity. | S | Legal and trademark risk. Real-world knowledge confuses what the game teaches. Clashes with "simulated, not a replay". | Safe public sharing |
| E. Crypto-style volatile assets | A few highly volatile fictional tokens with sentiment-driven events. | High drama, short sessions. | S | Weak link to company and macro moves. Feels gambling-like. | The macro and company layers |

**Recommendation: A for the first playable, planned to grow into C.** Fictional tickers avoid legal issues, and fictional companies let events be explained in-world (G2). Start with a few stocks plus one index and one macro variable. Add a currency pair and a commodity later. If the developer wants literal pairs, B is the alternative and could be the second market added.

**What would change it:** if "pairs" means FX pairs, move B ahead of A. If the developer wants a quick path to a presentable prototype for sharing, avoid D.

**Smaller related choices**

- Count for the first playable: recommendation is 4 stocks in 2 sectors, plus one index. Is that enough to make choices meaningful?
- Can the player short-sell, use leverage, or trade fractions of a share? Recommendation: long-only and whole shares at first. Add shorting later as a progression unlock.
- Are there fees and spreads? Recommendation: a small flat fee from the first build, because it stops infinite free trading (see risks).

### 3.3 Event and news system

How probability-driven events map to price movement, and how much the player can see in advance.

#### 3.3.1 Price model options

| Option | What it is | Fit to goals | Cost | Main risk |
| --- | --- | --- | --- | --- |
| A. Random walk plus event jumps | Base volatility noise. Each event applies an immediate price jump drawn from a distribution, then fades. | Simple. G1. | S | Feels random. Little to learn (fails G5). |
| B. Hidden fundamentals | Each asset has a hidden "fair value". Events change fundamentals. Price chases fair value with lag and noise. Players who read events can anticipate where price is heading. | Best for G2 and G5. News is signal and price is noisy. | M | Hard to tune. If lag is too short there is nothing to trade. If too long it feels slow. |
| C. Regime and drift | Events switch the asset into a regime (bull, bear, high volatility) that changes drift and volatility for a duration. | Easy to explain and chart. | S | Regimes can look arbitrary. |
| D. Scheduled plus unscheduled | A calendar of known events (earnings dates, rate decisions) with unknown outcomes, plus random unscheduled shocks. | Gives the player something to plan around (G2, G3: "I'm at work on earnings day"). | M | Needs a calendar UI. |
| E. Agent-based market | Simulated traders react to news and set prices. | Most emergent. | L | Hard to control. Hard to test. Not a solo-developer scope. |

#### 3.3.2 Visibility options (how much of an event the player sees, and when)

| Option | What the player sees | Effect on play |
| --- | --- | --- |
| V1. After only | News appears after the price has moved. | Reactive. Little skill. |
| V2. Concurrent | News and price move together, partly priced in. | Player judges whether it is "priced in". |
| V3. Partial advance (rumors) | A rumor appears before the event. It has a stated source and reliability. It may be false. | Strong G2. Reading sources becomes skill. |
| V4. Calendar | The player knows when an event will happen but not the outcome. | Planning. Ties to job hours (G3). |
| V5. Tiered by lifestyle or job | Better information sources are bought (a finance job, a data subscription, a faster feed). | Links G2 and G3. Gives lifestyle upgrades a trading effect. |

#### 3.3.3 Noise and misleading news

- Confirmed headlines: true, with a magnitude the player has to estimate.
- Rumors: true some percentage of the time, with a visible or learnable reliability by source.
- Noise news: real-looking headlines that do nothing.
- Contradictory news: two events hit one asset in opposite directions.
- Market overreaction: price jumps beyond fair value, then returns. This is learnable and fair.

**Recommendation: price model B (hidden fundamentals) with D (a calendar for macro), and visibility V2 plus V3 plus V4, with V5 left for the life layer.** It keeps events probabilistic (G1) while giving the player real signals to learn (G2, G5). A news item should carry a source with a reliability tier, because that is cheap to build and creates the "misleading but fair" feel.

For the first playable, a reduced form is enough: hidden fair value with noise, around 15 to 25 event types, one calendar event type (a rate decision), and headlines at V2 plus rumors at V3.

**What would change it:** if tuning B proves hard, fall back to C for the first playable. If the developer wants a pure-chance feel with a push-your-luck loop, A.

**Smaller related choices**

- How is an event's probability expressed? Options: a per-day chance, a per-week chance, or a weighted table where one event is picked per day. Recommendation: per-day chance per event type, with the sum shown in a debug view.
- Can the player influence event rates? Recommendation: no at first. Rates may move with macro state (for example, a recession raises the chance of layoffs).
- Do effects stack? Recommendation: yes, additively on fair value, with a cap per day to avoid absurd moves.
- How long do effects last? Recommendation: each event has a duration and a decay shape, shown in the debug view.
- Determinism: should a run use a seed so a bad run can be replayed and debugged? Recommendation: yes, a seed from the start. It also supports "daily challenge" modes later.
- Debug visibility: the developer rules ask for debug prints that show data flow. Recommendation: an "admin" event log that prints each event, its roll, its effect on fair value, and the resulting price delta.

### 3.4 Life layer

How jobs set trading time and capital, income and expenses, what lifestyle changes, and where the tension with trading comes from.

#### 3.4.1 Job structure options

| Option | What it is | Fit to goals | Cost | Main risk |
| --- | --- | --- | --- | --- |
| A. Three states | Jobless, part-time, full-time. Each fixes slots and salary. | Clear. Cheap. G3. | S | Thin as progression. |
| B. Job menu with tradeoffs | A handful of jobs differ in hours, pay, stability, and perks (for example, a finance job gives a better news feed but is high-hours). | Rich decisions. Links G2 and G3. | M | Balancing many jobs. |
| C. Career ladder | Jobs promote with time and skill, raising pay and often hours. | Strong progression. | M | Long-term pacing. |
| D. Gig and freelance | Flexible hours and variable pay. The player trades slots for cash day by day. | Good tension. No quit-or-stay decision. | M | Nothing to progress toward. |
| E. Job loss events | The job can be lost at random (layoffs tied to macro events). | Unites the life layer and the market. | S on top of A to C | Feels unfair if the player cannot read the warning. |

#### 3.4.2 Capital and expenses

- **Capital source options:** (a) salary surplus feeds the trading account automatically, (b) the player decides how much of savings to move to the trading account, (c) a separate trading account that never mixes with living money.
- **Expenses:** recurring rent and food, charged monthly or weekly. A lifestyle tier sets expenses. Higher tiers cost more, so success raises the pressure.
- **Lifestyle upgrade categories:** housing (comfort and cost), equipment (more watchlist slots, faster feed), information (news subscriptions, better source reliability), education (unlocks better jobs), and health or energy (if there is an energy stat).
- **Lifestyle's trading effects:** a faster feed, more watched assets, more actions per slot, and fewer random "life events" like repairs.

**Tension sources (this is the heart of G3)**

1. Jobless gives the most time but no income, so savings drain. Pressure to trade badly.
2. A job gives capital growth but removes trading time, so the player misses events.
3. A higher lifestyle improves trading tools but raises monthly costs.
4. Using living money to trade risks being unable to pay rent.

**Recommendation: A for the first playable, evolving into B with E as an optional event.** Use a monthly cycle. Salary and expenses are charged on the same day. The trading account is separate from living cash, with a visible transfer between them. Two or three lifestyle upgrades at launch: a faster feed (information), a bigger home (higher cost with a small bonus), and a course (unlocks a better job). This gives the basic loop of "trade or work, and spend to improve."

**What would change it:** if the developer wants lifestyle to be the main long-term progression, move to C earlier. If the developer wants a more arcade feel, D.

**Smaller related choices**

- Is there an energy, stress, or health stat? Recommendation: no at first. Time slots are enough constraint.
- Can the player be fired or quit freely? Recommendation: quitting is free, with a visible notice period.
- Is there tax on gains? Recommendation: defer.
- Is there a minimum cash reserve before the trading account can be funded? Recommendation: yes, one month of expenses, to avoid instant failure.

### 3.5 Goal and structure

| Option | What it is | Fit to goals | Cost | Main risk |
| --- | --- | --- | --- | --- |
| A. Net-worth target | Reach a target net worth. | Easy to understand. | S | Ignores the life layer, so it does not reward lifestyle choices. |
| B. Financial independence | Passive trading income covers lifestyle costs, so the player can quit the job. | Directly ties the market to G3. The job is the thing you are escaping. | S | Needs steady returns to feel earned. |
| C. Fixed-length scored runs | A run lasts a fixed in-game period (for example 3 years) and is scored on net worth, lifestyle, and survival. | Short sessions. Replayable. Fits a seed. | M | Less persistent progression. |
| D. Endless sandbox | Play indefinitely with milestones and no end. | Relaxed. | S | No tension without failure. |
| E. Scenario or campaign | Authored scenarios (a crash, a boom, a layoff year). | Teaches mechanics. | L | Needs content. Not G1-friendly. |

**Failure states**

- Hard bankruptcy: cash and trading account at or below zero means game over.
- Soft failure ladder: a missed rent forces a downgrade (cheaper home, lost upgrades) before game over. This recovers more gracefully.
- Soft lock: the player cannot trade because of no time or no capital. This is already an open question in the idea doc. It must be prevented or made a real, visible failure.

**Batch 4 change to the failure picture, corrected in batch 5.** In batch 4 I recorded that losses could exceed the account, and I wrote negative-balance options (carried debt, instant bankruptcy, ladder steps, a hybrid) for that. The user corrected this in batch 5: high leverage is enabled (a cap of 5x or more, faster liquidation), but **losses cannot exceed the account**. There is no negative-balance debt. Borrowing is a separate bank loan that the player can take, and failing to pay the loan interest can force liquidation or forced asset selling. I removed the negative-balance options. My earlier assumption "losses capped at the account" was right, and the 2x cap was the only part the user changed.

**The new tension: how does the game guarantee the loss cap?** With day-by-day turns, prices move between player turns. At 5x, an adverse overnight move of 20% wipes the trading account, and at 10x only 10% does. A liquidation that can only act at the next day's price may find the account already below zero. Options for the guarantee (not decided, and they can be combined):

| Option | How the cap is guaranteed | Fit | Risk |
| --- | --- | --- | --- |
| G1. Liquidate before zero | The game liquidates at a margin level well above zero (a maintenance margin). The price path inside a day is simulated in several steps (for example open, midday, close), and liquidation is checked at each step. | Closest to a real exchange. Uses the "faster liquidation" the user chose. | Does not cover a gap larger than the buffer. More simulation steps per day. |
| G2. Limit on gap size | A cap on the daily price move per asset (like a circuit breaker). The maximum leverage per asset is tied to it, so one capped move cannot wipe the account (for example, with a 15% daily cap, leverage has to stay below about 6.7x, and lower once a margin buffer is added, so the move cap and the leverage limit must be set together). Excess jump is carried to the next day. | A hard guarantee, and easy to explain. Ties to question 29(a). | Limits how big an event shock can be. Carried-over moves can look odd. |
| G3. Broker absorbs the shortfall | The account is floored at zero. Any shortfall below zero is written off. | Simple. A common real-world rule (negative balance protection). | Free-option exploit: the player risks only the account and keeps unlimited profit, so extreme leverage becomes a farm. Needs a cost such as a ladder step on every wipe-out, fees, or a leverage cooldown. |
| G4. No overnight leverage | Leveraged positions are closed at the end of each day at that day's close. | No gap risk for the account. | In a day-turn game this removes most of the point of leverage, since prices only move between turns. Probably not what the user wants. |
| G5. Combination | G2 as the main guarantee (a daily move cap tied to the leverage cap per asset), G1 for faster liquidation inside the day, and G3 as a small backstop with a ladder penalty on any wipe-out. | Strongest, and still simple to explain. | Most rules, and the most to tune. |

**Chosen in batch 7: G5**, as the user worded it: a daily price-move cap tied to the leverage limit, a small backstop, and a ladder penalty on any wipe-out. Intra-day liquidation checks (G1) were not part of the choice. Suggested, before the choice: G5, with G2 as the core. What would change it: G1 alone if the user wants a more realistic exchange, G3 alone for the least rules (then add the exploit mitigations).

**The bank loan (new in batch 5, details open).** The loan is a separate borrowing system, not a result of losses. Failing to pay loan interest can force liquidation or forced asset selling. The details are in questions 45 and 46. Notable interactions to design for: loan money used for trading is a second layer of leverage on top of margin; loan interest is a monthly expense and so affects the financial-independence calculation (question 24); and a missed payment may or may not be a ladder step. Where the soft ladder and the forced selling meet (what is sold first, and which downgrade comes before a sale) is a rule the user has to choose.

**Session length:** 15 to 45 minutes per run (C) or an open save (D). Day turns allow quick saves.

**Recommendation: C with B as the win condition.** A run lasts a set period, a win is reaching financial independence (passive returns cover expenses) before time runs out, and a score is awarded either way. Use a soft failure ladder before bankruptcy. Add the endless mode (D) later as an unlock after a win. B is the best match for the concept, because the job is both what funds the player and what they are escaping.

**What would change it:** if the developer wants persistent progression across sessions, D. If the developer wants a simpler first target, A.

**Smaller related choices**

- Single-player only? Recommendation: yes (already an open question in the idea doc).
- Does a bad run carry anything over (meta-progression)? Recommendation: no at first.
- Difficulty levels: starting cash and event frequency presets? Recommendation: defer.

### 3.6 Smallest first playable

**Primary question to prove:** is it fun to read incomplete information and decide whether to trade or work, with time and money pulling in opposite directions?

| Option | Slice | Proves | Cost |
| --- | --- | --- | --- |
| A. Market only | 4 fictional stocks, events, news feed, buy and sell, no life layer. | The price model and news are readable. | S |
| B. Market plus a minimal life layer | The above, plus jobless versus one job, rent, a monthly cycle, and day-turn time slots. | The core hook (G3). | M |
| C. Life layer only | Job, expense, and capital loop with a fake market. | Pacing of the life loop. | S |
| D. Vertical slice | Everything in 3.1 to 3.5 in reduced form, with a visual layer. | The full concept. | L |

**Recommendation: B.** A alone would not prove the unique concept, and D is too large.

**Proposed content for B (for discussion, not decided)**

- Time: day turns with 4 slots. The job costs 2 slots, and jobless is 0.
- Market: 4 fictional stocks in 2 sectors, plus one index. Long-only, whole shares, a flat fee.
- Events: about 15 to 25 types. One scheduled macro event (a rate decision). Headlines (V2) and rumors with a reliability tier (V3).
- Life: jobless or one job, monthly rent, a trading account separate from living cash, and 2 lifestyle upgrades (a faster feed and a course).
- Goal: reach financial independence within one in-game year, with a soft failure ladder and a bankruptcy end.
- UI: plain charts, a news list, a day summary, and an admin or debug log of events, rolls, and effects. A text-heavy UI is acceptable.
- Seeded runs.

**Success criteria (proposed)**

1. A player can say why a price moved after the fact, using the news list.
2. A player faces a real choice each day between work, research, and trading.
3. Jobless and employed runs both feel viable and different.
4. Two runs with different seeds feel different, and a bad run does not feel unfair.
5. A run takes under 30 minutes.

### 3.7 Design risks

| Risk | Why it matters | Mitigation ideas |
| --- | --- | --- |
| Price feels random, not learnable | No skill, no fun (G5). | Hidden fundamentals, visible event-to-effect rules the player can learn, an in-game "market primer", reliability tiers on sources. |
| Price feels too predictable | Players solve it and win every time. | Noise, partially priced-in news, false rumors, several overlapping events. |
| Exploits | Free trading, buying before known events, trading in a loop to farm small gains. | Fees and spread, a position limit, a cap on daily price move, no deterministic outcomes visible. |
| Information overload | Too many feeds, assets, and numbers. | Few assets at first, one feed, filters, a daily summary, sector tags. |
| Job versus trading is a dominated choice | One option is always best (always job or always jobless). | Tune pay, hours, and time cost so both are viable at different stages. Playtest both. |
| Soft locks | Not enough time or capital to trade, with no way out. | A reserve rule, a soft failure ladder, and a visible warning before the point of no return. |
| Unfair job loss or rent shocks | Feels arbitrary and not skill-based. | Telegraphed warnings, a visible layoff risk tied to macro news. |
| Calibration (tuning) cost | Event rates, magnitudes, and decay are many numbers. | Seeded runs, a debug log, a simulation script later to run many days and report distributions. |
| Realism and trust | A real-seeming market may imply financial advice or use real brand names. | Fictional tickers, a short in-game note that it is a simulation. |
| Scope creep | Many named drivers (news, company, macro, lifestyle) invite a large build. | Keep the first playable to section 3.6 B and add drivers one at a time. |
| Leverage tuning (added in batch 4) | A cap of 5x or more and faster liquidation can wipe the trading account and end a 30-minute run in one bad day, especially with stress and energy distortion on top. Losses cannot exceed the account (corrected in batch 5), which needs a guarantee (section 3.5). | A margin-level meter, a clear liquidation rule, a cap on daily price moves, a simulation script that runs many seeded days, and a staged distortion plan (section 3.9). |
| Liquidation versus financial independence (added in batch 4) | The win condition averages passive income over a rolling window. A liquidation loss can wipe the average and reset progress. Loan interest may or may not count against it. | Decide whether losses and debt interest count (question 24). Show the rolling average and the window on screen. |
| Bias that feels rigged (added in batch 4) | Biased news and posts are meant to simulate bad psychology. If the bias rule is hidden or too strong, players feel cheated, not taught. | A stated rule for who the bias favors, a cap, a visible warning state, a source tag, and a verify action (section 3.9). |

### 3.8 Scope risk (added after batch 2)

The batch 2 decisions add a lot to the minimum first playable proposed in section 3.6 B: several account types (savings, FD, high-interest savings), shorting and leverage, a percentage fee plus spread, two seed modes, an in-game book, and a job menu from the start. Each is a reasonable design choice, but together they are a much bigger build than "4 stocks, jobless or one job, rent". A 30-minute run (decision 5) adds a second pressure: every extra system adds daily actions, so the run can become longer or busier than intended.

Which parts can be staged without changing any decision (these are options, not a decision):

| Part | Cheap form first | Fuller form later | Staging note |
| --- | --- | --- | --- |
| Money accounts | Living cash, trading account, and one savings account. | FD with a lock and early-break penalty, high-interest savings with limits. | If accounts are rows of data (rate, lock, limit, fee) rather than special code, adding one is mostly content. |
| Job menu | 3 to 4 entries in a data table. | More entries, requirements, perks, layoffs. | The menu itself is in from the start, so the decision holds. |
| Short selling | Simple short with a flat borrow fee and no margin call. | Per-asset borrow cost, squeezes. | Shorting is close to long trading with a negative position, so it is cheaper than leverage. |
| Leverage | A fixed cap (for example 2x) with automatic liquidation. | Margin calls with a warning, borrowing interest tied to the policy rate. | Leverage is the largest risk, because it touches the failure ladder, the margin rules and the balance. |
| Percentage fee plus spread | In from the start. | Per-asset spread, spread widening on event days, broker upgrades. | The basic form is cheap and also blocks free-trading exploits. |
| Seeded and non-seeded modes | One RNG seed for every run, with a mode flag. Non-seeded picks a random seed and stores it. | Separate score tables, shareable seed codes. | The code is almost the same for both. The cost is in scoring and UI. |
| The book | Static text pages, available from the start. | Entries that reveal as events are seen, rare-case entries, direction hints shown by a mode or an unlock. | The direction presentation (question 27) can be a display flag over the same event data, so it can be left open. |
| Environment model | One regime label, or 2 to 3 variables. | Fuller macro simulation, policy cycles. | It drives event direction, savings rates and borrowing costs, so it should come early and stay small. |

Staging options for the user to choose from:

- **S1. Staged layers.** The first playable has cash, trading and one savings account, a job menu of 3 to 4 entries, long-only trading with a fee plus spread, a seed flag, and a static book. Shorting, leverage, FD and high-interest accounts come in later stages. Cost: S to M for the first playable. Risk: the first playable does not show the finance depth you have chosen.
- **S2. Data-driven systems with simple rules.** Build accounts, jobs and fees as data tables from the start. Include shorting and a simple capped leverage with automatic liquidation in the first playable, but leave out margin-call warnings and borrow-cost details. Cost: M. Risk: more balancing earlier, and more edge cases (for example liquidation versus the failure ladder).
- **S3. Everything at once.** Build all of the decided scope in the first playable. Cost: L or more. Risk: a long gap before anything is playable, and tuning too many systems at once.
- **S4. Two playables.** First playable proves the core loop (market, news, time budget, job, one savings account). A second playable adds the finance depth (accounts, shorting, leverage, the book). Cost: M, then M. Risk: the second playable needs a good first one.

What would change this: if the main appeal for you is the finance depth (accounts, leverage), S2 or S3. If the main appeal is reading news, S1 or S4. The success criteria in section 3.6 still apply to whichever option is picked.

**Chosen staging (batch 3, see section 5).** The user chose "core plus short": the first playable has cash, a trading account and a savings account, plus shorting and leverage. FD accounts, high-interest savings accounts and the book come in later versions. This is closest to S2, and it differs from my suggestion in two ways:

- **Shorting and leverage are in the first playable.** I suggested S1 timing for them (later). Leverage is the largest risk in the table above, so margin and liquidation rules (question 29) now have to be settled before the first playable, and they have to fit the failure ladder.
- **The book is not in the first playable.** I suggested a static book from the start. Without it, nothing in the game teaches how news affects prices, which puts more weight on the "learnable, not random" goal (G5). Question 34 asks how the first playable teaches without the book.

The first playable still carries the earlier decisions that have no stated stage: the job menu, the percentage fee plus spread, the two seed modes, and the financial-independence win. Question 33 asks the user to confirm these.

### 3.9 Energy and stress stats (partly decided in batch 4)

This replaces my earlier suggestion of "no stat" (question 15). I suggested none to keep scope small. The user does not want "none", and proposed that the stat should affect trading directly: low energy or high stress causes illusions, dizziness, or hallucinated news or candles. The player's perception of information could then be distorted.

**Batch 4 update (see section 5).** The user chose both energy and stress as two separate stats (not one combined stat, and not "energy first", which were my suggestions). The user chose all four distortion targets: numbers, news, candles, and UI. The fairness approach is telegraphed: a visible warning state, plus a subtle tell on the distorted content. Still open: which stat drives which distortion, how strong each effect is, how it is recovered, and what is active in the first playable (staging, below).

**Link to the pillar.** The pillar "Information is part of the game" says what the player can know, and when, is part of the design. This proposal adds a new layer to that: not only what the market shows, but how well the player can trust what they see. It also gives the life layer a direct effect on trading beyond time and capital (jobs, lifestyle and rest would feed the stat).

**What could be distorted.** The user chose all four targets: numbers (D2), news (D3 and D4, and the bias below), candles (D5), and UI (D1 blur and delays, and D6 misclick-style order errors). The table shows how each could work. How strong each is, and which stat drives it, is not decided.

| Option | What the player sees | Cost | Main risk |
| --- | --- | --- | --- |
| D1. Visual blur or tint | The screen blurs, shakes or dims at high stress or low energy. No data changes. | S | Only cosmetic, so it may not matter for play. Accessibility concerns for motion effects. |
| D2. Misread numbers | Displayed prices or balances are slightly wrong (jitter, swapped digits). | S to M | Feels unfair if the player cannot tell which number to trust. |
| D3. Phantom news | A false headline appears that was never generated by the market. | M | Overlaps with rumors and source reliability. The player needs a way to tell the two apart. |
| D4. Missing news | Some real news is hidden or arrives late. | M | Invisible by nature, so the player cannot know they missed it. |
| D5. Phantom or altered candles | The chart shows a candle that never happened. | M | Breaks trust in the one thing the player reads most. |
| D6. Action errors | The wrong order size or direction is more likely (a slip). | M | A different idea (control, not perception), and punishes the player without a read-skill answer. |

**Implications to keep in mind:**

- **Seeds.** Distortion should use its own random stream, so that a seeded run has the same market whatever the stat does. Otherwise a seed is no longer repeatable.
- **Debug log.** The admin log should show both the true value and the value shown, so distortion bugs can be told apart from price-model bugs.
- **Leverage and shorting.** Both are in the first playable, so a distorted view plus leverage can end a run fast. The failure ladder has to expect this.
- **Time slots.** If rest costs slots, the stat competes with trading and working for the same budget. That is the intended tension, but it can also make a run feel punishing.
- **Jobs and lifestyle.** Jobs could raise stress (long hours, hard roles), and lifestyle upgrades could lower it (better home, better sleep). That feeds the progression and constraint pillar, and it needs numbers on every job menu entry.
- **Fairness.** The game must teach and telegraph the effect, or the player cannot trust the UI. Ways to do this (options): a visible stat meter, a consistent tell (for example a tint or an icon) when distortion is active, a "verify" action that costs a slot and shows true data, and distortion confined to the presentation layer so the market and order fills are never changed (see the consistency check below for misclick-style errors and delays). The telegraphing is decided (batch 4), and the verify action exists for biased news (batch 6, cost open). The rest are options for the user.
- **Learnability (G5).** Distortion adds randomness on top of a market that already has noise. If both are strong, the game can feel unreadable.
- **Overlap with rumors.** Phantom news (D3) and missing news (D4) interact with the rumor and source-reliability system. They need a clear difference, for example rumors come from the world and phantoms come from the player's state.

#### Extra user intent: biased news and simulated bad psychology

In the user's terms: when the stats are bad, the game can also change the direction and percentage of the potential-direction hints for news (the book and hint idea), or show more one-directional, rigged news or social-media posts. The purpose is to simulate bad psychology: overtrading, overleveraging, and only seeing news that benefits your current trade or setup (confirmation bias).

**Consistency check: is this still display-only?** The original proposal text said the distortion was display-only. My check:

- **Rigged news, social-media posts and skewed hints: consistent.** They change what is shown, not what happens. The real events, the hidden fair values, the prices and the fills stay as the simulation made them. This holds if (a) the biased content is a selection, ordering or weighting of real news, or clearly social-media-style posts that are generated for display and are not market events, (b) the real feed stays reachable (for example a "verify" action), and (c) the hint skew only changes the shown direction and percentage, never the real event chances. If a "rigged post" were also allowed to move the price, it would stop being display-only. That is not what the user described.
- **Order misclick-style errors: not display-only.** They change the order the player submits (size or side), so the player's own action differs from what they intended. The market and fill rules are unchanged, but the original wording "never changes order fills" is too strong. The wording should become "the market, events and fill rules are never changed". Misclicks also fit the telegraphed rule only if the player can see and confirm the order before it is sent (an order confirmation step), which is a design choice for the user.
- **UI delays: depends.** A delayed display is display-only. A delay that changes the price at which an order fills is not. The user should say which is meant (question 43).
- **The hint skew belongs to the later book.** The book is not in the first playable, so in the first playable only news and social-post bias can apply, unless hints arrive sooner.

This is a wording conflict, not a conflict with the user's intent. I have not decided it.

**Staging options for the four distortion types (for the user to choose, not decided).** Both stats feeding four types is large for a first playable that already has shorting and leverage.

| Option | First playable | Later | Cost | Main risk |
| --- | --- | --- | --- | --- |
| P1. Data model only, effects off | Both stats exist, with meters and a warning state. The four types are in the data model but inactive. | All four types turned on one at a time. | S | The stats do nothing, so the player may ignore them. |
| P2. Meter plus cosmetic | Both stats, meters, warning state, and a UI effect (blur, short delay on display only). | Numbers, news, candles, misclick errors. | S to M | Cosmetic effects only, so little effect on trading. |
| P3. Meter, cosmetic, plus news bias | As P2, plus biased news and social posts. This best matches the psychology intent (confirmation bias). | Numbers, candles, misclick errors, hint skew. | M | Needs the news-selection rule and cap (question 39) before it is fair. |
| P4. Meter, cosmetic, news bias, and number distortion | As P3, plus displayed price and P&L errors. | Candles, misclick errors, hint skew. | M | Number errors with 5x leverage can be harsh. |
| P5. All four types, all active | Everything the user chose. | Tuning only. | L | Hard to balance together with leverage and a 30-minute run. Players may not be able to trust anything. |

My suggestion, not a decision: P3. It has the cheapest effects that carry the psychology idea (biased news, a visible meter and warning), and the data model holds the other types so they can be switched on later. What would change this: if the user wants the full experience at once, P5, with low strengths and strict caps.

**Chosen in batch 6: P3.** The first playable has both stats, a meter with a visible tell, cosmetic effects (blur and display-only delays), and biased news and posts. Number distortion, candle distortion and UI order errors come later. The data model should still hold all four types, so they can be turned on one at a time.

**Fairness measures kept in the working design (this session's instruction; confirm in question 15):**

- Distortion uses its own random stream, so a seeded market is identical whatever the stats do.
- The admin log shows both the true value and the shown value for every distorted item.
- Accessibility toggles exist for visual effects (blur, shake, delays).
- The telegraphing is decided: a visible warning state, plus a subtle tell on distorted content.

**Which stat drives which distortion (mapping options, not decided).**

- **M1. One shared impairment value.** Energy and stress both feed one value that every distortion type reads. Simplest, but the two stats feel the same.
- **M2. Each stat owns types.** For example, energy drives UI delays, number misreads and candle errors (tiredness), and stress drives news bias, misclick errors, and urges to overtrade or overleverage (pressure). Matches the psychology purpose. More tuning.
- **M3. Per-type thresholds on either stat.** Each distortion type has its own threshold and strength curve over both stats. Most flexible, most tuning work.

Suggested, not decided: M2, since it gives the two stats different feels and ties stress to confirmation bias.

**Biased news: how is the bias chosen, and capped?** This is needed so the bias stays fair and learnable. Options for what the bias favors (not decided):

- **B1. The player's open positions only.** Long positions get more bullish items, shorts get more bearish ones. A direct model of confirmation bias. Easy to explain.
- **B2. The player's open positions plus the order ticket.** As B1, and also whatever the player is about to trade (the current "setup").
- **B3. Mood-driven direction.** Stress pushes news toward fear (bearish, panic), and low energy toward carelessness. It is independent of positions.
- **B4. Recent behavior.** Bias follows the player's recent trades (for example the last few days of direction), which models chasing and overtrading.

Options for the cap (a suggestion for each, not decided):

- A maximum share of feed items that can be re-weighted (for example, at most a set fraction at maximum stress).
- The macro calendar and its outcomes are never biased. They stay as an anchor.
- Real news is never deleted from the true feed, and biased social posts carry a visible source tag.
- Bias strength scales with the stats and is shown by the warning state.
- A "verify" action shows the unbiased feed.
- The same rule for the later hint skew: a capped change in the shown percentage, and never the real chances.

My suggestion, not a decision: B1 first, because it is the confirmation-bias case the user described, with the caps above.

**Chosen in batch 6: B1 with caps.** Biased news favors the player's open positions. A capped share of items is re-weighted, the macro calendar is always unbiased, and a verify action shows the true feed. The exact cap and the verify cost are open (question 39).

**Overtrading and overleveraging.** The user's purpose includes these, but the four distortion types only change what the player sees or sends. If the game should also push the player toward them, options are: (a) none, the information bias is enough, (b) UI defaults that drift (default order size or leverage rises when stressed), (c) prompts or "FOMO" nudges, (d) costs that rise with trade count (fees or stress). Question 40.

## 4. Recommendation

Note: the recommendation below was written before batches 2, 3 and 4. Items 4 and 6 are now bigger because of the job menu, the savings account, shorting and high leverage (5x or more, with losses capped at the account) in the first playable, the fee plus spread, the two seed modes, and the energy and stress stats with four distortion types. The book is later, not in the first playable. Item 5 changes too: the ladder must now handle forced liquidation and forced selling from a bank loan, and the game needs a loss-cap guarantee (section 3.5). After batch 5 the first playable is also confirmed to hold the job menu, the fee plus spread, both seed modes, the financial-independence win and the ladder, all kept small. See section 3.8 for the chosen staging, and section 3.9 for the stats and their staging options.

Overall direction (not decided, for the developer to accept or change):

1. **Time:** day turns with a per-day time budget, where a job takes slots. Keep room for a live window later.
2. **Market:** a small fictional stock market (4 stocks, 2 sectors, one index), growing into a fictional mini-economy with a currency pair and a commodity.
3. **Events:** hidden fair value with event-driven changes, a calendar for macro events, and tiered news with rumors of varying reliability. Seeded and debug-logged.
4. **Life layer:** jobless, then a job, with monthly rent and a separate trading account. A few lifestyle upgrades that improve information, tools, and job options, and also raise costs.
5. **Goal:** fixed-length runs. Win by reaching financial independence. A soft failure ladder, then bankruptcy.
6. **First playable:** market plus a minimal life layer (section 3.6 B), under 30 minutes per run.

In short, it is a game about spending your time and money well while reading imperfect information. The market is the puzzle and the life layer is the budget.

## 5. Decisions

Only user-confirmed items are recorded here. Entries stay as history. Revisions on 2026-10-22 replace the failure ladder and the time-slot budget; see the revision list below and `GAME_DESIGN.md`.

Revisions, 2026-10-22:

- Failure is not a ladder of steps. The run ends when the player has no usable money and cannot pay the next expenses.
- Stress is reduced by a simple food and drink system.
- A day is simulated as sections or hours the player can skip. This replaces the time-slot budget. Revised later the same night: the sections are sleep, work, and trading while the market is open. Not enough sleep worsens energy and stress. Eating, drinking, and lifestyle changes are available while the day is playing and do not occupy a section. Skipping jumps from the end of work, when there is nothing to do, until the stock market opens.
- First trial: 120 game days, 30-day month.
- Margin warning at 15%, liquidation at 10%, daily price-move cap at 8%. The wipe-out no longer costs a ladder step.
- 2026-10-22, later the same night: to cover a bill the player chooses to sell positions, withdraw from another account, or take a bank loan. Lifestyle can be downgraded as ordinary asset management. A downgrade only lowers later bills and does not return the money spent. It cannot shrink a bill that is already short. A missed loan payment does not force a lifestyle downgrade. Food and drink are consumables that cost money and do not take a section of the day. Items restore energy, stress, or both, each with its own amounts and cost. The bank loan is in the first playable.

- 2026-10-21: Job, joblessness, and lifestyle are both the progression track and the constraint on trading time and capital. (Also recorded in the idea doc.)
- 2026-10-21: "Pairs" means any tradable instrument. The game starts with stocks, and a currency pair can be added later. (Answers former question 1.)
- 2026-10-21: Time model is day-by-day turns with a daily time budget. A job uses up time slots, and being jobless leaves them free. (Answers former question 2.)
- 2026-10-21: Starting assets are fictional stocks: about 4 stocks in 2 sectors, plus an index. (Answers former question 3.)
- 2026-10-21: Each asset has a hidden fair value that events move. A macro calendar and rumors with source reliability carry the information. (Answers former question 4.)
- 2026-10-21: Runs have a fixed length of about 30 minutes. The win condition is financial independence: trading income covers expenses, so the player can quit the job. (Answers former question 5.)
- 2026-10-21: Failure is a soft ladder of downgrades before bankruptcy. (Answers former question 6.)

Batch 2 (answers to former questions 7 to 11 and 13), in the user's terms:

- 2026-10-21: Job design (former question 7): there is a job menu from the start. It is not "jobless plus one job first". The entries on the menu are still open.
- 2026-10-21: Capital and money model (former question 8): the player manages their own salary. They deposit into a trading account and spend on monthly expenses. They can also hold a savings account, a fixed-deposit (FD) account, a high-interest savings account, and similar. The game therefore has several money accounts, not just cash and a trading account. Which accounts exist and their rules are still open.
- 2026-10-21: Short selling and leverage (former question 9): both are included.
- 2026-10-21: Fees (former question 10): a percentage fee plus a spread.
- 2026-10-21: Seeded runs (former question 11): there are two modes, one seeded and one non-seeded.
- 2026-10-21: Event visibility and teaching (former question 13, partly answered): the game has an in-game book or tutorial that teaches basic news-event impact, including sentiment impact and some rare cases. After that, either the player decides the likely direction themselves, or the game shows the possibility of which direction the price may go. Events and their impact directions have different chances depending on the event itself and the environment (economy, policy, and so on). **The user said "either": the choice between those two presentations is not yet decided.**

Batch 3 (answers to former questions 23, 12, 14, 16 and 19):

- 2026-10-21: Scope staging (former question 23): the first playable includes cash, a trading account and a savings account, plus shorting and leverage. FD accounts, high-interest savings accounts and the book come in later versions. (The user's option "core_plus_short". It differs from my suggestion, see section 3.8.)
- 2026-10-21: Event probability (former question 12): each event type has a per-day chance.
- 2026-10-21: Job loss (former question 14): telegraphed layoffs, in a later version.
- 2026-10-21: Tax on gains (former question 16): none at first.
- 2026-10-21: Meta-progression between runs (former question 19): none for the first playable, unlocks later.

Batch 4 (answers to former questions 15, 24, 26 and 29, partly):

- 2026-10-21: Energy and stress stats (former question 15, partly answered): there are both energy and stress, as two separate stats. (The user did not pick my suggested single stat or "energy first".) The stats distort all four targets: numbers (prices and P&L shown wrong), news (misread, fake or missing), candles (a wrong or ghost candle), and UI (blur, delays, and order misclick-style errors). Fairness is telegraphed: a visible warning state, and the distortion has a subtle tell.
- 2026-10-21: Extra user intent for the stats, in the user's terms: when the stats are bad, the game can also change the direction and percentage of the potential-direction hints for news (the book and hint idea), or show more one-directional, rigged news or social-media posts. The purpose is to simulate bad psychology: overtrading, overleveraging, and only seeing news that benefits your current trade or setup (confirmation bias). My check is in section 3.9: this is display-side and consistent with the original proposal, except that misclick-style order errors (and any delay that changes a fill) change what the player submits, so the earlier "display-only" wording must be narrowed. Which stat drives which distortion, the strength, recovery, and the first-playable staging are not decided.
- 2026-10-21: Financial independence (former question 24): it counts all passive income (trading profit and interest), averaged over a rolling window. The window length, whether losses and debt interest count, and whether unrealized profit counts are not decided.
- 2026-10-21: Environment model (former question 26): three variables for now (growth, inflation, policy rate), designed to be expandable later with things like wars, news shocks and technology improvements. How the variables move, and how they change event chances and directions, are not decided.
- 2026-10-21: Leverage and margin (former question 29, partly answered, **corrected in batch 5**): the user chose the higher option: a cap of 5x or more and faster liquidation. (Not my suggested 2x cap.) Batch 4 had also recorded "losses can exceed the account". That was a misreading, and the user corrected it: losses can NOT exceed the account. The exact cap and the liquidation rule are not decided.

Batch 5 (a correction to batch 4, and answers to former questions 25, 28 partly, 31, 33, 34 and 35):

- 2026-10-21: Correction to the leverage decision above: high leverage is enabled (a cap of 5x or more, faster liquidation), but losses cannot exceed the account. There is no negative-balance debt. Former question 35 is answered and reframed: borrowing is a separate bank loan.
- 2026-10-21: Bank loan (new): the game has a bank loan mechanism the player can use to borrow money. Failing to pay loan interest can cause forced liquidation or forced asset selling. The loan rules are not decided (questions 45 and 46).
- 2026-10-21: Job menu (former question 28, partly answered): 4 to 5 jobs, each with pay, time slots, one requirement and one perk. Whether jobs also carry energy and stress costs stays open.
- 2026-10-21: Savings account (former question 25): in the first playable it has low interest, no withdrawal limits, and instant free transfers.
- 2026-10-21: The first playable also includes the job menu, the fee plus spread, both seed modes, the financial-independence win and the failure ladder, all kept small. (Answers former question 33.)
- 2026-10-21: Teaching without the book (former question 34): the first playable has a one-screen primer and an end-of-day "what moved prices" summary.
- 2026-10-21: Seeded versus non-seeded (former question 31): seeded is a repeatable challenge, non-seeded is normal play, and scores are kept separately.

Batch 6 (answers to former questions 37 and 39, and parts of 24, 29, 45 and 46):

- 2026-10-21: Leverage cap in the first playable: 5x. (Borrowing interest, per-asset limits and the liquidation margin level are still open.)
- 2026-10-21: Bank loan basics: one loan at a time, the limit is set by job and lifestyle, interest follows the policy rate, and missed interest forces selling. (Whether the loan is in the first playable is still open. Loan size, term, the margin over the policy rate and early repayment are still open.)
- 2026-10-21: Forced-selling order when interest is missed: trading positions first (worst-performing first), then savings, then a lifestyle downgrade. (I had suggested leveraged positions first. The recorded rule has no separate leveraged tier, and whether leveraged positions rank ahead is a small open item in question 46.)
- 2026-10-21: Financial-independence window: passive income averaged over the last in-game month. (Whether losses, unrealized profit and loan interest count, and the hold length, are still open.)
- 2026-10-21: Distortion staging in the first playable (option P3): both stats (energy and stress), a meter with a visible tell, cosmetic effects, plus biased news and posts. **Number distortion, candle distortion and UI order errors are NOT in the first playable. They come later.** All four distortion types (numbers, news, candles, UI) from the batch 4 decision are still the long-term targets, so the earlier decision stands and this only sets the first-playable subset.
- 2026-10-21: Bias rule: biased news favors the player's open positions, with a capped share of items re-weighted, the macro calendar always unbiased, and a verify action that shows the true feed. (The exact cap and the verify cost are still open.)

Batch 7 (answers to former question 44 and part (a) of question 46):

- 2026-10-21: Loss cap guarantee (former question 44): the user chose my G5 combination: a daily price-move cap tied to the leverage limit, a small backstop, and a ladder penalty on any wipe-out so extreme leverage is not free. (The user's wording does not include intra-day liquidation checks, so those are not part of the decision. The design doc uses one end-of-day check as a provisional default. The cap value, the backstop size and the penalty size are not decided.)
- 2026-10-21: Bank loan timing (former question 46(a)): the bank loan is NOT in the first playable. It comes in a later version. The first playable has leverage but no loan. The loan decisions already recorded (one loan at a time, limit from job and lifestyle, interest following the policy rate, missed interest forces selling, and the forced-selling order) stay as the design for the later version.

The user did not answer the other blockers. The first design doc, [../GAME_DESIGN.md](../GAME_DESIGN.md), uses provisional defaults for them and tags each as `[PROVISIONAL]`: the failure ladder steps (46b), how energy and stress change, recover and are fed (15e, 15f, 28d), run length and month (49), financial-independence details (24), leverage details (29), tuning (36), which stat drives what (38), the bias cap and verify cost (39), the tell (41), the jobs (28), the primer and summary contents (48), seed details (47), environment dynamics (42), savings rate and fees (25, 30), slots per day, starting capital, and 13, 17, 18 and 20. Items 21 and 22 (tech stack, save format) stay deferred to the planner. No tech stack is chosen.

Details that these decisions leave open (slot count, ladder steps, run length in game days, and so on) are still open. The values in section 3.6 are proposals only, and parts of section 3.6 and section 4 are now smaller than the decisions above (see section 3.8).

## 6. Open questions

Former questions 1 to 12, 14, 16, 19, 23, 25, 31, 33, 34 and 35 are answered and moved to section 5. Questions 15, 24, 26, 28 and 29 are partly answered, and only their remaining parts are kept below. Question 13 is only partly answered, and its remaining part is kept below. Question 35 was reframed in batch 5 (there is no negative-balance debt, and borrowing is a separate bank loan). Numbers are kept so earlier references still work. Questions 23 to 32 came from batch 2, 33 and 34 from batch 3, 35 to 43 from batch 4, 44 to 48 from batch 5, and 49 from batch 6 (the financial-independence details stay in question 24).

**Batch 6 update.** Questions 37 and 39 are answered and moved to section 5. Questions 24, 29, 45 and 46 are partly answered, and only their remaining parts are kept below.

**Batch 7 update.** Question 44 is answered (details open), and 46(a) is answered. The first design doc, [../GAME_DESIGN.md](../GAME_DESIGN.md), now exists. It gives every unanswered question here a provisional default and tags it, so the open questions below are now "confirm or change the provisional default". The order to confirm them in is in section 17 of that doc.

Each question shows options and my suggested answer, ordered by importance. Small and detailed questions are included on purpose.

**New questions from the batch 5 decisions and the correction**

44. **How is the loss cap guaranteed? (answered in batch 7, details open).** Decided: a daily price-move cap tied to the leverage limit, a small backstop, and a ladder penalty on any wipe-out. Still open: (a) the daily move cap value (the design doc proposes 8%, below a 10% maintenance margin ratio), (b) whether an event jump above the cap carries over to the next days (the design doc proposes yes, the gap stays between price and fair value), (c) the size of the backstop and what counts as a wipe-out, (d) the size of the ladder penalty (the design doc proposes one step and a stress spike), (e) whether to add intra-day liquidation checks (not in the first playable by default).
45. **Bank loan details: the remaining parts (partly answered in batch 6).** Decided: one loan at a time, the limit is set by job and lifestyle, and interest follows the policy rate. Still open (suggestions in brackets): (a) loan size (a few fixed sizes, or a free amount up to the limit), (b) term (open-ended with monthly interest only, or a fixed term with a final repayment), (c) the margin over the policy rate (a small fixed margin), (d) early repayment (allowed, free), (e) secured or unsecured (unsecured, with the limit as the only guard), (f) what happens to the limit when the player is jobless (it drops, and existing loans stay), (g) whether loan interest counts as an expense for financial independence (yes, see question 24).
46. **Missed loan payments and forced selling: the remaining parts (partly answered in batch 6).** Decided: missed interest forces selling, in this order: trading positions first (worst-performing first), then savings, then a lifestyle downgrade. (a) is answered in batch 7: the bank loan is not in the first playable and comes in a later version. Still open: (b) How is the lifestyle downgrade in the sale order related to the failure ladder: is it the same step, and what ends the run once the ladder is used up? (c) Is there a grace period or a warning with a visible state before a forced sale (the telegraphing rule favors a warning day)? (d) Can the player use loan money for trading, which stacks leverage on top of margin (options: yes, no, or only up to a limit)? Suggested: only up to a limit, or no, in the first version. (e) Does a forced sale carry a penalty fee? (f) What does "worst-performing" mean: the largest loss in money or in percent, and do leveraged and short positions rank ahead? Suggested: the largest loss in money.
47. **Seeded and non-seeded modes: the remaining details.** Decided: seeded is a repeatable challenge, non-seeded is normal play, and scores are separate. Open: (a) can the player type or share a seed code, (b) is there one fixed challenge seed at a time (for example a daily seed) or can the player choose any seed, (c) can a seeded run be retried and how are retries scored, (d) is the seed shown at the end of a non-seeded run so it can be replayed (suggested: yes). Suggested: any seed code can be entered, retries allowed with a separate best score, and the seed shown at the end of every run.
48. **The primer and the end-of-day summary.** Decided: a one-screen primer and an end-of-day "what moved prices" summary. Open: (a) what the primer says (the basic news-to-price rules, sentiment, and one or two rare cases), (b) what the summary shows (which events fired, which assets moved, and how much), (c) does the summary show true data even when the stats distort the player's view (suggested: yes, since it can act as the "verify" channel at no slot cost, but that makes distortion weaker, so the user may prefer it costs a slot), (d) does it show hidden fair-value moves or only visible news (suggested: the news and the price moves, not the hidden values), and (e) does the summary appear every day or only on days with events.
49. **Run length in game days versus the 30-minute run (new in batch 6, and a correction to my earlier suggestion).** I suggested "about one in-game year". At 365 days in 30 minutes, a day lasts about 5 seconds, which is too short for 4 time slots of decisions. The financial-independence window is now one in-game month, so the run must be several months long. Options: (a) 90 days (about 20 seconds per day), (b) 120 days, (c) 180 days, (d) 365 days with quiet days fast-forwarded automatically. Also: how many game days is a month (suggested: 30, so rent, salary, loan interest and the FI window share one cycle)? Suggested: (b) 120 days (4 months) with an optional fast-forward on days with no events and no decisions.

**New questions from the batch 4 decisions**


35. **Negative balances versus the failure ladder (answered and reframed in batch 5).** Losses cannot exceed the account, so there is no negative-balance debt. Borrowing is the separate bank loan (questions 45 and 46), and the loss-cap guarantee is question 44.
36. **Tuning risk and liquidation: leverage plus distortion plus a 30-minute run.** Options for safeguards (pick any): (a) a visible margin-level meter, (b) a cap on the daily price move, (c) a first-run or easy preset with a lower cap, (d) a simulation script that runs many seeded days and reports blow-up rates, (e) distortion strength capped while the account is highly leveraged. Also, what does a liquidation do to the financial-independence average and to the ladder? Suggested: (a), (b), (d), plus (e) so the two harshest systems do not stack in the first runs.
37. **Staging of the four distortion types (answered in batch 6).** The user chose P3 for the first playable (section 5). The other three types come later and are still long-term targets.
38. **Which stat drives which distortion?** Options M1 (one shared value), M2 (each stat owns types), M3 (per-type thresholds on both). For the first playable only the cosmetic effects and news bias are active, so the question is: which stat drives which of those? Suggested: M2, with stress driving news bias (confirmation bias and fear) and energy driving the cosmetic effects (blur and short display delays). Later: energy for number misreads and candle errors, and stress for misclick errors and overtrading urges.
39. **Biased news: the remaining details (answered in part in batch 6).** Decided: the bias favors the player's open positions, a capped share of items is re-weighted, the macro calendar is always unbiased, and a verify action shows the true feed. Still open: (a) the exact cap (suggested: at most a quarter of the visible feed at maximum stress, scaling with the stat), (b) the verify cost (see 15d; suggested: one time slot), (c) whether biased social posts carry a visible source tag (suggested: yes), (d) whether the same rule applies later to hint direction and percentage (suggested: yes, with a capped change in the shown percentage).
40. **Overtrading and overleveraging pressure.** Does the game push these directly, or only through biased information? Options: (a) information bias only, (b) default order size or leverage drifts up under stress, (c) prompts and "FOMO" nudges, (d) trading costs that rise with trade count. Suggested: (a) at first, with (b) later, since (b) overlaps with misclick errors.
41. **How subtle is the "subtle tell"?** The decision pairs a visible warning state with a subtle tell on distorted content. Options for the tell: a consistent small icon or tint, a slight color shift, a short delay before the item settles, a tell only visible on hover. Is the tell the same for every distortion type, or one tell per type? Suggested: one consistent tell for all types, learnable from the tutorial text, plus the warning state always visible.
42. **Environment dynamics.** How do growth, inflation and policy rate move (random walk, scheduled policy meetings on the calendar, or event-driven), and what are their ranges? How do they change event chances and directions (a lookup table per event type)? Does the policy rate also set savings interest and borrowing cost? What is the expansion hook for later variables (wars, news shocks, technology improvements)? Suggested: policy changes on calendar dates, growth and inflation drift slowly with event nudges, the policy rate drives savings and borrowing rates, and each variable is a data entry so more can be added.
43. **Misclick errors and delays: what exactly changes? (later version: UI order errors are not in the first playable, but display-only delays and blur can be.)** Options: (a) a misclick changes the submitted order (size or side) and a confirmation step lets the player catch it, (b) the same without a confirmation step, (c) delays are display-only, (d) delays also delay order placement, so the fill price can change. Suggested: (a) and (c) first, so the fill rules never change and the telegraphing stays fair.

**Questions from the batch 2 and 3 decisions**

24. **Financial independence: the remaining details (partly answered, window decided in batch 6).** Decided: all passive income (trading profit and interest), averaged over the last in-game month. Still open: (a) is answered (the window is the last in-game month, and question 49 asks how many game days a month is), (b) whether trading losses reduce the average (suggested: yes, net trading result), (c) whether unrealized profit counts or only realized profit (suggested: realized only, so leverage cannot fake a win), (d) whether loan interest and margin borrowing costs count as expenses (suggested: yes), (e) what "expenses" means: the current lifestyle's monthly cost (suggested: yes), (f) whether the average must hold for several days before the win triggers (suggested: yes, a short hold). Salary is not counted.
25. **Accounts: the remaining details (answered for the first playable in batch 5).** Decided for the first playable: cash, trading and one savings account, with low interest, no withdrawal limits, and instant free transfers. Still open, for a later version: the FD lock period and early-break penalty, and the high-interest account's rate and limits. Small open item now: the exact savings rate, and whether it follows the policy rate (suggested: yes, a small fixed spread below it).
26. **Environment model (answered in batch 4, remaining part is question 42).** Decided: three variables for now (growth, inflation, policy rate), expandable later with wars, news shocks and technology improvements.
27. **The book and direction hints (later version).** The book is not in the first playable, so this can wait. The open choice from decision 13: after the book, (a) the player always decides direction alone, (b) the game always shows direction probabilities, (c) a difficulty or mode setting switches between (a) and (b), or (d) hints are an unlockable (for example a lifestyle upgrade or a paid analyst source). Related details: is the book available at the start, behind a lifestyle upgrade, or unlocked by progress? Is it fixed rules per event type, or does it reveal entries as the player sees events? Are the shown probabilities exact, or estimates with error? Suggested: (c) at first, because it is a display flag over the same data and lets you test both. The book is available at the start as static text, with entries revealing as the player sees events later. Shown probabilities are estimates from a source with a reliability tier, to match rumors.
28. **Job menu: the remaining details (partly answered in batch 5).** Decided: 4 to 5 jobs, each with pay, time slots, one requirement and one perk. Still open: (a) which jobs (names and roles, for example a night shift, an office job, a trading-floor job, a part-time job, a freelance job), (b) what kinds of requirements (education from a course, a lifestyle level, time served), (c) what kinds of perks (a better news feed, a lower fee, a stress or energy bonus, a loan limit boost), (d) whether jobs carry energy and stress costs (question 15f; suggested: yes, two numbers per job), (e) can the player switch jobs freely, with a notice period (suggested: yes). Layoffs are later (decision 14).
29. **Margin and leverage rules: the remaining details (needed for the first playable).** Decided: a cap of 5x in the first playable (batch 6), faster liquidation, and losses cannot exceed the account (corrected in batch 5). Still open: (a) whether the 5x cap differs by asset (a lower cap for volatile stocks) or is raised later by lifestyle upgrades, (b) what "faster liquidation" means: liquidation at a margin level with no warning, or with a warning in the same day, (c) the liquidation order (worst position first, or all), (d) borrowing interest (suggested: the policy rate plus a margin), (e) short borrow cost (suggested: a per-asset daily fee), (f) whether a liquidation counts as a ladder step (see questions 44 and 46), and (g) a margin-level meter, which the telegraphing rule favors. Suggested: a 5x cap at first, liquidation at a set margin level with a same-day warning shown on the meter, worst position first, and the interest and borrow cost as above.
30. **Fee and spread setting.** Is the percentage fee global and the spread per asset? Does the spread vary with volatility (wider on event days) and do lifestyle upgrades (for example a better broker tier) lower fees? Suggested: a global percentage fee, a per-asset spread that widens on event days, and a broker upgrade that cuts the fee.
31. **Seeded versus non-seeded modes (answered in batch 5).** Decided: seeded is a repeatable challenge, non-seeded is normal play, and scores are separate. The remaining details are question 47.
32. **Rare cases in the book (later version).** Which rare cases, and how often? Examples: "sell the news" (good news, price falls), bad news that was already priced in, and good news in a recession. Suggested: 3 to 5 rare cases at first, each flagged in the book and each tied to a condition in the environment model.

**Remaining earlier questions**

13. **Can the player affect event rates?** (The visibility part is now question 27.) Options: no, indirectly through news, or directly. Suggested: no at first.
15. **Energy and stress stats: the remaining details (partly answered in batch 4, section 3.9).** Decided: two separate stats (energy and stress), all four distortion targets, and telegraphing through a visible warning state plus a subtle tell. Answered or moved: 15a (which stats), 15b (what is distorted) and 15c (is the player told). Staging is question 37, the stat-to-distortion mapping is question 38, the tell is question 41. The remaining sub-questions, each with options and my suggestion:
    - **15d. Can the player verify true data?** Options: no, yes for a time slot, yes at a money cost, yes through an upgrade. Suggested: yes for a time slot.
    - **15e. How is the stat recovered?** Options: rest (uses time slots), a day off, lifestyle upgrades, quitting or changing job. Suggested: rest that costs slots, plus a lifestyle upgrade that raises recovery.
    - **15f. How do jobs and lifestyle feed the two stats?** Options: each job entry has an energy cost and a stress cost per day, lifestyle sets the recovery rates and the caps, and expenses scale with comfort. Do the two stats have separate recovery routes (for example sleep for energy, leisure for stress)? Suggested: two numbers per job entry, two recovery numbers per lifestyle tier.
    - **15g. First playable.** Answered in batch 6: both stats, a meter with a visible tell, cosmetic effects, and biased news and posts.
    - **15h. Fairness rules (wording changed in batch 4).** Kept in the working design: its own random stream, the admin log with true and shown values, accessibility toggles for visual effects, and telegraphing. Changed: the old rule "never changes order fills" becomes "the market, events and fill rules are never changed", because misclick-style errors change the order the player submits (question 43). Suggested: confirm these.
17. **Real-money or financial realism.** Is a visible "this is not financial advice" note wanted? Suggested: a short note in the credits or menu.
18. **Single-player only?** Options: yes, with leaderboards later, or with multiplayer. Suggested: single-player, and a seeded daily challenge later.
20. **Art and UI direction.** Options: plain text and charts, a dashboard style, a character-based life view. Suggested: plain dashboard for the first playable.
21. **Platform and tech stack (deferred).** Options include a web app, a desktop engine game, or a terminal prototype for the price model. No suggestion yet. This should be decided with the planner after the design questions.
22. **Save format (deferred).** Depends on item 21.

## 7. Next steps

1. Done on 2026-10-21: questions 1 to 6 answered, recorded in section 5, and `docs/ideas/trading-simulation.md` updated.
2. Done on 2026-10-21: batch 2 (former questions 7 to 11, and the visibility part of 13) recorded in section 5, and the idea doc updated.
3. Done on 2026-10-21: batch 3 (former questions 23, 12, 14, 16 and 19) recorded in section 5, the stat proposal recorded in section 3.9, and the idea doc updated.
4. Done on 2026-10-21: batch 4 (former questions 15, 24, 26 and 29, partly) recorded in section 5, sections 3.5, 3.7 and 3.9 updated, and the idea doc updated.
5. Done on 2026-10-21: batch 5 and the correction to batch 4 (leverage, losses capped at the account, the new bank loan) recorded in section 5, sections 3.5 and 3.7 corrected, and the idea doc updated.
6. Done on 2026-10-21: batch 6 (former questions 37 and 39, and parts of 24, 29, 45 and 46) recorded in section 5, section 3.9 updated, and the idea doc updated.
7. Done on 2026-10-21: batch 7 (former question 44 and 46(a)) recorded in section 5, and the first design doc written: [../GAME_DESIGN.md](../GAME_DESIGN.md). The idea doc is now the portfolio brief, and the README index points at the design doc.
8. Done on 2026-10-22: the user replaced the failure ladder, added food and drink for stress, replaced time slots with a skippable day, and accepted the 120-day run and the 8% / 10% / 15% leverage numbers. Recorded in `GAME_DESIGN.md`.
9. The user confirms or changes the remaining provisional defaults in section 17 of `GAME_DESIGN.md`.

**The blockers listed before the first design doc.** Items 44 and 46(a) were answered in batch 7. The others were not answered, so they carry provisional defaults in `GAME_DESIGN.md`. They are the ones to confirm first, because a wrong default would change the structure of other systems:

- **44. How the loss cap is guaranteed.** Answered in batch 7. The details (cap value, backstop, penalty size) are provisional.
- **46(a). Is the bank loan in the first playable?** Answered in batch 7: no, later.
- **46(b) and the failure ladder.** What the ladder steps are, how the forced-sale lifestyle downgrade relates to them, and what ends the run. The ladder is a decided feature but has no steps yet.
- **15e, 15f and 28(d). How energy and stress change and recover**, and whether jobs and lifestyle feed them. Both stats are now in the first playable, and without a feed and a recovery they have no loop.

**Can stay open or take a provisional default** (the design doc marks each as provisional):

| Question | Provisional default (my suggestion) |
| --- | --- |
| 49. Run length and month length | 120 game days, 30 days a month, fast-forward on quiet days |
| 24. FI details | Net trading result counts, realized profit only, loan interest counts as an expense, a short hold of a few days |
| 29. Leverage details | 5x cap for all assets, liquidation at a set margin level with a same-day warning, worst position first, borrow interest at the policy rate plus a margin, a per-asset daily short-borrow fee |
| 36. Tuning safeguards | Margin meter, a simulation script for many seeded runs, distortion capped while highly leveraged |
| 45. Loan details | Used only if the loan is in the first playable: fixed sizes, monthly interest only, a small fixed margin over the policy rate, free early repayment, unsecured |
| 46(c) to (f). Loan warning, use for trading, sale fee, "worst-performing" | A warning day before a forced sale, loan money cannot be used for trading at first, no sale fee, worst by the largest money loss |
| 38. Which stat drives what | Stress drives news bias, energy drives cosmetic effects |
| 39. Bias cap and verify cost | A quarter of the visible feed at most, verify costs one time slot |
| 41. The tell | One consistent tell for all distortion types, plus an always-visible warning state |
| 28. The 4 to 5 jobs, requirements and perks | Placeholder jobs (night shift, office job, trading-floor job, part-time job, freelance job) with placeholder numbers |
| 48. Primer and summary contents | Summary shows true data, a short primer of the basic news rules |
| 47. Seed mode details | Any seed code can be entered, retries have a separate best score, the seed is shown at the end of every run |
| 42. Environment dynamics | Policy changes on calendar dates, slow drift for growth and inflation, policy rate drives savings and borrowing rates |
| 25. Savings rate | A small fixed spread below the policy rate |
| 30. Fee and spread | A global percentage fee, a per-asset spread that widens on event days |
| Slots per day and starting capital | 4 slots, a small starting capital set in tuning |
| 13, 17, 18, 20 | No player influence on event rates, a short disclaimer note, single-player only, a plain dashboard |
| 21 and 22 | Deferred to the planner |
| 27, 32, 40, 43 and the FD and high-interest accounts | Later versions |

9. Record confirmed answers under Decisions here, update `GAME_DESIGN.md` (tags and values), and update the idea doc only if a change affects the pitch, status, or portfolio-level questions.
10. Hand off to the planner for a tech-stack comparison and an ordered plan for the first playable, using the scope in section 14 of `GAME_DESIGN.md`. The planner decides the stack. The user does not need to confirm every provisional default before the hand-off, but the first four items in section 17 of `GAME_DESIGN.md` shape the plan.
11. After a plan exists, the implementer builds a price-model sandbox first (events, fair value, debug log), then the time and life layer.
