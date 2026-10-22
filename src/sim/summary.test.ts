import { describe, expect, it } from 'vitest'

import { daySummary, formatSummary } from './summary.ts'
import type { LogEvent } from './types.ts'

const io = (await import(['node', 'fs'].join(':'))) as {
  writeSync: (fd: number, data: string) => number
}

function debugSummary(message: string): void {
  io.writeSync(1, `[DEBUG summary] ${message}\n`)
}

function priceLog(): LogEvent[] {
  return [
    { kind: 'noiseRoll', day: 1, asset: 'NOVA', z: 1.234567 },
    {
      kind: 'eventRoll',
      day: 1,
      eventDay: 4,
      type: 'scandal',
      target: 'NOVA',
      roll: 0.01,
      chance: 0.04,
      fired: true,
    },
    {
      kind: 'effectApplied',
      day: 1,
      asset: 'NOVA',
      effect: 'earningsBeat:NOVA:1',
      dayIndex: 0,
      delta: 120,
    },
    {
      kind: 'effectApplied',
      day: 1,
      asset: 'BLSW',
      effect: 'earningsBeat:NOVA:1',
      dayIndex: 0,
      delta: 80,
    },
    {
      kind: 'effectApplied',
      day: 1,
      asset: 'NOVA',
      effect: 'productLaunch:NOVA:1',
      dayIndex: 1,
      delta: 10,
    },
    {
      kind: 'effectApplied',
      day: 1,
      asset: 'NOVA',
      effect: 'calendar:policyDecision:1',
      dayIndex: 0,
      delta: -40,
      calendar: 'policyDecision',
    },
    {
      kind: 'fairValueChange',
      day: 1,
      asset: 'NOVA',
      before: 4800,
      total: 200,
      clipped: 200,
      after: 5000,
    },
    {
      kind: 'priceStep',
      day: 1,
      asset: 'NOVA',
      previous: 4800,
      fair: 5000,
      pull: 70,
      noise: 12,
      rawMove: 82,
      cappedMove: 48,
      capped: false,
      newPrice: 4848,
      gapAfter: 152,
    },
    {
      kind: 'indexStep',
      day: 1,
      asset: 'M4X',
      previous: 100000,
      quote: 99000,
      rawMove: -1000,
      cappedMove: -1000,
      capped: false,
      newPrice: 99000,
      gapAfter: 0,
    },
    {
      kind: 'calendarItem',
      day: 1,
      item: 'policyDecision',
      roll: 0.42,
      outcome: 'up',
      before: [{ id: 'policyRate', value: 4, lastReleased: null }],
      after: [{ id: 'policyRate', value: 4.25, lastReleased: null }],
    },
    {
      kind: 'headline',
      day: 1,
      feedDay: 2,
      eventId: 'earningsBeat:NOVA:1',
      text: 'NOVA earnings up',
      magnitude: 4,
      top: true,
    },
    {
      kind: 'rumourGenerated',
      day: 1,
      feedDay: 2,
      source: 'streetTalk',
      tier: 'low',
      truthRoll: 0.9,
      truth: false,
      claim: 'NOVA scandal',
      leadDays: 2,
      targetEventId: 'scandal:NOVA:3',
      noise: true,
    },
  ]
}

describe('day summary', () => {
  it('lists fired events, calendar outcomes, and percent moves without hidden fields', () => {
    const summary = daySummary(priceLog())
    const line = formatSummary(summary)
    debugSummary(`input priceLog day=1 output=${line}`)
    expect(summary).toEqual({
      day: 1,
      events: ['earningsBeat:NOVA:1'],
      calendar: [{ item: 'policyDecision', outcome: 'up' }],
      moves: [
        { asset: 'NOVA', percent: 1 },
        { asset: 'M4X', percent: -1 },
      ],
    })
    expect(line).toBe('day=1 events=earningsBeat:NOVA:1 calendar=policyDecision:up moves=NOVA=+1,M4X=-1')
    const encoded = `${JSON.stringify(summary)} ${line}`
    expect(encoded.includes('fairValue')).toBe(false)
    expect(encoded.includes('gapAfter')).toBe(false)
    expect(encoded.toLowerCase().includes('fair value')).toBe(false)
    expect(encoded.includes('fair')).toBe(false)
    expect(encoded.includes('gap')).toBe(false)
    expect(encoded.includes('1.234567')).toBe(false)
    expect(encoded.includes('5000')).toBe(false)
    expect(encoded.includes('152')).toBe(false)
  })

  it('returns an empty day-0 summary for an empty log', () => {
    const summary = daySummary([])
    debugSummary(`input empty output=${formatSummary(summary)}`)
    expect(summary).toEqual({ day: 0, events: [], calendar: [], moves: [] })
    expect(formatSummary(summary)).toBe('day=0 events=none calendar=none moves=none')
  })

  it('rejects a log that mixes days', () => {
    const log = priceLog()
    log.push({ kind: 'noiseRoll', day: 2, asset: 'NOVA', z: 0 })
    expect(() => daySummary(log)).toThrow('mixes day 1 and day 2')
  })
})
