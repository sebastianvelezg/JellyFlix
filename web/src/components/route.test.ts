import { describe, expect, it } from 'vitest'
import { formatRoute, parseRoute, type Route } from './route'

describe('routes', () => {
  const cases: Route[] = [
    { page: 'home' },
    { page: 'browse' },
    { page: 'collections' },
    { page: 'collection', id: 'bx0001' },
    { page: 'search', q: 'fast & furious' },
    { page: 'search', q: 'ñandú/ö?#' },
    { page: 'movie', id: 'abc123' },
    { page: 'section', section: 'series' },
    { page: 'section', section: 'anime' },
    { page: 'section', section: 'musicvideos' },
    { page: 'section', section: 'books' },
    { page: 'book', id: 'bk0001' },
    { page: 'read', id: 'bk0001' },
    { page: 'section', section: 'livetv' },
    { page: 'live', id: 'ch0001' },
    { page: 'show', id: 's0001' },
    { page: 'settings' },
    { page: 'admin' },
    { page: 'music', tab: 'home' },
    { page: 'music', tab: 'albums' },
    { page: 'album', id: 'al0001-1' },
    { page: 'artist', id: 'ar0001' },
    { page: 'playlist', id: 'pl1' },
    { page: 'person', id: 'p1', name: 'Zoë Saldaña & Co' },
    { page: 'play', id: 'abc123', startOver: false },
    { page: 'play', id: 'abc123', startOver: true },
    { page: 'play', id: 'abc123', startOver: false, startAt: 754 },
    { page: 'play', id: 'abc123', startOver: false, listId: 'vp0001' },
    { page: 'play', id: 'abc123', startOver: false, collectionId: 'bx0001' },
    { page: 'play', id: 'mv1', startOver: false, folderId: 'f1' },
    { page: 'play', id: 'mv1', startOver: false, libraryId: 'lib-musicvideos', shuffle: 'seed-1' },
    { page: 'play', id: 'mv1', startOver: true, queueId: 'k3x9aq' },
    { page: 'folder', id: 'f1' },
  ]
  it.each(cases)('round-trips %j', (route) => {
    expect(parseRoute(formatRoute(route))).toEqual(route)
  })

  it('falls back to the main page for empty, unknown or malformed hashes', () => {
    for (const hash of ['', '#', '#/', '#/nonsense', '#/movie/', '#/search/', '#/search/%20', '#/movie/%E0%A4%A', '#/show/', '#/album/', '#/artist/', '#/playlist/', '#/collection/', '#/collections/x']) {
      expect(parseRoute(hash)).toEqual({ page: 'home' })
    }
  })

  it('keeps movies at #/movies and the main page at #/', () => {
    expect(formatRoute({ page: 'home' })).toBe('#/')
    expect(formatRoute({ page: 'browse' })).toBe('#/movies')
    expect(parseRoute('#/movies')).toEqual({ page: 'browse' })
  })

  it('opens the music home for an unknown music tab', () => {
    expect(parseRoute('#/music/nonsense')).toEqual({ page: 'music', tab: 'home' })
    expect(parseRoute('#/music/')).toEqual({ page: 'music', tab: 'home' })
  })
})
