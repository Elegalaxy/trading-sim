import type { TierBadge } from '../content/lifestyle.ts'

// Small chips for what a choice does. The stat name has its own colour (energy blue, stress purple)
// on every button; the number and arrow are green when the change helps and red when it hurts. The
// arrow shows the direction of the change. A perk chip is neutral.

function statText(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value)}`
}

function harmful(kind: 'energy' | 'stress', value: number): boolean {
  return kind === 'energy' ? value < 0 : value > 0
}

export function StatBadge({ kind, value, label, title }: { kind: 'energy' | 'stress'; value: number; label?: string; title?: string }) {
  const bad = harmful(kind, value)
  return (
    <span className="badge badge-stat" title={title}>
      {label === undefined ? '' : <span className="badge-label">{label}</span>}
      <span className={bad ? 'badge-effect effect-bad' : 'badge-effect effect-good'}>
        <span className="badge-arrow" aria-hidden="true">
          {value < 0 ? '▼' : '▲'}
        </span>
        {statText(value)}
      </span>
      <span className={`badge-kind kind-${kind}`}>{kind === 'energy' ? 'Energy' : 'Stress'}</span>
      <span className="sr-only">{bad ? ' (harmful)' : ' (helpful)'}</span>
    </span>
  )
}

export function PerkBadge({ text, title }: { text: string; title?: string }) {
  return (
    <span className="badge badge-perk" title={title}>
      {text}
    </span>
  )
}

export function TierBadges({ badges }: { badges: readonly TierBadge[] }) {
  return (
    <span className="badges">
      {badges.map((badge, index) =>
        badge.kind === 'perk' ? (
          <PerkBadge key={index} text={badge.text} title={badge.title} />
        ) : (
          <StatBadge key={index} kind={badge.kind} value={badge.value} title={badge.title} />
        ),
      )}
    </span>
  )
}
