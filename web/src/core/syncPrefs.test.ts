import { describe, expect, it } from 'vitest'
import {
  EMPTY_SYNC_FILE,
  hasNewerSection,
  parseSyncFile,
  parseSyncState,
  planFirstActivation,
  planSection,
  pushStamp,
  readableSection,
  serializeSyncFile,
  serverTimeFromHeader,
  SYNC_OFF,
  withSection,
  type RemoteSection,
  type SectionState,
} from './syncPrefs'

const section = (at: number, data: unknown = { a: 1 }, by = 'tv', v = 1): RemoteSection => ({ v, at, by, data })
const state = (applied: number, snapshot: string | null, dirtyAt: number | null = null): SectionState => ({ applied, snapshot, dirtyAt })

describe('the saved file', () => {
  it('reads what it wrote, and keeps sections it does not know', () => {
    const file = withSection(withSection(EMPTY_SYNC_FILE, 'appearance', section(5)), 'playback', section(6))
    const withUnknown = { ...file, sections: { ...file.sections, future: { v: 9, at: 1, by: 'x', data: [1] } } }
    const back = parseSyncFile(serializeSyncFile(withUnknown))
    expect(readableSection(back, 'appearance')?.at).toBe(5)
    expect(back.sections.future).toEqual({ v: 9, at: 1, by: 'x', data: [1] })
    // Putting one section in leaves every other as it was.
    const next = withSection(back, 'playback', section(7))
    expect(next.sections.future).toEqual(back.sections.future)
    expect(readableSection(next, 'appearance')?.at).toBe(5)
  })

  it('is empty when the text is not one of ours', () => {
    for (const bad of [null, '', 'x', '{"sections":5}', '{"sections":[]}', '[]', '{not json']) expect(parseSyncFile(bad)).toBe(EMPTY_SYNC_FILE)
    expect(parseSyncFile('x'.repeat(60_000))).toBe(EMPTY_SYNC_FILE)
  })

  it('does not let a section called __proto__ in', () => {
    const file = parseSyncFile('{"v":1,"sections":{"__proto__":{"polluted":true},"appearance":{"v":1,"at":1,"by":"web","data":{}}}}')
    expect(Object.keys(file.sections)).toEqual(['appearance'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('does not read a damaged section, and leaves one of a later format alone', () => {
    const file = parseSyncFile('{"v":1,"sections":{"appearance":{"v":1,"at":"no"},"playback":{"v":2,"at":1,"by":"tv","data":{}}}}')
    expect(readableSection(file, 'appearance')).toBeNull()
    expect(readableSection(file, 'playback')).toBeNull()
    expect(hasNewerSection(file, 'playback')).toBe(true)
    expect(hasNewerSection(file, 'appearance')).toBe(false)
  })
})

describe('what a device remembers', () => {
  it('reads a valid state and forgets anything else', () => {
    expect(parseSyncState(null)).toBe(SYNC_OFF)
    expect(parseSyncState({ enabled: 'yes' }).enabled).toBe(false)
    const s = parseSyncState({ enabled: true, sections: { appearance: { applied: 5, snapshot: 'x', dirtyAt: 7 }, other: { applied: 1 }, playback: 'no' } })
    expect(s.enabled).toBe(true)
    expect(s.sections).toEqual({ appearance: { applied: 5, snapshot: 'x', dirtyAt: 7 } })
  })
})

describe('planning a section', () => {
  const NOW = 10_000

  it('sends this device\'s choices when the account has nothing yet', () => {
    expect(planSection({ remote: null, newerFormat: false, local: 'L', state: state(0, null), now: NOW }).action).toBe('push')
  })

  it('does nothing when neither side changed', () => {
    expect(planSection({ remote: section(5), newerFormat: false, local: 'L', state: state(5, 'L'), now: NOW }).action).toBe('none')
  })

  it('takes the account\'s copy when it is new and nothing here changed (the theme set on the web reaches the TV)', () => {
    expect(planSection({ remote: section(9), newerFormat: false, local: 'L', state: state(5, 'L'), now: NOW }).action).toBe('apply')
  })

  it('sends a change made here when the account has nothing newer', () => {
    const plan = planSection({ remote: section(5), newerFormat: false, local: 'CHANGED', state: state(5, 'L'), now: NOW })
    expect(plan).toEqual({ action: 'push', dirtyAt: NOW })
  })

  it('at the same moment on two devices, the later change wins, per section', () => {
    // Changed here at 8000 while the account got a copy at 9000: the account's is later.
    const lost = planSection({ remote: section(9_000), newerFormat: false, local: 'MINE', state: state(5_000, 'L', 8_000), now: NOW })
    expect(lost.action).toBe('apply-conflict')
    // Changed here at 9500, after the account's copy at 9000: this device's change wins.
    const won = planSection({ remote: section(9_000), newerFormat: false, local: 'MINE', state: state(5_000, 'L', 9_500), now: NOW })
    expect(won.action).toBe('push')
  })

  it('a change made offline keeps its time, so a later sync judges it by when it was made', () => {
    const first = planSection({ remote: section(5), newerFormat: false, local: 'MINE', state: state(5, 'L'), now: 6_000 })
    expect(first.dirtyAt).toBe(6_000)
    const later = planSection({ remote: section(5), newerFormat: false, local: 'MINE', state: state(5, 'L', first.dirtyAt), now: 99_000 })
    expect(later.dirtyAt).toBe(6_000)
  })

  it('when the account\'s copy is newer than an offline change, the account wins and says so', () => {
    expect(planSection({ remote: section(8_000), newerFormat: false, local: 'MINE', state: state(5, 'L', 6_000), now: 99_000 }).action).toBe('apply-conflict')
  })

  it('leaves a copy of a later format alone', () => {
    expect(planSection({ remote: null, newerFormat: true, local: 'L', state: state(0, null), now: NOW }).action).toBe('skip')
  })

  it('a push is stamped above what is saved, whatever the clocks say', () => {
    expect(pushStamp(100, section(500))).toBe(501)
    expect(pushStamp(1_000, section(500))).toBe(1_000)
    expect(pushStamp(7, null)).toBe(7)
  })
})

describe('turning it on for the first time', () => {
  const canonical = (_name: string, s: RemoteSection) => JSON.stringify(s.data)
  const locals = { appearance: JSON.stringify({ a: 1 }), playback: JSON.stringify({ b: 2 }) }

  it('just uploads when the account has nothing of ours', () => {
    expect(planFirstActivation(EMPTY_SYNC_FILE, locals, canonical)).toEqual({ kind: 'upload' })
  })

  it('has nothing to choose when the account already has the same choices', () => {
    const file = withSection(withSection(EMPTY_SYNC_FILE, 'appearance', section(4, { a: 1 })), 'playback', section(6, { b: 2 }))
    expect(planFirstActivation(file, locals, canonical)).toEqual({ kind: 'same', applied: { appearance: 4, playback: 6 } })
  })

  it('asks when they differ, and says which sections and who saved them', () => {
    const file = withSection(withSection(EMPTY_SYNC_FILE, 'appearance', section(4, { a: 'other' }, 'web')), 'playback', section(6, { b: 2 }))
    expect(planFirstActivation(file, locals, canonical)).toEqual({ kind: 'ask', sections: [{ name: 'appearance', at: 4, by: 'web' }] })
  })
})

describe('the server\'s clock', () => {
  it('is read from the Date header', () => {
    expect(serverTimeFromHeader('Mon, 09 Nov 2026 12:00:00 GMT')).toBe(Date.UTC(2026, 10, 9, 12))
    expect(serverTimeFromHeader(null)).toBeNull()
    expect(serverTimeFromHeader('not a date')).toBeNull()
  })
})
