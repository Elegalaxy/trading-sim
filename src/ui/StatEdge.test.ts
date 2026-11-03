import { describe, expect, it } from 'vitest'

import { energyLevel, stressLevel } from './effects.ts'

describe('screen edge levels', () => {
  it('are off outside the warning state and scale linearly to the extreme', () => {
    expect(stressLevel(60)).toBeNull()
    expect(stressLevel(61)).toBeCloseTo(1 / 40)
    expect(stressLevel(80)).toBeCloseTo(0.5)
    expect(stressLevel(100)).toBe(1)
    expect(energyLevel(40)).toBeNull()
    expect(energyLevel(30)).toBeCloseTo(0.25)
    expect(energyLevel(0)).toBe(1)
  })
})
