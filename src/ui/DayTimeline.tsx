import { useEffect, useState } from 'react'
import {
  COURSE_STUDY_UNITS,
  COURSE_UNITS_DAYTIME,
  COURSE_UNITS_EVENING,
  RESEARCH_POINTS_DAYTIME,
  RESEARCH_POINTS_EVENING,
  SESSION_STEPS,
  SLEEP_HOURS,
  WORK_FULL_TIME_END_MINUTE,
  WORK_START_MINUTE,
} from '../sim/constants.ts'
import { dayBlocks, formatMinute, sectionClock } from '../sim/day.ts'
import { activeJob } from '../sim/jobs.ts'
import { clockTime } from '../sim/session.ts'
import { freeSlots } from '../sim/study.ts'
import type { DaySection, GameState, LiquidationEvent, StudiedEvent, StudyActivity, StudySlot } from '../sim/types.ts'
import { MARKET_DEFINITIONS } from '../content/index.ts'
import { debugLog } from './debug.ts'
import { pendingSale, saleText } from './loanText.ts'
import { formatUsd } from './money.ts'
import { dispatch, endDay } from './store.ts'

function skipReasonText(reason: string): string {
  if (reason === 'cannotSkip') return 'Nothing to skip.'
  if (reason === 'notStarted') return 'Start a game first.'
  if (reason === 'studiedEvening') return 'You spent this evening studying. The market opens again tomorrow.'
  return reason
}

function studyReasonText(reason: string): string {
  if (reason === 'notEnrolled') return 'Enrol in a course first (Life tab, Lifestyle).'
  if (reason === 'slotUsed') return 'That time is already used today.'
  if (reason === 'marketOpen') return 'The market is already open.'
  if (reason === 'notFree') return 'Your job takes the daytime.'
  return reason
}

/** What a slot was spent on today, from the command log. */
function slotUse(game: GameState, slot: StudySlot): StudiedEvent | null {
  for (const event of game.pending) if (event.kind === 'studied' && event.slot === slot) return event
  return null
}

function slotText(event: StudiedEvent | null): string | null {
  if (event === null) return null
  return event.activity === 'research' ? 'research' : 'course'
}

/** Liquidations the log holds so far, oldest first. The log keeps every command since the last close. */
function liquidationsIn(game: GameState): LiquidationEvent[] {
  return game.log.filter((event): event is LiquidationEvent => event.kind === 'liquidation')
}

