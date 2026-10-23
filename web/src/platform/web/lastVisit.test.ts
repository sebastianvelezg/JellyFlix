import { afterEach, describe, expect, it } from 'vitest'
import { VISIT_GAP_MS, nextVisit } from './lastVisit'

afterEach(() => localStorage.clear())

describe('visits', () => {
  it('has no previous visit the first time', () => {
    expect(nextVisit(null, 1000)).toEqual({ seen: 1000 })
    expect(nextVisit({}, 1000)).toEqual({ seen: 1000 })
    expect(nextVisit({ seen: Number.NaN }, 1000)).toEqual({ seen: 1000 })
  })

  it('counts a long pause as a new visit, and remembers when the last one was', () => {
    expect(nextVisit({ seen: 1000 }, 1000 + VISIT_GAP_MS + 1)).toEqual({ since: 1000, seen: 1000 + VISIT_GAP_MS + 1 })
  })

  it('keeps what was new while you come back within the half hour (a reload, another tab)', () => {
    const later = nextVisit({ since: 500, seen: 1000 }, 1000 + 60_000)
    expect(later).toEqual({ since: 500, seen: 1000 + 60_000 })
    // ...and with nothing new to hold on to, there is still nothing.
    expect(nextVisit({ seen: 1000 }, 2000)).toEqual({ seen: 2000 })
  })
})
