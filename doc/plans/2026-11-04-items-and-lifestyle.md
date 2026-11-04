# Trading Sim: Consumable Items and Lifestyle Benefits

Date: 2026-11-04  
Status: draft. Question 1 answered (option B, items with trade-offs). No step starts before the user answers questions 2 to 8 in section 7. Every number here is a placeholder, provisional in this plan only.  
Design source of truth: [../GAME_DESIGN.md](../GAME_DESIGN.md), section 6 (Expenses and lifestyle) and section 9 (Stats). It closes the `[OPEN]` item list in section 9 and open question 1 in section 17. It changes no `[CONFIRMED]` rule; where an option would, it says so.  
Format: like [2026-11-03-market-depth.md](2026-11-03-market-depth.md). Step ids are `L1`, `L2`… Status values: `todo`, `done`, `verified`, `failed`, `blocked`.

## 1. Goal

Make energy and stress a loop the player manages, not a meter that only falls, and make every lifestyle tier worth its monthly cost. Food and drink should be cheap, everyday choices with clear trade-offs. A lifestyle upgrade should change how a day feels, not only the bill.

## 2. Where it is today

Read from the code on 2026-11-04.

- **Items** (`src/content/consumables.ts`): four items, each usable once a day, paid from cash, applied at once.
  - Coffee: $10, +15 energy.
  - Herbal tea: $10, −12 stress.
  - Home-cooked meal: $20, +8 energy, −6 stress.
  - Night out: $60, −25 stress.
  - The only perk that touches them is Steady routine (office clerk), which gives 10% more stress relief.
- **Daily change** (`applyEndOfDayStats`): energy falls by the job's cost (0 to 20 a day), stress rises by the job's cost (0 to 15). Short sleep, a 10% drawdown, a margin warning and a wipe-out add more. **Nothing recovers on its own.**
  - A jobless player never loses energy or stress except by reading, verifying or studying.
  - A night-shift worker loses 20 energy and gains 12 stress a day. Coffee and tea once a day just about hold that, for $20 a day, about $600 a month. That is 0.6E against a 1.3E salary.
  - Stats matter through the warning state (energy below 40 or stress above 60): blur and delays from low energy, bent news and posts from high stress.
- **Lifestyle** (`src/sim/lifestyle.ts`, `src/content/lifestyle.ts`):
  - **Home** (3 tiers, +$150 a month each): **does nothing.** The code says "Recovery is not applied yet"; section 9 put it on hold until the item list exists. Besides the cost, it only raises the loan limit.
  - **Information feed** (2 tiers, +$100 a month each): adds a medium source, then a high source, and hides noise.
  - **Courses**: enrol for $500, finished by free-time study, unlock jobs.
  - An upgrade costs twice the monthly amount it adds. A downgrade refunds nothing and only lowers later bills.
- **UI**: `Consumables.tsx` on the Life tab lists the items as buttons; `LifestylePanel.tsx` shows the tiers with a one-line note.

## 3. Rules every option must keep

- Food and drink cost money and do not take a section of the day (`[CONFIRMED]`, section 9).
- Some items restore energy, some stress, some both, each with its own amounts and cost (`[CONFIRMED]`).
- Lifestyle can be upgraded, sets trading time and usable capital, and raises monthly expenses. A downgrade refunds nothing and cannot shrink a bill already due (`[CONFIRMED]`, section 6).
- Expenses are the current lifestyle's cost, so upgrades raise the bar for the financial independence win (section 8).
- Stats never touch the market or another party's behaviour (section 15). No new randomness; if one is needed it uses its own derived stream.
- Debug rule: every effect writes typed log events (`statChange` with a cause), shown in the Day book.

## 4. Consumable items

### 4.1 Options

**A. Longer flat menu.** About eight items, each a fixed cost and a fixed change, once a day. The smallest change: content only.

**B. Items with a trade-off (recommended).** Same as A, but some items have a catch, so the choice is not just "buy the best value":
- a side cost at once (coffee adds a little stress, a gym session costs energy);
- an after-effect the next morning (an energy drink crashes, a night out leaves a hangover);
- a requirement (a home-cooked meal needs a kitchen, Home tier 1 or more).

One new mechanic: a small list of "tomorrow" effects that the end of day applies, logged like any other stat change.

**C. B plus tolerance.** The same item on several days in a row gives less each time (coffee every day ends up at half). More realistic, but harder to read and to balance. Suggested as later.

### 4.2 Item list for option B (placeholders)

Prices assume 1E = $1,000 a month, so $10 is 1% of the base bill.