export function DayTimeline({ game }: { game: GameState | null }) {
  const section: DaySection | null = game?.section ?? null
  const sleepHours = game?.sleepHours ?? SLEEP_HOURS
  const day = game?.market.day ?? null
  const job = game === null ? null : activeJob(game.job)
  const jobless = job === null || job.slots === 0
  const blocks = dayBlocks(sleepHours, jobless, job !== null && job.slots > 0 ? job.slots : undefined)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [trackedGame, setTrackedGame] = useState(game)
  const [trackedDay, setTrackedDay] = useState(day)
  if (trackedGame !== game || trackedDay !== day) {
    setTrackedGame(game)
    setTrackedDay(day)
    setMessage(null)
    setConfirmEnd(false)
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
    const seen = liquidationsIn(game).length
    const outcome = dispatch({ type: 'tick', steps })
    if (outcome.accepted) {
      const fresh = liquidationsIn(game).slice(seen)
      setMessage(
        fresh.length === 0
          ? null
          : fresh
              .map((event) => `Liquidated ${event.asset} at ${event.time ?? 'the close'} for a ${formatUsd(event.fee ?? 0, 'liquidation fee')} fee.`)
              .join(' '),
      )
      return
    }
    const reason = outcome.reason ?? 'rejected'
    console.error(`[ui] rejected tick: ${reason}`)
    setMessage(reason === 'sessionOver' ? 'The market is closed for the day.' : reason)
  }

  function onStudy(slot: StudySlot, activity: StudyActivity): void {
    if (game === null) return
    const outcome = dispatch({ type: 'study', slot, activity })
    if (!outcome.accepted) {
      const reason = outcome.reason ?? 'rejected'
      console.error(`[ui] rejected study: ${reason}`)
      setMessage(studyReasonText(reason))
      return
    }
    const done = game.pending.find((event) => event.kind === 'courseCompleted')
    setMessage(
      done?.kind === 'courseCompleted'
        ? `Course finished. Its jobs are open now.`
        : activity === 'research'
          ? `Research done. You have ${game.study.points} points.`
          : `Studied. Course ${game.study.course?.units ?? COURSE_STUDY_UNITS} of ${COURSE_STUDY_UNITS}.`,
    )
  }

  // A missed loan payment is sold off by End day. The first click shows the sale, the second ends the day.
  const sale = game === null ? null : pendingSale(game, MARKET_DEFINITIONS)
  const confirming = confirmEnd && sale !== null

  function onEndDay(): void {
    if (sale !== null && !confirmEnd) {
      setConfirmEnd(true)
      return
    }
    setConfirmEnd(false)
    endDay()
  }

  const clock = game?.session.clock ?? 0
  const inMarket = section === 'market'
  const sessionOpen = game !== null && game.runEnd === null && inMarket && clock < SESSION_STEPS
  const slots = game === null ? [] : freeSlots(game)
  const daytimeUse = game === null ? null : slotText(slotUse(game, 'daytime'))
  const eveningUse = game === null ? null : slotText(slotUse(game, 'evening'))
  const enrolled = game?.study.course ?? null
  const freeRange = `${formatMinute(WORK_START_MINUTE)}-${formatMinute(WORK_FULL_TIME_END_MINUTE)}`

  return (
    <section className="panel" aria-label="Day">
      <h2>Day</h2>
      <div className="day-bar">
        <div className="schedule" role="group" aria-label="Schedule">
          <div className="schedule-top">
          <ol className="day-timeline">
            {blocks.map((block) => {
              const current = section === block.section
              // Jobless daytime is free time, not an empty work block.
              const free = jobless && block.section === 'work'
              const used = block.section === 'work' ? daytimeUse : block.section === 'market' ? eveningUse : null
              return (
                <li key={block.section} className={current ? 'day-current' : undefined} aria-current={current ? 'step' : undefined}>
                  <strong>{free ? 'Free time' : block.title}</strong>
                  <span>{free ? freeRange : block.clock}</span>
                  {used !== null ? <span className="slot-use">{used}</span> : null}
                  {current && !free ? <span className="sr-only">current</span> : null}
                </li>
              )
            })}
          </ol>
          <p className="now-clock">
            {section === null
              ? 'Start a game to play the day.'
              : inMarket
                ? `Now ${clockTime(clock)}${clock >= SESSION_STEPS ? ' (closed)' : ''}`
                : `Now ${sectionClock(section)}`}
          </p>
          </div>
          {slots.length > 0 ? (
            <div className="study-actions" role="group" aria-label="Free time">
              {slots.includes('daytime') ? (
                <>
                  <button type="button" onClick={() => onStudy('daytime', 'research')} title="Spend the day researching companies. Verify spends these points.">
                    Research day +{RESEARCH_POINTS_DAYTIME} pts
                  </button>
                  <button
                    type="button"
                    onClick={() => onStudy('daytime', 'course')}
                    disabled={enrolled === null}
                    title={enrolled === null ? 'Enrol in a course first (Life tab, Lifestyle).' : `Study ${enrolled.id}: +${COURSE_UNITS_DAYTIME} of ${COURSE_STUDY_UNITS}.`}
                  >
                    Study day
                  </button>
                </>
              ) : null}
              {slots.includes('evening') ? (
                <>
                  <button
                    type="button"
                    onClick={() => onStudy('evening', 'research')}
                    title="Skip today's market and research instead. The market stays closed today."
                  >
                    Skip market: research +{RESEARCH_POINTS_EVENING} pts
                  </button>
                  <button
                    type="button"
                    onClick={() => onStudy('evening', 'course')}
                    disabled={enrolled === null}
                    title={
                      enrolled === null
                        ? 'Enrol in a course first (Life tab, Lifestyle).'
                        : `Skip today's market and study ${enrolled.id}: +${COURSE_UNITS_EVENING} of ${COURSE_STUDY_UNITS}.`
                    }
                  >
                    Skip market: study
                  </button>
                </>
              ) : null}
              <span className="study-note">
                {game?.study.points ?? 0} research pts
                {enrolled !== null ? ` · ${enrolled.id} course ${enrolled.units} of ${COURSE_STUDY_UNITS}` : ''}
              </span>
            </div>
          ) : null}
        </div>
        <div className="bar-divider" role="separator" aria-orientation="vertical" />
        <div className="bar-actions">
          <div className="day-actions">
            <button
              type="button"
              className="act-open"
              onClick={onSkip}
              disabled={game === null || game.runEnd !== null || section === 'market' || eveningUse !== null}
              title={eveningUse !== null ? 'You spent this evening studying.' : 'Same day. The session starts at 17:00.'}
            >
              Open market
            </button>
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
            <button
              type="button"
              className={confirming ? 'act-end act-end-confirm' : 'act-end'}
              onClick={onEndDay}
              disabled={game === null || game.bill !== null || game.runEnd !== null}
              title={
                game?.runEnd !== null
                  ? 'The run has ended.'
                  : game?.bill !== null
                    ? 'Pay the bill before the day can end.'
                    : sale !== null
                      ? 'The loan payment is not covered. The first click shows what is sold.'
                      : 'Sleep. The next day starts and prices move.'
              }
            >
              {confirming ? 'Confirm End day' : 'End day'}
            </button>
            {confirming ? (
              <button type="button" className="act-end-cancel" onClick={() => setConfirmEnd(false)}>
                Cancel
              </button>
            ) : null}
          </div>
          {confirming && sale !== null ? (
            <p className="end-confirm" role="alert">
              <span aria-hidden="true">▲ </span>
              The loan payment is not covered. End day will: {saleText(sale)}.
              {sale.endsRun ? ' That is still not enough, so the run ends.' : ''}
            </p>
          ) : null}
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
