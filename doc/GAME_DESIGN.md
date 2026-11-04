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
- `[PROVISIONAL]` Prices move during the market session in 15-minute steps (section 5, Intraday session). Events, fair value, accounts and the margin check still update once per day, at End day. Replaces the 2026-10-22 rule of no intraday price movement.
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
- `[PROVISIONAL]` Order-flow parties (plan market depth, Step M4, user decision 2026-11-03: real orders against depth). Price moves by net demand over depth, where depth is a stock's daily traded value times a number of days, so a fund with fixed money moves a thin stock more than a deep one. The pull toward fair value is the institutions and the noise term is the noise traders. The first new party is informed money: for some scheduled events (a chance per event type, scaled by a hidden per-run regime) it trades in the event's direction on the two days before the event fires, so a share of the move is already in the price. Calendar releases never leak. The second party is news traders: on each day a stock has an event effect applied, they close a share of the gap to fair value plus what the effect has still to apply (a hidden per-run efficiency, 0.4 to 0.7), on top of the pull, so the price reacts faster and a headline reader finds less left to trade. A share above 1 would overshoot and revert. The retail crowd keeps a mood per stock: every rumour the player can read (any source, true or false) sways it by the source's tier, headlines sway it a little after the fact, and it trades the change in mood with fixed dollars, so a thin stock moves more. A rumour's share leaves when its day comes, so a true rumour is sold into the news and a false one unwinds when the day passes with no event. Trend followers trade the direction of the last few closes. Parties move the price only, never fair value, and draw only their own seeded stream. They never read the player's stats, positions or resting orders. The one thing the player does that reaches them is a large market order (the next rule).
- `[PROVISIONAL]` A move above the cap is not lost. The rest of the gap stays between price and fair value and plays out over the following days.
- `[PROVISIONAL]` Event effects add to fair value, and have a magnitude, a duration and a decay shape. Effects stack, with a per-day limit on the total change in fair value.

### Intraday session `[PROVISIONAL]`

Added 2026-10-31 at the user's request: the player can trade at intraday prices, with a volume figure. Numbers are placeholders. Built in plan Step 28.

- `[CONFIRMED]` Orders are tradable intraday: a fill uses the price at the player's current time in the session, not one price per day.
- `[PROVISIONAL]` The session is the market window, 17:00 to 21:00, in 16 steps of 15 minutes. Open market moves the clock to 17:00. A new control moves the clock forward one step at a time, and End day jumps to 21:00 and then to the next day. The clock never moves back.
- `[PROVISIONAL]` The day's close is still decided when the day is stepped, exactly as today, from fair value, events and noise. The intraday path is a bridge from the previous close (the open) to that close, with noise that scales with the asset's volatility. The path is fixed and hidden at the start of the day. The player sees only bars up to the current clock time.
- `[PROVISIONAL]` The path uses its own seeded stream, so adding it does not change the daily price, event or rumour draws, and a seeded run still gives the same market whatever the player's stats do, and whatever orders the player places below the free share (section 5, order flow). The existing daily golden fixtures should not change.
- `[PROVISIONAL]` The 8% daily move cap applies to the close against the previous close. Intraday bars may swing past 8% from the open but are clamped to a wider band (suggested 12%), so the loss cap guarantee in section 7 is not weakened.
- `[PROVISIONAL]` The warning, the wipe-out check and funding are checked once per day at the close (end-of-day check). Liquidation is also checked after every 15-minute bar (section 7, Leverage and margin). The margin meter during the session uses the current intraday price. Order sizing against the margin rule uses the current intraday price.
- `[PROVISIONAL]` Spread and fee are unchanged. An event day still widens the spread.
- `[PROVISIONAL]` Liquidity grabs (plan Step M9). On about a quarter of stock-days one bar's wick runs through a public level and comes back: a round price ($1 apart under $20, $5 under $100, $10 above) or the high or low of the last few closes, within 1.5% of the open. The close of the bar, the path and the day's close do not change, only that bar's high or low, so a stop sitting on an obvious level can be hit and the price recover. The level comes from public prices only and never from the player's resting orders. It uses its own session stream. Old saves are rejected (the session gained a stream).
- `[PROVISIONAL]` The player's market orders join the order flow (plan Step M13, user decision 2026-11-03). Net value bought or sold in a stock today is free up to 2% of its daily traded value, so ordinary orders leave the market exactly as it was. Beyond that, the excess moves the price by excess over depth like any party: the rest of the session bends toward a new close and End day prints exactly that close. Bars already played never change. An order placed at the close has no time left to be felt. Limit orders, take profits, stop losses and liquidations do not add flow yet. Slippage is the cost inside the bar; the push is the effect on the price that follows. Same seed and same commands give the same run; the market differs from an idle run only after an order above the free share.
- `[PROVISIONAL]` Slippage (plan Step M3, option I1). A market order, a stop loss and a liquidation pay extra beyond the half spread when they are larger than 5% of the shares traded in the bar they trade in (the bar the clock is about to run, or the bar that triggered the stop). Extra per share = price × daily volatility × sqrt(share of bar − 5%), at most 20% of the price; the index uses a 1% volatility floor. Limit orders and take profits pay none. It uses the seeded bar volume only, so no market price or stream moves. The order panel shows the cost before the order. Volume is no longer cosmetic: it is the liquidity a fill is measured against.
- `[PROVISIONAL]` Volume is a per-bar figure that is higher on event days and on larger moves, plus noise, from a separate seeded stream, scaled per stock by its daily traded value. It does not change prices or the spread. It is the liquidity that slippage is measured against. The player can see it per bar and per day. Each stock has its own scale: `liquidityNotionalCents`, a typical daily traded value, divides by price to give shares. Each stock also has `sharesOutstanding`, and the header shows market cap (shares times price). Both are display and volume scale only until slippage (plan Step M3).
- `[PROVISIONAL]` The day's high and low in the header and the candle are the session path's high and low. Daily closes, scores and the FI ledger are unchanged.
- `[OPEN]` Whether a player who ends the day without reaching 21:00 has their open orders affected (there are none, since orders are market orders), and whether News or rumours reveal the close early. Default: no.
- `[CONFIRMED]` The 15-minute clock step costs nothing: no energy, no stress, no money (user decision 2026-11-04).
- `[PROVISIONAL]` As built: the path is made by previewing the next market step on a copy, so End day prints exactly the close the session ended on. At End day, the drawdown and wipe-out measures start from the price at the clock, so only the move still to come counts. Day 120 has no next step and its session is flat. The two session streams are kept off the market, so a session never changes a market hash or a daily fixture.

