import { useCallback, useEffect, useState } from 'react'

/**
 * Hash-based routes, so the browser Back button and a page refresh both behave:
 *   #/                  the main page (a bit of everything)
 *   #/movies            the movies home
 *   #/collections       all collections; #/collection/<id> one of them
 *   #/series, #/anime, #/musicvideos, #/books, #/livetv   the series / anime / music videos / books / live TV home
 *   #/settings          preferences and account
 *   #/stats             what you have watched
 *   #/admin             administration (administrators only)
 *   #/music[/<tab>]     music home, or its albums / artists / songs / playlists
 *   #/album/<id>, #/artist/<id>, #/playlist/<id>   (music)
 *   #/lists             your playlists of movies and episodes; #/list/<id> one of them
 *   #/show/<id>         a series page (seasons and episodes)
 *   #/search/<text>     search results
 *   #/movie/<id>        movie page
 *   #/live/<id>         a live channel being watched
 *   #/book/<id>         book page (read it, listen to it, download it); #/read/<id> the reader
 *   #/person/<id>?name= a person's filmography
 *   #/play/<id>         player (add ?start=0 to start over instead of resuming, or ?start=<seconds> to begin there;
 *                       ?list=<playlist id>, ?collection=<collection id>, ?folder=<folder id> or ?library=<library id> goes on to the
 *                       next title of it when this one ends; &shuffle=<seed> plays that queue in a random order)
 *   #/folder/<id>       a folder of music videos
 */
export const MUSIC_TABS = ['home', 'albums', 'artists', 'songs'] as const
export type MusicTab = (typeof MUSIC_TABS)[number]

/**
 * What a title is played as part of, so that the next one follows it: a playlist, a collection, a folder of music videos (and
 * everything below it) or a whole library of music videos. `shuffle` is a seed: the queue is put in a random order that is the
 * same on every page of the queue.
 */
export interface PlayQueueRef {
  listId?: string
  collectionId?: string
  folderId?: string
  libraryId?: string
  shuffle?: string
}

export type Route =
  | { page: 'home' }
  | { page: 'browse' }
  | { page: 'collections' }
  | { page: 'collection'; id: string }
  | { page: 'lists' }
  | { page: 'list'; id: string }
  | { page: 'folder'; id: string }
  | { page: 'section'; section: 'series' | 'anime' | 'musicvideos' | 'books' | 'livetv' }
  | { page: 'show'; id: string }
  | { page: 'settings' }
  | { page: 'stats' }
  | { page: 'admin' }
  | { page: 'music'; tab: MusicTab }
  | { page: 'album'; id: string }
  | { page: 'artist'; id: string }
  | { page: 'playlist'; id: string }
  | { page: 'search'; q: string }
  | { page: 'movie'; id: string }
  | { page: 'book'; id: string }
  | { page: 'read'; id: string }
  | { page: 'live'; id: string }
  | { page: 'person'; id: string; name: string }
  | ({ page: 'play'; id: string; startOver: boolean; startAt?: number } & PlayQueueRef)

