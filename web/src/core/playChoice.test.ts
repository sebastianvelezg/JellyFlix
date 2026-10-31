// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { defaultVersion, setPlayChoice, takePlayChoice } from './playChoice'

describe('play choice', () => {
  it('is handed over once, to the title it was made for', () => {
    setPlayChoice('a', { mediaSourceId: 'v2', audioIndex: 3 }, 1000)
    expect(takePlayChoice('b', 1000)).toBeUndefined()
    expect(takePlayChoice('a', 2000)).toEqual({ mediaSourceId: 'v2', audioIndex: 3 })
    expect(takePlayChoice('a', 2000)).toBeUndefined()
  })

  it('is forgotten when nobody uses it for a minute', () => {
    setPlayChoice('a', { subtitleIndex: null }, 1000)
    expect(takePlayChoice('a', 1000 + 61_000)).toBeUndefined()
  })

  it('keeps an explicit "no subtitles"', () => {
    setPlayChoice('a', { subtitleIndex: null }, 1000)
    expect(takePlayChoice('a', 1500)?.subtitleIndex).toBeNull()
  })
})

describe('defaultVersion', () => {
  const versions = [
    { id: 'x', resolution: '4K' },
    { id: 'y', resolution: '1080p' },
  ]
  it('prefers the resolution chosen last time', () => {
    expect(defaultVersion(versions, '1080p')).toBe('y')
  })
  it('falls back to the first version', () => {
    expect(defaultVersion(versions, '720p')).toBe('x')
    expect(defaultVersion(versions, null)).toBe('x')
    expect(defaultVersion([], '4K')).toBeUndefined()
  })
})
