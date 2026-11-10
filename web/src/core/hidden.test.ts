import { describe, expect, it } from 'vitest'
import {
  filterNextUp,
  filterResume,
  hiddenCount,
  hiddenMargin,
  hideFromNextUp,
  hideFromResume,
  isNextUpHidden,
  isResumeHidden,
  listHidden,
  MAX_HIDDEN,
  NO_HIDDEN,
  parseHidden,
  restoreAllHidden,
  restoreHidden,
} from './hidden'

const title = (id: string, lastPlayedAt?: number) => ({ id, lastPlayedAt })

describe('Continue watching: hiding a title', () => {
  it('takes the title out of the row and leaves the others', () => {
    const hidden = hideFromResume(NO_HIDDEN, title('a', 100), 'A', 1)
    expect(filterResume(hidden, [title('a', 100), title('b', 50)]).map((t) => t.id)).toEqual(['b'])
  })

  it('keeps it hidden while it has not been played again', () => {
    const hidden = hideFromResume(NO_HIDDEN, title('a', 100), 'A', 1)
    expect(isResumeHidden(hidden, title('a', 100))).toBe(true)
    // An older date (clocks, rounding) is still the same watch.
    expect(isResumeHidden(hidden, title('a', 90))).toBe(true)
  })

  it('brings it back when it is played again after being hidden', () => {
    const hidden = hideFromResume(NO_HIDDEN, title('a', 100), 'A', 1)
    expect(isResumeHidden(hidden, title('a', 101))).toBe(false)
    expect(filterResume(hidden, [title('a', 5000)]).map((t) => t.id)).toEqual(['a'])
  })

  it('treats a title with no play date as never played since', () => {
    const hidden = hideFromResume(NO_HIDDEN, title('a'), 'A', 1)
    expect(isResumeHidden(hidden, title('a'))).toBe(true)
    expect(isResumeHidden(hidden, title('a', 1))).toBe(false)
  })

  it('compares dates of the server only, so the clock of this device does not matter', () => {
    // Hidden "in the future" on this device's clock, then played at a server time before that: it is still a new play.
    const hidden = hideFromResume(NO_HIDDEN, title('a', 100), 'A', 9_999_999_999_999)
    expect(isResumeHidden(hidden, title('a', 200))).toBe(false)
  })

  it('restoring brings it back whatever its dates are', () => {
    const hidden = hideFromResume(NO_HIDDEN, title('a', 100), 'A', 1)
    expect(filterResume(restoreHidden(hidden, 'resume', 'a'), [title('a', 100)]).length).toBe(1)
  })
})

describe('Next up: hiding a series', () => {
  it('takes every episode of that series out of the row', () => {
    const hidden = hideFromNextUp(NO_HIDDEN, 's1', 'Show', 1)
    const rows = [{ id: 'e1', seriesId: 's1' }, { id: 'e2', seriesId: 's2' }, { id: 'e3', seriesId: 's1' }]
    expect(filterNextUp(hidden, rows).map((e) => e.id)).toEqual(['e2'])
    expect(isNextUpHidden(hidden, 's1')).toBe(true)
  })

  it('stays hidden however much of it is watched, until it is restored', () => {
    const hidden = hideFromNextUp(NO_HIDDEN, 's1', 'Show', 1)
    expect(filterNextUp(hidden, [{ id: 'new', seriesId: 's1' }])).toEqual([])
    expect(filterNextUp(restoreHidden(hidden, 'nextUp', 's1'), [{ id: 'new', seriesId: 's1' }]).length).toBe(1)
  })

  it('does not touch what is hidden from Continue watching', () => {
    const both = hideFromNextUp(hideFromResume(NO_HIDDEN, title('a'), 'A', 1), 's1', 'Show', 2)
    expect(Object.keys(restoreHidden(both, 'nextUp', 's1').resume)).toEqual(['a'])
    expect(Object.keys(restoreHidden(both, 'resume', 'a').nextUp)).toEqual(['s1'])
  })
})

describe('the list of hidden things', () => {
  it('lists both kinds, newest first, and counts them', () => {
    const h = hideFromNextUp(hideFromResume(NO_HIDDEN, title('a'), 'A', 10), 's1', 'Show', 20)
    expect(listHidden(h).map((r) => `${r.kind}:${r.id}`)).toEqual(['nextUp:s1', 'resume:a'])
    expect(hiddenCount(h)).toBe(2)
  })

  it('restores one kind or everything', () => {
    const h = hideFromNextUp(hideFromResume(NO_HIDDEN, title('a'), 'A', 10), 's1', 'Show', 20)
    expect(hiddenCount(restoreAllHidden(h, 'resume'))).toBe(1)
    expect(hiddenCount(restoreAllHidden(h, 'nextUp'))).toBe(1)
    expect(hiddenCount(restoreAllHidden(h))).toBe(0)
  })

  it('hiding the same thing twice is one entry, and restoring what is not hidden changes nothing', () => {
    const once = hideFromResume(NO_HIDDEN, title('a'), 'A', 1)
    expect(hiddenCount(hideFromResume(once, title('a'), 'A', 2))).toBe(1)
    expect(restoreHidden(once, 'resume', 'zzz')).toEqual(once)
  })

  it('asks the server for a few more titles, so a row stays full', () => {
    expect(hiddenMargin(NO_HIDDEN, 'resume')).toBe(0)
    expect(hiddenMargin(hideFromResume(NO_HIDDEN, title('a'), 'A', 1), 'resume')).toBe(1)
  })

  it('lets the oldest make room beyond the limit', () => {
    let h = NO_HIDDEN
    for (let i = 0; i < MAX_HIDDEN + 5; i += 1) h = hideFromResume(h, title(`t${i}`), `T${i}`, i)
    expect(Object.keys(h.resume).length).toBe(MAX_HIDDEN)
    expect('t0' in h.resume).toBe(false)
    expect(`t${MAX_HIDDEN + 4}` in h.resume).toBe(true)
  })
})

describe('reading what was stored', () => {
  it('keeps a valid value', () => {
    const h = hideFromResume(NO_HIDDEN, title('a', 7), 'A', 1)
    expect(parseHidden(JSON.parse(JSON.stringify(h)))).toEqual(h)
  })

  it('drops anything that is not one of ours', () => {
    expect(parseHidden(null)).toBe(NO_HIDDEN)
    expect(parseHidden('x')).toBe(NO_HIDDEN)
    expect(parseHidden({ resume: [], nextUp: 5 })).toBe(NO_HIDDEN)
    const messy = parseHidden({ resume: { a: { name: 3, at: 'x', playedAt: null }, b: 'no', '': { name: 'x' } }, nextUp: {} })
    expect(messy.resume).toEqual({ a: { name: '', at: 0, playedAt: 0 } })
  })

  it('cannot be used to change an object prototype', () => {
    const raw = JSON.parse('{"resume":{"__proto__":{"name":"x","at":1,"playedAt":1},"ok":{"name":"y","at":1,"playedAt":1}},"nextUp":{}}')
    const h = parseHidden(raw)
    expect(Object.keys(h.resume)).toEqual(['ok'])
    expect(({} as Record<string, unknown>).name).toBeUndefined()
  })
})