export function formatRoute(route: Route): string {
  switch (route.page) {
    case 'home':
      return '#/'
    case 'browse':
      return '#/movies'
    case 'collections':
      return '#/collections'
    case 'collection':
      return `#/collection/${encodeURIComponent(route.id)}`
    case 'lists':
      return '#/lists'
    case 'list':
      return `#/list/${encodeURIComponent(route.id)}`
    case 'folder':
      return `#/folder/${encodeURIComponent(route.id)}`
    case 'section':
      return `#/${route.section}`
    case 'show':
      return `#/show/${encodeURIComponent(route.id)}`
    case 'settings':
      return '#/settings'
    case 'stats':
      return '#/stats'
    case 'admin':
      return '#/admin'
    case 'music':
      return route.tab === 'home' ? '#/music' : `#/music/${route.tab}`
    case 'album':
    case 'artist':
    case 'playlist':
      return `#/${route.page}/${encodeURIComponent(route.id)}`
    case 'search':
      return `#/search/${encodeURIComponent(route.q)}`
    case 'movie':
      return `#/movie/${encodeURIComponent(route.id)}`
    case 'book':
    case 'read':
    case 'live':
      return `#/${route.page}/${encodeURIComponent(route.id)}`
    case 'person':
      return `#/person/${encodeURIComponent(route.id)}?name=${encodeURIComponent(route.name)}`
    case 'play':
    {
      const params = new URLSearchParams()
      if (route.startAt) params.set('start', String(Math.round(route.startAt)))
      else if (route.startOver) params.set('start', '0')
      if (route.listId) params.set('list', route.listId)
      if (route.collectionId) params.set('collection', route.collectionId)
      if (route.folderId) params.set('folder', route.folderId)
      if (route.libraryId) params.set('library', route.libraryId)
      if (route.shuffle) params.set('shuffle', route.shuffle)
      const query = params.toString()
      return `#/play/${encodeURIComponent(route.id)}${query ? `?${query}` : ''}`
    }
  }
}

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [kind, ...rest] = path.split('/')
  const value = rest.join('/')
  try {
    const decoded = decodeURIComponent(value)
    if (kind === 'search' && decoded.trim()) return { page: 'search', q: decoded }
    if (kind === 'movie' && decoded) return { page: 'movie', id: decoded }
    if ((kind === 'book' || kind === 'read' || kind === 'live') && decoded) return { page: kind, id: decoded }
    if (kind === 'movies' && !decoded) return { page: 'browse' }
    if (kind === 'collections' && !decoded) return { page: 'collections' }
    if (kind === 'collection' && decoded) return { page: 'collection', id: decoded }
    if (kind === 'lists' && !decoded) return { page: 'lists' }
    if (kind === 'list' && decoded) return { page: 'list', id: decoded }
    if (kind === 'folder' && decoded) return { page: 'folder', id: decoded }
    if (kind === 'settings' && !decoded) return { page: 'settings' }
    if (kind === 'stats' && !decoded) return { page: 'stats' }
    if (kind === 'admin' && !decoded) return { page: 'admin' }
    if (kind === 'music') {
      const tab = MUSIC_TABS.find((t) => t === decoded)
      return { page: 'music', tab: tab ?? 'home' }
    }
    if ((kind === 'album' || kind === 'artist' || kind === 'playlist') && decoded) return { page: kind, id: decoded }
    if (kind === 'show' && decoded) return { page: 'show', id: decoded }
    if ((kind === 'series' || kind === 'anime' || kind === 'musicvideos' || kind === 'books' || kind === 'livetv') && !decoded) return { page: 'section', section: kind }
    if (kind === 'person' && decoded) {
      return { page: 'person', id: decoded, name: new URLSearchParams(query).get('name') ?? '' }
    }
    if (kind === 'play' && decoded) {
      const params = new URLSearchParams(query)
      const start = params.get('start')
      const listId = params.get('list')
      const collectionId = params.get('collection')
      const folderId = params.get('folder')
      const libraryId = params.get('library')
      const shuffle = params.get('shuffle')
      const seconds = start === null ? NaN : Number(start)
      return {
        page: 'play',
        id: decoded,
        startOver: start === '0',
        ...(Number.isFinite(seconds) && seconds > 0 ? { startAt: seconds } : {}),
        ...(listId ? { listId } : {}),
        ...(collectionId ? { collectionId } : {}),
        ...(folderId ? { folderId } : {}),
        ...(libraryId ? { libraryId } : {}),
        ...(shuffle ? { shuffle } : {}),
      }
    }
  } catch {
    // Malformed percent-encoding: fall through to the home page.
  }
  return { page: 'home' }
}

export interface Navigate {
  (route: Route, options?: { replace?: boolean }): void
}

/** How many in-app pages are behind the current one (0 on a fresh load or deep link). */
function depth(): number {
  const state = history.state as { depth?: number } | null
  return state?.depth ?? 0
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash))

  useEffect(() => {
    // We restore scroll positions ourselves (per page); the browser's own restoration fights with that.
    history.scrollRestoration = 'manual'
    const sync = () => setRoute(parseRoute(location.hash))
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
  }, [])

  const navigate = useCallback<Navigate>((next, options) => {
    const hash = formatRoute(next)
    if (options?.replace) history.replaceState({ depth: depth() }, '', hash)
    else history.pushState({ depth: depth() + 1 }, '', hash)
    setRoute(next)
  }, [])

  /** Go back one page if the app has one to go back to, otherwise go to `fallback`. */
  const back = useCallback(
    (fallback: Route) => {
      if (depth() > 0) history.back()
      else navigate(fallback, { replace: true })
    },
    [navigate],
  )

  return { route, navigate, back }
}
