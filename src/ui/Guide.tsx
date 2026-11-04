// The guide book. A reference, not a strategy: it teaches what the news means and how the
// rules work, in plain words. Market behaviour (event sizes, timing, calendar effects, rumour
// reliability, stat thresholds) is described in rough terms on purpose, so the player still
// has to read the market. Account rules the player controls (orders, exits, leverage,
// margin, payday) keep their exact numbers. It does not add a mechanic. When a rule
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
          The day in the top bar is the day you are trading. Its news and its session lead to that day&apos;s close. A run
          lasts 120 days.
        </p>
        <h3>How a day goes</h3>
        <ul>
          <li>Sleep, then work if you have a job, then the market from 17:00 to 21:00.</li>
          <li>You can read the news and manage your life at any time. You can only trade while the market is open.</li>
          <li>The clock buttons move time forward 15 minutes at a time. Prices move as the clock runs.</li>
          <li>End day plays out the rest of the session, prints the close and starts tomorrow.</li>
          <li>A short report follows. Paydays, bills and liquidations always show it.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'news',
    title: 'Reading the news',
    body: (
      <>
        <h3>What you see</h3>
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
              <td>Something that really happened today.</td>
            </tr>
            <tr>
              <td>Rumour · high / medium / low</td>
              <td>A claim about something coming in the next few days. It can be wrong. The tier says how trustworthy the source is.</td>
            </tr>
            <tr>
              <td>Post</td>
              <td>Chatter from other traders. Never official, often wrong. For now it only shows up when you are stressed.</td>
            </tr>
            <tr>
              <td>Calendar</td>
              <td>Scheduled economic releases. Always honest. You learn the result on the day.</td>
            </tr>
          </tbody>
        </table>
        <h3>Headlines describe the fact</h3>
        <p>
          A headline tells you what happened, not what the price will do. Working out the effect is your job. The basics
          are in What the news means.
        </p>
        <h3>Reading costs energy</h3>
        <p>
          Without reading you only see the top headline. Reading opens the whole feed for the day. Verify shows the true
          feed when stress has bent what you see. It costs a research point, earned in free time.
        </p>
      </>
    ),
  },
  {
    id: 'meaning',
    title: 'What the news means',
    body: (
      <>
        <h3>Company news</h3>
        <table>
          <thead>
            <tr>
              <th>Fact</th>
              <th>Usually means</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Earnings beat / miss</td><td>Profits were better / worse than hoped. Good / bad for the stock.</td></tr>
            <tr><td>Raises / cuts guidance</td><td>The company expects better / worse times ahead.</td></tr>
            <tr><td>Raises / cuts its dividend</td><td>More / less cash returned to owners. A sign of confidence / strain.</td></tr>
            <tr><td>Product launch, contract award</td><td>New income. Usually good.</td></tr>
            <tr><td>Share buyback</td><td>The company buys its own shares. Usually mildly good.</td></tr>
            <tr><td>Scandal, lawsuit</td><td>Fines, lost trust, distraction. Usually bad.</td></tr>
            <tr><td>Management change</td><td>Could go either way.</td></tr>
          </tbody>
        </table>
        <h3>Sector news</h3>
        <ul>
          <li>Regulation, supply shocks and higher input costs squeeze a whole sector. Usually bad.</li>
          <li>A demand shift changes how much people want a sector&apos;s products. Often good, not always.</li>
        </ul>
        <h3>The economy</h3>
        <table>
          <thead>
            <tr>
              <th>Fact</th>
              <th>Usually means</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Growth stronger than expected</td>
              <td>Companies sell more. Good for stocks, best for growth companies (sector A).</td>
            </tr>
            <tr>
              <td>Inflation hotter than expected</td>
              <td>Costs rise and rate hikes get likelier. Bad for stocks, worst for rate-sensitive ones (sector B).</td>
            </tr>
            <tr>
              <td>Policy rate hike</td>
              <td>Borrowing costs more. Bad for stocks, hardest on sector B.</td>
            </tr>
            <tr>
              <td>Policy rate cut</td>
              <td>Borrowing is cheaper. Good for stocks, best for sector B.</td>
            </tr>
            <tr>
              <td>Market mood turns upbeat / gloomy</td>
              <td>Traders feel braver / more scared. Lifts / drops everything a little, briefly.</td>
            </tr>
          </tbody>
        </table>
        <p>The opposite fact (weaker growth, cooler inflation) usually has the opposite effect.</p>
      </>
    ),
  },
  {
    id: 'companies',
    title: 'Companies',
    body: (
      <>
        <p>All companies are fictional.</p>
        <h3>NOVA · Nova Dynamics (sector A, growth)</h3>
        <p>
          A young chip and software designer that lives on new products. Its price is the jumpiest of the four and its
          spread the widest. It reacts most to growth data, launches and earnings, and it pays little back to owners. A mid-sized company with thin trading, so a big order stands out.
        </p>
        <h3>BLSW · Blueswell Networks (sector A, growth)</h3>
        <p>
          An established network and cloud provider. Still a growth business, but calmer than NOVA. Big contracts and
          guidance matter. A strong economy helps it, a weak one hurts. The largest and most heavily traded of the four.
        </p>
        <h3>HRBU · Harbour Utilities (sector B, rates)</h3>
        <p>
          Power and water for the city. Steady income, reliable dividends and a lot of borrowing to fund its plants. That
          makes it sensitive to interest rates and regulation more than to growth. The calmest stock, with the tightest
          spread. Large and easy to trade.
        </p>
        <h3>KSR · Kestrel Realty (sector B, rates)</h3>
        <p>
          Owns and rents out offices and homes, funded with loans. Rate decisions and inflation move it a lot, and building
          costs hit it through input-cost shocks. Moderately volatile. The smallest company and the thinnest to trade.
        </p>
        <h3>M4X · Market 4 Index</h3>
        <p>
          The four stocks in equal parts. It moves with the whole market: good for trading the economy rather than one
          company.
        </p>
        <h3>What makes a company worth more</h3>
        <ul>
          <li>Profits now and expected later (earnings, guidance, products, contracts).</li>
          <li>Cash returned to owners (dividends, buybacks).</li>
          <li>Risks (lawsuits, scandals, regulation, management quality).</li>
          <li>The economy around it (growth, inflation, interest rates).</li>
        </ul>
      </>
    ),
  },
  {
    id: 'prices',
    title: 'How prices move',
    body: (
      <>
        <h3>Fair value</h3>
        <p>
          Every stock has a hidden fair value: what it is really worth. News changes it. The price drifts toward it over
          time, with everyday noise on top.
        </p>
        <h3>Timing</h3>
        <ul>
          <li>Some news hits hardest on the first day and fades. Some pushes evenly for several days.</li>
          <li>The price chases fair value, so a move can keep going for days after the news.</li>
          <li>A single day can only move so far. Very big news plays out over several days.</li>
          <li>Several pieces of news can stack, or cancel each other out.</li>
        </ul>
        <h3>Mood versus data</h3>
        <ul>
          <li>Market mood is small, short and can flip. It is noise you can ride, not a trend.</li>
          <li>Economic data lasts a few days and hits sectors differently.</li>
          <li>Company news moves one stock. Sector news moves its two stocks. Economic news moves everything.</li>
        </ul>
        <h3>The economy drifts</h3>
        <p>
          Growth and inflation change slowly in the background. A strong economy brings more good company news. High
          inflation brings more bad news and more rate hikes.
        </p>
      </>
    ),
  },
  {
    id: 'events',
    title: 'Events',
    body: (
      <>
        <p>A rough guide. Every event varies in size, and noise can hide a small one.</p>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Usually</th>
              <th>Size</th>
              <th>Lasts</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Earnings</td><td>Either way</td><td>Large</td><td>Medium</td></tr>
            <tr><td>Scandal</td><td>Bad</td><td>Large</td><td>Medium</td></tr>
            <tr><td>Lawsuit</td><td>Bad</td><td>Medium</td><td>Medium</td></tr>
            <tr><td>Product launch</td><td>Good</td><td>Medium</td><td>Short</td></tr>
            <tr><td>Contract award</td><td>Good</td><td>Medium</td><td>Short</td></tr>
            <tr><td>Share buyback</td><td>Leans good</td><td>Small</td><td>Short</td></tr>
            <tr><td>Guidance</td><td>Either way</td><td>Medium</td><td>Short</td></tr>
            <tr><td>Dividend</td><td>Either way</td><td>Small</td><td>Short</td></tr>
            <tr><td>Management change</td><td>Either way</td><td>Small</td><td>Short</td></tr>
            <tr><td>Regulation (sector)</td><td>Leans bad</td><td>Medium</td><td>Long</td></tr>
            <tr><td>Supply shock (sector)</td><td>Bad</td><td>Large</td><td>Medium</td></tr>
            <tr><td>Input cost shock (sector)</td><td>Bad</td><td>Medium</td><td>Medium</td></tr>
            <tr><td>Demand shift (sector)</td><td>Leans good</td><td>Medium</td><td>Medium</td></tr>
            <tr><td>Market mood</td><td>Either way</td><td>Small</td><td>Short</td></tr>
            <tr><td>Inflation data</td><td>Leans bad</td><td>Medium</td><td>Medium</td></tr>
            <tr><td>Growth data</td><td>Leans good</td><td>Medium</td><td>Medium</td></tr>
          </tbody>
        </table>
        <p>
          &quot;Either way&quot; events tell you their direction in the headline (beat or miss, raises or cuts). The
          others name only the fact, so lean on what that fact usually means.
        </p>
      </>
    ),
  },
  {
    id: 'calendar',
    title: 'Calendar',
    body: (
      <>
        <p>Every 30-day month has three scheduled releases. You see the date in advance, what most people expect a few days before, and the result on the day. The headline says whether the result beat or missed what was expected.</p>
        <table>
          <thead>
            <tr>
              <th>Release</th>
              <th>When</th>
              <th>Who feels it most</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Growth</td>
              <td>Day 10 of the month</td>
              <td>Sector A. Strong lifts it, weak drags it. Sector B moves less.</td>
            </tr>
            <tr>
              <td>Inflation</td>
              <td>Day 20</td>
              <td>Sector B. Hot hurts it, cool helps it. Sector A moves less.</td>
            </tr>
            <tr>
              <td>Policy rate</td>
              <td>Day 25</td>
              <td>Sector B, strongly. A hike hurts, a cut helps, a hold barely moves anything.</td>
            </tr>
          </tbody>
        </table>
        <p>A result in line with expectations moves prices only a little, because part of it is already in the price. A surprise moves them more. Hikes get likelier while inflation runs high.</p>
      </>
    ),
  },
  {
    id: 'rumours',
    title: 'Rumours and sources',
    body: (
      <>
        <ul>
          <li>A rumour claims an event a few days ahead. A true one is followed by the event. A false one by nothing.</li>
          <li>High-tier sources are right most of the time, medium a little more often than not, low less often than not.</li>
          <li>Acting on a rumour gets you in early, at the risk of being wrong.</li>
          <li>
            Under the news there is a feed of posts from other traders: opinions, whispers about what might be coming,
            and reactions to moves as they happen. They are less reliable than any rumour source, and they tend to
            show what the crowd already thinks, which is not the same as what comes next. When you are stressed, posts
            that agree with what you hold get louder and some that disagree go missing.
          </li>
          <li>Better feeds and some jobs unlock better sources.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'psychology',
    title: 'Market psychology',
    body: (
      <>
        <p>Ideas real traders use. None of them is a rule. Whether one applies depends on the market at the time.</p>
        <h3>Expectations</h3>
        <p>
          Markets react to news compared with what people expected. &quot;Better than expected&quot; and
          &quot;good&quot; are not the same thing.
        </p>
        <h3>Pricing in</h3>
        <p>
          If many traders already believe something will happen, they may buy or sell before it does. By the time the news
          is official, part of the move may be done.
        </p>
        <h3>&quot;Buy the rumour, sell the news&quot;</h3>
        <p>
          A saying for when traders buy on a rumour and take profit once the news is confirmed. It describes a pattern
          that sometimes happens, not a law.
        </p>
        <h3>Crowds overreact</h3>
        <p>Fear and greed can push a price past where it should be, and it can drift back later.</p>
        <h3>Your own mind</h3>
        <ul>
          <li>Confirmation bias: you notice news that agrees with your position and skip the rest.</li>
          <li>Loss aversion: holding a loser too long because closing it makes the loss real.</li>
          <li>Fear of missing out: chasing a move that has already happened.</li>
          <li>Revenge trading: trading bigger to win back a loss.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'participants',
    title: 'Who else trades',
    body: (
      <>
        <p>
          You are not alone in the market. Prices move because other people buy and sell, and the sizes and timing differ
          from run to run. None of this is a rule. It is the cast.
        </p>
        <ul>
          <li>
            <strong>Funds that hear early.</strong> Some news leaks. Now and then a fund buys or sells in the day or two
            before an announcement, so part of the move is already in the price.
          </li>
          <li>
            <strong>Fast traders.</strong> Professionals react to news the moment it prints, usually before you can read
            it. How fully they react changes from market to market.
          </li>
          <li>
            <strong>The crowd.</strong> Small traders chase rumours and good headlines, and some sell when the news
            arrives. A thin stock feels the crowd more than a big one. The posts under the news are the crowd talking.
          </li>
          <li>
            <strong>Trend followers.</strong> They buy what has been rising and sell what has been falling, until the
            trend turns.
          </li>
          <li>
            <strong>Level hunters.</strong> Prices sometimes poke through obvious levels, such as round numbers or a
            recent high or low, and come back.
          </li>
        </ul>
        <p>
          Big stocks are deep and shrug off orders. Small stocks are thin, so the same money moves them more, yours
          included.
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
            A market order fills now at the price at the clock, plus half the spread, plus a 0.1% fee. The spread widens
            on a stock&apos;s news days.
          </li>
          <li>
            A big order pays slippage on top. Up to 5% of the shares traded in the current 15-minute bar it is free.
            Above that, each share pays extra: the price times the stock&apos;s daily volatility times the square root of
            the order&apos;s share of the bar beyond 5%, never more than 20% of the price. Stop losses and forced
            liquidations pay it too. Limit orders and take profits fill at their own price and pay none. The order panel
            shows the cost before you send. A thinly traded stock, or a high leverage on your whole account, hits it
            first.
          </li>
          <li>
            A very large market order is also real demand. Everyone else in the market sees it, so it can push the price
            for the rest of the day and into the close, and the effect fades over the days after. Ordinary orders are
            far too small to be noticed. A thin stock moves more than a deep one. Pushing the price rarely pays: the
            slippage you pay going in is usually bigger than the push you get.
          </li>
          <li>
            A limit buy waits below the price, a limit sell above it. It fills when the price reaches it, at your price or
            better, with no spread. It stays until filled or cancelled. At most 8 at once.
          </li>
        </ul>
        <h3>Another order on a stock you hold</h3>
        <ul>
          <li>
            Same direction: it adds to the position and the entry becomes the average. It must use the same leverage, or
            it is rejected. Your take profits and stop losses stay.
          </li>
          <li>
            Opposite direction, smaller: it reduces the position and books that part&apos;s profit or loss. An exit for
            more shares than are left shrinks to what is left.
          </li>
          <li>Opposite direction, same size: it closes the position and cancels its exits.</li>
          <li>Opposite direction, bigger: it flips you to the other side at the new leverage and cancels the old exits.</li>
        </ul>
        <h3>Take profit and stop loss</h3>
        <ul>
          <li>For a long, take profit goes above the price and stop loss below. For a short, the other way round.</li>
          <li>On a limit order the check uses your limit price. On an open position it uses the price at the clock.</li>
          <li>A level on the wrong side is rejected with a message. Nothing changes.</li>
          <li>
            A stop fills at its price, or worse if the price jumps past it. A take profit fills at its price or better. If
            one bar touches both, only the stops fill.
          </li>
          <li>
            Each exit closes a number of shares, or the whole position if left empty. Up to 4 take profits and 4 stop
            losses, for example TP1 closes half and TP2 the rest.
          </li>
          <li>When the position closes or flips, its remaining exits are cancelled.</li>
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
          <li>Each position picks its leverage, from 1x to 50x. It ties up margin equal to its value divided by the leverage.</li>
          <li>Free margin is trading equity minus margin used. A new order needs enough of it.</li>
          <li>You get a warning when trading equity falls to 75% of the margin used.</li>
          <li>
            At 50% you are liquidated: whole positions close, worst first, for a 0.5% fee, until you are back above the
            warning. This is checked every 15 minutes and at the close.
          </li>
          <li>Open positions pay a small funding charge each day, a bit more when you hold the side the market favoured.</li>
          <li>Higher leverage means a smaller move against you is enough to be liquidated.</li>
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
          <li>Savings earn interest that follows the policy rate.</li>
        </ul>
        <h3>Payday</h3>
        <p>Every 30th day, at the close (the top bar counts down to it):</p>
        <ol>
          <li>your salary for the days you worked arrives in cash,</li>
          <li>savings interest arrives,</li>
          <li>loan interest is charged (the policy rate plus 4 points a year),</li>
          <li>the monthly bill (living costs plus lifestyle) is charged to cash.</li>
        </ol>
        <h3>When cash is short</h3>
        <ul>
          <li>An unpaid bill blocks End day. Move money into cash, withdraw savings or take a loan, then pay it.</li>
          <li>If everything you have together cannot cover it, the run is lost.</li>
          <li>Unpaid loan interest sells your worst positions, then savings.</li>
        </ul>
        <h3>Winning</h3>
        <p>
          You reach financial independence when passive income covers your monthly expenses for 5 days in a row, from day
          30 on. Passive income is the last 30 days of closed trades and savings interest, minus any net loss on positions
          still open. Salary and open profit do not count, so a winning trade only counts once you close it, and a losing
          one counts against you even while you hold it.
        </p>
        <h3>Free time</h3>
        <ul>
          <li>Jobless, your daytime is free. Anyone can also skip the market for an evening.</li>
          <li>Research in free time earns research points. Verify spends one.</li>
          <li>
            A course costs cash to enrol, then needs study in free time (a free day counts more than an evening). When it
            is done, its jobs open.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'stats',
    title: 'Energy and stress',
    body: (
      <>
        <ul>
          <li>Work, short sleep and reading the news use energy. Work, losses, margin warnings and short sleep add stress.</li>
          <li>Neither recovers on its own. Food and drink restore energy or calm stress.</li>
          <li>
            Low energy or high stress puts you in a warning state: the meters change colour and the edge of the screen
            changes. High stress glows red, low energy darkens the corners. Both get stronger the further you go.
          </li>
          <li>Low energy blurs and delays the news.</li>
          <li>
            High stress makes the feed lean toward what you want to hear about your positions, more as stress rises. Bent
            items look like any other item. Verify shows the true feed, and the end-of-day report says how many items
            were bent.
          </li>
          <li>The market itself never changes with your stats. Only what you see does.</li>
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
