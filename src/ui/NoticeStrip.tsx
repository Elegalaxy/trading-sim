import { activeJob } from '../sim/jobs.ts'
import type { GameState } from '../sim/types.ts'
import { noticeLine, noticeSeverance, openNotice } from './employer.ts'

// A strip under the top bar while an employer notice is open, so the player sees it without opening
// the Life tab. It reads only the stage, never `notice.real`. Clicking it opens the Job card.

export function NoticeStrip({ game, onOpen }: { game: GameState | null; onOpen: () => void }) {
  if (game === null || game.runEnd !== null) return null
  const notice = openNotice(game)
  if (notice === null) return null
  const confirmed = notice.stage === 'confirmed'
  const holding = activeJob(game.job).id === notice.jobId
  const severance = noticeSeverance(game, notice)
  const text = noticeLine(game, notice)
  return (
    <button type="button" className={confirmed ? 'notice-strip notice-confirmed' : 'notice-strip notice-rumour'} onClick={onOpen}>
      <span className="notice-icon" aria-hidden="true">
        {confirmed ? '⛔' : '⚠'}
      </span>
      <span className="notice-text">{text}</span>
      {holding && severance !== null ? <span className="notice-meta">Leaving before then forfeits severance</span> : null}
      <span className="notice-go">Open Job card ›</span>
    </button>
  )
}