### Limit orders and exits `[PROVISIONAL]`

Added 2026-11-01 at the user's request. Built in plan Step 32. Numbers are placeholders.

- `[PROVISIONAL]` Besides market orders there are limit orders and, for an open position, a take profit and a stop loss. All of them rest on the game state and are checked against the 15-minute bars as the clock moves, and against the rest of the day's bars when End day is pressed. They carry over to the next day. Nothing about them is random and nothing moves a price.
- `[PROVISIONAL]` A limit buy must sit below the price at the clock and a limit sell above it. A bar fills it when the bar's low (buy) or high (sell) reaches the limit. The fill is at the limit, or at the bar's open if the bar opened past it. There is no spread. The 0.1% fee and the 5x check apply at fill time. An order that fails the check then is dropped and logged. At most 8 limit orders at once.
- `[PROVISIONAL]` A take profit or stop loss belongs to one position. For a long the take profit is above the price and the stop below, for a short the other way round. A stop fills at the stop, or at the bar's open if that is worse. A take profit fills at the target, or at a better open. Exits are not margin-checked, like any close. The fee applies, the spread does not. Closing or flipping the position removes its exits.
- `[PROVISIONAL]` Partial exits (added 2026-11-03): each exit is a level that closes a set number of shares, or the whole position when no number is set. Exits from before this change, and ones set without a number, close the whole position. A position holds up to 4 take profit and 4 stop loss levels, for example TP1 closing half and TP2 the rest. A level never closes more than is open, and a filled level is removed.
- `[PROVISIONAL]` Levels one bar reaches fill one after another, nearest the bar's open first, each at its own price or the open as above. If one bar touches a stop and a take profit, only the stops fill in that bar; the take profits stay for later bars.
- `[PROVISIONAL]` Reducing a position with another order shrinks any level set to close more than is left. Adding to a position leaves the levels' share counts as they are. A level without a number keeps covering the whole position.
- `[PROVISIONAL]` A limit order can carry a take profit and a stop loss, each closing all or a part of the order's shares. They are set when it fills and are live from the next bar. A whole-position level from a limit replaces the old whole-position level of its kind. A market order can set them right after it fills.
- `[PROVISIONAL]` Orders are placed in the market section. Cancelling works at any time. Limit orders do not reserve buying power. The 5x check is made when placing (as a hint) and again when filling.
- `[PROVISIONAL]` Bars are the only price path, so an exit can trigger on a bar's wick, which the player sees on the chart. Liquidation is also checked after every bar. The warning, wipe-out check and funding are still once a day at the close.
- `[PROVISIONAL]` Open orders and exits of the charted asset are drawn as dashed lines with a price tag on the right axis: gold for a limit, green for a take profit, red for a stop loss. Several levels of one kind are numbered from the price outwards (TP1, TP2), and a partial one shows the shares it closes. A level outside the visible range sits at the chart edge with an arrow.

### Events

