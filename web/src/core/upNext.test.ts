import { describe, expect, it } from 'vitest'
import { upNextPhase } from './upNext'

const base = { hasNext: true, ended: false, remainingSeconds: 600, durationSeconds: 2400, dismissed: false, autoplay: true, error: false }

describe('upNextPhase', () => {
  it('stays away until the title nears its end, then offers what follows', () => {
    expect(upNextPhase(base)).toBe('hidden')
    expect(upNextPhase({ ...base, remainingSeconds: 21 })).toBe('hidden')
    expect(upNextPhase({ ...base, remainingSeconds: 20 })).toBe('preview')
    expect(upNextPhase({ ...base, remainingSeconds: 3, autoplay: false })).toBe('preview')
  })

  it('counts down once the title has ended when autoplay is on, and only waits when it is off', () => {
    expect(upNextPhase({ ...base, ended: true, remainingSeconds: 0 })).toBe('counting')
    expect(upNextPhase({ ...base, ended: true, remainingSeconds: 0, autoplay: false })).toBe('waiting')
  })

  it('is never shown without a next title, after being closed, or while there is an error', () => {
    expect(upNextPhase({ ...base, hasNext: false, ended: true })).toBe('hidden')
    expect(upNextPhase({ ...base, ended: true, dismissed: true })).toBe('hidden')
    expect(upNextPhase({ ...base, remainingSeconds: 5, dismissed: true })).toBe('hidden')
    expect(upNextPhase({ ...base, ended: true, error: true })).toBe('hidden')
  })

  it('does not sit on a short clip, or on a title whose length is not known yet', () => {
    expect(upNextPhase({ ...base, durationSeconds: 30, remainingSeconds: 10 })).toBe('hidden')
    expect(upNextPhase({ ...base, durationSeconds: 0, remainingSeconds: 0 })).toBe('hidden')
    // ...but the end of a short clip still counts down.
    expect(upNextPhase({ ...base, durationSeconds: 30, ended: true })).toBe('counting')
  })
})
