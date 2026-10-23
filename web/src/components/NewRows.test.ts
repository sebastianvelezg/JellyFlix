import { describe, expect, it } from 'vitest'
import { airsText } from './NewRows'

const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime()

describe('airsText', () => {
  const now = noon(2026, 10, 22)
  it('says today, tomorrow and in a few days', () => {
    expect(airsText(noon(2026, 10, 22), now)).toBe('Today')
    expect(airsText(new Date(2026, 9, 22, 23, 59).getTime(), now)).toBe('Today')
    expect(airsText(noon(2026, 10, 23), now)).toBe('Tomorrow')
    expect(airsText(noon(2026, 10, 25), now)).toBe('In 3 days')
  })

  it('gives the date after a week, and nothing when it is not known', () => {
    expect(airsText(noon(2026, 11, 5), now)).toMatch(/5/)
    expect(airsText(undefined, now)).toBe('')
  })

  it('treats something that aired earlier as today', () => {
    expect(airsText(noon(2026, 10, 20), now)).toBe('Today')
  })
})
