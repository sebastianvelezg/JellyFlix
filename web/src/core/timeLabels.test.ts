// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { timeLabelText } from './timeLabels'

const state = { currentTime: 750, duration: 6350, speed: 1, now: Date.UTC(2026, 0, 1, 20, 0, 0), locale: 'en-GB' }

describe('timeLabelText', () => {
  it('shows elapsed, remaining and total time', () => {
    expect(timeLabelText('elapsed', state)).toBe('12:30')
    expect(timeLabelText('remaining', state)).toBe('-1:33:20')
    expect(timeLabelText('total', state)).toBe('1:45:50')
  })

  it('shows nothing when none is chosen or the length is unknown', () => {
    expect(timeLabelText('none', state)).toBeNull()
    expect(timeLabelText('total', { ...state, duration: 0 })).toBeNull()
    expect(timeLabelText('remaining', { ...state, duration: 0 })).toBeNull()
    expect(timeLabelText('endsAt', { ...state, duration: 0 })).toBeNull()
  })

  it('works out the end time from the speed', () => {
    const normal = timeLabelText('endsAt', { ...state, locale: 'en-GB' })
    const double = timeLabelText('endsAt', { ...state, speed: 2, locale: 'en-GB' })
    expect(normal).not.toBeNull()
    expect(double).not.toBe(normal)
  })
})
