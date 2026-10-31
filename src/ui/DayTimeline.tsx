import { useEffect, useState } from 'react'
import { SESSION_STEPS, SLEEP_HOURS } from '../sim/constants.ts'
import { dayBlocks, sectionClock } from '../sim/day.ts'
import { activeJob } from '../sim/jobs.ts'
import { clockTime } from '../sim/session.ts'
import type { DaySection, GameState } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { dispatch, endDay } from './store.ts'

function skipReasonText(reason: string): string {
  if (reason === 'cannotSkip') return 'Nothing to skip.'
  if (reason === 'notStarted') return 'Start a game first.'
  return reason
}

export function DayTimeline({ game }: { game: GameState | null }) {
  const section: DaySection | null = game?.section ?? null
  const sleepHours = game?.sleepHours ?? SLEEP_HOURS
  const day = game?.market.day ?? null
  const job = game === null ? null : activeJob(game.job)
  const jobless = job === null || job.slots === 0
  const blocks = dayBlocks(sleepHours, jobless, job !== null && job.slots > 0 ? job.slots : undefined)
  const [message, setMessage] = useState<string | null>(null)
  const [trackedGame, setTrackedGame] = useState(game)
  const [trackedDay, setTrackedDay] = useState(day)
  if (trackedGame !== game || trackedDay !== day) {
    setTrackedGame(game)
    setTrackedDay(day)
    setMessage(null)
  }

  useEffect(() => {
    if (section === null || day === null) return
    debugLog('[ui]', `day section=${section} sleepHours=${sleepHours} clock=${sectionClock(section)} day=${day}`)
  }, [section, sleepHours, day])

  function onSkip(): void {
    if (game === null) {
      console.error('[ui] rejected skip: game has not started')
      debugLog('[ui]', 'skip rejected before dispatch: notStarted')
      setMessage('Start a game first.')
      return
    }
    const outcome = dispatch({ type: 'skip' })
    if (outcome.accepted) {
      setMessage('The market is open at 17:00.')
      return
    }
    const reason = outcome.reason ?? 'rejected'
    console.error(`[ui] rejected skip: ${reason}`)
    setMessage(skipReasonText(reason))
  }

  function onTick(steps: number): void {
    if (game === null) return
    const outcome = dispatch({ type: 'tick', steps })
    if (outcome.accepted) {
      setMessage(null)
      return
    }
    const reason = outcome.reason ?? 'rejected'
    console.error(`[ui] rejected tick: ${reason}`)
    setMessage(reason === 'sessionOver' ? 'The market is closed for the day.' : reason)
  }

  const clock = game?.session.clock ?? 0
  const inMarket = section === 'market'
  const sessionOpen = game !== null && game.runEnd === null && inMarket && clock < SESSION_STEPS

  return (
    <section className="panel" aria-label="Day">
      <h2>Day</h2>
      <ol className="day-timeline">
        {blocks.map((block) => {
          const current = section === block.section
          return (
            <li key={block.section} className={current ? 'day-current' : undefined} aria-current={current ? 'step' : undefined}>
              <strong>{block.title}</strong>
              <span>{block.clock}</span>
              {block.empty ? <span className="day-note">empty</span> : null}
              {current ? <span>current</span> : null}
            </li>
          )
        })}
      </ol>
      {section === null ? (
        <p>Start a game to play the day.</p>
      ) : inMarket ? (
        <p>Now {clockTime(clock)}{clock >= SESSION_STEPS ? ' (closed)' : ''}.</p>
      ) : (
        <p>Now {sectionClock(section)}.</p>
      )}
      <div className="day-actions">
        <div>
          <button type="button" onClick={onSkip} disabled={game === null || game.runEnd !== null || section === 'market'} title="Same day. The session starts at 17:00.">
            Open market
          </button>
          <p className="day-note">Same day. Prices move while the clock runs.</p>
        </div>
        <div className="clock-actions" role="group" aria-label="Market clock">
          <button type="button" onClick={() => onTick(1)} disabled={!sessionOpen} title="Move the clock forward 15 minutes.">
            +15 min
          </button>
          <button type="button" onClick={() => onTick(4)} disabled={!sessionOpen} title="Move the clock forward one hour.">
            +1 hour
          </button>
          <button type="button" onClick={() => onTick(SESSION_STEPS)} disabled={!sessionOpen} title="Run the clock to the 21:00 close.">
            To close
          </button>
        </div>
        <div>
          <button
            type="button"
            onClick={() => endDay()}
            disabled={game === null || game.bill !== null || game.runEnd !== null}
            title={
              game?.runEnd !== null
                ? 'The run has ended.'
                : game?.bill !== null
                  ? 'Pay the bill before the day can end.'
                  : undefined
            }
          >
            End day
          </button>
          <p className="day-note">Sleep. The next day starts and prices move.</p>
        </div>
      </div>
      {message !== null ? (
        <p className={`day-message ${message === 'The market is open at 17:00.' ? 'trade-ok' : 'trade-alert'}`} role={message === 'The market is open at 17:00.' ? 'status' : 'alert'}>
          {message}
        </p>
      ) : null}
    </section>
  )
}
