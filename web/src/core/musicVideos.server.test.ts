// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import type { Session } from './jellyfin'
import { clearQueueCache, firstOfQueue, getFolderContents, getFolderTrail, getVideosUnder, newShuffleSeed, nextInQueue, orderQueue, sortByPath } from './musicVideos'

let mock: MockServer
let session: Session
beforeAll(async () => {
  // 7 videos in 2 folders: Folder 0001 has 1-4, Folder 0002 has 5-6 and a folder "Nested" with 7.
  mock = await startMockJellyfin({ movieCount: 2, musicVideos: 7, musicVideoFolders: 2 })
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

describe('music video folders', () => {
  it('lists what is directly inside a library or a folder, folders apart from videos', async () => {
    const root = await getFolderContents(session, 'lib-musicvideos')
    expect(root.folders.map((f) => f.name)).toEqual(['Folder 0001', 'Folder 0002'])
    expect(root.videos).toEqual([])
    const first = await getFolderContents(session, 'mvf0001')
    expect(first.folders).toEqual([])
    expect(first.videos.map((v) => v.id)).toEqual(['mv0001', 'mv0002', 'mv0003', 'mv0004'])
    expect(first.videos[0]).toMatchObject({ musicVideo: true, parentId: 'mvf0001' })
    const second = await getFolderContents(session, 'mvf0002')
    expect(second.folders.map((f) => [f.id, f.name])).toEqual([['mvf0099', 'Nested']])
    expect(second.videos.map((v) => v.id)).toEqual(['mv0005', 'mv0006'])
    // Only one level is asked for.
    const asked = [...mock.requests].reverse().find((r) => r.path === '/Items' && r.query.parentId === 'mvf0002')
    expect(asked?.query.recursive).toBe('false')
  })

  it('reads every video below a folder, folders first, in path order', async () => {
    const all = await getVideosUnder(session, 'lib-musicvideos')
    // Folder 0002 lists its own folder (Nested, holding mv0007) before its own files.
    expect(all.map((v) => v.id)).toEqual(['mv0001', 'mv0002', 'mv0003', 'mv0004', 'mv0007', 'mv0005', 'mv0006'])
    expect((await getVideosUnder(session, 'mvf0002')).map((v) => v.id)).toEqual(['mv0007', 'mv0005', 'mv0006'])
  })

  it('reuses a queue read a moment ago', async () => {
    clearQueueCache()
    await getVideosUnder(session, 'mvf0001')
    const before = mock.requests.length
    await getVideosUnder(session, 'mvf0001')
    expect(mock.requests.length).toBe(before)
  })

  it('names the folders above one, the library first', async () => {
    const nested = await getFolderTrail(session, 'mvf0099')
    expect(nested.name).toBe('Nested')
    expect(nested.trail).toEqual([
      { id: 'lib-musicvideos', name: 'Music videos' },
      { id: 'mvf0002', name: 'Folder 0002' },
    ])
    expect((await getFolderTrail(session, 'mvf0001')).trail).toEqual([{ id: 'lib-musicvideos', name: 'Music videos' }])
  })
})

describe('queue helpers', () => {
  const v = (id: string, isSeries = false) => ({ id, isSeries })

  it('goes on to the next video, skips a series, and stops at the end unless it loops', () => {
    const queue = [v('a'), v('s', true), v('b')]
    expect(nextInQueue(queue, 'a')?.id).toBe('b')
    expect(nextInQueue(queue, 'b')).toBeNull()
    expect(nextInQueue(queue, 'b', true)?.id).toBe('a')
    expect(nextInQueue(queue, 'zzz', true)).toBeNull()
    expect(nextInQueue([v('only')], 'only', true)?.id).toBe('only')
  })

  it('keeps the order, or shuffles the same way for the same seed', () => {
    const items = Array.from({ length: 12 }, (_, i) => i)
    expect(orderQueue(items)).toEqual(items)
    expect(orderQueue(items, 'x')).toEqual(orderQueue(items, 'x'))
    expect(orderQueue(items, 'x')).not.toEqual(items)
    expect([...orderQueue(items, 'x')].sort((p, q) => p - q)).toEqual(items)
  })

  it('sorts paths with folders first and numbers as numbers', () => {
    const paths = ['/m/B/10.mkv', '/m/B/2.mkv', '/m/a.mkv', '/m/A/z.mkv', '/m/Sub/Deep/x.mkv']
    expect(sortByPath(paths, (p) => p)).toEqual(['/m/A/z.mkv', '/m/B/2.mkv', '/m/B/10.mkv', '/m/Sub/Deep/x.mkv', '/m/a.mkv'])
    expect(paths[0]).toBe('/m/B/10.mkv') // the original is untouched
    // Windows paths sort the same way.
    expect(sortByPath(['C:\\m\\b.mkv', 'C:\\m\\A\\z.mkv'], (p) => p)).toEqual(['C:\\m\\A\\z.mkv', 'C:\\m\\b.mkv'])
  })

  it('starts a queue with its first title, or the first of the shuffled order', () => {
    const items = [v('s', true), v('a'), v('b'), v('c'), v('d'), v('e')]
    expect(firstOfQueue(items)?.id).toBe('a')
    const seed = newShuffleSeed()
    expect(seed).toMatch(/^[0-9a-z]{8}$/)
    expect(firstOfQueue(items, seed)?.id).toBe(orderQueue(items, seed).find((m) => !m.isSeries)?.id)
    expect(firstOfQueue([], seed)).toBeUndefined()
    expect(newShuffleSeed(() => 0)).toBe('00000000')
  })
})
