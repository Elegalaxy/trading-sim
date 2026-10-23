import { useState } from 'react'
import { dayBlocks } from '../sim/day.ts'
import { activeJob } from '../sim/jobs.ts'
import type { GameState, JobDefinition } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { dispatch } from './store.ts'

function jobOptionLabel(job: JobDefinition, locked: boolean): string {
  if (!locked) return job.name
  const course = job.requirement === 'basic' ? 'Basic' : 'Finance'
  return `${job.name} (locked, needs ${course})`
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
      setMessage(starts === undefined ? `${name} requested.` : `${name} starts on day ${starts}.`)
      return
    }
    const reason = outcome.reason ?? 'rejected'
    console.error(`[ui] rejected job ${choice}: ${reason}`)
    setTone('alert')
    setMessage(reasonText(reason, next))
  }

  return (
    <section className="panel" aria-label="Job">
      <h2>Job</h2>
      <p>
        {job.name}. Sleep {sleep?.clock ?? `${game.sleepHours}h`}. Work {work?.clock ?? 'unset'}
        {work?.empty ? ' (empty)' : ''}.
      </p>
      {pending !== null && pendingJob !== undefined ? (
        <p>
          {pendingJob.name} starts on day {pending.effectiveDay}.
        </p>
      ) : null}
      <label htmlFor="job-choice">
        Change job{' '}
        <select id="job-choice" value={choice} onChange={(event) => onChoice(event.target.value)}>
          {game.job.catalog.map((item) => {
            const locked = jobLocked(item, game)
            return (
              <option key={item.id} value={item.id} disabled={locked}>
                {jobOptionLabel(item, locked)}
              </option>
            )
          })}
        </select>
      </label>
      <button type="button" onClick={onRequest} disabled={game.runEnd !== null}>
        Request change
      </button>
      {message !== null ? (
        <p className={tone === 'ok' ? 'trade-ok' : 'trade-alert'} role={tone === 'ok' ? 'status' : 'alert'}>
          {message}
        </p>
      ) : null}
    </section>
  )
}
