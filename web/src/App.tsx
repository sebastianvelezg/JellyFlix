import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CatalogPage } from './components/CatalogPage'
import { FolderPage } from './components/MusicVideoFolders'
import { MusicVideosPage } from './components/MusicVideosPage'
import { ConnectForm } from './components/ConnectForm'
import { DetailsPage } from './components/DetailsPage'
import { CardActionsProvider, PlayVideoProvider, type PlayVideo } from './components/cardActions'
import { recallPlayList, rememberPlayList } from './components/playQueues'
import { leaveFullscreen, pageInFullscreen } from './components/player/fullscreen'
import { AddToPlaylistDialog } from './components/AddToPlaylistDialog'
import { AdminTools } from './components/admin/AdminTools'
import { clearActivity } from './platform/web/adminActivity'
import { useAppearance } from './platform/web/appearance'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { Toaster } from './components/toast'
import { HomePage } from './components/HomePage'
import { BottomNav, Header, type NavTab } from './components/Header'
import { MiniPlayer } from './components/music/MiniPlayer'
import { RemoteProvider } from './components/remote/RemoteProvider'
import { MusicProvider, useMusic, useMusicState } from './components/music/MusicProvider'
import { OfflineBanner } from './components/OfflineBanner'
import { PersonPage } from './components/PersonPage'
import { formatRoute, useRoute, type MusicTab, type Navigate, type PlayQueueRef, type PlayRoute, type Route } from './components/route'
import { CloseIcon } from './components/icons'
import { DockNotice, DOCK_BUTTON } from './components/player/dock'
import { readPlayerPrefs, writePlayerPrefs } from './platform/web/prefs'
import { SearchPage } from './components/SearchPage'
import { useLanguage } from './components/useLanguage'
import { clearSwr, swrKey, swrScope, useSwr } from './components/useSwr'
import {
  arrangeMenu,
  audiobookStart,
  audiobookTrack,
  getLibrarySections,
  getCollectionItems,
  getFolderContents,
  getVideosUnder,
  getNextEpisode,
  getPlayable,
  getPlaylistEntries,
  nextInQueue,
  orderQueue,
  getSeriesPlayTarget,
  isEpisode,
  logout,
  resumeSession,
  toStoredSession,
  verifySession,
  type Collection,
  type Episode,
  type Movie,
  type Section,
  type Session,
} from './core'
import { connectFromBrowser, preconnectTo, quickConnectFromBrowser } from './platform/web/browser'
import { webSessionStore } from './platform/web/storage'
import { t, tr } from './i18n'

