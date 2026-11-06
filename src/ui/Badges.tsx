import type { TierBadge } from '../content/lifestyle.ts'

// Small coloured chips for what a choice does. A stat chip is green for energy and teal for stress,
// on every button. Whether a change helps or hurts is shown by the sign and a ▲/▼ marker, never by
// a different colour. A perk chip is neutral.

function statText(kind: 'energy' | 'stress', value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value)} ${kind === 'energy' ? 'Energy' : 'Stress'}`
}

function harmful(kind: 'energy' | 'stress', value: number): boolean {
  return kind === 'energy' ? value < 0 : value > 0
}

export function StatBadge({ kind, value, label, title }: { kind: 'energy' | 'stress'; value: number; label?: string; title?: string }) {
  const bad = harmful(kind, value)
  return (
    <span className={`badge badge-${kind}`} title={title}>
      {label === undefined ? '' : <span className="badge-label">{label}</span>}
      <span className="badge-arrow" aria-hidden="true">
        {bad ? '▼' : '▲'}
      </span>
      {statText(kind, value)}
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
