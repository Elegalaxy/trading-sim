import { useState, type FormEvent } from 'react'
import { JOB_DEFINITIONS } from '../content/index.ts'
import type { JobDefinition } from '../sim/types.ts'
import { Primer } from './Primer.tsx'
import { startGame, type RunMode } from './store.ts'

function startingJobLabel(job: JobDefinition): string {
  if (job.requirement === 'none') return job.name
  const course = job.requirement === 'basic' ? 'Basic' : 'Finance'
  return `${job.name} (locked, needs ${course})`
}

function readMode(value: string): RunMode | null {
  if (value === 'seeded' || value === 'normal') return value
  return null
}

export function StartScreen() {
  const [mode, setMode] = useState<RunMode>('seeded')
  const [seed, setSeed] = useState('')
  const [jobId, setJobId] = useState('jobless')
  const [error, setError] = useState<string | null>(null)

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
    </main>
  )
}
