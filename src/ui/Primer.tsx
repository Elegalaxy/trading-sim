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
        The margin meter is trading equity divided by the value of open positions. It warns at 15%. At the end of a day,
        10% or lower liquidates positions, worst first, until the ratio is back above the warning. Leverage stops at 5x.
      </p>
      <p>
        The warning state is energy below 40 or stress above 60. Those meters change color. In that state, news can lean
        toward your open positions. Every distorted item carries the same small diamond and tint. That mark is the tell.
        The market, the events, and the fills stay the same.
      </p>
      <p>this is a simulation, not financial advice</p>
    </section>
  )
}
