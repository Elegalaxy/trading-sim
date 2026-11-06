import type { TierBadge } from '../content/lifestyle.ts'

// Small coloured chips for what a choice does. A stat chip is green for energy and teal for stress,
// and turns amber when the change hurts (energy down, stress up). A perk chip is neutral.

function statText(kind: 'energy' | 'stress', value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value)} ${kind === 'energy' ? 'Energy' : 'Stress'}`
}

function harmful(kind: 'energy' | 'stress', value: number): boolean {
  return kind === 'energy' ? value < 0 : value > 0
}

export function StatBadge({ kind, value, label, title }: { kind: 'energy' | 'stress'; value: number; label?: string; title?: string }) {
  const tone = harmful(kind, value) ? 'badge-bad' : `badge-${kind}`
  return (
    <span className={`badge ${tone}`} title={title}>
      {label === undefined ? '' : <span className="badge-label">{label}</span>}
      {statText(kind, value)}
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