// The player (with its controls), the series page and settings are only needed once you open them, so they
// are loaded on demand to keep the first screen quick.
const loadPlayer = () => import('./components/player/Player')
const Player = lazy(() => loadPlayer().then((m) => ({ default: m.Player })))
const SeriesPage = lazy(() => import('./components/SeriesPage').then((m) => ({ default: m.SeriesPage })))
const SettingsPage = lazy(() => import('./components/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const CollectionsPage = lazy(() => import('./components/CollectionsPage').then((m) => ({ default: m.CollectionsPage })))
const CollectionPage = lazy(() => import('./components/CollectionsPage').then((m) => ({ default: m.CollectionPage })))
const AdminPage = lazy(() => import('./components/admin/AdminPage').then((m) => ({ default: m.AdminPage })))
const StatsPage = lazy(() => import('./components/StatsPage').then((m) => ({ default: m.StatsPage })))
const ListsPage = lazy(() => import('./components/ListsPage').then((m) => ({ default: m.ListsPage })))
const ListPage = lazy(() => import('./components/ListsPage').then((m) => ({ default: m.ListPage })))
const LiveTvPage = lazy(() => import('./components/live/LiveTvPage').then((m) => ({ default: m.LiveTvPage })))
const LivePlayer = lazy(() => import('./components/live/LivePlayer').then((m) => ({ default: m.LivePlayer })))
const BookPage = lazy(() => import('./components/BookPage').then((m) => ({ default: m.BookPage })))
const BookReader = lazy(() => import('./components/reader/BookReader').then((m) => ({ default: m.BookReader })))
const MusicPage = lazy(() => import('./components/music/MusicPage').then((m) => ({ default: m.MusicPage })))
const AlbumPage = lazy(() => import('./components/music/MusicDetails').then((m) => ({ default: m.AlbumPage })))
const ArtistPage = lazy(() => import('./components/music/MusicDetails').then((m) => ({ default: m.ArtistPage })))
const PlaylistPage = lazy(() => import('./components/music/MusicDetails').then((m) => ({ default: m.PlaylistPage })))

function PageLoading() {
  return (
    <p role="status" className="py-24 text-center text-neutral-400">
      {t('Loading…')}
    </p>
  )
}

const EXPIRED = tr('Your session expired or was signed out elsewhere. Please sign in again.')

/**
 * Top-level state: restoring a saved session, signed out (connection form) or signed in
 * (header + browse / title pages, with the player layered on top). The section home pages stay
 * mounted while a title page or the player is open, so their scroll position, filters and loaded
 * pages survive "Back".
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const { route, navigate, back } = useRoute()
  // Changing the language starts the screens afresh (the session, the music and what was read are kept).
  const language = useLanguage()
  const [overrides, setOverrides] = useState<Record<string, Movie>>({})
  const [playbackVersion, setPlaybackVersion] = useState(0)

  const expire = useCallback(() => {
    void webSessionStore.clear()
    clearSwr()
    clearActivity()
    setSession(null)
    setNotice(t(EXPIRED))
    setOverrides({})
  }, [])

  // Open the connection to the server while the page is still starting.
  const serverUrl = session?.serverUrl
  useEffect(() => {
    if (serverUrl) preconnectTo(serverUrl)
  }, [serverUrl])

  // Resume a saved session: sessionStorage survives reloads; localStorage is "keep me signed in". The app is drawn at
  // once from what is stored; whether the server still accepts the token is checked right behind it (and any
  // request it refuses with 401 ends the session as well).
  useEffect(() => {
    let cancelled = false
    resumeSession(webSessionStore, { onUnauthorized: expire })
      .then((resumed) => {
        if (cancelled) return
        if (resumed) webSessionStore.persistent = localStorage.getItem('jellyflix.session') !== null
        setSession(resumed)
        if (resumed) {
          void verifySession(resumed).then((result) => {
            if (!cancelled && result === 'rejected') expire()
          })
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setNotice(e instanceof Error ? t('Could not resume your session: {message}', { message: t(e.message) }) : null)
      })
      .finally(() => {
        if (!cancelled) setRestoring(false)
      })
    return () => {
      cancelled = true
    }
  }, [expire])

  // When the player closes, re-read what was played (resume position, watched) and refresh "Continue watching".
  const lastPlayed = useRef<string | null>(null)
  useEffect(() => {
    const finished = lastPlayed.current
    lastPlayed.current = route.page === 'play' ? route.id : null
    if (finished && route.page !== 'play' && session) {
      getPlayable(session, finished)
        .then((fresh) => setOverrides((prev) => ({ ...prev, [fresh.id]: fresh })))
        .catch(() => undefined)
        .finally(() => setPlaybackVersion((v) => v + 1))
    }
  }, [route, session])

  // When the book reader closes, "Continue reading" is read again (what it shows comes from the places the reader saved).
  const [reading, setReading] = useState(false)
  if ((route.page === 'read') !== reading) {
    setReading(route.page === 'read')
    if (reading) setPlaybackVersion((v) => v + 1)
  }

  // The home pages are hidden (not unmounted) while a title page or the player is open, which
  // collapses the document and loses the scroll position. Remember it on the way out, put it back on
  // the way in, and start title pages at the top.
  const routeKey = formatRoute(route)
  const savedScroll = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    // Arriving somewhere: back to where you were if you have been here, otherwise the top.
    window.scrollTo(0, savedScroll.current.get(routeKey) ?? 0)
  }, [routeKey])
  /** Navigate, remembering the scroll position of the page being left. */
  const go: Navigate = (next, options) => {
    savedScroll.current.set(routeKey, window.scrollY)
    navigate(next, options)
  }

  const signOut = useCallback(async () => {
    const current = session
    setSession(null)
    setNotice(null)
    setOverrides({})
    clearSwr()
    clearActivity()
    navigate({ page: 'home' }, { replace: true })
    await webSessionStore.clear()
    if (current) await logout(current)
  }, [session, navigate])

  if (restoring) {
    return (
      <p role="status" className="py-24 text-center text-neutral-400">
        {t('Loading…')}
      </p>
    )
  }

  if (!session) {
    return (
      <ConnectForm
        key={language}
        notice={notice}
        onConnect={(url, user, password) => connectFromBrowser(url, user, password, expire)}
        quickConnect={{
          start: quickConnectFromBrowser.start,
          approved: quickConnectFromBrowser.approved,
          complete: (request) => quickConnectFromBrowser.complete(request, expire),
        }}
        onConnected={(next, keep) => {
          webSessionStore.persistent = keep
          void webSessionStore.save(toStoredSession(next))
          setNotice(null)
          setSession(next)
        }}
      />
    )
  }

  return (
    <MusicProvider session={session}>
      <RemoteProvider session={session} go={go}>
      <Shell
        key={language}
        session={session}
        route={route}
        go={go}
        back={back}
        overrides={overrides}
        setOverrides={setOverrides}
        playbackVersion={playbackVersion}
        onSignOut={() => void signOut()}
      />
      </RemoteProvider>
    </MusicProvider>
  )
}

const SECTIONS: Section[] = ['movies', 'series', 'anime', 'musicvideos', 'books', 'livetv', 'music']

const MUSIC_ROUTES = new Set(['music', 'album', 'artist', 'playlist'])

/** Page titles for the pages that do not set their own. */
const SIMPLE_TITLES: Partial<Record<Route['page'], string>> = {
  home: tr('Home'),
  browse: tr('Movies'),
  collections: tr('Collections'),
  settings: tr('Settings'),
}
const SECTION_TITLES = { series: tr('Series'), anime: tr('Anime'), musicvideos: tr('Music videos'), books: tr('Books'), livetv: tr('Live TV') } as const

/** Changes when the page changes, but not when only what is typed in the search box does. */
function routeKeyForFocus(route: Route): string {
  return route.page === 'search' ? 'search' : formatRoute(route)
}

/** The signed-in app: header, the page for the current route, and the player on top. */
function Shell({
  session,
  route,
  go,
  back,
  overrides,
  setOverrides,
  playbackVersion,
  onSignOut,
}: {
  session: Session
  route: Route
  go: Navigate
  back: (fallback: Route) => void
  overrides: Record<string, Movie>
  setOverrides: (update: (prev: Record<string, Movie>) => Record<string, Movie>) => void
  playbackVersion: number
  onSignOut: () => void
}) {
  const loadSections = useCallback(() => getLibrarySections(session), [session])
  // The list of libraries is remembered, so the page can start loading its rows without waiting for it.
  const { state: sections, retry: retrySections } = useSwr(swrKey(swrScope(session), 'sections'), loadSections, { fresh: 60_000 })
  const available = sections.status === 'ready' ? SECTIONS.filter((x) => sections.data[x].length > 0) : []
  // The main page is only worth having when there is more than one section to mix.
  const hasHome = available.length >= 2
  const { menu } = useAppearance()
  const tabs: NavTab[] = arrangeMenu(hasHome ? ['home', ...available] : available, menu)
  const current: NavTab | null =
    route.page === 'home'
      ? 'home'
      : route.page === 'browse' || route.page === 'collections' || route.page === 'collection'
        ? 'movies'
        : route.page === 'section'
          ? route.section
          : MUSIC_ROUTES.has(route.page)
            ? 'music'
            : route.page === 'book' || route.page === 'read'
              ? 'books'
              : route.page === 'live'
                ? 'livetv'
                : route.page === 'folder'
                  ? 'musicvideos'
                  : null

  // With two or more tabs the phone layout needs a second header row for them.
  const hasTabs = tabs.length >= 2
  useEffect(() => {
    document.documentElement.toggleAttribute('data-tabs', hasTabs)
    return () => document.documentElement.removeAttribute('data-tabs')
  }, [hasTabs])

  // An account with a single kind of library has no main page: it starts on that library. The same goes for the
  // movies page of an account without movies.
  const firstSection = available[0]
  const sectionRoute = (section: Section): Route =>
    section === 'movies' ? { page: 'browse' } : section === 'music' ? { page: 'music', tab: 'home' } : { page: 'section', section }
  const homeRoute: Route = hasHome || !firstSection ? { page: 'home' } : sectionRoute(firstSection)
  const noMovies = sections.status === 'ready' && sections.data.movies.length === 0
  const onBrowse = route.page === 'browse'
  const onHome = route.page === 'home'
  const ready = sections.status === 'ready'
  useEffect(() => {
    if (!firstSection) return
    if ((onBrowse && noMovies && firstSection !== 'movies') || (onHome && ready && !hasHome)) {
      go(sectionRoute(firstSection), { replace: true })
    }
    // Only the route and which libraries exist decide this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBrowse, onHome, ready, hasHome, noMovies, firstSection])

  // The main page is created on first visit and then kept (hidden), like the section pages.
  const [homeSeen, setHomeSeen] = useState(false)
  if (onHome && hasHome && !homeSeen) setHomeSeen(true)

  // The player is a separate download; fetch it while the browser is idle so the first Play starts at once.
  useEffect(() => {
    const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn: () => void) => setTimeout(fn, 2000)
    const handle = idle(() => void loadPlayer())
    return () => {
      if (typeof cancelIdleCallback === 'function' && typeof handle === 'number') cancelIdleCallback(handle)
    }
  }, [])

  // The movies, series and anime pages are created on first visit and then kept (hidden), so their filters, loaded
  // pages and scroll position survive going to a title and back. (Not before: each one reads a dozen lists, and the
  // main page does not need them.)
  const [seen, setSeen] = useState<Section[]>([])
  const visiting: Section | null = route.page === 'browse' ? 'movies' : route.page === 'section' ? route.section : null
  if (visiting && !seen.includes(visiting)) setSeen([...seen, visiting])

  // Music: the music player keeps going between pages, and gives way to the video player.
  const music = useMusic()
  const musicState = useMusicState()
  const queued = musicState.queue !== null
  const playingVideo = route.page === 'play'
  useEffect(() => {
    if (playingVideo) music.pause()
  }, [playingVideo, music])

  // A music video left with Back goes on playing in a bar at the bottom of the page (like the music) while you look for another one.
  // The bar is the same player, not a new one: it is told to be small, so the video never stops.
  const [docked, setDocked] = useState<PlayRoute | null>(null)
  // Opening another video full screen takes the place of the one in the bar.
  if (route.page === 'play' && docked && playKey(docked) !== playKey(route)) setDocked(null)
  // A music video is docked whenever the player is left, however that happens: the Back button, Esc, or the browser's own Back (a
  // back gesture, a mouse button). Which video is a music video is only known once it has loaded; one that was closed on purpose
  // (a failed one, the bar's close button) is not kept.
  const [lastPlay, setLastPlay] = useState<PlayRoute | null>(null)
  const [loadedMusicVideo, setLoadedMusicVideo] = useState<string | null>(null)
  const [notKept, setNotKept] = useState<string | null>(null)
  const rememberLoaded = useCallback((item: Movie) => setLoadedMusicVideo(item.musicVideo ? item.id : null), [])
  if (route.page === 'play') {
    if (!lastPlay || playKey(lastPlay) !== playKey(route)) {
      setLastPlay(route)
      setNotKept(null)
    }
  } else if (lastPlay) {
    setLastPlay(null)
    if (loadedMusicVideo === lastPlay.id && notKept !== playKey(lastPlay)) setDocked(lastPlay)
  }
  const video: PlayRoute | null = route.page === 'play' ? route : docked
  const mini = route.page !== 'play'
  const barShown = mini && !!video
  // Full screen belongs to the player: it goes on from one video to the next, and ends when the player does (or becomes the bar).
  const hadVideo = useRef(false)
  useEffect(() => {
    if (hadVideo.current && !video && pageInFullscreen()) leaveFullscreen()
    hadVideo.current = !!video
  }, [video])
  useEffect(() => () => (pageInFullscreen() ? leaveFullscreen() : undefined), [])
  // A song starting while a video waits in the bar takes its place (the music's own bar comes back).
  if (barShown && musicState.status === 'playing') setDocked(null)

  // The music home is kept (hidden) once visited, like the other homes, remembering its tab; its "recently played"
  // lists are read again each time it is opened.
  const [musicSeen, setMusicSeen] = useState(false)
  const [musicTab, setMusicTab] = useState<MusicTab>('home')
  const [musicVisit, setMusicVisit] = useState(0)
  const onMusic = route.page === 'music'
  const [wasOnMusic, setWasOnMusic] = useState(false)
  if (onMusic && !musicSeen) setMusicSeen(true)
  if (route.page === 'music' && route.tab !== musicTab) setMusicTab(route.tab)
  if (onMusic !== wasOnMusic) {
    setWasOnMusic(onMusic)
    if (onMusic) setMusicVisit((v) => v + 1)
  }
  const musicLibraries = sections.status === 'ready' ? sections.data.music : []
  const openAlbum = (id: string) => go({ page: 'album', id })
  const openArtist = (id: string) => go({ page: 'artist', id })
  const openPlaylist = (id: string) => go({ page: 'playlist', id })
  const backToMusic = () => back({ page: 'music', tab: musicTab })

  // Keyboard and screen-reader users: each page gets a title (the detail pages set their own), and after moving to
  // another page focus goes to the top of the content, unless they are typing (the search box changes the page too).
  const mainRef = useRef<HTMLElement>(null)
  const pageTitleText =
    SIMPLE_TITLES[route.page] ??
    (route.page === 'section' ? SECTION_TITLES[route.section] : route.page === 'music' ? tr('Music') : undefined)
  const pageTitle = route.page === 'search' ? t('Search: {query}', { query: route.q }) : pageTitleText ? t(pageTitleText) : undefined
  const firstRoute = useRef(true)
  const focusKey = routeKeyForFocus(route)
  const playing = route.page === 'play'
  useEffect(() => {
    if (pageTitle) document.title = `${pageTitle} · Jellyflix`
  }, [pageTitle])
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false
      return
    }
    const active = document.activeElement
    const typing = active instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)
    if (!playing && !typing) mainRef.current?.focus({ preventScroll: true })
  }, [focusKey, playing])

  const openCollection = (collection: Collection) => go({ page: 'collection', id: collection.id })
  const seeCollections = () => go({ page: 'collections' })
  const openMovie = (movie: Movie) => go({ page: 'movie', id: movie.id })
  const openShow = (show: Movie) => go({ page: 'show', id: show.id })
  const openSeries = (id: string) => go({ page: 'show', id })
  const openBook = (book: Movie) => go({ page: 'book', id: book.id })
  /** An audiobook goes to the music player (from where you stopped); the rest of the books open on their page. */
  const listen = (book: Movie, startSeconds: number) => music.play([audiobookTrack(book)], 0, { startSeconds })
  const playOrOpenBook = (book: Movie) => (book.book === 'audiobook' ? listen(book, audiobookStart(book)) : openBook(book))
  const play = (item: Movie, startOver = false) => go({ page: 'play', id: item.id, startOver })
  /** Plays a video as part of a folder, a library or a shuffled queue: the next one of it follows. */
  const playQueue = (first: Movie, queue: PlayQueueRef) => go({ page: 'play', id: first.id, startOver: false, ...queue })
  /** The play button of a music video's card: what follows is the folder it is in, or the row or grid it was played from. */
  const playVideoNow: PlayVideo = (video, from) => {
    if (from?.queue) playQueue(video, from.queue)
    else if (from?.list && from.list.length > 1) playQueue(video, { queueId: rememberPlayList(from.list) })
    else play(video)
  }
  // The cards get a function that never changes (the page re-renders often, and every card would re-render with it).
  const latestPlayVideo = useRef(playVideoNow)
  useEffect(() => {
    latestPlayVideo.current = playVideoNow
  })
  const playVideo = useCallback<PlayVideo>((video, from) => latestPlayVideo.current(video, from), [])
  /** The Play button of a series: its next (or first) episode. */
  const playShow = (show: Movie) => {
    getSeriesPlayTarget(session, show.id)
      .then((episode) => (episode ? play(episode) : openShow(show)))
      .catch(() => openShow(show))
  }
  const remember = (movie: Movie) => setOverrides((prev) => ({ ...prev, [movie.id]: movie }))

  const catalog = {
    session,
    overrides,
    playbackVersion,
    onPlay: play,
    onPlayShow: playShow,
    onOpenSeries: openSeries,
    onOpenCollection: openCollection,
    onSeeCollections: seeCollections,
    sections,
    retrySections,
  }

  return (
    <CardActionsProvider value={remember}>
    <PlayVideoProvider value={playVideo}>
      <button
        type="button"
        className="btn-primary fixed left-3 top-3 z-[60] -translate-y-20 focus:translate-y-0"
        onClick={() => mainRef.current?.focus()}
      >
        {t('Skip to content')}
      </button>
      <Header
        session={session}
        query={route.page === 'search' ? route.q : ''}
        sections={tabs}
        current={current}
        onSection={(tab) =>
          go(tab === 'home' ? { page: 'home' } : tab === 'music' ? { page: 'music', tab: musicTab } : sectionRoute(tab))
        }
        onSearch={(text) =>
          text.trim()
            ? go({ page: 'search', q: text.trim() }, { replace: route.page === 'search' })
            : go(homeRoute, { replace: route.page === 'search' })
        }
        onHome={() => go(homeRoute)}
        onSettings={() => go({ page: 'settings' })}
        onSignOut={onSignOut}
      />
      <OfflineBanner />
      <main ref={mainRef} id="main" tabIndex={-1} className={`gutter-x pt-[var(--header-h)] outline-none ${queued || barShown ? 'pb-[calc(10rem+var(--nav-h))]' : 'pb-[calc(5rem+var(--nav-h))]'}`}>
        {homeSeen && hasHome && sections.status === 'ready' && (
          <div hidden={!onHome}>
            <HomePage
              session={session}
              sections={sections.data}
              overrides={overrides}
              playbackVersion={playbackVersion}
              onPlay={play}
              onPlayShow={playShow}
              onOpenMovie={openMovie}
              onOpenBook={openBook}
              onOpenShow={openShow}
              onOpenSeries={openSeries}
              onOpenAlbum={openAlbum}
              onOpenArtist={openArtist}
              onOpenCollection={openCollection}
              onSeeCollections={seeCollections}
              onOpenList={(id) => go({ page: 'list', id })}
              onSeeLists={() => go({ page: 'lists' })}
              onSection={(section) => go(section === 'music' ? { page: 'music', tab: musicTab } : sectionRoute(section))}
            />
          </div>
        )}
        {seen.includes('movies') && (
          <div hidden={route.page !== 'browse'}>
            <CatalogPage section="movies" onOpen={openMovie} {...catalog} />
          </div>
        )}
        {(['series', 'anime', 'musicvideos', 'books'] as const)
          .filter((x) => seen.includes(x))
          .map((x) => (
            <div key={x} hidden={!(route.page === 'section' && route.section === x)}>
              {x === 'musicvideos' ? (
                <MusicVideosPage
                  onOpen={openMovie}
                  onOpenFolder={(id) => go({ page: 'folder', id })}
                  onPlayQueue={playQueue}
                  {...catalog}
                />
              ) : (
                <CatalogPage
                  section={x}
                  onOpen={x === 'books' ? openBook : openShow}
                  {...catalog}
                  {...(x === 'books' ? { onPlay: playOrOpenBook } : {})}
                />
              )}
            </div>
          ))}
        {route.page === 'folder' && (
          <FolderPage
            key={route.id}
            session={session}
            id={route.id}
            overrides={overrides}
            onOpenFolder={(id) => go({ page: 'folder', id })}
            onOpenLibrary={() => go(sectionRoute('musicvideos'))}
            onOpenVideo={openMovie}
            onPlayQueue={playQueue}
            onBack={() => back(sectionRoute('musicvideos'))}
          />
        )}
        {musicSeen && musicLibraries.length > 0 && (
          <div hidden={!onMusic}>
            <Suspense fallback={<PageLoading />}>
              <MusicPage
                session={session}
                libraries={musicLibraries}
                tab={musicTab}
                visit={musicVisit}
                onTab={(tab) => go({ page: 'music', tab })}
                onOpenAlbum={openAlbum}
                onOpenArtist={openArtist}
                onOpenPlaylist={openPlaylist}
              />
            </Suspense>
          </div>
        )}
        {onMusic && sections.status === 'ready' && musicLibraries.length === 0 && (
          <p className="py-24 text-center text-neutral-400">
            {t('This account has no music libraries. Add one in Jellyfin (a library of type Music) and it will appear here.')}
          </p>
        )}
        {(route.page === 'album' || route.page === 'artist' || route.page === 'playlist') && (
          <Suspense fallback={<PageLoading />}>
            {route.page === 'album' && (
              <AlbumPage key={route.id} session={session} id={route.id} onBack={backToMusic} onOpenAlbum={openAlbum} onOpenArtist={openArtist} />
            )}
            {route.page === 'artist' && (
              <ArtistPage key={route.id} session={session} id={route.id} onBack={backToMusic} onOpenAlbum={openAlbum} onOpenArtist={openArtist} />
            )}
            {route.page === 'playlist' && (
              <PlaylistPage key={route.id} session={session} id={route.id} onBack={backToMusic} onOpenAlbum={openAlbum} onOpenArtist={openArtist} />
            )}
          </Suspense>
        )}
        {route.page === 'collections' && (
          <Suspense fallback={<PageLoading />}>
            <CollectionsPage session={session} onOpen={openCollection} onBack={() => back({ page: 'browse' })} />
          </Suspense>
        )}
        {route.page === 'collection' && (
          <Suspense fallback={<PageLoading />}>
            <CollectionPage
              key={route.id}
              session={session}
              id={route.id}
              overrides={overrides}
              onPlay={(item) => go({ page: 'play', id: item.id, startOver: false, collectionId: route.id })}
              onOpen={openMovie}
              onBack={() => back({ page: 'collections' })}
            />
          </Suspense>
        )}
        {route.page === 'admin' && (
          <Suspense fallback={<PageLoading />}>
            <AdminPage session={session} onBack={() => back({ page: 'settings' })} />
          </Suspense>
        )}
        {route.page === 'stats' && (
          <Suspense fallback={<PageLoading />}>
            <StatsPage session={session} onBack={() => back({ page: 'settings' })} />
          </Suspense>
        )}
        {route.page === 'lists' && (
          <Suspense fallback={<PageLoading />}>
            <ListsPage session={session} onOpen={(id) => go({ page: 'list', id })} onBack={() => back(homeRoute)} />
          </Suspense>
        )}
        {route.page === 'list' && (
          <Suspense fallback={<PageLoading />}>
            <ListPage
              key={route.id}
              session={session}
              id={route.id}
              overrides={overrides}
              onPlay={(item) => go({ page: 'play', id: item.id, startOver: false, listId: route.id })}
              onShuffle={(item, seed) => go({ page: 'play', id: item.id, startOver: false, listId: route.id, shuffle: seed })}
              onOpenMovie={openMovie}
              onOpenSeries={openSeries}
              onBack={() => back({ page: 'lists' })}
            />
          </Suspense>
        )}
        {route.page === 'search' && (
          <SearchPage
            key={route.q}
            term={route.q}
            session={session}
            overrides={overrides}
            hasMusic={musicLibraries.length > 0}
            hasMusicVideos={sections.status === 'ready' && sections.data.musicvideos.length > 0}
            hasBooks={sections.status === 'ready' && sections.data.books.length > 0}
            onOpenBook={openBook}
            onOpenMovie={openMovie}
            onOpenShow={openShow}
            onOpenCollection={openCollection}
            onOpenAlbum={openAlbum}
            onOpenArtist={openArtist}
            onPlay={(episode: Episode) => play(episode)}
          />
        )}
        {route.page === 'movie' && (
          <DetailsPage
            key={route.id}
            session={session}
            id={route.id}
            onPlay={play}
            onOpen={openMovie}
            onPerson={(person) => go({ page: 'person', id: person.id, name: person.name })}
            onBack={() => back(homeRoute)}
            onChanged={remember}
          />
        )}
        {route.page === 'show' && (
          <Suspense fallback={<PageLoading />}>
            <SeriesPage
              key={route.id}
              session={session}
              id={route.id}
              onPlay={(episode) => play(episode)}
              onOpen={openShow}
              onPerson={(person) => go({ page: 'person', id: person.id, name: person.name })}
              onBack={() => back(homeRoute)}
              onChanged={remember}
            />
          </Suspense>
        )}
        {(route.page === 'section' && route.section === 'livetv') || route.page === 'live' ? (
          <div hidden={route.page !== 'section'}>
            <Suspense fallback={<PageLoading />}>
              <LiveTvPage session={session} paused={route.page === 'live'} onPlay={(channel) => go({ page: 'live', id: channel.id })} />
            </Suspense>
          </div>
        ) : null}
        {route.page === 'book' && (
          <Suspense fallback={<PageLoading />}>
            <BookPage
              key={route.id}
              session={session}
              id={route.id}
              onRead={(book) => go({ page: 'read', id: book.id })}
              onListen={listen}
              onBack={() => back({ page: 'section', section: 'books' })}
              onChanged={remember}
            />
          </Suspense>
        )}
        {route.page === 'settings' && (
          <Suspense fallback={<PageLoading />}>
            <SettingsPage session={session} onBack={() => back(homeRoute)} onSignOut={onSignOut} onStats={() => go({ page: 'stats' })} onAdmin={() => go({ page: 'admin' })} />
          </Suspense>
        )}
        {route.page === 'person' && (
          <PersonPage
            key={route.id}
            session={session}
            id={route.id}
            name={route.name}
            overrides={overrides}
            onOpen={openMovie}
            onBack={() => back(homeRoute)}
          />
        )}
      </main>
      <ShortcutsDialog />
      <AddToPlaylistDialog session={session} />
      <AdminTools session={session} />
      <Toaster />
      <BottomNav
        sections={tabs}
        current={current}
        onSelect={(tab) =>
          go(tab === 'home' ? { page: 'home' } : tab === 'music' ? { page: 'music', tab: musicTab } : sectionRoute(tab))
        }
      />
      <MiniPlayer session={session} onOpenAlbum={openAlbum} onOpenArtist={openArtist} hidden={barShown} />
      {route.page === 'live' && (
        <Suspense fallback={<PlayerLoading />}>
          <LivePlayer
            key={route.id}
            session={session}
            id={route.id}
            onChannel={(id) => go({ page: 'live', id }, { replace: true })}
            onExit={() => back({ page: 'section', section: 'livetv' })}
          />
        </Suspense>
      )}
      {route.page === 'read' && (
        <Suspense fallback={<PlayerLoading />}>
          <BookReader key={route.id} session={session} id={route.id} onExit={() => back({ page: 'book', id: route.id })} />
        </Suspense>
      )}
      {video && (
        <Suspense fallback={mini ? null : <PlayerLoading />}>
          <PlayerRoute
            // The same key full screen and in the bar: going from one to the other keeps the same player (and its <video>).
            key={playKey(video)}
            session={session}
            id={video.id}
            startOver={video.startOver}
            startAt={video.startAt}
            queue={queueOf(video)}
            mini={mini}
            // A music video that follows another one plays from its start (not from where it was left: a list of videos flows).
            // In the bar the next one takes its place there, without taking the page along.
            onNextEpisode={(following) => {
              const nextRoute: PlayRoute = { page: 'play', id: following.id, startOver: !!following.musicVideo, ...queueOf(video) }
              if (mini) setDocked(nextRoute)
              else go(nextRoute, { replace: true })
            }}
            // (A music video keeps playing in the bar when the player is left: see `docked`.)
            onExit={(item) => back(item && isEpisode(item) ? { page: 'show', id: item.seriesId } : { page: 'movie', id: video.id })}
            onLoaded={rememberLoaded}
            onClose={() => {
              setDocked(null)
              setNotKept(playKey(video))
            }}
            onExpand={() => go(video)}
            onPlaying={() => music.pause()}
          />
        </Suspense>
      )}
    </PlayVideoProvider>
    </CardActionsProvider>
  )
}

