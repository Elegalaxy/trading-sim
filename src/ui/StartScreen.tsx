import { useState, type FormEvent } from 'react'
import { JOB_DEFINITIONS } from '../content/index.ts'
import { DAMAGED_SAVE_MESSAGE, loadSave, type RunMode, type SaveFile } from '../persist/save.ts'
import { DAMAGED_SCORES_MESSAGE, loadScores, type ScoreFile, type ScoreRow } from '../persist/scores.ts'
import type { JobDefinition } from '../sim/types.ts'
import { debugLog } from './debug.ts'
import { Primer } from './Primer.tsx'
import { continueGame, startGame } from './store.ts'

function startingJobLabel(job: JobDefinition): string {
  if (job.requirement === 'none') return job.name
  const course = job.requirement === 'basic' ? 'Basic' : 'Finance'
  return `${job.name} (locked, needs ${course})`
}

function readMode(value: string): RunMode | null {
  if (value === 'seeded' || value === 'normal') return value
  return null
}

function modeLabel(mode: RunMode): string {
  return mode === 'seeded' ? 'Seeded' : 'Normal'
}

function reportRejected(reason: string, cause: unknown): void {
  if (cause === null || cause === undefined) console.error(`[save] rejected reason=${reason}`)
  else console.error(`[save] rejected reason=${reason}`, cause)
  debugLog('[save]', `rejected reason=${reason}`)
}

type StartStatus = {
  save: SaveFile | null
  saveMessage: string | null
  scores: ScoreFile
  scoreMessage: string | null
}

function readStartStatus(): StartStatus {
  const loaded = loadSave()
  let save: SaveFile | null = null
  let saveMessage: string | null = null
  if (loaded.ok) {
    save = loaded.save
    debugLog('[save]', `loaded day=${loaded.save.state.market.day}`)
  } else if (loaded.reason !== 'empty') {
    reportRejected(loaded.reason, loaded.cause)
    saveMessage = DAMAGED_SAVE_MESSAGE
  }

  const scores = loadScores()
  if (!scores.ok) {
    reportRejected(scores.reason, scores.cause)
    return {
      save,
      saveMessage,
      scores: { version: 1, seeded: {}, normal: [] },
      scoreMessage: DAMAGED_SCORES_MESSAGE,
    }
  }
  return { save, saveMessage, scores: scores.scores, scoreMessage: null }
}

function ScoreLines({ title, rows }: { title: string; rows: readonly ScoreRow[] }) {
  return (
    <section className="panel" aria-label={title}>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p>None yet.</p>
      ) : (
        <ul>
          {rows.map((row, index) => (
            <li key={`${row.seed}-${row.day}-${row.score}-${index}`}>
              {row.seed}: score {row.score}, day {row.day}, {row.outcome}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function StartScreen() {
  const [status] = useState(readStartStatus)
  const [saveMessage, setSaveMessage] = useState(status.saveMessage)
  const [mode, setMode] = useState<RunMode>('seeded')
  const [seed, setSeed] = useState('')
  const [jobId, setJobId] = useState('jobless')
  const [error, setError] = useState<string | null>(null)
  const seededRows = Object.values(status.scores.seeded)
    .slice()
    .sort((left, right) => right.score - left.score || left.seed.localeCompare(right.seed))

  function onMode(value: string): void {
    const next = readMode(value)
    if (next === null) {
      console.error(`[ui] rejected mode ${JSON.stringify(value)}`)
      return
    }
    setMode(next)
    setError(null)
  }

  function onStartingJob(value: string): void {
    const job = JOB_DEFINITIONS.find((item) => item.id === value)
    if (job === undefined) {
      console.error(`[ui] rejected starting job ${JSON.stringify(value)}`)
      return
    }
    if (job.requirement !== 'none') {
      console.error(`[ui] rejected starting job ${job.id}: locked`)
      return
    }
    setJobId(value)
    setError(null)
  }

  function onContinue(): void {
    if (status.save === null) return
    const message = continueGame(status.save)
    if (message !== null) setSaveMessage(message)
  }

  function onStart(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(startGame(seed, jobId, mode))
  }

  return (
    <main className="start-screen">
      <header>
        <h1>Trading Sim</h1>
      </header>
      <Primer />
      {status.save !== null ? (
        <section className="panel">
          <p>
            A save from day {status.save.state.market.day} is ready ({modeLabel(status.save.mode)}, seed{' '}
            {status.save.seed}).
          </p>
          <button type="button" onClick={onContinue}>
            Continue
          </button>
        </section>
      ) : null}
      {saveMessage !== null ? (
        <p className="trade-alert" role="alert">
          {saveMessage}
        </p>
      ) : null}
      <form className="panel start-form" onSubmit={onStart}>
        <fieldset className="mode-choice">
          <legend>Mode</legend>
          <label htmlFor="mode-seeded">
            <input
              id="mode-seeded"
              type="radio"
              name="mode"
              value="seeded"
              checked={mode === 'seeded'}
              onChange={() => onMode('seeded')}
            />
            Seeded
          </label>
          <label htmlFor="mode-normal">
            <input
              id="mode-normal"
              type="radio"
              name="mode"
              value="normal"
              checked={mode === 'normal'}
              onChange={() => onMode('normal')}
            />
            Normal
          </label>
        </fieldset>
        {mode === 'seeded' ? (
          <label htmlFor="seed">
            Seed{' '}
            <input
              id="seed"
              value={seed}
              maxLength={32}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                setSeed(event.target.value)
                setError(null)
              }}
            />
          </label>
        ) : (
          <p>Normal picks a seed for this run.</p>
        )}
        <label htmlFor="starting-job">
          Starting job{' '}
          <select id="starting-job" value={jobId} onChange={(event) => onStartingJob(event.target.value)}>
            {JOB_DEFINITIONS.map((job) => (
              <option key={job.id} value={job.id} disabled={job.requirement !== 'none'}>
                {startingJobLabel(job)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Start</button>
        {error !== null ? (
          <p className="trade-alert" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      {status.scoreMessage !== null ? (
        <p className="trade-alert" role="alert">
          {status.scoreMessage}
        </p>
      ) : null}
      <ScoreLines title="Seeded scores" rows={seededRows} />
      <ScoreLines title="Normal scores" rows={status.scores.normal} />
    </main>
  )
}