| Item | Cost | Now | Next morning | Requirement |
| --- | --- | --- | --- | --- |
| Coffee | $4 | +12 energy, +2 stress | — | — |
| Energy drink | $6 | +22 energy | −10 energy | — |
| Herbal tea | $3 | −8 stress | — | — |
| Takeaway meal | $18 | +10 energy, −5 stress | — | — |
| Home-cooked meal | $8 | +10 energy, −6 stress | — | Home tier 1 |
| Gym session | $12 | −15 stress, −6 energy | +4 energy | — |
| Night out | $60 | −28 stress | −12 energy | — |
| Massage | $80 | −35 stress, +5 energy | — | — |

Each item stays once a day. Steady routine keeps its 10% extra stress relief.

## 5. Lifestyle benefits

### 5.1 Overnight recovery (the base for Home)

Add a small recovery at every End day, after the job and sleep costs, scaled by Home tier. Without it Home has nothing to improve, and a jobless player's meters never move on their own.

| Home tier | Monthly | Energy per night | Stress per night | Extra |
| --- | --- | --- | --- | --- |
| 0 (shared room) | base 1E | +4 | −3 | — |
| 1 (studio) | +$150 | +7 | −5 | Kitchen: unlocks the home-cooked meal |
| 2 (flat) | +$300 | +10 | −7 | Quiet room: short-sleep penalty halved |
| 3 (house with a study) | +$450 | +13 | −9 | Home office: stress from a drawdown or margin warning halved |

Recovery only happens when the player sleeps the full night (it is skipped on a short-sleep day, so a night shift pays twice).

### 5.2 Information feed (kept, small additions)

Keep both tiers. Suggested extras:
- Tier 1: the first news read each day is free (the same as the Quiet breaks perk; it does not stack).
- Tier 2: Verify costs no energy (still one research point).

### 5.3 New categories (pick any)

- **Health** (gym membership, 1 tier, +$80 a month): the gym session item is free, and stress never rises above 90 from the job alone.
- **Equipment** (2 tiers, +$60 and +$120 a month):
  - Tier 1, a second screen: the low-energy blur and delay effects are halved.
  - Tier 2, a pro platform: the trading fee drops from 0.1% to 0.08%.
  - This is the "lifestyle sets trading conditions" link from section 6.
- **Transport** (1 tier, +$100 a month): a job's energy cost is 3 lower each day. Helps workers, not jobless players.

### 5.4 Usable capital and trading time

Section 6 says lifestyle "sets trading time and usable capital". Today only the loan limit (+0.25E per tier) does that. Options:
- keep usable capital at the loan limit (no change, suggested for now);
- trading conditions through Equipment (5.3): a lower fee, or a lower liquidation fee;
- trading time is already open to everyone every evening, so a tier that adds trading time would need a new session (for example a pre-market hour). Suggested as later.

## 6. Steps

| Step | Work | Status |
| --- | --- | --- |
| L0 | Baseline: a harness report of monthly item spend and warning days per job, with the current four items, when a bot buys just enough to stay out of warning. | todo |
| L1 | Item list and the "next morning" effects (option B): `ConsumableDefinition` gains optional `next` energy/stress and `requires` (home tier). The end of day applies and logs them. Tests: cost, effect, requirement, the next-morning change, once a day. | todo |
| L2 | Overnight recovery by Home tier (5.1), skipped on short sleep. Tests and a GAME_DESIGN rule; the Home note in `content/lifestyle.ts` describes it. | todo |
| L3 | Home extras (kitchen, quiet room, home office) and the information feed extras (5.2). | todo |
| L4 | New categories the user picks (5.3). `LIFESTYLE_CATEGORIES` grows; save shape and the loan limit follow. Old saves load with the new tiers at 0. | todo |
| L5 | UI: the Life tab shows each item's effect now and next morning, its requirement, and each lifestyle tier's benefit in words; the day report lists recovery. Guide page "Food, sleep and home". | todo |
| L6 | Balance: rerun L0. Target: a worker can stay out of warning for about 15% to 30% of their pay, and Home tier 2 pays for itself in item savings for a worker within a month or two. | todo |

## 7. Questions for the user

1. **Item model:** A (flat list), B (trade-offs and next-morning effects, recommended) or C (B plus tolerance)? **Answer (2026-11-04): B.**
2. **The item list:** keep the table in 4.2 as the starting point, or change names, prices or effects?
3. **Overnight recovery:** add a base recovery scaled by Home tier (recommended)? Should it skip short-sleep nights?
4. **Home extras:** kitchen, quiet room, home office as in 5.1?
5. **Information feed extras:** the free first read and free-energy Verify, or leave the feed as it is?
6. **New categories:** which of Health, Equipment, Transport, or none?
7. **Trading conditions:** may Equipment lower the trading fee (a broker tier)? It changes a rule players already know.
8. **Upgrade price:** keep "an upgrade costs twice the monthly amount it adds", or change it?