function PlayerLoading() {
  return (
    <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)] text-neutral-300">
      {t('Preparing playback…')}
    </div>
  )
}

/** The queue a /play route belongs to, as the route's own words. */
const queueOf = (route: PlayRoute): PlayQueueRef => ({
  listId: route.listId,
  collectionId: route.collectionId,
  folderId: route.folderId,
  libraryId: route.libraryId,
  queueId: route.queueId,
  shuffle: route.shuffle,
})

/** Two play routes with the same key are the same viewing: the player is kept between them, not started again. */
const playKey = (route: PlayRoute): string => `${route.id}:${route.startOver}:${route.startAt ?? ''}:${JSON.stringify(queueOf(route))}`

/** Looks up what a /play route points at (it may be a deep link or a refresh) and renders the player. */
function PlayerRoute({
  session,
  id,
  startOver,
  startAt,
  queue,
  mini,
  onNextEpisode,
  onExit,
  onClose,
  onExpand,
  onPlaying,
  onLoaded,
}: {
  session: Session
  id: string
  startOver: boolean
  /** What this is played as part of (a playlist, a collection, a folder...): what follows is the next title of it. */
  queue: PlayQueueRef
  /** Seconds to begin at, when another device handed its playback over. */
  startAt?: number
  /** Drawn as a bar at the bottom of the page (a music video that was left with Back), not over the whole screen. */
  mini: boolean
  onNextEpisode: (next: Movie) => void
  /** Leave the player; `item` is what was playing (null if it could not be loaded). */
  onExit: (item: Movie | null) => void
  /** Stop for good and take the bar away. */
  onClose: () => void
  /** Bring the bar back as the full-screen player. */
  onExpand: () => void
  onPlaying: () => void
  /** The title is known (so the app knows whether it is a music video). */
  onLoaded: (item: Movie) => void
}) {
  const [item, setItem] = useState<Movie | null>(null)
  useEffect(() => {
    if (item) onLoaded(item)
  }, [item, onLoaded])
  // The titles that follow each other (in play order) when this is part of a queue, and the next episode when it is just an episode.
  const [titles, setTitles] = useState<Movie[] | null>(null)
  const [episodeNext, setEpisodeNext] = useState<Movie | null>(null)
  // After the last title of a queue the first one plays again. Chosen in the player and remembered.
  const [loop, setLoop] = useState(() => readPlayerPrefs().repeatQueue)
  const [failed, setFailed] = useState(false)
  const { listId, collectionId, folderId, libraryId, queueId, shuffle } = queue

  useEffect(() => {
    let cancelled = false
    const readQueue = (read: Promise<Movie[]>) =>
      read
        .then((all) => {
          if (!cancelled) setTitles(orderQueue(all, shuffle))
        })
        .catch(() => undefined)
    getPlayable(session, id)
      .then((found) => {
        if (cancelled) return
        setItem(found)
        // What follows is only needed at the end, so it is looked up in the background.
        // (A row or grid it was played from is already known; after a reload it is not, and the folder's other videos follow instead.)
        const fromRow = queueId ? recallPlayList(queueId) : undefined
        if (fromRow) setTitles(orderQueue(fromRow, shuffle))
        else if (listId) void readQueue(getPlaylistEntries(session, listId).then((entries) => entries.map((e) => e.item)))
        else if (collectionId) void readQueue(getCollectionItems(session, collectionId))
        else if (folderId || libraryId) void readQueue(getVideosUnder(session, (folderId ?? libraryId) as string))
        // A music video played on its own goes on with the others of its folder.
        else if (found.musicVideo && found.parentId) void readQueue(getFolderContents(session, found.parentId).then((c) => c.videos))
        else if (isEpisode(found)) {
          getNextEpisode(session, found)
            .then((following) => {
              if (!cancelled) setEpisodeNext(following)
            })
            .catch(() => undefined)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [session, id, listId, collectionId, folderId, libraryId, queueId, shuffle])

  const next = titles ? nextInQueue(titles, id, loop) : episodeNext

  // The bar at the bottom of the page does not cover the page while it waits for the video or when it could not be loaded.
  if (mini && (failed || !item)) {
    return (
      <DockNotice title={failed ? t('That title could not be loaded.') : t('Preparing playback…')} text="">
        <button type="button" aria-label={t('Close the video player')} title={t('Close')} onClick={onClose} className={DOCK_BUTTON}>
          <CloseIcon />
        </button>
      </DockNotice>
    )
  }
  if (failed) {
    return (
      <div
        role="alert"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[var(--color-bg)] p-6 text-center"
      >
        <p className="text-neutral-100">{t('That title could not be loaded.')}</p>
        <button type="button" className="btn" onClick={() => onExit(null)}>
          {t('Back')}
        </button>
      </div>
    )
  }
  if (!item) {
    return (
      <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-black text-neutral-300">
        {t('Preparing playback…')}
      </div>
    )
  }
  return (
    <Player
      session={session}
      movie={item}
      startOver={startOver}
      startAt={startAt}
      next={next}
      onNext={() => next && onNextEpisode(next)}
      onPickEpisode={onNextEpisode}
      repeat={titles ? { enabled: loop, onChange: (on) => { setLoop(on); writePlayerPrefs({ repeatQueue: on }) } } : undefined}
      onExit={() => onExit(item)}
      mini={mini}
      onClose={onClose}
      onExpand={onExpand}
      onPlaying={onPlaying}
    />
  )
}
