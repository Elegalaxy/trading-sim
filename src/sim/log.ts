// One text line per log event. The simulation does not print; tests and the harness do.

import type { LogEvent } from './types.ts'

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

/** Integers print as integers. Other finite numbers print with up to 8 decimal places. */
function formatNumber(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`formatEvent expected a finite number, received ${describeValue(value)}`)
  }
  if (value === 0) return '0'
  if (Number.isSafeInteger(value)) return String(value)
  const trimmed = value.toFixed(8).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return trimmed === '-0' ? '0' : trimmed
}

function formatAsset(asset: string): string {
  if (typeof asset !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(asset)) {
    throw new Error(`formatEvent asset must be an id token, received ${describeValue(asset)}`)
  }
  return asset
}

function formatFlag(value: boolean): string {
  if (value === true) return 'true'
  if (value === false) return 'false'
  throw new Error(`formatEvent capped flag must be boolean, received ${describeValue(value)}`)
}

/** One line. Prices and gaps are cents. `gapAfter` is fair (or the index quote) minus the new price. */
export function formatEvent(event: LogEvent): string {
  switch (event.kind) {
    case 'noiseRoll':
      return `day=${formatNumber(event.day)} kind=noiseRoll asset=${formatAsset(event.asset)} z=${formatNumber(event.z)}`
    case 'priceStep':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=priceStep',
        `asset=${formatAsset(event.asset)}`,
        `previous=${formatNumber(event.previous)}`,
        `fair=${formatNumber(event.fair)}`,
        `pull=${formatNumber(event.pull)}`,
        `noise=${formatNumber(event.noise)}`,
        `rawMove=${formatNumber(event.rawMove)}`,
        `cappedMove=${formatNumber(event.cappedMove)}`,
        `capped=${formatFlag(event.capped)}`,
        `newPrice=${formatNumber(event.newPrice)}`,
        `gapAfter=${formatNumber(event.gapAfter)}`,
      ].join(' ')
    case 'indexStep':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=indexStep',
        `asset=${formatAsset(event.asset)}`,
        `previous=${formatNumber(event.previous)}`,
        `quote=${formatNumber(event.quote)}`,
        `rawMove=${formatNumber(event.rawMove)}`,
        `cappedMove=${formatNumber(event.cappedMove)}`,
        `capped=${formatFlag(event.capped)}`,
        `newPrice=${formatNumber(event.newPrice)}`,
        `gapAfter=${formatNumber(event.gapAfter)}`,
      ].join(' ')
    default: {
      const unknown: never = event
      throw new Error(`formatEvent cannot format ${describeValue(unknown)}`)
    }
  }
}