- `[CONFIRMED]` Every event type has a per-day chance.
- `[CONFIRMED]` The direction chances of an event depend on the event itself and on the environment (economy, policy).
- `[CONFIRMED]` Event sources: news, general events, company moves, macro moves.
- `[PROVISIONAL]` An event type has: scope (one stock, one sector, or the whole market), a per-day chance, direction chances (up, down, no effect), a magnitude range, a duration and decay, and how it is shown (calendar, rumour, headline).
- `[PROVISIONAL]` First playable: about 15 to 25 event types, for example earnings beat or miss, product launch, scandal, management change, regulation, supply shock, demand shift, policy rate decision, growth data, inflation data.
- `[PROVISIONAL]` The player cannot change event rates.
- `[PROVISIONAL]` Changed 2026-11-03 (user decision): headline and rumour wording describes the fact, not the price move: "NOVA earnings beat", "NOVA cuts guidance", "Inflation data hotter than expected", "Market mood turns gloomy". The player works out the price effect. Each event type maps its price direction to a fact word in content (`directionWords`). Events whose fact already implies a lean (scandal, lawsuit, buyback) name only the fact.

### Macro calendar

- `[CONFIRMED]` The player sees a macro calendar.
- `[PROVISIONAL]` Scheduled items show their date in advance but not their outcome: a monthly policy rate decision (hold, up, down) and monthly growth and inflation releases.
- `[PROVISIONAL]` The outcome is rolled three days ahead but shown only from the day it happens, when its headline prints. Fixed 2026-11-03: the calendar panel used to show a rolled outcome up to three days early.

- `[PROVISIONAL]` Consensus (plan Step M7, user choice C1 on 2026-11-03). Each release and decision has a public consensus: the most likely outcome in its chance table at the last released values, so forecasters lag the hidden value. It uses no random draw and is fixed when the outcome is rolled, so it shows on the calendar from three days ahead, as "expected: stronger, in line, weaker" (inflation: hotter, in line, cooler; policy: hike, hold, cut). The headline judges the result against it ("Growth data stronger than expected", "Policy rate hike, as expected"). In the two days before a release, traders move prices toward the effect of the expected outcome, so a result that matches the consensus has less left to move and a surprise moves the price by about the actual effect minus the expected one. The release's effect on fair value is unchanged.

### Social feed `[PROVISIONAL]`

- `[PROVISIONAL]` (plan Step M10) An always-on feed of short retail posts under the news, from personas (hype, doom, bag holder, joker, insider). Posts are a window on the crowd, not a cause: they never move a price, and they use their own seeded stream and state, apart from the market.
- `[PROVISIONAL]` Three kinds: a mood post per stock on most days, whose direction follows the crowd's mood (so it shows how crowded a trade is); whispers about an event up to three days ahead, true about 28% of the time (below the lowest rumour tier at 35%) and likelier for an event informed money knows; and chatter stamped with a session time, reacting only to bars that have printed and hidden until the clock reaches it.
- `[PROVISIONAL]` Stress acts on posts under the same rule and cap as the news (none at stress 60, up to a quarter of the posts at stress 100), as its own channel so a long list of posts cannot raise the news cap. A post that agrees with an open position can be promoted to its loaded wording, and one that disagrees can be hidden. Nothing marks them (section 9). Verify shows every post in plain wording. The day report counts posts together with news.

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

### Free time: research and courses `[PROVISIONAL]`

Added 2026-11-03 at the user's request, so being jobless is a playstyle and not only "no salary".

- A day has two slots the player may spend on study instead:
  - Daytime (08:00–16:00), the work section. It is free only when jobless.
  - Evening, the 17:00–21:00 market session. Anyone can give it up before opening the market, and the market then stays closed that day.
- Each slot is used once a day, for one of two activities:
  - Research earns research points: 4 for a daytime, 2 for an evening, capped at 20. The run starts with 2.
  - Course study works toward the enrolled course: 2 units for a daytime, 1 for an evening, 6 units to finish.
- Studying costs a little energy at once: 4 for a daytime, 2 for an evening.
- Verify now costs one research point, on top of its energy. It is refused once the feed is already verified that day, or without a point.
- A course is enrolled with its one-time cash cost, one at a time. It is owned, and its jobs unlock, only when study finishes it.
- So a jobless player can research or study every day and still trade every evening. A worker earns points or course units only by skipping the market.

### Expenses and lifestyle

- `[CONFIRMED]` Lifestyle can be upgraded, and lifestyle sets trading time and usable capital.
- `[CONFIRMED]` The player pays monthly expenses.
- `[PROVISIONAL]` Upgrades change trading tools and conditions, and raise monthly expenses.
- `[PROVISIONAL]` The lowest lifestyle costs 1E a month.
- `[PROVISIONAL]` First-playable upgrades:
  - Home (3 tiers): faster energy and stress recovery. Each tier adds about 0.15E a month.
  - Information feed (2 tiers): more rumour sources, and a cleaner feed. Each tier adds about 0.1E a month.
  - Courses (Basic, Finance): a one-time cost of about 0.5E each. They unlock job requirements and add no monthly cost. Since 2026-11-03 the cost enrols; free-time study finishes the course (section 6, Free time).
