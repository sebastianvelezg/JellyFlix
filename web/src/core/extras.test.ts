// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import { activeSegment, chapterAt, getPlaybackExtras, type Segment } from './extras'
import type { Session } from './jellyfin'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 3, seriesCount: 1, segments: true })
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

describe('getPlaybackExtras', () => {
  it('reads intro and credits segments and chapters', async () => {
    const extras = await getPlaybackExtras(session, 's0001-ep-1-1')
    expect(extras.segments).toEqual([
      { kind: 'intro', startSeconds: 3, endSeconds: 8 },
      { kind: 'outro', startSeconds: 24, endSeconds: 30 },
    ])
    expect(extras.chapters).toEqual([
      { name: 'Opening', startSeconds: 0 },
      { name: 'The middle', startSeconds: 12 },
      { name: 'Finale', startSeconds: 22 },
    ])
  })

  it('is empty for a title without segments', async () => {
    expect((await getPlaybackExtras(session, 'm0001')).segments).toEqual([])
  })

  it('never throws: a server that cannot answer just gives no extras', async () => {
    const down = await startMockJellyfin({ movieCount: 1, flaky: { path: '/MediaSegments/m0001', status: 500, times: 99 } })
    try {
      const s = await connect(down.url, 'tester', 'secret')
      expect((await getPlaybackExtras(s, 'm0001')).segments).toEqual([])
    } finally {
      await down.close()
    }
  })
})

describe('segments and chapters at a position', () => {
  const segments: Segment[] = [
    { kind: 'intro', startSeconds: 10, endSeconds: 40 },
    { kind: 'outro', startSeconds: 100, endSeconds: 120 },
  ]
  it('finds the segment you are in, but not at its very end', () => {
    expect(activeSegment(segments, 5)).toBeUndefined()
    expect(activeSegment(segments, 9.9)?.kind).toBe('intro') // the button appears just before it starts
    expect(activeSegment(segments, 25)?.kind).toBe('intro')
    expect(activeSegment(segments, 39.5)).toBeUndefined() // skipping lands here, it must not offer another skip
    expect(activeSegment(segments, 110)?.kind).toBe('outro')
    expect(activeSegment([], 10)).toBeUndefined()
  })

  it('finds the chapter being played', () => {
    const chapters = [
      { name: 'A', startSeconds: 0 },
      { name: 'B', startSeconds: 60 },
    ]
    expect(chapterAt(chapters, 0)?.name).toBe('A')
    expect(chapterAt(chapters, 59.9)?.name).toBe('A')
    expect(chapterAt(chapters, 60)?.name).toBe('B')
    expect(chapterAt([], 5)).toBeUndefined()
  })
})
