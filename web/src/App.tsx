import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CatalogPage } from './components/CatalogPage'
import { FolderPage } from './components/MusicVideoFolders'
import { MusicVideosPage } from './components/MusicVideosPage'
import { ConnectForm } from './components/ConnectForm'
import { DetailsPage } from './components/DetailsPage'
import { CardActionsProvider, PlayVideoProvider } from './components/cardActions'
import { AddToPlaylistDialog } from './components/AddToPlaylistDialog'
import { AdminTools } from './components/admin/AdminTools'
import { clearActivity } from './platform/web/adminActivity'
import { useAppearance } from './platform/web/appearance'
import { restoreKids, useKids } from './platform/web/kids'
import { KidsExitDialog } from './components/KidsMode'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { SetupWizard } from './components/SetupWizard'
import { showToast, Toaster } from './components/toast'
import { HomePage } from './components/HomePage'
import { BottomNav, Header, type NavTab } from './components/Header'
import { MiniPlayer } from './components/music/MiniPlayer'
import { RemoteProvider } from './components/remote/RemoteProvider'
import { ModulesProvider, useModules } from './components/modules/ModulesProvider'
import { SyncPlayProvider, useSyncPlay } from './components/syncplay/SyncPlayProvider'
import { TogetherButton } from './components/syncplay/TogetherDialog'
import { MusicProvider, useMusic, useMusicState } from './components/music/MusicProvider'
import { OfflineBanner } from './components/OfflineBanner'
import { PersonPage } from './components/PersonPage'
import { formatRoute, useRoute, type Navigate, type PlayRoute, type Route } from './components/route'
import { writeUiPrefs } from './platform/web/prefs'
import { clearRecentSearches } from './platform/web/recentSearches'
import { setStorageOwner } from './platform/web/owner'
import { startSyncWatcher } from './platform/web/sync'
import { SearchPage } from './components/SearchPage'
import { useLanguage } from './components/useLanguage'
import { clearSwr, swrKey, swrScope, useSwr } from './components/useSwr'
import {
  arrangeMenu,
  getLibrarySections,
  getPlayable,
  isEpisode,
  logout,
  resumeSession,
  toStoredSession,
  verifySession,
  type Episode,
  type Movie,
  type Section,
  type Session,
} from './core'
import { connectFromBrowser, preconnectTo, quickConnectFromBrowser } from './platform/web/browser'
import { webSessionStore } from './platform/web/storage'
import { t, tr } from './i18n'

import { loadPlayer, PlayerLoading, PlayerRoute, playKey, queueOf } from './components/PlayerRoute'
import { useDockedVideo } from './components/shell/useDockedVideo'
import { leaveFullscreen, pageInFullscreen } from './components/player/fullscreen'
import { useMusicTab } from './components/shell/useMusicTab'
import { usePageFocus } from './components/shell/usePageFocus'
import { sectionRoute, useSectionRedirects } from './components/shell/useSectionRedirects'
import { useTitleActions } from './components/shell/useTitleActions'

// The series page, settings, the lists, the admin and the other pages are only needed once you open them, so they
// are loaded on demand to keep the first screen quick.
const SeriesPage = lazy(() => import('./components/SeriesPage').then((m) => ({ default: m.SeriesPage })))
const SettingsPage = lazy(() => import('./components/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const CollectionsPage = lazy(() => import('./components/CollectionsPage').then((m) => ({ default: m.CollectionsPage })))
const CollectionPage = lazy(() => import('./components/CollectionsPage').then((m) => ({ default: m.CollectionPage })))
const AdminPage = lazy(() => import('./components/admin/AdminPage').then((m) => ({ default: m.AdminPage })))
const LinkPage = lazy(() => import('./components/LinkPage').then((m) => ({ default: m.LinkPage })))
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
// The extra modules are only downloaded by people who have a modules container (see ModulesProvider).
const ModulesPage = lazy(() => import('./components/modules/ModulesPage').then((m) => ({ default: m.ModulesPage })))
const ChannelPlayer = lazy(() => import('./components/modules/channels/ChannelPlayer').then((m) => ({ default: m.ChannelPlayer })))

function PageLoading() {
  return (
    <p role="status" className="py-24 text-center text-neutral-400">
      {t('Loading…')}
    </p>
  )
}

const EXPIRED = tr('Your session expired or was signed out elsewhere. Please sign in again.')

/** What this browser remembers about the person who used it (the searches, the last channel), so the next account does not see it. */
function forgetTraces(): void {
  clearRecentSearches()
  writeUiPrefs({ lastChannel: null })
}

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
    forgetTraces()
    setStorageOwner(null)
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
        setStorageOwner(resumed?.userId ?? null)
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
    forgetTraces()
    setStorageOwner(null)
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
          setStorageOwner(next.userId)
          setSession(next)
        }}
      />
    )
  }

  return (
    <MusicProvider session={session}>
      <RemoteProvider session={session} go={go}>
      <SyncPlayProvider session={session} go={go}>
      <ModulesProvider token={session.accessToken}>
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
      </ModulesProvider>
      </SyncPlayProvider>
      </RemoteProvider>
    </MusicProvider>
  )
}