- `[CONFIRMED]` The player can downgrade lifestyle as ordinary asset management, the same way they manage other assets (2026-10-22).
- `[CONFIRMED]` A downgrade does not return the money spent on the upgrade. It only lowers later bills.
- `[CONFIRMED]` A downgrade cannot be used at the moment a bill cannot be paid, to shrink that bill. The bill uses the lifestyle cost already in effect.

## 7. Trading Rules

### Orders and costs

- `[CONFIRMED]` The player can go long and short.
- `[CONFIRMED]` Trades cost a percentage fee plus a spread.
- `[PROVISIONAL]` Orders are market orders that fill at the current price during a trade session. No limit or stop orders in the first playable.
- `[PROVISIONAL]` The fee is a global percentage per trade. The spread is set per asset and widens on event days.
- `[PROVISIONAL]` Changed 2026-11-03: margin interest and the short borrow fee are replaced by funding (section 7, Funding). A bank loan (section 6) still pays its own interest.

### Leverage and margin

- `[CONFIRMED]` Liquidation is faster than a gentle margin call.
- `[CONFIRMED]` Changed 2026-11-03 at the user's request: leverage is chosen per position, from 1x to 50x, when the position is opened. It replaces the earlier account-wide cap of 5x. A position saved without a leverage counts as 5x.
- `[PROVISIONAL]` Margin for a position is its value divided by its leverage. The account needs equity of at least the margin of all positions together, so an order that would leave equity below that is rejected. A 1x position needs its full value and never borrows.
- `[PROVISIONAL]` Adding to an open position uses its leverage. To change it, close it first. Reducing keeps the leverage. A flip opens the new side at the leverage on the order.
- `[PROVISIONAL]` Margin ratio is equity divided by the required margin scaled to the old 5x account (five times the required margin). At 5x on every position this is the old equity over position value, so the marks below keep their meaning. In plain terms: the warning is at 75% of the required margin and liquidation at 50%.
- `[CONFIRMED]` A warning appears at a 15% ratio, shown on a visible margin meter. Liquidation happens when the end-of-day ratio is 10% or lower.
- `[PROVISIONAL]` Liquidation closes the worst-performing position first, and continues until the ratio is back above the warning level.
- `[PROVISIONAL]` Limit orders carry their leverage and open the position at it when they fill.
- `[PROVISIONAL]` Changed 2026-11-03, like a perpetual future: after every 15-minute bar of the session, if the ratio is at or below the 10% liquidation mark, whole positions close at that bar's quote, worst result first, until the ratio is above the warning mark. No warning or check event is logged inside the session. The end-of-day check still runs. A bar moves far less than a day, so a high-leverage position is closed before it gaps below zero.
- `[PROVISIONAL]` Liquidation fee: a position closed by liquidation also pays 0.5% of its value, on top of the trade fee. It is charged to trading cash and the realized ledger.

### Funding `[PROVISIONAL]`

- `[PROVISIONAL]` Every open position pays funding once a day, after the market step, on its value at the new price. It does not depend on leverage and it replaces margin interest and the short borrow fee.
- `[PROVISIONAL]` The rate is a base of 0.01% a day for both sides, plus a crowd charge for the side the day's move favoured: a rising day charges longs, a falling day charges shorts, at 5% of the move up to 0.2% a day. Examples: a long on a +8% day pays 0.21%, a short on that day pays 0.01%.
- `[PROVISIONAL]` The player only pays. There is no counterparty, so funding is never received. It is booked to trading cash (which may go negative) and to the realized ledger.

### Loss cap guarantee

- `[CONFIRMED]` Losses cannot exceed the account. There is no negative-balance debt.
- `[CONFIRMED]` The guarantee has two parts: a daily price-move cap tied to the leverage limit, and a small backstop. The third part, a ladder penalty on a wipe-out, was removed on 2026-10-22 because there is no failure ladder (section 8).
- `[CONFIRMED]` Daily price-move cap: a single day's price change is limited to 8%, below the 10% liquidation ratio, with room for fees and spread. At 5x or less an adverse move no larger than the ratio cannot take equity below zero before the end-of-day check.
- `[PROVISIONAL]` Above about 10x one capped day can gap through the liquidation mark and below zero. The backstop then floors equity at zero and the loss is written off, so losses still never exceed the account. High leverage is therefore the one place the backstop is expected to be used. Measure it in the batch report.
- `[PROVISIONAL]` Backstop: equity is floored at zero, and any rounding or spread shortfall is written off. The design test is that the backstop is never used beyond rounding at 5x or less.
- `[PROVISIONAL]` A wipe-out is a liquidation that leaves the trading account below 10% of its value at the start of the day. It does not end the run. It drains the trading account and adds a stress spike. The run ends only under section 8.
- `[PROVISIONAL]` The loss cap check is done once per day at the end-of-day check. Intraday checks are not part of the first playable.

