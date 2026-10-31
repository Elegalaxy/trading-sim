import { useEffect, useState } from 'react'
import { SLEEP_HOURS } from '../sim/constants.ts'
import { dayBlocks, sectionClock } from '../sim/day.ts'
import { activeJob } from '../sim/jobs.ts'
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
      setMessage('The market is open. Prices have not moved.')
      return
    }
    const reason = outcome.reason ?? 'rejected'
    console.error(`[ui] rejected skip: ${reason}`)
    setMessage(skipReasonText(reason))
  }

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
      {section === null ? <p>Start a game to play the day.</p> : <p>Now {sectionClock(section)}.</p>}
      <div className="day-actions">
        <div>
          <button type="button" onClick={onSkip} disabled={game === null || game.runEnd !== null || section === 'market'} title="Same day. Prices stay where they are.">
            Open market
          </button>
          <p className="day-note">Same day. Prices stay where they are.</p>
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
        <p className={message === 'The market is open. Prices have not moved.' ? 'trade-ok' : 'trade-alert'} role={message === 'The market is open. Prices have not moved.' ? 'status' : 'alert'}>
          {message}
        </p>
      ) : null}
    </section>
  )
}
