import { describe, expect, it } from 'vitest'
import { moneyText, wholeNumberText } from './numberInput.ts'

describe('number-only inputs', () => {
  it('keeps digits for share counts', () => {
    expect(wholeNumberText('1a2.5,3')).toBe('1253')
    expect(wholeNumberText('')).toBe('')
  })
  it('keeps digits and one dot with 2 decimals for money', () => {
    expect(moneyText('12abc')).toBe('12')
    expect(moneyText('1,000.5')).toBe('1000.5')
    expect(moneyText('12.345')).toBe('12.34')
    expect(moneyText('1.2.3')).toBe('1.23')
    expect(moneyText('12.')).toBe('12.')
    expect(moneyText('-5')).toBe('5')
  })
})