## 8. Goal and Failure

### Financial independence win

- `[CONFIRMED]` The win condition is financial independence: all passive income (trading profit and interest), averaged over the last in-game month, covers expenses.
- `[PROVISIONAL]` Salary does not count as passive income. This is implied by "passive", but not stated by the user.
- `[PROVISIONAL]` Passive income over the last 30 days is the net trading result (realized profit minus losses, fees, spread, and borrow and margin interest) plus savings interest received.
- `[PROVISIONAL]` Unrealized profit does not count, so leverage cannot fake a win.
- `[PROVISIONAL]` Changed 2026-11-03 (user decision): an open loss does count. At each check the net unrealized result of all open positions, when below zero, is subtracted from the window. Before this, a player could bank winners, hold a large losing position, and win while net worth fell (seen in a playtest: a win at day 45 with a 50x position $1,880 under water).
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
- `[CONFIRMED]` First playable (option P3): both stats, a meter with a visible warning state, cosmetic effects, and biased news and posts. The per-item tell was dropped on 2026-11-03 (Telegraphing below).
- `[LATER]` Number distortion, candle distortion and UI order errors.
- `[PROVISIONAL]` The data model holds all four types, so they can be switched on one at a time.
- `[PROVISIONAL]` Which stat drives what: stress drives biased news. Energy drives the cosmetic effects (blur and short display-only delays). Later, energy drives number and candle errors, and stress drives order errors and overtrading urges.

### Telegraphing

