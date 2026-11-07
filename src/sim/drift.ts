// Analytic expected daily drift of a stock's fair value (price-model plan, Step P0).
// Pure and not used by the market yet. It is the mean of the fractional fair-value
// change per day, from the two sources that move fair value:
//   events    each day every (type, target) rolls once. A target reaches the stock when it is
//             the stock itself, its sector, or any market-scope target. Mean effect of one
//             roll is chance x (up - down) x (magnitudeMin + magnitudeMax) / 2 / 100, with the
//             chance and directions shifted by the environment. Decay only spreads an effect
//             over days; shares sum to 1, so the daily mean is unchanged.
//   calendar  each schedule entry fires once a month. Its mean effect, using the chance table
//             at the current bands, is divided by daysPerMonth.
// The +-12% daily clip is ignored (it only bites on stacked effects). Negative means falling.

import { lookupPolicyChances } from './calendar.ts'
import { adjustForEnvironment } from './environment.ts'
import type {
  AssetDefinition,
  CalendarBand,
  CalendarDefinitions,
  CalendarItemKind,
  CalendarOutcome,
  EnvironmentEntryState,
  EventTypeDefinition,
  MarketDefinitions,
  SectorId,
} from './types.ts'

function reaches(eventType: EventTypeDefinition, target: string, asset: AssetDefinition): boolean {
  if (eventType.scope === 'stock') return target === asset.id
  if (eventType.scope === 'sector') return target === asset.sector
  return true
}

function envValue(env: readonly EnvironmentEntryState[], id: string): number {
  const entry = env.find((item) => item.id === id)
  if (entry === undefined) throw new Error(`[DEBUG drift] missing environment entry ${id}`)
  return entry.value
}

function band(value: number, lowBelow: number, highAt: number): CalendarBand {
  if (value < lowBelow) return 'low'
  if (value >= highAt) return 'high'
  return 'mid'
}

function effectPercent(calendar: CalendarDefinitions, kind: CalendarItemKind, outcome: CalendarOutcome, sector: SectorId): number {
  const cell = calendar.effects.find((row) => row.kind === kind && row.outcome === outcome && row.sector === sector)
  if (cell === undefined) throw new Error(`[DEBUG drift] calendar effect ${kind}:${outcome}:${sector} is missing`)
  return cell.percent
}

/** Mean percent effect of one calendar item on a sector, over its outcome chances. */
function calendarItemPercent(
  calendar: CalendarDefinitions,
  env: readonly EnvironmentEntryState[],
  kind: CalendarItemKind,
  sector: SectorId,
): number {
  const inflation = envValue(env, calendar.inflationEntryId)
  const growth = envValue(env, calendar.growthEntryId)
  if (kind === 'policyDecision') {
    const chances = lookupPolicyChances(calendar, inflation, growth)
    return (
      chances.hold * effectPercent(calendar, kind, 'hold', sector) +
      chances.up * effectPercent(calendar, kind, 'up', sector) +
      chances.down * effectPercent(calendar, kind, 'down', sector)
    )
  }
  const isGrowth = kind === 'growthRelease'
  const wanted = isGrowth
    ? band(growth, calendar.growthLowBelow, calendar.growthHighAt)
    : band(inflation, calendar.inflationLowBelow, calendar.inflationHighAt)
  const cell = (isGrowth ? calendar.growthRelease : calendar.inflationRelease).find((row) => row.band === wanted)
  if (cell === undefined) throw new Error(`[DEBUG drift] no ${kind} chances for band ${wanted}`)
  return (
    cell.above * effectPercent(calendar, kind, 'above', sector) +
    cell.inline * effectPercent(calendar, kind, 'inline', sector) +
    cell.below * effectPercent(calendar, kind, 'below', sector)
  )
}

/** Expected fractional change of the asset's fair value per day. 0 for an index. */
export function expectedDrift(
  defs: MarketDefinitions,
  asset: AssetDefinition,
  env: readonly EnvironmentEntryState[],
): number {
  if (asset.kind !== 'stock') return 0
  let percent = 0
  for (const eventType of defs.events) {
    const matching = eventType.targets.filter((target) => reaches(eventType, target, asset)).length
    if (matching === 0) continue
    const adjusted = adjustForEnvironment(eventType, env)
    percent += matching * adjusted.chance * (adjusted.up - adjusted.down) * ((eventType.magnitudeMin + eventType.magnitudeMax) / 2)
  }
  const calendar = defs.calendar
  if (calendar !== undefined && (asset.sector === 'A' || asset.sector === 'B')) {
    for (const entry of calendar.schedule) {
      percent += calendarItemPercent(calendar, env, entry.kind, asset.sector) / calendar.daysPerMonth
    }
  }
  return percent / 100
}
