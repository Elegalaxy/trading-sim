import { useState } from 'react'
import { dayBlocks } from '../sim/day.ts'
import { activeJob } from '../sim/jobs.ts'
import type { GameState, JobDefinition } from '../sim/types.ts'
import { PerkBadge, StatBadge } from './Badges.tsx'
import { debugLog } from './debug.ts'
import { formatUsd } from './money.ts'
import { dispatch } from './store.ts'
import { playerDay } from './days.ts'

function courseName(job: JobDefinition): string {
  return job.requirement === 'basic' ? 'Basic' : 'Finance'
}

function slotsText(job: JobDefinition): string {
  if (job.slots === 0) return 'Free daytime'
  return job.slots === 1 ? 'Part-time' : 'Full-time'
}

function reasonText(reason: string, job: JobDefinition | undefined): string {
  if (reason === 'jobLocked') {
    if (job?.requirement === 'basic') return 'That job needs the Basic course.'
    if (job?.requirement === 'finance') return 'That job needs the Finance course.'
    return 'That job needs a course.'
  }
  if (reason === 'alreadyEmployed') return 'You already have that job.'
  if (reason === 'alreadyRequested') return 'That change is already waiting.'
  if (reason === 'unknownJob') return 'That job is not on the menu.'
  if (reason === 'notStarted') return 'Start a game first.'
  if (reason === 'runEnded') return 'The run has ended.'
  return reason
}

function jobLocked(job: JobDefinition, game: GameState): boolean {
  if (job.requirement === 'none') return false
  return !game.job.courses.includes(job.requirement)
}

export function JobPanel({ game }: { game: GameState | null }) {
  const currentId = game?.job.jobId ?? 'jobless'
  const [choice, setChoice] = useState(currentId)
  const [message, setMessage] = useState<string | null>(null)
  const [tone, setTone] = useState<'ok' | 'alert'>('alert')
  const [trackedId, setTrackedId] = useState(currentId)
  if (trackedId !== currentId) {
    setTrackedId(currentId)
    setChoice(currentId)
    setMessage(null)
  }

  if (game === null) {
    return (
      <section className="panel" aria-label="Job">
        <h2>Job</h2>
        <p>Start a game to see the job.</p>
      </section>
    )
  }

  const job = activeJob(game.job)
  const blocks = dayBlocks(game.sleepHours, job.slots === 0, job.slots > 0 ? job.slots : undefined)
  const sleep = blocks.find((block) => block.section === 'sleep')
  const work = blocks.find((block) => block.section === 'work')
  const pending = game.job.pending
  const pendingJob = pending === null ? undefined : game.job.catalog.find((item) => item.id === pending.jobId)

  function onChoice(value: string): void {
    const next = game?.job.catalog.find((item) => item.id === value)
    if (next === undefined || game === null) {
      console.error(`[ui] rejected job ${JSON.stringify(value)}`)
      return
    }
    if (jobLocked(next, game)) {
      console.error(`[ui] rejected job ${next.id}: locked`)
      return
    }
    setChoice(value)
  }

  function onRequest(): void {
    const next = game?.job.catalog.find((item) => item.id === choice)
    debugLog('[ui]', `job request ${choice}`)
    const outcome = dispatch({ type: 'setJob', jobId: choice })
    if (outcome.accepted) {
      const starts = game?.job.pending?.effectiveDay
      const name = next?.name ?? choice
      setTone('ok')
      setMessage(starts === undefined ? `${name} requested.` : `${name} starts on day ${playerDay(starts)}.`)
      return
    }
    const reason = outcome.reason ?? 'rejected'
    console.error(`[ui] rejected job ${choice}: ${reason}`)
    setTone('alert')
    setMessage(reasonText(reason, next))
  }

  const chosen = game.job.catalog.find((item) => item.id === choice)

  return (
    <section className="panel" aria-label="Job">
      <h2>Job</h2>
      <dl className="kv-row">
        <div>
          <dt>Now</dt>
          <dd>{job.name}</dd>
        </div>
        <div>
          <dt>Sleep</dt>
          <dd>{sleep?.clock ?? `${game.sleepHours}h`}</dd>
        </div>
        <div>
          <dt>Work</dt>
          <dd>{work?.empty ? `${work.clock} (empty)` : (work?.clock ?? 'unset')}</dd>
        </div>
      </dl>
      {pending !== null && pendingJob !== undefined ? (
        <p className="card-note">
          {pendingJob.name} starts on day {playerDay(pending.effectiveDay)}.
        </p>
      ) : null}
      <div className="tier-list" role="group" aria-label="Job menu">
        {game.job.catalog.map((item) => {
          const locked = jobLocked(item, game)
          const active = item.id === currentId
          const picked = item.id === choice
          return (
            <button
              key={item.id}
              type="button"
              className={active ? 'tier-row tier-active' : picked ? 'tier-row tier-picked' : 'tier-row'}
              aria-pressed={picked}
              disabled={locked || game.runEnd !== null}
              title={locked ? `Needs the ${courseName(item)} course.` : undefined}
              onClick={() => onChoice(item.id)}
            >
              <span className="tier-main">
                <span className="tier-name">{item.name}</span>
                <span className="badges">
                  <PerkBadge text={slotsText(item)} title={`${item.slots} work slots, sleep ${item.sleepHours}h.`} />
                  {item.energyCost !== 0 ? <StatBadge kind="energy" value={-item.energyCost} label="Daily" /> : null}
                  {item.stressCost !== 0 ? <StatBadge kind="stress" value={item.stressCost} label="Daily" /> : null}
                  {locked ? <PerkBadge text={`Needs ${courseName(item)}`} title="Finish this course in your free time." /> : null}
                </span>
              </span>
              <span className="tier-price">
                <strong>{item.payCents === 0 ? 'No pay' : `+${formatUsd(item.payCents, 'pay')}/mo`}</strong>
                {active ? (
                  <span className="tier-pill tier-pill-current">Current</span>
                ) : picked ? (
                  <span className="tier-pill tier-pill-picked">Selected</span>
                ) : (
                  <small>{' '}</small>
                )}
              </span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="primary-action"
        onClick={onRequest}
        disabled={game.runEnd !== null || choice === currentId || chosen === undefined}
      >
        {choice === currentId || chosen === undefined ? 'Pick a job to switch' : `Switch to ${chosen.name}`}
      </button>
      {message !== null ? (
        <p className={tone === 'ok' ? 'trade-ok' : 'trade-alert'} role={tone === 'ok' ? 'status' : 'alert'}>
          {message}
        </p>
      ) : null}
    </section>
  )
}