- `[CONFIRMED]` Changed 2026-11-03 (user decision): the warning state is telegraphed, but distorted items carry no mark. Bent news and posts look like any other item, as real confirmation bias does. This replaces "the distortion has a subtle tell".
- `[PROVISIONAL]` The warning state is an always-visible meter for each stat that changes color in the warning zone.
- `[PROVISIONAL]` Added 2026-11-03 at the user's request: the edge of the screen shows the warning state. Stress above 60 draws a red glow that grows and pulses faster toward 100. Energy below 40 darkens the corners, more toward 0. "Reduce visual effects" stops the pulse but keeps the edge.
- `[PROVISIONAL]` After End day, the report says how many feed items stress bent that day, and whether the player verified. Verify still shows the true feed during the day.

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
- `[PROVISIONAL]` Added 2026-11-03 at the user's request: a Guide (top bar) as a reference, not a strategy. It teaches what news facts usually mean for companies, the economy and prices, introduces each (fictional) company and what makes it worth more, and explains the account rules.
  - Market behaviour (event sizes, durations, calendar effects, rumour reliability, stat thresholds) is described in rough terms (small, medium, large; a few days; leans bad) so following the guide is not a winning formula.
  - Account rules the player controls (fees, limit orders, exits, leverage, margin marks, payday) keep exact numbers.
  - A market psychology page teaches general concepts (expectations, pricing in, "buy the rumour, sell the news", overreaction, the player's own biases) as ideas real traders use. It never says when or whether the game's market behaves that way. The player learns the basics and combines them when market conditions support it.
- `[PROVISIONAL]` After End day a short report shows equity and cash changes, energy and stress, money lines (salary, interest, bill, funding, fees) and warnings. Paydays, bills, liquidations and job changes always show it. The top bar counts down to payday.
- `[PROVISIONAL]` The primer covers the basic news-to-price rules, sentiment, how rumour reliability works, the margin meter, and the warning state.
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

### Market depth ideas

Raised by the user on 2026-11-03 and built on 2026-11-04 as plan Steps M0 to M13 (`plans/2026-11-03-market-depth.md`), except the government party and scheduled earnings, which stay later. Each item below says where its rule now lives.

- `[PROVISIONAL]` **Social feed rework ("Y").** Built as the social feed (section 5, plan Step M10). The idea is kept here for its reasoning: Posts become an always-on feed of what other retail traders think, not only a stress effect. They can be true, fake or misleading. They are faster than the news (a post can hint at an event before its rumour or headline, and price may already be moving) but less reliable than rumours. Under stress the feed shows more emotionally loaded posts that agree with the player's positions, simulating traders filtering out signals against them. Constraint: posts still never change the market; the stress filter stays inside the bias cap, with no per-item mark (section 9).
- `[PROVISIONAL]` **Player price impact, company size and liquidity.** Built as stock size and liquidity (M2), slippage (M3, section 5 intraday) and the player's market orders joining the order flow (M13, section 5 price rules). The idea is kept for its reasoning: A very large order could move the price. Each stock would get a size (market cap) and liquidity (daily volume, depth). Trade-off: if player orders move the market, a seeded run no longer gives the same market whatever the player does (section 15, criterion 9, and the determinism rule). Recommended default: temporary impact only. A large order fills worse (slippage grows with size against liquidity) and the market path is unchanged, so replays stay identical.
- `[PROVISIONAL]` **Market participants.** Built as informed money, news traders, a retail crowd, trend followers and consensus traders, plus liquidity grabs in the session (section 5, plan Steps M4 to M9). The government party stays `[LATER]`. The idea is kept for its reasoning: Today prices move only from events, calendar releases, the environment's effect on event odds, a pull toward fair value and noise. Other parties (retail crowds, whales, institutions, governments, trading bots) do not exist. Idea: seeded parties with their own behaviour (news traders, momentum followers, dip buyers, stop hunters around obvious levels, informed money before events), so patterns such as pre-news drift, "sell the news", overreaction and liquidity grabs emerge from who is trading rather than being scripted per strategy. Constraint: parties draw only their own seeded streams, so a seed still replays the same market.
- `[PROVISIONAL]` **Expectations and pricing in.** Built for calendar releases as a public consensus that headlines are judged against and that traders price in (section 5 macro calendar, plan Step M7). Earnings stay random events (user choice E1); scheduled earnings dates stay `[LATER]`. The idea is kept for its reasoning: Calendar releases and earnings could be judged against a published consensus, and part of a coming event could be priced in early through informed flow, so "better than expected" matters more than "good". Likely built on the market participants idea.
- `[CONFIRMED]` **The 8% daily move cap** stays (user choice K1). After the order-flow parties it applies to 1.2% of stock-days, under the 3% mark that would have brought a per-stock cap back to the user (plan Step M11). The idea is kept for its reasoning: It comes from the loss cap guarantee (section 7): with the old 5x limit a day could not take equity below zero before the end-of-day check. With per-position leverage up to 50x and intraday liquidation that reason is weaker. Options: keep it as a circuit breaker (default), widen it, or replace it with per-stock limits tied to volatility.

### Later systems

- `[LATER]` FD and high-interest savings accounts. `[OPEN]` Their lock periods, penalties, rates and limits.
- `[LATER]` The in-game book (a first Guide exists since 2026-11-03, section 11): teaches news-event impact, including sentiment and some rare cases. After the book, either the player judges direction alone or the game shows the possible directions. `[OPEN]` Which of those two (Q 27 and 32). Hint direction and percentage can also be skewed by bad stats.
- `[LATER]` Number distortion, candle distortion and UI order errors (section 9).
- `[LATER]` Job loss through telegraphed layoffs.
- `[LATER]` Meta-progression: there is none in the first playable, and unlocks may come later.
- `[LATER]` A currency pair as a new asset.

## 13. Presentation and Technical Direction

- `[PROVISIONAL]` The trade screen is a terminal: a candle chart, an order rail, and a bottom subpanel for positions, life, news, and the day book. A candle's open is the previous close. From the intraday session on, 15m and 1H bars are real, a 1D candle's high and low come from the session path, and a volume bar is printed. 4H is not offered because the session is 4 hours (it would equal 1D). 1W groups 7 days and 1M groups 30.
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
- `[CONFIRMED]` Energy and stress with a meter and a visible warning state, cosmetic effects, and biased news and posts.
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
6. Notice the warning state, and use verify to see the true feed.
7. Recognize their own confirmation bias at least once, and say the game showed it fairly.
8. Reach FI in a skilled run, and fail in an average run, without it feeling arbitrary.
9. Replay a seeded run with the same commands and get the same market. The market matches an idle run whatever the stats do, unless a large order moved it.
10. Report that the game is interesting enough to replay.

## 16. Major Design Risks

### Price feels random, not learnable

The game needs signal in a noisy market. Hidden fair value, readable event rules, honest reliability tiers, the primer and the end-of-day summary are the mitigations.

### Price feels too predictable

A daily price-move cap means a big event plays out over several days, so the player can ride the move after a capped day. Noise, partly priced-in news, false rumours and overlapping events should keep it open. Test for it.

### Exploits

Free trading, trading loops, a free option on extreme leverage, and farming small gains are all possible. The fee plus spread, the borrow costs, the wipe-out penalty and the daily move cap are the mitigations.

### High leverage and the backstop `[PROVISIONAL]`

Measured 2026-11-03 with the harness bots `longNova10`, `longNova20`, `longNova50` and `shortNova50` (one NOVA position as large as the margin allows, opened again after a liquidation; 120 days, trading equity $3,000 at the start).

Before intraday liquidation and the fee (liquidation once a day, no fee, margin interest), 100 runs, seed `abc`:

| Bot | Mean final equity | Median | Backstop write-offs, 100 runs |
|---|---|---|---|
| longNova10 | $468 | $2 | $919 |
| longNova20 | $284 | $0 | $19,464 |
| longNova50 | $118 | $0 | $127,184 |
| shortNova50 | $5,139 | $0 | $108,853 |

The 50x short bot's mean was above the start (and $5,984 over 300 runs, seed `xyz`). The backstop turned every gap below zero into a free write-off while gains stayed uncapped, which is the "free option on extreme leverage" risk in section 16.

After intraday liquidation, the 0.5% fee and funding:

| Bot | Mean final equity | Median | 95th percentile | Backstop write-offs |
|---|---|---|---|---|
| random (1 share, 5x), 100 runs | $2,880 | $2,892 | $4,032 | $0 |
| longNova10, 100 runs | $270 | $3 | $1,325 | $0 |
| longNova20, 100 runs | $185 | $1 | $485 | $0 |
| longNova50, 100 runs | $0 | $0 | $0 | $22,476 |
| shortNova50, 100 runs | $3,041 | $0 | $53,177 | $22,915 |
| shortNova50, 300 runs (seed `xyz`) | $2,635 | $0 | $23,735 | $74,781 |

The backstop is no longer used at 10x and 20x and its use at 50x fell by about 80%. (Before slippage, see the next table.) The short bot's mean is now at or below the start, so the free option is mostly closed, but its tail is still fat (the best runs end near $20,000 to $50,000). `[OPEN]` Whether that tail is acceptable. The remaining gap-throughs come from event bars that move more than the 1% margin. Default: accept until the playtests.

After slippage (plan Step M3, 2026-11-04), seed `abc`, 100 runs, 120 days:

| Bot | Median | 90th percentile | Backstop write-offs |
|---|---|---|---|
| random (1 share, 5x) | $2,889 | $3,714 | $0 |
| longNova10 | $3 | $375 | $0 |
| longNova20 | $0 | $1 | $7,154 |
| longNova50 | $0 | $0 | $160,055 |
| shortNova50 | $0 | $0 | $151,468 |

Slippage removes the fat winning tail of the 50x short (the 95th percentile was $53,177 in the table above; the 90th is now $0) but a forced sale of a whole 50x position is far larger than one bar, so it pays the capped slippage and gaps below zero more often. Backstop use rose about seven times at 50x and reappeared at 20x. The player's result is the same (equity floors at $0), so this is a cost to the model, not to the player. User decision 2026-11-04: liquidations keep paying slippage, as in a real forced sale. The higher backstop use is accepted.

After the order-flow parties and the player's order flow (plan Steps M4 to M13, 2026-11-04), seed `abc`, 100 runs, 120 days:

| Bot | 90th percentile | Backstop write-offs |
|---|---|---|
| longNova20 | $2 | $6,357 |
| longNova50 | $0 | $151,090 |
| shortNova50 | $23,561 | $146,899 |

Backstop use is about what it was after slippage (M3). The 50x short's upper tail came back (its 90th percentile was $0 after M3): a huge short pushes the close down by its own flow and the next day's pull only gives that back in part, so a whole-account 50x order gains a little from its own push even after slippage. `[OPEN]` Whether the push should be smaller (more depth days) or the slippage larger so that moving the market never pays. A pump and dump inside one session still loses on average (tested over 120 seeds).

### Leverage plus distortion in a 30-minute run

5x leverage, faster liquidation and stress effects can end a run in one bad day. Safeguards: the margin meter, the daily move cap, a simulation script that runs many seeded days and reports blow-up rates, and capped distortion while highly leveraged (all provisional).

### Bias that feels rigged

If the bias rule is hidden or too strong, players feel cheated rather than taught. The stated rule, the cap, the warning state (meters and screen edge), the verify action and the end-of-day count are the mitigations. Since 2026-11-03 bent items carry no mark, so the playtest must check criterion 7 (the player says the game showed the bias fairly).

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

- 2026-11-04 (fill ledger): The game keeps a ledger of every fill (`GameState.fills`): market orders, limit fills, take profits, stop losses, liquidations and forced sales for missed loan interest. It is saved with the run, so History and P&L survive a reload and now include liquidations and forced sales. It is a record only and changes no price, draw or fixture. Saves from before it load with an empty ledger. The game also keeps a record of each closed day (the session bars, the closes and the closing equity, `GameState.past`), so a reloaded chart still has its candles and the fill marks on them. See [plans/2026-11-04-save-fill-history.md](plans/2026-11-04-save-fill-history.md).
- 2026-11-04 (clock step): User decision: the 15-minute clock step costs nothing (section 5, intraday session, was `[OPEN]`). This matches the code, so nothing changes in play. A plan to save the trade history is in [plans/2026-11-04-save-fill-history.md](plans/2026-11-04-save-fill-history.md).

- 2026-11-03 (win rule, free time): The FI check subtracts net open losses (section 8). Free time added: jobless daytime and a skipped market evening can go to research (points that verify spends) or course study (courses are now enrolled, then finished by study) (section 6).

- 2026-11-03 (telegraphing): User decision: stress-bent news and posts no longer carry the diamond and tint. The warning state is shown by the meters and a new screen-edge effect (red glow for stress, dark corners for low energy, both scaling with the stat), and the end-of-day report counts the bent items. Verify is unchanged (section 9).

- 2026-11-03 (guide and wording): Headlines and rumours describe the fact ("earnings beat", "inflation hotter than expected") instead of "up" or "down" (section 5). The calendar no longer shows an outcome before its day. The Guide describes market behaviour in rough terms, adds company profiles and a market psychology page, and keeps exact numbers only for account rules (section 11). Recorded the social feed, price impact, market participants, expectations and 8% cap ideas as open questions (section 12).

- 2026-11-03 (partial exits): Take profit and stop loss can close part of a position, and a position can hold up to 4 levels of each kind (section 5, "Limit orders and exits"). One bar touching a stop and a take profit fills only the stops. Old saves load, and their exits close the whole position.
- 2026-11-04: Plan Steps M11 and M12. The cap review keeps 8% (1.2% of stock-days capped, under the 3% mark). The Guide gained a Who else trades page and lines on consensus, posts, slippage and large orders, in rough terms. The market depth ideas in section 12 are marked built.
- 2026-11-04: Plan Step M13. The player's market orders join the order flow: a large order moves the rest of the session and the close, and orders below 2% of a stock's daily trading change nothing. The seeded rule is now "same seed and same commands, same market" (section 15 criterion 9).
- 2026-11-04: Plan Step M10. Added the social feed (section 5): always-on retail posts, whispers and session chatter, a window on the crowd with its own stream. Stress acts on the posts as a separate channel with the same cap, unmarked. The market and the market fixtures are unchanged; saves from before it are rejected only if their shape is wrong (the `social` key is optional).
- 2026-11-04: Plan Step M9. Liquidity grabs in the session: some bars wick through a round price or a recent high or low and return. Closes and fixtures are unchanged.
- 2026-11-04: Plan Step M7. Calendar consensus (C1): the calendar shows what is expected, headlines read against it, and consensus traders price it in over the two days before a release. Only the three calendar headline lines of the price log changed besides prices. Fixes the known gap "Growth release inline".
- 2026-11-04: Plan Step M6. A retail crowd (mood from rumours and headlines) and trend followers join the order flow. The crowd buys rumours and sells into the news, and a false rumour pumps then unwinds. The price log fixture was regenerated again; non-price lines are unchanged.
- 2026-11-04: Plan Step M5. News traders close part of the gap to news-adjusted fair value on event days, so the post-headline edge falls to about break-even for a 1x follower (Question 3). The price log fixture was regenerated again; non-price lines are unchanged.
- 2026-11-04: Plan Step M4. Informed money trades ahead of leaked events (section 5, hidden fair value and price). The price log fixture was regenerated on purpose; every non-price line of it is identical to before and the four main streams are unchanged. Old saves are rejected only if their shape is wrong (the new `participants` key is optional).
- 2026-11-04: Plan Step M3. Large market orders, stops and liquidations pay slippage against the bar volume (section 7). Limit orders and take profits do not. The order panel and the Guide show it. No market stream moved.
- 2026-11-04: Plan Step M2. Stocks have `sharesOutstanding` and `liquidityNotionalCents`. Session volume scales per stock and the header shows market cap. Prices, draws and fixtures are unchanged. Guide company pages say large or small, thin or deep.
- 2026-11-03 (later): Made leveraged trading more like a perpetual future. Liquidation is also checked after every 15-minute bar, a liquidation costs a 0.5% fee, and funding (0.01% a day plus a crowd charge) replaces margin interest and the short borrow fee. Old saves still load.
- 2026-11-03: Leverage is now chosen per position, 1x to 50x (user decision), replacing the account-wide 5x cap. Margin is value over leverage. The 15% and 10% marks, read against the required margin, are unchanged. Above about 10x the backstop can be used.
- 2026-11-01: Added limit orders, take profit and stop loss (plan Step 32), and order sizing by quantity, cost or value in the order panel. Old saves are rejected as damaged again.
- 2026-10-31: Built the intraday session (plan Step 28). Added `tick`, 15m and 1H candles, a volume panel and per-bar volume. Orders fill at the clock quote. Old saves are rejected as damaged.
- 2026-10-31: Intraday session and volume added to the design at the user's request. Orders become tradable intraday on a 15-minute clock over 17:00 to 21:00, with a hidden path ending at the day's existing close. Volume is cosmetic. Margin and liquidation stay end-of-day. 4H is dropped. Provisional values; no code changed yet.
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