/** Leaves the page it is drawn on for another one (for a link that leads nowhere on this device). */
function GoTo({ go, to }: { go: Navigate; to: Route }) {
  useEffect(() => {
    go(to, { replace: true })
  }, [go, to])
  return null
}

const SECTIONS: Section[] = ['movies', 'series', 'anime', 'musicvideos', 'books', 'livetv', 'music']

const MUSIC_ROUTES = new Set(['music', 'album', 'artist', 'playlist'])

/** The signed-in app: header, the page for the current route, and the player on top. */
function Shell({
  session,
  route,
  go: goNow,
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
  // In a group of people watching together, playing a title is asking the group to (every player opens it, together).
  const together = useSyncPlay()
  const interceptPlay = together?.interceptPlay
  const go = useCallback<Navigate>((to, options) => (interceptPlay?.(to) ? undefined : goNow(to, options)), [goNow, interceptPlay])
  // The optional sync of preferences with the account's other devices (nothing runs unless it was turned on in Settings).
  useEffect(
    () =>
      startSyncWatcher(session, (report) => {
        if (report.conflicts.length > 0) showToast({ message: t('A newer copy of your settings from another device replaced your latest change.') })
        else if (report.applied.length > 0) showToast({ message: t('Your settings were updated from another device.') })
      }),
    [session],
  )
  const loadSections = useCallback(() => getLibrarySections(session), [session])
  // The list of libraries is remembered, so the page can start loading its rows without waiting for it.
  const { state: sections, retry: retrySections } = useSwr(swrKey(swrScope(session), 'sections'), loadSections, { fresh: 60_000 })
  // Kids mode: no Live TV (a channel has no age rating), and the settings pages are shut (see below).
  const kids = useKids()
  const [leavingKids, setLeavingKids] = useState(false)
  useEffect(() => {
    restoreKids(session)
  }, [session])
  const available = sections.status === 'ready' ? SECTIONS.filter((x) => sections.data[x].length > 0 && !(kids.enabled && x === 'livetv')) : []
  // The main page is only worth having when there is more than one section to mix.
  const hasHome = available.length >= 2
  const { menu } = useAppearance()
  // The modules button exists only when a modules container answered; it goes last and is not part of the arrangeable menu (yet).
  const modules = useModules().state
  const tabs: NavTab[] = [...arrangeMenu(hasHome ? ['home', ...available] : available, menu), ...(modules.status === 'ready' ? (['modules'] as const) : [])]
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
                  : route.page === 'modules' || route.page === 'channel'
                    ? 'modules'
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
  const homeRoute: Route = hasHome || !firstSection ? { page: 'home' } : sectionRoute(firstSection)
  const ready = sections.status === 'ready'
  const onHome = route.page === 'home'
  useSectionRedirects({
    route,
    go,
    homeRoute,
    firstSection,
    hasHome,
    librariesKnown: ready,
    noMovies: ready && sections.data.movies.length === 0,
    kids: kids.enabled,
  })


  // Leaving a retro TV channel (the arrow, Escape, the guide's "All channels", the browser's Back) also leaves full screen, as leaving a
  // movie does. Changing channel stays in it.
  const wasChannel = useRef(false)
  useEffect(() => {
    if (wasChannel.current && route.page !== 'channel' && pageInFullscreen()) leaveFullscreen()
    wasChannel.current = route.page === 'channel'
  }, [route.page])

  // A link to a channel on a device that has no modules container (or when it stopped answering) leads to the main page.
  const channelGone = route.page === 'channel' && modules.status === 'absent'

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

  // A music video left with Back goes on playing in a bar at the bottom of the page (see the hook).
  const { video, mini, barShown, rememberLoaded, dock, closeDock } = useDockedVideo(route, musicState.status === 'playing')

  // The music home is kept (hidden) once visited, like the other homes, remembering its tab.
  const { musicSeen, musicTab, musicVisit, onMusic } = useMusicTab(route)
  const musicLibraries = sections.status === 'ready' ? sections.data.music : []
  const backToMusic = () => back({ page: 'music', tab: musicTab })

  const mainRef = usePageFocus(route)

  const {
    openAlbum,
    openArtist,
    openPlaylist,
    openCollection,
    seeCollections,
    openMovie,
    openShow,
    openSeries,
    openBook,
    listen,
    playOrOpenBook,
    play,
    playQueue,
    playVideo,
    playShow,
    remember,
  } = useTitleActions({ session, go, music, setOverrides })

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
          go(tab === 'home' ? { page: 'home' } : tab === 'modules' ? { page: 'modules' } : tab === 'music' ? { page: 'music', tab: musicTab } : sectionRoute(tab))
        }
        onSearch={(text) =>
          text.trim()
            ? go({ page: 'search', q: text.trim() }, { replace: route.page === 'search' })
            : go(homeRoute, { replace: route.page === 'search' })
        }
        onHome={() => go(homeRoute)}
        onSettings={() => (kids.enabled ? setLeavingKids(true) : go({ page: 'settings' }))}
        together={kids.enabled ? undefined : <TogetherButton userName={session.userName} />}
        onSignOut={onSignOut}
        kids={kids.enabled}
      />
      <KidsExitDialog open={leavingKids} onClose={() => setLeavingKids(false)} />
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
        {route.page === 'link' && (
          <Suspense fallback={<PageLoading />}>
            <LinkPage session={session} code={route.code} onDone={() => go(homeRoute, { replace: true })} />
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
        {route.page === 'modules' && (
          <Suspense fallback={<PageLoading />}>
            <ModulesPage session={session} module={route.module} join={route.join} go={go} back={back} homeRoute={homeRoute} />
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
      <SetupWizard suppressed={kids.enabled} />
      <AddToPlaylistDialog session={session} />
      <AdminTools session={session} />
      <Toaster />
      <BottomNav
        sections={tabs}
        current={current}
        onSelect={(tab) =>
          go(tab === 'home' ? { page: 'home' } : tab === 'modules' ? { page: 'modules' } : tab === 'music' ? { page: 'music', tab: musicTab } : sectionRoute(tab))
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
      {channelGone && <GoTo go={go} to={homeRoute} />}
      {route.page === 'channel' && modules.status === 'checking' && <PlayerLoading />}
      {route.page === 'channel' && modules.status === 'ready' && (
        <Suspense fallback={<PlayerLoading />}>
          <ChannelPlayer
            key={route.id}
            session={session}
            channelId={route.id}
            onChannel={(id) => go({ page: 'channel', id }, { replace: true })}
            onExit={() => back({ page: 'modules', module: 'channels' })}
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
              if (mini) dock(nextRoute)
              else go(nextRoute, { replace: true })
            }}
            // (A music video keeps playing in the bar when the player is left: see `docked`.)
            onExit={(item) => back(item && isEpisode(item) ? { page: 'show', id: item.seriesId } : { page: 'movie', id: video.id })}
            onLoaded={rememberLoaded}
            onClose={() => closeDock(video)}
            onExpand={() => go(video)}
            onPlaying={() => music.pause()}
          />
        </Suspense>
      )}
    </PlayVideoProvider>
    </CardActionsProvider>
  )
}
