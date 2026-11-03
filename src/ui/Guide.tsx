// The guide book. It restates the current rules in plain words, with the provisional
// numbers from src/content and src/sim/constants. It does not add a mechanic. When a rule
// changes, change the matching topic here.

import { useState, type ReactNode } from 'react'

type Topic = { id: string; title: string; body: ReactNode }

const TOPICS: readonly Topic[] = [
  {
    id: 'day',
    title: 'A day',
    body: (
      <>
        <h3>Day numbers</h3>
        <p>
          The day in the top bar is the day you are trading. Its news, its calendar items and its session all lead to
          that day&apos;s close. A run has 120 days.
        </p>
        <h3>Sections</h3>
        <p>
          A day runs sleep, then work (if you have a job), then the market. Open market moves the clock to 17:00. The
          session is 17:00 to 21:00 in 16 bars of 15 minutes. You can only place orders while the market is open.
        </p>
        <h3>The clock and End day</h3>
        <ul>
          <li>The clock buttons move time forward. Prices move bar by bar, and orders fill at the price at the clock.</li>
          <li>End day plays the rest of the session, prints the close and starts the next day.</li>
          <li>A short report opens after End day. Paydays, bills, liquidations and job changes always open it.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'news',
    title: 'Reading the news',
    body: (
      <>
        <h3>Item types</h3>
        <table>
          <thead>
            <tr>
              <th>Tag</th>
              <th>What it is</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Headline</td>
              <td>A real event that starts today. Always true.</td>
            </tr>
            <tr>
              <td>Rumour · high / medium / low</td>
              <td>
                A claim about an event 1 to 3 days ahead, from a named source. It can be false. The tier is honest: high
                is right most of the time, medium a bit more often than not, low less often than not.
              </td>
            </tr>
            <tr>
              <td>Post · low</td>
              <td>Social chatter. Never a market event. It only shows when you are stressed.</td>
            </tr>
            <tr>
              <td>Calendar</td>
              <td>Scheduled macro dates. Never biased. The outcome is unknown until the day.</td>
            </tr>
          </tbody>
        </table>
        <h3>Wording</h3>
        <ul>
          <li>
            &quot;Up&quot; and &quot;down&quot; always describe the effect on the price. &quot;Inflation data up&quot;
            means the inflation news pushes prices up, not that inflation rose.
          </li>
          <li>&quot;None&quot; means the event happened but does not move fair value.</li>
          <li>
            Some headlines carry no direction, such as &quot;NOVA scandal&quot;. Use the event&apos;s usual lean in the
            Events topic. A scandal is down three times in four.
          </li>
          <li>&quot;Sector A&quot; and &quot;Sector B&quot; are groups of stocks. See Sectors.</li>
        </ul>
        <h3>Reading and verifying</h3>
        <p>
          Without reading you only see the top headline. Read costs 2 energy and opens the whole day&apos;s feed. Verify
          costs 2 energy and swaps in the true feed when stress has bent it (see Energy and stress).
        </p>
      </>
    ),
  },
  {
    id: 'sectors',
    title: 'Sectors and scope',
    body: (
      <>
        <h3>Assets</h3>
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Stocks</th>
              <th>Leans on</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sector A (growth)</td>
              <td>NOVA, BLSW</td>
              <td>Growth data. More volatile, wider spread.</td>
            </tr>
            <tr>
              <td>Sector B (rates)</td>
              <td>HRBU, KSR</td>
              <td>Interest rates and inflation. Calmer, tighter spread.</td>
            </tr>
            <tr>
              <td>Index</td>
              <td>M4X</td>
              <td>Follows the four stocks together.</td>
            </tr>
          </tbody>
        </table>
        <h3>Scope of an event</h3>
        <ul>
          <li>Stock news (earnings, scandal, buyback…) moves one stock.</li>
          <li>Sector news (regulation, supply shock, demand shift, input costs) moves both stocks in that sector.</li>
          <li>Market news (sentiment, inflation data, growth data) moves every stock.</li>
        </ul>
        <p>Effects stack: a stock can feel its own news, its sector&apos;s and the market&apos;s on the same day.</p>
      </>
    ),
  },
  {
    id: 'prices',
    title: 'How news moves prices',
    body: (
      <>
        <h3>Fair value</h3>
        <p>
          Every stock has a hidden fair value. Events add to it. Each day the price moves part of the way toward fair
          value, plus noise. Your orders never move prices.
        </p>
        <h3>Timing</h3>
        <ul>
          <li>An event has a size, a duration of 2 to 5 days and a shape.</li>
          <li>Front-loaded events put most of the push on the first day and less on each later day.</li>
          <li>Linear events push the same amount each day.</li>
          <li>
            The price then chases fair value, so the move arrives over several days. On a typical stock headline about a
            quarter of the move happens on the event day and most of the rest over the next 3 to 5 days.
          </li>
          <li>No close can move more than 8% from the previous close. Anything left over plays out on later days.</li>
        </ul>
        <h3>Sentiment versus data</h3>
        <ul>
          <li>
            Sentiment swings are market-wide, small (1 to 3%), short (2 days) and can go either way. They are noise you
            can ride, not a trend.
          </li>
          <li>
            Inflation and growth data shocks are market-wide and last 3 days. Inflation news leans down, growth news
            leans up.
          </li>
          <li>
            Calendar releases are scheduled each month: growth on day 10, inflation on day 20 and the rate decision on day
            25. They hit the sectors differently (see Calendar).
          </li>
        </ul>
        <h3>Environment</h3>
        <p>
          Growth and inflation drift slowly. Strong growth makes good company news more likely. High inflation makes bad
          news more likely and rate hikes more likely.
        </p>
      </>
    ),
  },
  {
    id: 'events',
    title: 'Events',
    body: (
      <>
        <p>Chances are per stock or sector per day. Size is the push on fair value. All numbers are provisional.</p>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Usual lean</th>
              <th>Size</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Earnings</td><td>Either way</td><td>2–6%</td><td>3, front-loaded</td></tr>
            <tr><td>Scandal</td><td>Down (75%)</td><td>3–8%</td><td>4, front-loaded</td></tr>
            <tr><td>Lawsuit</td><td>Down (70%)</td><td>2–5%</td><td>3, front-loaded</td></tr>
            <tr><td>Product launch</td><td>Up (70%)</td><td>1–4%</td><td>2, front-loaded</td></tr>
            <tr><td>Contract award</td><td>Up (65%)</td><td>1–4%</td><td>2, front-loaded</td></tr>
            <tr><td>Share buyback</td><td>Up (60%)</td><td>1–3%</td><td>2, linear</td></tr>
            <tr><td>Guidance</td><td>Either way</td><td>1–4%</td><td>2, front-loaded</td></tr>
            <tr><td>Dividend</td><td>Either way</td><td>1–3%</td><td>2, linear</td></tr>
            <tr><td>Management change</td><td>Either way</td><td>1–3%</td><td>2, linear</td></tr>
            <tr><td>Regulation (sector)</td><td>Down (55%)</td><td>2–5%</td><td>5, linear</td></tr>
            <tr><td>Supply shock (sector)</td><td>Down (65%)</td><td>2–6%</td><td>3, front-loaded</td></tr>
            <tr><td>Input cost shock (sector)</td><td>Down (65%)</td><td>1–4%</td><td>3, front-loaded</td></tr>
            <tr><td>Demand shift (sector)</td><td>Up (50%)</td><td>1–4%</td><td>3, linear</td></tr>
            <tr><td>Sentiment (market)</td><td>Either way</td><td>1–3%</td><td>2, linear</td></tr>
            <tr><td>Inflation data (market)</td><td>Down (50%)</td><td>1–4%</td><td>3, linear</td></tr>
            <tr><td>Growth data (market)</td><td>Up (50%)</td><td>1–4%</td><td>3, linear</td></tr>
          </tbody>
        </table>
        <p>
          Big, front-loaded, one-sided events (scandal, lawsuit, earnings) follow through most reliably. Small linear
          ones (buyback, dividend) are easily drowned by daily noise.
        </p>
      </>
    ),
  },
  {
    id: 'calendar',
    title: 'Calendar',
    body: (
      <>
        <p>Each 30-day month has three scheduled items. The push on fair value by sector:</p>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Outcome</th>
              <th>Sector A</th>
              <th>Sector B</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Growth (day 10)</td><td>Above</td><td>+3%</td><td>+1%</td></tr>
            <tr><td></td><td>Below</td><td>−2.5%</td><td>−0.8%</td></tr>
            <tr><td>Inflation (day 20)</td><td>Above</td><td>−1%</td><td>−2.5%</td></tr>
            <tr><td></td><td>Below</td><td>+0.8%</td><td>+1.5%</td></tr>
            <tr><td>Rate decision (day 25)</td><td>Hike</td><td>−1.5%</td><td>−4%</td></tr>
            <tr><td></td><td>Cut</td><td>+1%</td><td>+3%</td></tr>
            <tr><td></td><td>Hold</td><td>+0.25%</td><td>−0.25%</td></tr>
          </tbody>
        </table>
        <p>In-line releases move prices only a little. Hikes are more likely when inflation runs high.</p>
      </>
    ),
  },
  {
    id: 'rumours',
    title: 'Rumours and psychology',
    body: (
      <>
        <h3>Using rumours</h3>
        <ul>
          <li>A true rumour is followed by its event 1 to 3 days later. A false one is followed by nothing.</li>
          <li>Acting on a rumour gets you in before the headline, at the cost of sometimes being wrong.</li>
          <li>Weigh the tier first: one high-tier rumour is worth more than a pile of low-tier ones.</li>
        </ul>
        <h3>&quot;Buy the rumour, sell the news&quot;</h3>
        <p>
          In real markets traders price a rumour in early, so the price can fall when the news lands. Here prices do not
          move on rumours. They move on events, and most of an event&apos;s move comes after its headline. Selling the
          moment the headline prints usually leaves money on the table. Getting out after the event&apos;s duration is
          closer to the rules.
        </p>
        <h3>Your own bias</h3>
        <p>
          When stressed you see more news that agrees with your positions. A position you love is the one to verify.
        </p>
      </>
    ),
  },
  {
    id: 'orders',
    title: 'Orders and positions',
    body: (
      <>
        <h3>Market and limit orders</h3>
        <ul>
          <li>
            A market order fills now at the price at the clock, plus half the spread, plus a 0.1% fee. The spread doubles
            on a stock&apos;s event days.
          </li>
          <li>
            A limit buy rests below the price and a limit sell above it. It fills when a bar reaches it, at your price or
            better, with no spread. It stays across days until filled or cancelled. At most 8 at once.
          </li>
        </ul>
        <h3>A second order on a pair you already hold</h3>
        <ul>
          <li>
            Same direction (buy while long, sell while short): it adds to the position. The entry becomes the average
            price. It must use the same leverage as the position, or it is rejected. Your take profit and stop loss stay,
            and now close the bigger position.
          </li>
          <li>Opposite direction, smaller: it reduces the position and realizes the profit or loss on that part.</li>
          <li>Opposite direction, same size: it closes the position and cancels its take profit and stop loss.</li>
          <li>
            Opposite direction, bigger: it closes the position and opens the rest the other way (a flip) at the leverage
            you picked. The old take profit and stop loss are cancelled.
          </li>
        </ul>
        <h3>Take profit and stop loss</h3>
        <ul>
          <li>For a long, the take profit must be above the price and the stop below it. For a short, the other way round.</li>
          <li>
            On a limit order the check is against your limit price. On an open position it is against the price at the
            clock.
          </li>
          <li>
            A level on the wrong side is rejected with a message. Nothing is placed, and any level you set before stays
            as it was.
          </li>
          <li>
            A stop fills at the stop, or at a worse bar open if the price jumps past it. A take profit fills at the target
            or a better open. If one bar touches both, the stop wins.
          </li>
          <li>Both close the whole position.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'margin',
    title: 'Leverage and margin',
    body: (
      <>
        <ul>
          <li>Leverage is set per position, from 1x to 50x. Margin used is the position value divided by its leverage.</li>
          <li>Free margin is trading equity minus margin used. A new order needs enough free margin.</li>
          <li>
            The warning comes when trading equity falls to 75% of margin used. Liquidation comes at 50%. It is checked
            after every 15-minute bar and at the close.
          </li>
          <li>
            A liquidation closes whole positions, worst first, until you are back above the warning. It costs 0.5% of the
            value on top of the fee.
          </li>
          <li>
            Every open position pays funding once a day: 0.01% of its value, plus up to 0.2% more for the side the
            day&apos;s move favoured. You never receive funding.
          </li>
          <li>At 50x with all your equity in one position, a move of about 1% against you liquidates it.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'money',
    title: 'Money and payday',
    body: (
      <>
        <h3>Accounts</h3>
        <ul>
          <li>Cash pays bills, food and drink, lifestyle and courses.</li>
          <li>The trading account pays for positions. Move money between accounts in the Accounts panel.</li>
          <li>Savings earn interest linked to the policy rate.</li>
        </ul>
        <h3>Payday</h3>
        <p>
          At the close of every 30th day (30, 60, 90 and 120) these happen in order. The top bar counts down to it.
        </p>
        <ol>
          <li>Salary for the days you worked arrives in cash.</li>
          <li>Savings interest arrives.</li>
          <li>Loan interest is charged at the policy rate plus 4 points a year.</li>
          <li>The monthly bill (base costs plus lifestyle) is charged to cash.</li>
        </ol>
        <h3>When cash is short</h3>
        <ul>
          <li>An unpaid bill blocks End day. Move money into cash, withdraw savings or take a loan, then pay it.</li>
          <li>If cash, savings, trading equity and unused loan room together cannot cover it, the run is lost.</li>
          <li>Unpaid loan interest sells your worst positions, then savings.</li>
        </ul>
        <h3>Winning</h3>
        <p>You reach financial independence when passive income covers your expenses for 5 days.</p>
      </>
    ),
  },
  {
    id: 'stats',
    title: 'Energy and stress',
    body: (
      <>
        <ul>
          <li>Work, short sleep and reading the news cost energy. Work, losses, margin warnings and short sleep add stress.</li>
          <li>Nothing recovers on its own. Food and drink restore energy or lower stress, each once a day.</li>
          <li>Energy below 40 or stress above 60 is the warning state, and the meters change colour.</li>
          <li>
            Above 60 stress, up to a quarter of the news can lean toward your open positions. Bent items carry a small
            diamond: that is the tell.
          </li>
          <li>Low energy blurs and delays the feed.</li>
          <li>The market, events and fills never change. Only what you see does.</li>
        </ul>
      </>
    ),
  },
]

export function Guide({ onClose }: { onClose: () => void }) {
  const [topic, setTopic] = useState(TOPICS[0]?.id ?? 'day')
  const current = TOPICS.find((item) => item.id === topic) ?? TOPICS[0]

  return (
    <div className="report-backdrop" onClick={onClose}>
      <section
        className="guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className="guide-head">
          <h2 id="guide-title">Guide</h2>
          <button type="button" className="primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
        <nav className="guide-topics" aria-label="Guide topics">
          {TOPICS.map((item) => (
            <button key={item.id} type="button" aria-pressed={item.id === topic} onClick={() => setTopic(item.id)}>
              {item.title}
            </button>
          ))}
        </nav>
        <div className="guide-body">{current?.body}</div>
      </section>
    </div>
  )
}
