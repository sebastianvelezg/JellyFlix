// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromeLikeCapabilities as capabilities } from '../../test/fixtures'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import {
  collectionPlayTarget,
  getCollection,
  getCollectionItems,
  getCollectionPage,
  nextInCollection,
  searchCollections,
  sortByYear,
} from './collections'
import { setFavorite } from './details'
import type { Session } from './jellyfin'
import { negotiatePlayback } from './playback'
import { PlaybackSession } from './playbackSession'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 10, collections: 3 })
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

describe('collections', () => {
  it('lists the collections with how many titles each holds', async () => {
    const page = await getCollectionPage(session, { startIndex: 0 })
    expect(page.total).toBe(3)
    expect(page.items.map((c) => c.name)).toEqual(['Test Collection 001', 'Test Collection 002', 'Test Collection 003'])
    expect(page.items[0]).toMatchObject({ id: 'bx0001', itemCount: 3, imageTag: 'tag1', backdropTag: 'bd1', favorite: false })
    // The server is asked for boxsets only, across all libraries.
    const request = [...mock.requests].reverse().find((r) => r.path === '/Items' && r.query.includeItemTypes === 'BoxSet')
    expect(request?.query.parentId).toBeUndefined()
    expect(request?.query.fields).toContain('ChildCount')
  })

  it('sorts newest first, pages and searches by name', async () => {
    const newest = await getCollectionPage(session, { startIndex: 0, sort: 'added' })
    expect(newest.items.map((c) => c.id)).toEqual(['bx0003', 'bx0002', 'bx0001'])
    const second = await getCollectionPage(session, { startIndex: 1, limit: 1 })
    expect(second.items.map((c) => c.id)).toEqual(['bx0002'])
    expect(second.total).toBe(3)
    expect((await searchCollections(session, 'collection 002')).map((c) => c.id)).toEqual(['bx0002'])
    expect(await searchCollections(session, '   ')).toEqual([])
  })

  it('can take a random handful for a row', async () => {
    const page = await getCollectionPage(session, { startIndex: 0, limit: 2, sort: 'random' })
    expect(page.items).toHaveLength(2)
    const request = [...mock.requests].reverse().find((r) => r.path === '/Items' && r.query.includeItemTypes === 'BoxSet')
    expect(request?.query.sortBy).toBe('Random')
    expect(request?.query.sortOrder).toBeUndefined()
  })

  it('reads one collection with its description', async () => {
    const collection = await getCollection(session, 'bx0002')
    expect(collection.name).toBe('Test Collection 002')
    expect(collection.overview).toContain('Test Collection 002')
  })

  it('lists what is inside, oldest first', async () => {
    const items = await getCollectionItems(session, 'bx0002')
    expect(items.map((m) => m.id)).toEqual(['m0004', 'm0005', 'm0006'])
    const years = items.map((m) => m.year ?? 0)
    expect(years).toEqual([...years].sort((a, b) => a - b))
    expect([...mock.requests].reverse().find((r) => r.path === '/Items' && r.query.parentId === 'bx0002')).toBeDefined()
  })

  it('does not break when the server has no collections', async () => {
    const empty = await startMockJellyfin({ movieCount: 3 })
    try {
      const s = await connect(empty.url, 'tester', 'secret')
      expect(await getCollectionPage(s, { startIndex: 0 })).toEqual({ items: [], total: 0 })
    } finally {
      await empty.close()
    }
  })

  it('tells that a favorite collection is a favorite', async () => {
    await setFavorite(session, 'bx0003', true)
    const page = await getCollectionPage(session, { startIndex: 0 })
    expect(page.items.find((c) => c.id === 'bx0003')?.favorite).toBe(true)
    await setFavorite(session, 'bx0003', false)
  })

  it('can play a movie from the collection', async () => {
    const [first] = await getCollectionItems(session, 'bx0001')
    const plan = await negotiatePlayback(session, (first as { id: string }).id, { capabilities })
    expect(plan.url).toContain('/Videos/m0001/')
    void PlaybackSession
  })
})

describe('sortByYear', () => {
  it('puts the oldest first, titles without a year last, and keeps ties in order', () => {
    const sorted = sortByYear([
      { id: 'a', year: 2005 },
      { id: 'b' },
      { id: 'c', year: 1999 },
      { id: 'd', year: 2005 },
    ])
    expect(sorted.map((x) => x.id)).toEqual(['c', 'a', 'd', 'b'])
  })
})

describe('collectionPlayTarget', () => {
  const m = (id: string, extra: object = {}) => ({ id, played: false, resumeTicks: 0, ...extra })
  it('prefers one you left half-way, then the first unwatched, then the first', () => {
    expect(collectionPlayTarget([m('1', { played: true }), m('2', { resumeTicks: 5 }), m('3')])?.id).toBe('2')
    expect(collectionPlayTarget([m('1', { played: true }), m('2'), m('3')])?.id).toBe('2')
    expect(collectionPlayTarget([m('1', { played: true }), m('2', { played: true })])?.id).toBe('1')
  })
  it('skips series and handles an empty collection', () => {
    expect(collectionPlayTarget([m('s', { isSeries: true }), m('2')])?.id).toBe('2')
    expect(collectionPlayTarget([])).toBeUndefined()
  })
})

describe('nextInCollection', () => {
  const m = (id: string, isSeries = false) => ({ id, isSeries })
  const saga = [m('1'), m('2'), m('show', true), m('3')]
  it('goes on to the next title, skipping a series', () => {
    expect(nextInCollection(saga, '1')?.id).toBe('2')
    expect(nextInCollection(saga, '2')?.id).toBe('3')
  })
  it('has nothing after the last title, or for a title that is not in it', () => {
    expect(nextInCollection(saga, '3')).toBeNull()
    expect(nextInCollection(saga, 'nope')).toBeNull()
    expect(nextInCollection([m('1'), m('show', true)], '1')).toBeNull()
  })
})
