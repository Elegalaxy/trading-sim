// One text line per log event. The simulation does not print; tests and the harness do.

import type { AccountLogEvent, EnvironmentView, LogEvent } from './types.ts'

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

function formatText(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) {
    throw new Error(`formatEvent ${label} must be one non-empty line, received ${describeValue(value)}`)
  }
  return JSON.stringify(value)
}

/** One line, including an empty account name. */
function formatJsonString(value: string, label: string): string {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) {
    throw new Error(`formatEvent ${label} must be one line, received ${describeValue(value)}`)
  }
  return JSON.stringify(value)
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

/** Display clock `HH:MM`. Not a timestamp. */
function formatClock(value: string): string {
  if (typeof value !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
    throw new Error(`formatEvent clock must be HH:MM, received ${describeValue(value)}`)
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

function formatCalendarTag(calendar: string | undefined): string {
  if (calendar === undefined) return ''
  return ` calendar=${formatToken(calendar, 'calendar')}`
}

function formatOptionalNumber(value: number | null, label: string): string {
  if (value === null) return 'none'
  if (typeof value !== 'number') {
    throw new Error(`formatEvent ${label} must be a number or null, received ${describeValue(value)}`)
  }
  return formatNumber(value)
}

function formatEnvironmentChange(before: readonly EnvironmentView[], after: readonly EnvironmentView[]): string {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length || before.length === 0) {
    throw new Error(
      `formatEvent calendar environment before and after must be the same non-empty list, received ${describeValue(before?.length)} and ${describeValue(after?.length)}`,
    )
  }
  const parts: string[] = []
  for (let i = 0; i < before.length; i += 1) {
    const left = before[i]
    const right = after[i]
    if (left === undefined || right === undefined || left.id !== right.id) {
      throw new Error('formatEvent calendar environment before and after must list the same entries in order')
    }
    const id = formatToken(left.id, 'environment id')
    parts.push(`${id}=${formatNumber(left.value)}->${formatNumber(right.value)}`)
    parts.push(
      `${id}Released=${formatOptionalNumber(left.lastReleased, 'released')}->${formatOptionalNumber(right.lastReleased, 'released')}`,
    )
  }
  return parts.join(' ')
}

/** One line. Prices and gaps are cents. `gapAfter` is fair (or the index quote) minus the new price. */
export function formatEvent(event: LogEvent | AccountLogEvent): string {
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
      ].join(' ') + formatCalendarTag(event.calendar)
    case 'fairValueChange':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=fairValueChange',
        `asset=${formatAsset(event.asset)}`,
        `before=${formatNumber(event.before)}`,
        `total=${formatNumber(event.total)}`,
        `clipped=${formatNumber(event.clipped)}`,
        `after=${formatNumber(event.after)}`,
      ].join(' ') + formatCalendarTag(event.calendar)
    case 'calendarItem':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=calendarItem',
        `item=${formatToken(event.item, 'item')}`,
        `roll=${formatNumber(event.roll)}`,
        `outcome=${formatToken(event.outcome, 'outcome')}`,
        formatEnvironmentChange(event.before, event.after),
      ].join(' ')
    case 'headline':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=headline',
        `feedDay=${formatNumber(event.feedDay)}`,
        `event=${formatEffectId(event.eventId)}`,
        `magnitude=${formatNumber(event.magnitude)}`,
        `top=${formatFlag(event.top, 'top flag')}`,
        `text=${formatText(event.text, 'text')}`,
      ].join(' ')
    case 'rumourGenerated':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=rumourGenerated',
        `feedDay=${formatNumber(event.feedDay)}`,
        `source=${formatToken(event.source, 'source')}`,
        `tier=${formatToken(event.tier, 'tier')}`,
        `truthRoll=${formatNumber(event.truthRoll)}`,
        `truth=${formatFlag(event.truth, 'truth flag')}`,
        `claim=${formatText(event.claim, 'claim')}`,
        `leadDays=${formatNumber(event.leadDays)}`,
        `target=${formatEffectId(event.targetEventId)}`,
        `noise=${formatFlag(event.noise, 'noise flag')}`,
      ].join(' ')
    case 'transfer':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=transfer',
        `from=${formatToken(event.from, 'from')}`,
        `to=${formatToken(event.to, 'to')}`,
        `amount=${formatNumber(event.amountCents)}`,
        `cash=${formatNumber(event.cashCents)}`,
        `trading=${formatNumber(event.tradingCents)}`,
        `savings=${formatNumber(event.savingsCents)}`,
      ].join(' ')
    case 'commandRejected': {
      const account =
        event.account === undefined ? '' : ` account=${formatJsonString(event.account, 'account')}`
      return [
        `day=${formatNumber(event.day)}`,
        'kind=commandRejected',
        `command=${formatText(event.command, 'command')}`,
        `reason=${formatToken(event.reason, 'reason')}`,
      ].join(' ') + account
    }
    case 'skip':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=skip',
        `from=${formatToken(event.from, 'from')}`,
        `to=${formatToken(event.to, 'to')}`,
      ].join(' ')
    case 'sectionChange':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=sectionChange',
        `from=${formatToken(event.from, 'from')}`,
        `to=${formatToken(event.to, 'to')}`,
        `clock=${formatClock(event.clock)}`,
      ].join(' ')
    case 'savingsAccrual':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=savingsAccrual',
        `savings=${formatNumber(event.savingsCents)}`,
        `policyRate=${formatNumber(event.policyRate)}`,
        `annualRate=${formatNumber(event.annualRate)}`,
        `accrual=${formatNumber(event.accrualCents)}`,
        `accrued=${formatNumber(event.accruedCents)}`,
      ].join(' ')
    case 'savingsInterestPaid':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=savingsInterestPaid',
        `amount=${formatNumber(event.amountCents)}`,
        `savings=${formatNumber(event.savingsCents)}`,
        `accrued=${formatNumber(event.accruedCents)}`,
      ].join(' ')
    case 'orderFill':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=orderFill',
        `asset=${formatAsset(event.asset)}`,
        `side=${formatToken(event.side, 'side')}`,
        `quantity=${formatNumber(event.quantity)}`,
        `price=${formatNumber(event.price)}`,
        `halfSpread=${formatNumber(event.halfSpread)}`,
        `fillPrice=${formatNumber(event.fillPrice)}`,
        `fee=${formatNumber(event.fee)}`,
      ].join(' ')
    case 'borrowFee':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=borrowFee',
        `asset=${formatAsset(event.asset)}`,
        `shares=${formatNumber(event.shares)}`,
        `price=${formatNumber(event.price)}`,
        `ratePpm=${formatNumber(event.ratePpm)}`,
        `assessed=${formatNumber(event.assessed)}`,
        `paid=${formatNumber(event.paid)}`,
        `unpaid=${formatNumber(event.unpaid)}`,
      ].join(' ')
    case 'realized':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=realized',
        `asset=${formatAsset(event.asset)}`,
        `amount=${formatNumber(event.amount)}`,
      ].join(' ')
    case 'marginInterest':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=marginInterest',
        `borrowed=${formatNumber(event.borrowed)}`,
        `policyRate=${formatNumber(event.policyRate)}`,
        `annualRate=${formatNumber(event.annualRate)}`,
        `interest=${formatNumber(event.interest)}`,
        `trading=${formatNumber(event.tradingCents)}`,
      ].join(' ')
    case 'marginCheck':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=marginCheck',
        `equity=${formatNumber(event.equity)}`,
        `positionValue=${formatNumber(event.positionValue)}`,
        `ratio=${formatOptionalNumber(event.ratio, 'ratio')}`,
      ].join(' ')
    case 'marginWarning':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=marginWarning',
        `equity=${formatNumber(event.equity)}`,
        `positionValue=${formatNumber(event.positionValue)}`,
        `ratio=${formatNumber(event.ratio)}`,
      ].join(' ')
    case 'liquidation':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=liquidation',
        `asset=${formatAsset(event.asset)}`,
        `quantity=${formatNumber(event.quantity)}`,
        `fill=${formatNumber(event.fill)}`,
        `ratio=${formatOptionalNumber(event.ratioAfter, 'ratio')}`,
      ].join(' ')
    case 'backstopWriteOff':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=backstopWriteOff',
        `amount=${formatNumber(event.amount)}`,
      ].join(' ')
    case 'wipeOut':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=wipeOut',
        `startEquity=${formatNumber(event.startEquity)}`,
        `endEquity=${formatNumber(event.endEquity)}`,
      ].join(' ')
    case 'salaryPaid':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=salaryPaid',
        `job=${formatToken(event.job, 'job')}`,
        `days=${formatNumber(event.days)}`,
        `amount=${formatNumber(event.amountCents)}`,
      ].join(' ')
    case 'jobChangeRequested':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=jobChangeRequested',
        `from=${formatToken(event.from, 'from')}`,
        `to=${formatToken(event.to, 'to')}`,
        `effectiveDay=${formatNumber(event.effectiveDay)}`,
      ].join(' ')
    case 'jobChanged':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=jobChanged',
        `from=${formatToken(event.from, 'from')}`,
        `to=${formatToken(event.to, 'to')}`,
        `slots=${formatNumber(event.slots)}`,
        `sleepHours=${formatNumber(event.sleepHours)}`,
      ].join(' ')
    case 'perkApplied':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=perkApplied',
        `job=${formatToken(event.job, 'job')}`,
        `perk=${formatToken(event.perk, 'perk')}`,
      ].join(' ')
    case 'billDue':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=billDue',
        `amount=${formatNumber(event.amountCents)}`,
        `cash=${formatNumber(event.cashCents)}`,
      ].join(' ')
    case 'billPaid':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=billPaid',
        `amount=${formatNumber(event.amountCents)}`,
        `cash=${formatNumber(event.cashCents)}`,
      ].join(' ')
    case 'billPending':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=billPending',
        `amount=${formatNumber(event.amountCents)}`,
        `cash=${formatNumber(event.cashCents)}`,
        `shortfall=${formatNumber(event.shortfallCents)}`,
      ].join(' ')
    case 'coverableCheck':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=coverableCheck',
        `cash=${formatNumber(event.cashCents)}`,
        `savings=${formatNumber(event.savingsCents)}`,
        `tradingEquity=${formatNumber(event.tradingEquityCents)}`,
        `loanLimit=${formatNumber(event.loanLimitCents)}`,
        `total=${formatNumber(event.totalCents)}`,
        `bill=${formatNumber(event.billCents)}`,
      ].join(' ')
    case 'runEnded':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=runEnded',
        `reason=${formatToken(event.reason, 'reason')}`,
      ].join(' ')
    case 'fiCheck':
      return [
        `day=${formatNumber(event.day)}`,
        'kind=fiCheck',
        `windowDays=${formatNumber(event.windowDays)}`,
        `passive=${formatNumber(event.passiveCents)}`,
        `expenses=${formatNumber(event.expensesCents)}`,
        `streak=${formatNumber(event.streak)}`,
      ].join(' ')
    default: {
      const unknown: never = event
      throw new Error(`formatEvent cannot format ${describeValue(unknown)}`)
    }
  }
}
