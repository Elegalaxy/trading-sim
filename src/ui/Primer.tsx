// Provisional primer text for the first playable. It restates the current rules.
// It does not add a mechanic.

export function Primer() {
  return (
    <section className="panel primer" aria-label="Primer">
      <h2>Primer</h2>
      <p>
        News moves a hidden fair value. Each day the price steps part of the way toward that value, plus noise. One day
        cannot move a price more than 8%. Whatever is left keeps moving on later days. A headline confirms an event on
        the day it happens, and the price may already be on the way.
      </p>
      <p>
        Sentiment is a market-wide swing. It can lift prices, drop them, or do nothing, and it lasts a short time. It
        stacks with other news. It is not a promise of the next move.
      </p>
      <p>
        A rumour names a source, a claimed event, and a claimed direction. It can arrive before the day it talks about,
        and it can be wrong. Reliability is a tier: high, medium, or low. The tier is honest. High is right more often
        than medium, and medium more often than low.
      </p>
      <p>
        Each position has its own leverage, from 1x to 50x, and uses margin equal to its value divided by that
        leverage. When trading equity falls to 75% of the margin used you get a warning. At 50%, after any 15-minute bar
        or at the close, positions are liquidated, worst first, for a 0.5% fee. Open positions pay a small daily
        funding charge. The Guide button in the top bar explains every rule.
      </p>
      <p>
        The warning state is energy below 40 or stress above 60. Those meters change color. In that state, news can lean
        toward your open positions, and the edge of the screen glows or darkens. Bent items look like any other item:
        Verify shows the true feed, and the end-of-day report counts them. The market, the events, and the fills stay the
        same.
      </p>
      <p>this is a simulation, not financial advice</p>
    </section>
  )
}
