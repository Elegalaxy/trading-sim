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

function formatFlag(value: boolean, label: string): string {
  if (value === true) return 'true'
  if (value === false) return 'false'
  throw new Error(`formatEvent ${label} must be boolean, received ${describeValue(value)}`)
}

function formatToken(value: string, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(value)) {
    throw new Error(`formatEvent ${label} must be an id token, received ${describeValue(value)}`)
  }
  return value
}

function formatEffectId(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9]*(?::[A-Za-z][A-Za-z0-9]*)+:[1-9][0-9]*$/.test(value)) {
    throw new Error(`formatEvent effect must be type:target:day, received ${describeValue(value)}`)
  }
  return value
}

function formatDirection(value: string): string {
  if (value === 'up' || value === 'down' || value === 'none') return value
  throw new Error(`formatEvent result must be up, down, or none, received ${describeValue(value)}`)
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
        `capped=${formatFlag(event.capped, 'capped flag')}`,
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
        `capped=${formatFlag(event.capped, 'capped flag')}`,
        `newPrice=${formatNumber(event.newPrice)}`,
        `gapAfter=${formatNumber(event.gapAfter)}`,
      ].join(' ')
    case 'envDrift':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=envDrift',
        `entry=${formatToken(event.entry, 'entry')}`,
        `before=${formatNumber(event.before)}`,
        `shock=${formatNumber(event.shock)}`,
        `delta=${formatNumber(event.delta)}`,
        `after=${formatNumber(event.after)}`,
      ].join(' ')
    case 'eventRoll':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=eventRoll',
        `eventDay=${formatNumber(event.eventDay)}`,
        `type=${formatToken(event.type, 'type')}`,
        `target=${formatToken(event.target, 'target')}`,
        `roll=${formatNumber(event.roll)}`,
        `chance=${formatNumber(event.chance)}`,
        `fired=${formatFlag(event.fired, 'fired flag')}`,
      ].join(' ')
    case 'eventDirection':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=eventDirection',
        `eventDay=${formatNumber(event.eventDay)}`,
        `type=${formatToken(event.type, 'type')}`,
        `target=${formatToken(event.target, 'target')}`,
        `roll=${formatNumber(event.roll)}`,
        `up=${formatNumber(event.up)}`,
        `down=${formatNumber(event.down)}`,
        `none=${formatNumber(event.none)}`,
        `shiftUp=${formatNumber(event.shiftUp)}`,
        `shiftDown=${formatNumber(event.shiftDown)}`,
        `shiftNone=${formatNumber(event.shiftNone)}`,
        `result=${formatDirection(event.result)}`,
      ].join(' ')
    case 'eventMagnitude':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=eventMagnitude',
        `eventDay=${formatNumber(event.eventDay)}`,
        `type=${formatToken(event.type, 'type')}`,
        `target=${formatToken(event.target, 'target')}`,
        `roll=${formatNumber(event.roll)}`,
        `min=${formatNumber(event.min)}`,
        `max=${formatNumber(event.max)}`,
        `magnitude=${formatNumber(event.magnitude)}`,
      ].join(' ')
    case 'effectApplied':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=effectApplied',
        `asset=${formatAsset(event.asset)}`,
        `effect=${formatEffectId(event.effect)}`,
        `dayIndex=${formatNumber(event.dayIndex)}`,
        `delta=${formatNumber(event.delta)}`,
      ].join(' ')
    case 'fairValueChange':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=fairValueChange',
        `asset=${formatAsset(event.asset)}`,
        `before=${formatNumber(event.before)}`,
        `total=${formatNumber(event.total)}`,
        `clipped=${formatNumber(event.clipped)}`,
        `after=${formatNumber(event.after)}`,
      ].join(' ')
    default: {
      const unknown: never = event
      throw new Error(`formatEvent cannot format ${describeValue(unknown)}`)
    }
  }
}
