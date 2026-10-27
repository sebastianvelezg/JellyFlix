package app.jellyflix.tv

import android.app.Application
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.jellyflix.tv.data.Album
import app.jellyflix.tv.data.AlbumSort
import app.jellyflix.tv.data.Artist
import app.jellyflix.tv.data.CastMember
import app.jellyflix.tv.data.FilterOptions
import app.jellyflix.tv.data.FreshSeries
import app.jellyflix.tv.data.LibraryFilters
import app.jellyflix.tv.data.MIN_RESUME_MS
import app.jellyflix.tv.data.Appearance
import app.jellyflix.tv.data.HomeLayout
import app.jellyflix.tv.data.PlayHistory
import app.jellyflix.tv.data.PlaylistEntry
import app.jellyflix.tv.data.RemoteSubtitle
import app.jellyflix.tv.data.SUBTITLE_SEARCH_LANGUAGES
import app.jellyflix.tv.data.defaultSearchLanguage
import app.jellyflix.tv.data.newSubtitleIndex
import app.jellyflix.tv.data.playThroughFrom
import app.jellyflix.tv.data.PosterSize
import app.jellyflix.tv.data.ThemeChoice
import app.jellyflix.tv.data.resolveTheme
import app.jellyflix.tv.ui.Palette
import app.jellyflix.tv.ui.Posters
import app.jellyflix.tv.data.TrickplayPictures
import app.jellyflix.tv.data.UpcomingEpisode
import app.jellyflix.tv.data.WatchedStats
import app.jellyflix.tv.data.VideoPlaylist
import app.jellyflix.tv.data.WatchLaterResult
import app.jellyflix.tv.data.WatchedFilter
import app.jellyflix.tv.data.isWatchLater
import app.jellyflix.tv.data.moved
import app.jellyflix.tv.data.newPlaylistName
import app.jellyflix.tv.data.HomeCache
import app.jellyflix.tv.data.HomeSnapshot
import app.jellyflix.tv.data.JellyfinRepository
import app.jellyflix.tv.data.Lib
import app.jellyflix.tv.data.Libraries
import app.jellyflix.tv.data.MenuItem
import app.jellyflix.tv.data.MenuLayout
import app.jellyflix.tv.data.NavStyle
import app.jellyflix.tv.data.TvChannel
import app.jellyflix.tv.data.TvProgram
import app.jellyflix.tv.data.neighbourChannel
import app.jellyflix.tv.data.nextProgram
import app.jellyflix.tv.data.Lyrics
import app.jellyflix.tv.data.MediaItem
import app.jellyflix.tv.data.PlaybackPlan
import app.jellyflix.tv.data.Chapter
import app.jellyflix.tv.data.DirectOnlyException
import app.jellyflix.tv.data.Playlist
import app.jellyflix.tv.data.PluginsReport
import app.jellyflix.tv.data.Recommendation
import app.jellyflix.tv.data.Section
import app.jellyflix.tv.data.TvSettings
import app.jellyflix.tv.data.Segment
import app.jellyflix.tv.data.Session
import app.jellyflix.tv.data.SessionStore
import app.jellyflix.tv.data.Song
import app.jellyflix.tv.data.SortOption
import app.jellyflix.tv.music.MusicPlayer
import app.jellyflix.tv.music.MusicReporter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.jellyfin.sdk.api.client.exception.ApiClientException
import org.jellyfin.sdk.api.client.exception.InvalidStatusException
import org.jellyfin.sdk.model.api.BaseItemKind
import java.io.IOException
import java.util.UUID

/** The sections of the top bar. Only those the account has are shown (see [AppViewModel.tabs]). */
enum class Tab(@StringRes val label: Int, @DrawableRes val icon: Int) {
    Home(R.string.nav_home, R.drawable.ic_nav_home),
    Movies(R.string.nav_movies, R.drawable.ic_nav_movies),
    Series(R.string.nav_series, R.drawable.ic_nav_series),
    Anime(R.string.nav_anime, R.drawable.ic_nav_anime),
    MusicVideos(R.string.nav_music_videos, R.drawable.ic_nav_music_videos),
    Books(R.string.nav_books, R.drawable.ic_nav_books),
    LiveTv(R.string.nav_live_tv, R.drawable.ic_nav_live_tv),
    Music(R.string.nav_music, R.drawable.ic_nav_music),
    Collections(R.string.nav_collections, R.drawable.ic_nav_collections),
    Search(R.string.nav_search, R.drawable.ic_nav_search),
    Settings(R.string.nav_settings, R.drawable.ic_nav_settings),
}

/** Pages that sit on top of the tabs; Back pops them. */
sealed interface Page {
    data class Detail(val state: DetailState) : Page
    data class Collection(val state: DetailState) : Page
    data class Player(val plan: PlaybackPlan) : Page
    data class Album(val state: AlbumPageState) : Page
    data class Artist(val state: ArtistPageState) : Page
    data class Playlist(val state: PlaylistPageState) : Page
    data class VideoPlaylist(val state: VideoPlaylistState) : Page
    data class Stats(val state: StatsState) : Page
    data class Person(val state: PersonState) : Page
    data object NowPlaying : Page
}

/** What a remote device (the web app, another phone) can ask of the video that is playing. */
sealed interface PlayerCommand {
    data object Pause : PlayerCommand
    data object Resume : PlayerCommand
    data object Toggle : PlayerCommand
    data object Stop : PlayerCommand
    data object Next : PlayerCommand
    data class SeekTo(val ms: Long) : PlayerCommand
    data class SeekBy(val ms: Long) : PlayerCommand
}

/** What the Music section can show. */
/** The three faces of the full-screen music player: the cover and controls alone, with the queue beside them, or the words of the song. */
enum class NowPlayingPanel { Player, Queue, Lyrics }

enum class MusicView(val label: Int) {
    Overview(R.string.music_overview),
    Albums(R.string.music_albums),
    Artists(R.string.music_artists),
    Playlists(R.string.music_playlists),
}

class PersonState(val person: CastMember) {
    var items by mutableStateOf<List<MediaItem>?>(null)
}

class AlbumPageState(val album: Album) {
    var full by mutableStateOf(album)
    var tracks by mutableStateOf<List<Song>?>(null)
}

class ArtistPageState(val artist: Artist) {
    var full by mutableStateOf(artist)
    var albums by mutableStateOf<List<Album>?>(null)
    var popular by mutableStateOf<List<Song>?>(null)
}

class PlaylistPageState(val playlist: Playlist) {
    var tracks by mutableStateOf<List<Song>?>(null)
}

/** The viewing stats page: nothing until the titles are read, then the numbers. [failed] when they could not be. */
class StatsState {
    var stats by mutableStateOf<WatchedStats?>(null)
    var failed by mutableStateOf(false)
    /** What Playback Reporting recorded, when the server has the plugin and this account may read it. */
    var history by mutableStateOf<PlayHistory?>(null)
}

/** A playlist of movies and episodes: its places, in order. */
class VideoPlaylistState(val playlist: VideoPlaylist) {
    var entries by mutableStateOf<List<PlaylistEntry>?>(null)
}

/** One choice of a [DialogSpec]. It closes the dialog when picked unless [closes] is false (a choice that opens or redraws another one). */
class DialogChoice(val label: String, val selected: Boolean = false, val closes: Boolean = true, val onPick: () -> Unit)

/** A list of choices over the screen, for the card menu and the filters. [parent] is where Back goes to (null: closes it). */
class DialogSpec(val title: String, val choices: List<DialogChoice>, val parent: DialogSpec? = null)

/** What a title in a playlist's page can do besides the usual: leave the list, move, start the list from it. */
class PlaylistContext(val state: VideoPlaylistState, val entry: PlaylistEntry)

/** A list read in pages (or all at once) that keeps its place when you open something and come back. */
class PagedList<T>(val grid: LazyGridState = LazyGridState()) {
    val items = mutableStateListOf<T>()
    var total by mutableStateOf(0)
    var loading by mutableStateOf(false)
    var loaded by mutableStateOf(false)

    fun reset() {
        items.clear()
        total = 0
        loading = false
        loaded = false
    }
}

/** The Music overview rows; each fills in as the server answers. */
class MusicHome {
    var newAlbums by mutableStateOf<List<Album>>(emptyList())
    var jumpBack by mutableStateOf<List<Album>>(emptyList())
    var tryThese by mutableStateOf<List<Album>>(emptyList())
    var pick by mutableStateOf<Pick<Album>>(Pick.Loading)
    val list = LazyListState()
}

/** The Live TV tab: the channels (read a page at a time), what comes after what is on now, and which view is showing. */
class LiveTvState {
    val channels = mutableStateListOf<TvChannel>()
    var total by mutableStateOf(0)
    var loading by mutableStateOf(false)
    var loaded by mutableStateOf(false)

    /** Changes each time the list starts over, so a page that was still on its way for the old list is dropped when it arrives. */
    var generation = 0

    /** The programme after the one on now, by channel (read for the channels on screen, to show "Next"). */
    var upNext by mutableStateOf<Map<UUID, TvProgram>>(emptyMap())
    var guide by mutableStateOf(false)
    var favoritesOnly by mutableStateOf(false)
    val grid = LazyGridState()
    val list = LazyListState()

    fun reset() {
        generation++
        channels.clear()
        total = 0
        loading = false
        loaded = false
        upNext = emptyMap()
    }
}

/** A paged library list that keeps its place when you open a title and come back. */
class LibraryState(val section: Section) {
    val items = mutableStateListOf<MediaItem>()
    var total by mutableStateOf(0)
    var sort by mutableStateOf(SortOption.Added)
    var loading by mutableStateOf(false)
    var loaded by mutableStateOf(false)
    val grid = LazyGridState()

    /** Which title of the banner at the top is showing. */
    var bannerIndex by mutableIntStateOf(0)

    /** Where `items[0]` sits in the whole sorted list: not 0 after jumping to a letter (earlier titles are reached by choosing an earlier letter). */
    var startIndex by mutableIntStateOf(0)

    /** The letter last jumped to, for the highlight (null: the list starts at its beginning). */
    var letter by mutableStateOf<String?>(null)

    /** Bumped when the list is replaced (new sort, letter jump) so answers to older requests are thrown away. */
    var generation = 0

    /** What the list is narrowed by (Filters), and what the server offers to narrow it by (read once, after the first page). */
    var filters by mutableStateOf(LibraryFilters())
    var options by mutableStateOf<FilterOptions?>(null)
}

/** The extra data a title page shows once it has loaded. */
class DetailState(val item: MediaItem) {
    var full by mutableStateOf(item)
    var seasons by mutableStateOf<List<MediaItem>>(emptyList())
    var selectedSeason by mutableStateOf<MediaItem?>(null)
    var episodes by mutableStateOf<List<MediaItem>?>(null)
    var nextEpisode by mutableStateOf<MediaItem?>(null)
    /** Collections: what is inside. */
    var members by mutableStateOf<List<MediaItem>?>(null)
    /** The version chosen to play when the title has several; null: the server's first. */
    var version by mutableStateOf<String?>(null)
    /** A movie: the collection that holds it, once found. */
    var collection by mutableStateOf<MediaItem?>(null)
}

/** A random pick for "Discover something new": loading, nothing to pick from, or a pick. */
sealed interface Pick<out T> {
    data object Loading : Pick<Nothing>
    data object Empty : Pick<Nothing>
    data class Ready<T>(val value: T) : Pick<T>
}

/** What the main page is made of; each part fills in as soon as the server answers. */
class HomeState {
    var lineup by mutableStateOf<List<MediaItem>?>(null)
    var continueRow by mutableStateOf<List<MediaItem>>(emptyList())
    var nextUp by mutableStateOf<List<MediaItem>>(emptyList())
    var newMovies by mutableStateOf<List<MediaItem>>(emptyList())
    var newSeries by mutableStateOf<List<MediaItem>>(emptyList())
    var newAnime by mutableStateOf<List<MediaItem>>(emptyList())
    var newMusicVideos by mutableStateOf<List<MediaItem>>(emptyList())
    var newBooks by mutableStateOf<List<MediaItem>>(emptyList())
    var collections by mutableStateOf<List<MediaItem>>(emptyList())
    var watchLater by mutableStateOf<List<MediaItem>>(emptyList())
    var playlists by mutableStateOf<List<VideoPlaylist>>(emptyList())
    var favorites by mutableStateOf<List<MediaItem>>(emptyList())
    /** Movies and series added since the previous visit; empty on a first visit or when nothing is new. */
    var sinceVisit by mutableStateOf<List<MediaItem>>(emptyList())
    /** Episodes about to air, soonest first. */
    var upcoming by mutableStateOf<List<UpcomingEpisode>>(emptyList())
    /** Rows of suggestions ("Because you watched X", "Because you liked X"). */
    var because by mutableStateOf<List<Recommendation>>(emptyList())
    var pickMovie by mutableStateOf<Pick<MediaItem>>(Pick.Loading)
    var pickSeries by mutableStateOf<Pick<FreshSeries>>(Pick.Loading)
    val list = LazyListState()
    /** Which banner slide is showing (kept so Back from a title page lands on the same one). */
    var heroIndex by mutableIntStateOf(0)
}

private const val PAGE_SIZE = 60


/** The SDK reads each response on the thread that called it, which must not be the main one. */
private suspend fun <T> io(block: suspend () -> T): T = withContext(Dispatchers.IO) { block() }

/** All state lives here so it survives recomposition and a screen coming back from the player. */
class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val failureHandler = CoroutineExceptionHandler { _, e -> if (e is Exception) fail(e) }

    /** Like `viewModelScope.launch`, but a failure shows the error banner instead of crashing, and does not cancel its siblings. */
    private fun launchSafe(block: suspend CoroutineScope.() -> Unit): Job = viewModelScope.launch(failureHandler, block = block)

    private val store = SessionStore(app)
    private val repo = JellyfinRepository(app)

    private var session: Session? = store.load()

    /** Playback preferences (Settings). */
    var autoplayNext by mutableStateOf(store.autoplayNext)
        private set
    var autoSkip by mutableStateOf(store.autoSkip)
        private set

    fun updateAutoplayNext(on: Boolean) {
        autoplayNext = on
        store.autoplayNext = on
    }

    fun updateAutoSkip(on: Boolean) {
        autoSkip = on
        store.autoSkip = on
    }

    /** Subtitle look, quality limit, text size... (Settings). */
    var settings by mutableStateOf(store.settings)
        private set

    fun updateSettings(change: (TvSettings) -> TvSettings) {
        settings = change(settings)
        store.settings = settings
    }

    /** Background, accent, poster size and Home rows (Settings, Appearance). Painted from the very first frame. */
    var appearance by mutableStateOf(store.appearance)
        private set

    init {
        showLook(appearance)
    }

    private fun showLook(look: Appearance) {
        Palette.apply(resolveTheme(look.theme))
        Posters.size = look.posters
    }

    /** Whether the remote is on the top bar: the Music overview then scrolls back to its first card. */
    var topBarFocused by mutableStateOf(false)

    /** Whether the Home shows its banner (turned on, and there is something to feature): the top bar's Down goes to its button. */
    val homeHasBanner: Boolean get() = appearance.home.banner && !home.lineup.isNullOrEmpty() && libs?.hasVideo == true

    /** Saves the look on the server; only when the viewer presses the button. */
    fun saveLookOnServer() {
        val s = session ?: return
        launchSafe {
            runCatching { io { repo.saveAppearance(s, appearance) } }
                .onSuccess { notice = str(R.string.backup_saved) }
                .onFailure { notice = str(R.string.backup_failed) }
        }
    }

    /** Loads the look saved on the server (from another TV or the web app) and uses it. */
    fun loadLookFromServer() {
        val s = session ?: return
        launchSafe {
            runCatching { io { repo.loadAppearance(s) } }
                .onSuccess { look ->
                    if (look == null) notice = str(R.string.backup_none)
                    else {
                        updateAppearance { look }
                        notice = str(R.string.backup_loaded)
                    }
                }
                .onFailure { notice = str(R.string.backup_failed) }
        }
    }

    fun updateAppearance(change: (Appearance) -> Appearance) {
        appearance = change(appearance)
        store.appearance = appearance
        showLook(appearance)
    }

    fun chooseCanvas(id: String) = updateAppearance { it.copy(theme = it.theme.copy(canvas = id)) }
    fun chooseAccent(id: String) = updateAppearance { it.copy(theme = ThemeChoice(it.theme.canvas, id)) }
    fun choosePosters(size: PosterSize) = updateAppearance { it.copy(posters = size) }
    fun chooseNav(style: NavStyle) = updateAppearance { it.copy(nav = style) }
    fun updateMenu(change: (MenuLayout) -> MenuLayout) = updateAppearance { it.copy(menu = change(it.menu)) }
    fun updateHome(change: (HomeLayout) -> HomeLayout) = updateAppearance { it.copy(home = change(it.home)) }

    /** The server's plugins, read for Settings; null until the first answer. */
    var plugins by mutableStateOf<PluginsReport?>(null)
        private set
    var pluginsFailed by mutableStateOf(false)
        private set

    fun refreshPlugins() {
        val s = session ?: return
        launchSafe {
            runCatching { io { repo.pluginsReport(s) } }
                .onSuccess {
                    plugins = it
                    pluginsFailed = false
                }
                .onFailure {
                    if (it is CancellationException) throw it
                    pluginsFailed = true
                }
        }
    }

    val signedIn: Boolean get() = session != null
    val lastServer: String get() = store.lastServer
    val userName: String get() = session?.userName.orEmpty()
    val serverUrl: String get() = session?.serverUrl.orEmpty()
    /** The token the player sends with every request. */
    val accessToken: String get() = session?.accessToken.orEmpty()

    var libs: Libraries? by mutableStateOf(null)
        private set
    var hasCollections by mutableStateOf(false)
        private set

    /** The tabs this account can use, in order. */
    val tabs: List<Tab>
        get() {
            val l = libs
            val available = buildSet {
                add(MenuItem.Home)
                if (l == null || l.movies.isNotEmpty()) add(MenuItem.Movies)
                if (l == null || l.series.isNotEmpty()) add(MenuItem.Series)
                if (l != null && l.anime.isNotEmpty()) add(MenuItem.Anime)
                if (l != null && l.musicVideos.isNotEmpty()) add(MenuItem.MusicVideos)
                if (l != null && l.books.isNotEmpty()) add(MenuItem.Books)
                if (l != null && l.liveTv.isNotEmpty()) add(MenuItem.LiveTv)
                if (l != null && l.music.isNotEmpty()) add(MenuItem.Music)
                if (hasCollections) add(MenuItem.Collections)
            }
            // The sections in the order the user chose (the names of both lists are the same), then Search and Settings.
            return appearance.menu.arrange(available).map { Tab.valueOf(it.name) } + Tab.Search + Tab.Settings
        }

    var tab by mutableStateOf(Tab.Home)
        private set
    val pages = mutableStateListOf<Page>()

    var busy by mutableStateOf(false)
        private set
    var errorRes: Int? by mutableStateOf(null)
        private set
    var errorText: String? by mutableStateOf(null)
        private set

    val home = HomeState()
    val movies = LibraryState(Section.Movies)
    val series = LibraryState(Section.Series)
    val anime = LibraryState(Section.Anime)
    val musicVideos = LibraryState(Section.MusicVideos)
    val books = LibraryState(Section.Books)
    val liveTv = LiveTvState()
    val collectionList = LibraryState(Section.Collections)

    // Music
    val musicHome = MusicHome()
    var musicView by mutableStateOf(MusicView.Overview)
    val albumList = PagedList<Album>()
    var albumSort by mutableStateOf(AlbumSort.Added)
    val artistList = PagedList<Artist>()
    val playlistList = PagedList<Playlist>()
    var music: MusicPlayer? by mutableStateOf(null)
        private set
    private var musicTicker: Job? = null

    var query by mutableStateOf("")
        private set
    var results: List<MediaItem>? by mutableStateOf(null)
        private set
    var musicResults: Pair<List<Album>, List<Artist>> by mutableStateOf(emptyList<Album>() to emptyList())
        private set
    private var searchJob: Job? = null
    private var musicLoaded = false

    /** The title that had focus when a page opened, so Back lands on it again. */
    var lastFocused: UUID? = null

    /** Set when a screen should hand the remote focus to this title once (cleared by the card that takes it). */
    var restoreTarget: UUID? by mutableStateOf(null)

    /**
     * Where the remote goes when it presses Down on the top bar: the first thing to use on the current section (the
     * banner's Play button, the sort choices, the search box...). Whichever screen is showing attaches it.
     */
    val contentEntry = androidx.compose.ui.focus.FocusRequester()

    /** True once the remote has been given its first place on Home. */
    var initialFocusDone = false

    // ---- Being controlled from another device -----------------------------------------------------------------

    /** Commands for the video player on screen (it listens while it is open). */
    val playerCommands = MutableSharedFlow<PlayerCommand>(extraBufferCapacity = 8)
    private var remoteJob: Job? = null

    /**
     * Makes this TV show up in the other Jellyfin apps' "Play on" list and does what they ask: play a title, pause, resume,
     * skip, seek, stop. It lasts as long as the app is open (the server only knows the TV while it is connected).
     */
    private fun startRemote() {
        val s = session ?: return
        remoteJob?.cancel()
        remoteJob = launchSafe {
            // The server forgets a session that has been quiet for a while; saying who we are again now and then keeps it findable.
            launchSafe {
                while (true) {
                    runCatching { io { repo.registerRemote(s) } }
                    delay(240_000)
                }
            }
            repo.remoteMessages(s).collect { message ->
                when (message) {
                    is JellyfinRepository.RemoteMessage.Play -> if (message.itemIds.isNotEmpty()) playRemote(message.itemIds, message.startMs)
                    is JellyfinRepository.RemoteMessage.State -> handleRemoteState(message)
                }
            }
        }
    }

    private fun playRemote(ids: List<UUID>, startMs: Long) {
        val s = session ?: return
        launchSafe {
            // Songs, an album or a playlist start the music player, with everything that was sent as its queue.
            val songs = io { repo.songsFor(s, ids) }
            if (songs.isNotEmpty()) {
                playSongs(songs)
                openNowPlaying()
                return@launchSafe
            }
            val item = io { repo.details(s, ids.first()) }
            // No position asked for: carry on where this title was left, as pressing Play here would.
            if (startMs > 0) play(item, startMs) else play(item)
        }
    }

    private fun handleRemoteState(message: JellyfinRepository.RemoteMessage.State) {
        val playing = pages.lastOrNull() is Page.Player
        val m = music
        val command = when (message.command) {
            org.jellyfin.sdk.model.api.PlaystateCommand.PAUSE -> PlayerCommand.Pause
            org.jellyfin.sdk.model.api.PlaystateCommand.UNPAUSE -> PlayerCommand.Resume
            org.jellyfin.sdk.model.api.PlaystateCommand.PLAY_PAUSE -> PlayerCommand.Toggle
            org.jellyfin.sdk.model.api.PlaystateCommand.STOP -> PlayerCommand.Stop
            org.jellyfin.sdk.model.api.PlaystateCommand.NEXT_TRACK -> PlayerCommand.Next
            org.jellyfin.sdk.model.api.PlaystateCommand.SEEK -> message.seekMs?.let { PlayerCommand.SeekTo(it) }
            org.jellyfin.sdk.model.api.PlaystateCommand.REWIND -> PlayerCommand.SeekBy(-30_000)
            org.jellyfin.sdk.model.api.PlaystateCommand.FAST_FORWARD -> PlayerCommand.SeekBy(30_000)
            else -> null
        } ?: return
        when {
            playing -> playerCommands.tryEmit(command)
            m != null && m.hasQueue -> when (command) {
                PlayerCommand.Pause -> if (m.playing) m.toggle()
                PlayerCommand.Resume -> if (!m.playing) m.toggle()
                PlayerCommand.Toggle -> m.toggle()
                PlayerCommand.Next -> m.next()
                PlayerCommand.Stop -> m.stop()
                is PlayerCommand.SeekTo -> m.seekTo(command.ms)
                is PlayerCommand.SeekBy -> m.seekBy(command.ms)
                else -> Unit
            }
        }
    }

    /** What this TV was found to play (see TvCapabilities); asked early so the first video does not wait for it. */
    var capabilities by mutableStateOf<List<String>>(emptyList())
        private set

    init {
        launchSafe { capabilities = runCatching { io { repo.capabilitySummary() } }.getOrDefault(emptyList()) }
        session?.let { s ->
            // What the main page showed last time goes up at once; the server's answer replaces it a moment later.
            HomeCache.load(getApplication(), s)?.let { cached ->
                libs = cached.libs
                home.lineup = cached.lineup
                home.continueRow = cached.continueRow
                home.nextUp = cached.nextUp
                home.newMovies = cached.newMovies
                home.newSeries = cached.newSeries
                home.newAnime = cached.newAnime
                home.newMusicVideos = cached.newMusicVideos
                home.newBooks = cached.newBooks
                home.collections = cached.collections
            }
        }
        if (session != null) {
            loadHome()
            startRemote()
        }
    }

    // ---- Session ----------------------------------------------------------------------------------------------

    fun signIn(server: String, user: String, password: String) {
        if (busy) return
        busy = true
        errorText = null
        errorRes = null
        launchSafe {
            try {
                val s = io { repo.signIn(server, user, password) }
                store.save(s)
                store.lastServer = s.serverUrl
                session = s
                tab = Tab.Home
                loadHome()
                startRemote()
            } catch (e: Exception) {
                fail(e, R.string.error_sign_in)
            } finally {
                busy = false
            }
        }
    }

    // ---- Quick Connect -----------------------------------------------------------------------------------------

    /** The code to type on another device while waiting for it to be approved; null when not waiting. */
    var quickCode: String? by mutableStateOf(null)
        private set
    private var quickJob: Job? = null

    /** Asks the server for a code and waits (every two seconds, up to ten minutes) for somebody to approve it. */
    fun startQuickConnect(server: String) {
        if (server.isBlank()) return
        quickJob?.cancel()
        errorText = null
        errorRes = null
        quickJob = launchSafe {
            try {
                val start = io { repo.quickConnectStart(server) }
                quickCode = start.code
                var waited = 0
                while (waited < 600_000) {
                    delay(2_000)
                    waited += 2_000
                    if (io { repo.quickConnectApproved(start) }) {
                        val s = io { repo.quickConnectFinish(start) }
                        store.save(s)
                        store.lastServer = s.serverUrl
                        session = s
                        tab = Tab.Home
                        loadHome()
                        startRemote()
                        return@launchSafe
                    }
                }
                errorRes = R.string.error_quick_connect_expired
            } catch (e: JellyfinRepository.QuickConnectOff) {
                errorRes = R.string.error_quick_connect_off
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                fail(e, R.string.error_sign_in)
            } finally {
                quickCode = null
            }
        }
    }

    fun cancelQuickConnect() {
        quickJob?.cancel()
        quickCode = null
    }

    fun signOut() {
        remoteJob?.cancel()
        homeSaveJob?.cancel()
        homeLoaded = false
        HomeCache.clear(getApplication())
        launchSafe { io { WatchNext.clear(getApplication()) } }
        music?.release()
        music = null
        musicTicker?.cancel()
        resetMusic()
        store.clear()
        session = null
        libs = null
        hasCollections = false
        pages.clear()
        resetHome()
        for (lib in listOf(movies, series, anime, musicVideos, books, collectionList)) resetLibrary(lib)
        liveTv.reset()
        results = null
        musicResults = emptyList<Album>() to emptyList()
        query = ""
        tab = Tab.Home
        errorText = null
        errorRes = null
    }

    private fun resetHome() {
        home.lineup = null
        home.continueRow = emptyList()
        home.nextUp = emptyList()
        home.newMovies = emptyList()
        home.newSeries = emptyList()
        home.newAnime = emptyList()
        home.newMusicVideos = emptyList()
        home.newBooks = emptyList()
        home.collections = emptyList()
        home.watchLater = emptyList()
        home.playlists = emptyList()
        home.favorites = emptyList()
        home.sinceVisit = emptyList()
        home.upcoming = emptyList()
        home.because = emptyList()
        home.pickMovie = Pick.Loading
        home.pickSeries = Pick.Loading
        home.heroIndex = 0
        initialFocusDone = false
    }

    private fun resetMusic() {
        musicHome.newAlbums = emptyList()
        musicHome.jumpBack = emptyList()
        musicHome.tryThese = emptyList()
        dayMix = null
        musicHome.pick = Pick.Loading
        musicLoaded = false
        musicView = MusicView.Overview
        albumList.reset()
        artistList.reset()
        playlistList.reset()
    }

    private fun resetLibrary(lib: LibraryState) {
        lib.generation++
        lib.items.clear()
        lib.total = 0
        lib.loaded = false
        lib.loading = false
        lib.startIndex = 0
        lib.letter = null
    }

    // ---- Tabs and home ----------------------------------------------------------------------------------------

    fun select(next: Tab) {
        tab = next
        val state = libraryOf(next)
        if (state != null && !state.loaded) loadMore(state)
        if (next == Tab.Music) loadMusic()
        if (next == Tab.LiveTv && !liveTv.loaded) loadLiveTv()
    }

    // ---- Live TV ------------------------------------------------------------------------------------------------

    /** Reads the next page of channels (from the start when [restart] is set), then what comes after each one's current programme. */
    fun loadLiveTv(restart: Boolean = false) {
        val s = session ?: return
        if (restart) liveTv.reset()
        if (liveTv.loading || (liveTv.loaded && liveTv.channels.size >= liveTv.total)) return
        liveTv.loading = true
        val favorites = liveTv.favoritesOnly
        val generation = liveTv.generation
        launchSafe {
            try {
                val page = io { repo.channels(s, liveTv.channels.size, LIVE_PAGE, favorites) }
                if (generation != liveTv.generation) return@launchSafe
                liveTv.channels.addAll(page.items)
                page.total?.let { liveTv.total = it }
                liveTv.loaded = true
                refreshUpNext(page.items)
            } catch (e: Exception) {
                fail(e)
            } finally {
                // Only the load that belongs to the list now showing may say it is done.
                if (generation == liveTv.generation) liveTv.loading = false
            }
        }
    }

    private fun refreshUpNext(channels: List<TvChannel>) {
        val s = session ?: return
        launchSafe {
            val now = System.currentTimeMillis()
            val found = runCatching { io { repo.programs(s, channels.map { it.id }, now, now + 3 * 3_600_000L) } }.getOrDefault(emptyMap())
            liveTv.upNext = liveTv.upNext + found.mapNotNull { (id, programs) -> nextProgram(programs, now)?.let { id to it } }
        }
    }

    fun showGuide(guide: Boolean) {
        liveTv.guide = guide
    }

    fun toggleLiveFavorites() {
        liveTv.favoritesOnly = !liveTv.favoritesOnly
        loadLiveTv(restart = true)
    }

    /** Watches a channel. */
    fun watch(channel: TvChannel) = play(channel.item, startMs = 0)

    /** Changes channel from the player: the one [step] places on in the list (the list is read first when it has not been). */
    fun stepChannel(plan: PlaybackPlan, step: Int) {
        val s = session ?: return
        if (busy) return
        launchSafe {
            // The list being browsed (it may be only the favorites); when it does not hold this channel, the first page of all of them.
            var list: List<TvChannel> = liveTv.channels
            if (list.none { it.item.id == plan.item.id }) {
                list = runCatching { io { repo.channels(s, 0, LIVE_PAGE) } }.getOrNull()?.items ?: return@launchSafe
            }
            neighbourChannel(list, plan.item.id, step)?.let { play(it.item, startMs = 0) }
        }
    }

    /**
     * The banner at the top of Movies, Series and Anime: the newest titles the Home already read (so it costs no request), those with
     * a backdrop. None for Music videos and Collections, while a filter is on (the newest titles would not match it), or when the banner is turned off.
     */
    fun sectionBanner(lib: LibraryState): List<MediaItem> {
        if (!appearance.home.banner || lib.filters.isActive) return emptyList()
        val newest = when (lib.section) {
            Section.Movies -> home.newMovies
            Section.Series -> home.newSeries
            Section.Anime -> home.newAnime
            Section.MusicVideos, Section.Books, Section.Collections -> return emptyList()
        }
        return newest.filter { it.backdropUrl != null }.take(8)
    }

    private companion object {
        const val LIVE_PAGE = 60
    }

    fun libraryOf(tab: Tab): LibraryState? = when (tab) {
        Tab.Movies -> movies
        Tab.Series -> series
        Tab.Anime -> anime
        Tab.MusicVideos -> musicVideos
        Tab.Books -> books
        Tab.Collections -> collectionList
        else -> null
    }

    private fun libsFor(section: Section): List<Lib> {
        val l = libs ?: return emptyList()
        return when (section) {
            Section.Movies -> l.movies
            Section.Series -> l.series
            Section.Anime -> l.anime
            Section.MusicVideos -> l.musicVideos
            Section.Books -> l.books
            Section.Collections -> emptyList()
        }
    }

    /** Reads the libraries, then everything on the main page at the same time; each part appears when it is ready. */
    fun loadHome() {
        val s = session ?: return
        // Not "libs == null": the libraries may already be on screen from the saved copy, and the picks still need to be made.
        val firstLoad = !homeLoaded
        launchSafe {
            val l = try {
                io { repo.libraries(s) }
            } catch (e: Exception) {
                fail(e)
                return@launchSafe
            }
            libs = l
            homeLoaded = true
            if (firstLoad) {
                launchSafe {
                    // Collections live in a hidden library: ask for one to know whether the tab is worth showing.
                    hasCollections = l.movies.isNotEmpty() && runCatching {
                        io { repo.library(s, Section.Collections, emptyList(), SortOption.Added, 0, 1, withTotal = false).items.isNotEmpty() }
                    }.getOrDefault(false)
                }
            }
            if (!l.hasTitles) {
                home.lineup = emptyList()
                return@launchSafe
            }
            // The banner's lists go first: the server answers a few requests at a time, and the picks are not what you wait for.
            launchSafe {
                // A failed read keeps what is on screen (the saved copy); only a first-ever load settles for "nothing".
                runCatching { io { repo.homeLineup(s, l) } }.getOrNull()?.let { home.lineup = it }
                if (home.lineup == null) home.lineup = emptyList()
                saveHomeLater()
            }
            refreshContinue()
            launchSafe {
                home.newMovies = if (l.movies.isEmpty()) emptyList() else io { repo.latest(s, BaseItemKind.MOVIE, l.movies) }
                saveHomeLater()
            }
            launchSafe {
                home.newSeries = if (l.series.isEmpty()) emptyList() else io { repo.latest(s, BaseItemKind.SERIES, l.series) }
                saveHomeLater()
            }
            launchSafe {
                home.newAnime = if (l.anime.isEmpty()) emptyList() else io { repo.latest(s, BaseItemKind.SERIES, l.anime) }
                saveHomeLater()
            }
            launchSafe {
                home.newMusicVideos = if (l.musicVideos.isEmpty()) emptyList() else io { repo.latest(s, BaseItemKind.MUSIC_VIDEO, l.musicVideos) }
                saveHomeLater()
            }
            launchSafe {
                home.newBooks = if (l.books.isEmpty()) emptyList() else runCatching { io { repo.latestBooks(s, l.books) } }.getOrDefault(home.newBooks)
                saveHomeLater()
            }
            launchSafe {
                runCatching { io { repo.randomCollections(s) } }.getOrNull()?.let { home.collections = it }
                saveHomeLater()
            }
            launchSafe {
                runCatching { io { repo.recommendations(s) } }.getOrNull()?.let { home.because = it }
            }
            refreshOrganised()
            refreshNews(l)
            if (firstLoad) {
                pickMovie()
                pickSeries()
                if (l.music.isNotEmpty()) pickAlbum()
            }
        }
    }

    /** The rows that answer "what is new for me": titles added since the previous visit, and episodes about to air. */
    private fun refreshNews(l: Libraries) {
        val s = session ?: return
        val since = store.startVisit(System.currentTimeMillis())
        launchSafe {
            home.sinceVisit = if (since == null) emptyList()
            else runCatching { io { repo.addedSince(s, since, l.movies + l.shows) } }.getOrDefault(home.sinceVisit)
        }
        launchSafe {
            home.upcoming = if (l.shows.isEmpty()) emptyList() else io { repo.upcoming(s) }
        }
    }

    /** "Continue watching" and "Next up" are read again after every playback. */
    fun refreshContinue() {
        val s = session ?: return
        launchSafe {
            kotlinx.coroutines.coroutineScope {
                val withVideos = libs?.musicVideos?.isNotEmpty() == true
                val resuming = async { runCatching { io { repo.continueAll(s, withVideos) } }.getOrNull() }
                val upNext = async { runCatching { io { repo.nextUp(s) } }.getOrNull() }
                resuming.await()?.let { home.continueRow = it }
                upNext.await()?.let { home.nextUp = it }
            }
            // The same two lists feed the "Continue watching" row of the Google TV home screen.
            val resuming = home.continueRow
            val upNext = home.nextUp
            io { WatchNext.sync(getApplication(), resuming, upNext) }
            saveHomeLater()
        }
    }

    private var homeLoaded = false
    private var homeSaveJob: Job? = null

    /** Writes the main page down for next time, once the rows have stopped arriving. */
    private fun saveHomeLater() {
        val s = session ?: return
        val l = libs ?: return
        homeSaveJob?.cancel()
        homeSaveJob = launchSafe {
            delay(1500)
            val snapshot = HomeSnapshot(
                l, home.lineup.orEmpty(), home.continueRow, home.nextUp, home.newMovies, home.newSeries, home.newAnime, home.collections,
                home.newMusicVideos, home.newBooks,
            )
            io { HomeCache.save(getApplication(), s, snapshot) }
        }
    }

    /** A card of the Google TV home screen row: plays that title, where it was left. */
    fun playFromLink(id: UUID) {
        val s = session ?: return
        launchSafe {
            val item = io { repo.details(s, id) }
            play(item)
        }
    }

    private val lyricsCache = HashMap<UUID, Lyrics>()

    /**
     * The lyrics of a song, asked once per song while the app is open. A song without lyrics is asked again next time (the server
     * may have found some since, and a miss is cheap); a failed read is not remembered either.
     */
    suspend fun lyricsFor(songId: UUID): Lyrics? {
        lyricsCache[songId]?.let { return it }
        val s = session ?: return null
        return try {
            io { repo.lyrics(s, songId) }?.also { lyricsCache[songId] = it }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    private val noLyrics = HashSet<UUID>()

    /** Whether a song has lyrics, for the button of the now-playing bar. A song without them is not asked about again until the app restarts. */
    suspend fun hasLyrics(songId: UUID): Boolean {
        if (lyricsCache.containsKey(songId)) return true
        if (songId in noLyrics) return false
        val found = lyricsFor(songId) != null
        if (!found) noLyrics.add(songId)
        return found
    }

    /** What happened when timed lyrics were looked for: the new lyrics, none to be found, not allowed (not an administrator), or a failure. */
    sealed interface TimedLyricsResult {
        data class Found(val lyrics: Lyrics) : TimedLyricsResult
        data object None : TimedLyricsResult
        data object Denied : TimedLyricsResult
        data object Failed : TimedLyricsResult
    }

    /** Asks the server's lyrics plugin for timed lyrics and saves them beside the song (see [JellyfinRepository.findTimedLyrics]). */
    suspend fun findTimedLyrics(songId: UUID): TimedLyricsResult {
        val s = session ?: return TimedLyricsResult.Failed
        return try {
            val found = io { repo.findTimedLyrics(s, songId) }
            if (found == null) TimedLyricsResult.None else TimedLyricsResult.Found(found).also { lyricsCache[songId] = found }
        } catch (e: CancellationException) {
            throw e
        } catch (e: org.jellyfin.sdk.api.client.exception.InvalidStatusException) {
            if (e.status == 403) TimedLyricsResult.Denied else TimedLyricsResult.Failed
        } catch (e: Exception) {
            TimedLyricsResult.Failed
        }
    }

    fun pickMovie() {
        val s = session ?: return
        val l = libs ?: return
        if (l.movies.isEmpty()) return
        home.pickMovie = Pick.Loading
        launchSafe {
            home.pickMovie = runCatching { io { repo.randomMovie(s, l.movies) } }.getOrNull()?.let { Pick.Ready(it) } ?: Pick.Empty
        }
    }

    fun pickSeries() {
        val s = session ?: return
        val l = libs ?: return
        if (l.shows.isEmpty()) return
        home.pickSeries = Pick.Loading
        launchSafe {
            home.pickSeries = runCatching { io { repo.freshSeries(s, l.shows) } }.getOrNull()?.let { Pick.Ready(it) } ?: Pick.Empty
        }
    }

    fun loadMore(lib: LibraryState) {
        val s = session ?: return
        if (lib.loading || (lib.loaded && lib.startIndex + lib.items.size >= lib.total)) return
        lib.loading = true
        val sort = lib.sort
        val generation = lib.generation
        launchSafe {
            try {
                // A library list needs the libraries first (a restored session reads them on its own).
                val known = libs ?: io { repo.libraries(s) }.also { libs = it }
                val where = libsFor(lib.section).takeIf { known.hasTitles } ?: emptyList()
                val page = io { repo.library(s, lib.section, where, sort, lib.startIndex + lib.items.size, PAGE_SIZE, narrowedBy = lib.filters) }
                // The sort may have changed (or a letter been chosen) while this was loading; if so the result belongs to the old list.
                if (sort == lib.sort && generation == lib.generation) {
                    lib.items.addAll(page.items)
                    page.total?.let { lib.total = it }
                    lib.loaded = true
                    if (lib.options == null) loadFilterOptions(lib, where)
                }
            } catch (e: Exception) {
                fail(e)
            } finally {
                lib.loading = false
            }
        }
    }

    /** Shows the list from the first title that starts with [letter] ("#" is the beginning); only for the A-Z order. */
    fun jumpToLetter(lib: LibraryState, letter: String) {
        val s = session ?: return
        val known = libs ?: return
        if (lib.sort != SortOption.Name) return
        lib.letter = letter.takeIf { it != "#" }
        val generation = ++lib.generation
        val where = libsFor(lib.section).takeIf { known.hasTitles } ?: emptyList()
        launchSafe {
            try {
                val index = if (letter == "#") 0 else io { repo.libraryCountBefore(s, lib.section, where, letter, lib.filters) }
                val start = index.coerceAtMost((lib.total - 1).coerceAtLeast(0))
                val page = io { repo.library(s, lib.section, where, SortOption.Name, start, PAGE_SIZE, narrowedBy = lib.filters) }
                if (generation != lib.generation) return@launchSafe
                lib.items.clear()
                lib.items.addAll(page.items)
                lib.startIndex = start
                page.total?.let { lib.total = it }
                lib.loaded = true
                lib.grid.scrollToItem(0)
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    fun sortBy(lib: LibraryState, sort: SortOption) {
        if (lib.sort == sort) return
        lib.sort = sort
        resetLibrary(lib)
        loadMore(lib)
    }

    fun search(text: String) {
        query = text
        searchJob?.cancel()
        val s = session ?: return
        if (text.isBlank()) {
            results = null
            musicResults = emptyList<Album>() to emptyList()
            return
        }
        searchJob = launchSafe {
            delay(350) // wait for the typing to pause
            results = try {
                io { repo.search(s, text.trim()) }
            } catch (e: Exception) {
                emptyList()
            }
            if (libs?.music?.isNotEmpty() == true) {
                musicResults = runCatching { io { repo.searchMusic(s, text.trim()) } }.getOrDefault(emptyList<Album>() to emptyList())
            }
        }
    }

    // ---- Music ------------------------------------------------------------------------------------------------

    /** Reads the overview rows the first time Music is opened. */
    fun loadMusic() {
        val s = session ?: return
        val l = libs ?: return
        if (musicLoaded || l.music.isEmpty()) return
        musicLoaded = true
        launchSafe { musicHome.newAlbums = runCatching { io { repo.albums(s, l.music, AlbumSort.Added, 0, 16).items } }.getOrDefault(emptyList()) }
        launchSafe { musicHome.tryThese = runCatching { io { repo.randomAlbums(s, l.music) } }.getOrDefault(emptyList()) }
        launchSafe { musicHome.jumpBack = runCatching { io { repo.jumpBackAlbums(s, l.music) } }.getOrDefault(emptyList()) }
        pickAlbum()
    }

    fun pickAlbum() {
        val s = session ?: return
        val l = libs ?: return
        if (l.music.isEmpty()) return
        musicHome.pick = Pick.Loading
        launchSafe {
            musicHome.pick = runCatching { io { repo.randomAlbums(s, l.music, 1) } }.getOrNull()?.firstOrNull()?.let { Pick.Ready(it) } ?: Pick.Empty
        }
    }

    fun selectMusicView(view: MusicView) {
        musicView = view
        when (view) {
            MusicView.Albums -> loadMoreAlbums()
            MusicView.Artists -> loadMoreArtists()
            MusicView.Playlists -> loadPlaylists()
            MusicView.Overview -> Unit
        }
    }

    fun loadMoreAlbums() {
        val s = session ?: return
        val l = libs ?: return
        val list = albumList
        if (list.loading || (list.loaded && list.items.size >= list.total)) return
        list.loading = true
        val sort = albumSort
        launchSafe {
            try {
                val page = io { repo.albums(s, l.music, sort, list.items.size, PAGE_SIZE) }
                if (sort == albumSort) {
                    list.items.addAll(page.items)
                    page.total?.let { list.total = it }
                    list.loaded = true
                }
            } catch (e: Exception) {
                fail(e)
            } finally {
                list.loading = false
            }
        }
    }

    fun sortAlbums(sort: AlbumSort) {
        if (sort == albumSort) return
        albumSort = sort
        albumList.reset()
        loadMoreAlbums()
    }

    fun loadMoreArtists() {
        val s = session ?: return
        val l = libs ?: return
        val list = artistList
        if (list.loading || (list.loaded && list.items.size >= list.total)) return
        list.loading = true
        launchSafe {
            try {
                val page = io { repo.artists(s, l.music, list.items.size, PAGE_SIZE) }
                list.items.addAll(page.items)
                page.total?.let { list.total = it }
                list.loaded = true
            } catch (e: Exception) {
                fail(e)
            } finally {
                list.loading = false
            }
        }
    }

    fun loadPlaylists() {
        val s = session ?: return
        val list = playlistList
        if (list.loading || list.loaded) return
        list.loading = true
        launchSafe {
            try {
                val all = io { repo.playlists(s) }
                list.items.addAll(all)
                list.total = all.size
                list.loaded = true
            } catch (e: Exception) {
                fail(e)
            } finally {
                list.loading = false
            }
        }
    }

    fun openAlbum(album: Album) {
        val s = session ?: return
        val state = AlbumPageState(album)
        pages.add(Page.Album(state))
        launchSafe { runCatching { io { repo.album(s, album.id) } }.getOrNull()?.let { state.full = it } }
        launchSafe { state.tracks = runCatching { io { repo.albumTracks(s, album.id) } }.getOrDefault(emptyList()) }
    }

    fun openArtist(artist: Artist) {
        val s = session ?: return
        val state = ArtistPageState(artist)
        pages.add(Page.Artist(state))
        launchSafe { runCatching { io { repo.artist(s, artist.id) } }.getOrNull()?.let { state.full = it } }
        launchSafe { state.albums = runCatching { io { repo.albums(s, libs?.music.orEmpty(), AlbumSort.Year, 0, 100, artist.id).items } }.getOrDefault(emptyList()) }
        launchSafe { state.popular = runCatching { io { repo.popularSongs(s, artist.id) } }.getOrDefault(emptyList()) }
    }

    fun openPlaylist(playlist: Playlist) {
        val s = session ?: return
        val state = PlaylistPageState(playlist)
        pages.add(Page.Playlist(state))
        launchSafe { state.tracks = runCatching { io { repo.playlistTracks(s, playlist.id) } }.getOrDefault(emptyList()) }
    }

    /** Opens the album an album-artist link points at, by artist id (a song's own artist). */
    fun openNowPlaying(panel: NowPlayingPanel? = null) {
        if (music?.hasQueue != true) return
        // Without a choice it opens where it was left: the queue, or the player alone when the queue was put away.
        nowPlayingPanel = panel ?: nowPlayingHome
        if (pages.lastOrNull() != Page.NowPlaying) pages.add(Page.NowPlaying)
    }

    /** What the full-screen music player shows. [nowPlayingHome] is where the lyrics go back to; it is kept while the app is open. */
    var nowPlayingPanel by mutableStateOf(NowPlayingPanel.Queue)
    var nowPlayingHome by mutableStateOf(NowPlayingPanel.Queue)

    fun showNowPlayingPanel(panel: NowPlayingPanel) {
        if (panel != NowPlayingPanel.Lyrics) nowPlayingHome = panel
        nowPlayingPanel = panel
    }

    fun playSongs(songs: List<Song>, start: Int = 0, shuffle: Boolean = false, startMs: Long = 0L) {
        ensureMusic()?.play(songs, start, shuffle, startMs)
    }

    /** Plays an audiobook in the music player, from [startMs] (where it was left by default). */
    fun listen(book: MediaItem, startMs: Long = book.resumeMs) {
        if (book.isAudiobook) playSongs(listOf(book.toAudiobookSong()), 0, false, startMs)
    }

    fun playAlbum(album: Album, shuffle: Boolean = false) {
        val s = session ?: return
        launchSafe {
            val songs = runCatching { io { repo.albumTracks(s, album.id) } }.getOrDefault(emptyList())
            playSongs(songs, 0, shuffle)
        }
    }

    /** Plays the radio of a song, an album or an artist: the songs that go with it, from the server's instant mix. */
    fun playRadio(itemId: UUID) {
        val s = session ?: return
        launchSafe {
            val songs = runCatching { io { repo.radio(s, itemId) } }.getOrDefault(emptyList())
            if (songs.isEmpty()) notice = str(R.string.music_mix_none) else playSongs(songs)
        }
    }

    /** The mix of the day that was made last: kept, so it is the same all day while the app is open (the surprises in it are random). */
    private var dayMix: Pair<Long, List<Song>>? = null

    /** Today's mix of songs made for you; it is the same all day (it follows the date). */
    fun playDayMix() {
        val s = session ?: return
        val l = libs ?: return
        val today = java.time.LocalDate.now().toEpochDay()
        launchSafe {
            val songs = dayMix?.takeIf { it.first == today }?.second
                ?: runCatching { io { repo.dayMix(s, l.music, today) } }.getOrDefault(emptyList()).also { if (it.isNotEmpty()) dayMix = today to it }
            if (songs.isEmpty()) notice = str(R.string.music_mix_none) else playSongs(songs)
        }
    }

    fun shuffleEverything() {
        val s = session ?: return
        val l = libs ?: return
        launchSafe {
            val songs = runCatching { io { repo.randomSongs(s, l.music) } }.getOrDefault(emptyList())
            playSongs(songs)
        }
    }

    /** The music player is made on first use (it needs the session's token) and kept for the rest of the session. */
    private fun ensureMusic(): MusicPlayer? {
        val s = session ?: return null
        music?.let { return it }
        val reporter = object : MusicReporter {
            override fun started(song: Song) {
                launchSafe { io { repo.reportSongStarted(s, song) } }
            }

            override fun stopped(song: Song, positionMs: Long) {
                launchSafe { io { repo.reportSongStopped(s, song, positionMs) } }
            }

            override fun progress(song: Song, positionMs: Long, paused: Boolean) {
                launchSafe { io { repo.reportSongProgress(s, song, positionMs, paused) } }
            }
        }
        val player = MusicPlayer(getApplication(), s.accessToken, { repo.audioUrl(s, it) }, reporter)
        music = player
        musicTicker = launchSafe {
            while (true) {
                delay(500)
                if (player.hasQueue) player.tick()
            }
        }
        return player
    }

    override fun onCleared() {
        music?.release()
        super.onCleared()
    }

    // ---- Organising: the card menu, Watch later, playlists, favourites and the library filters ---------------------

    private fun str(@StringRes id: Int, vararg args: Any): String = getApplication<Application>().getString(id, *args)

    /** The menu or filter dialog on screen, if any. */
    var dialog by mutableStateOf<DialogSpec?>(null)
        private set

    /** Back inside a dialog: up one level, or away. */
    fun closeDialog() {
        dialog = dialog?.parent
    }

    fun showDialog(spec: DialogSpec?) {
        dialog = spec
    }

    /** A short confirmation over the screen ("Added to Watch later"); it goes away by itself. */
    var notice by mutableStateOf<String?>(null)
        private set

    fun dismissNotice() {
        notice = null
    }

    /** The titles being played through, in order (a playlist started with Play all); null for a single title or an episode run. */
    var playContext: List<MediaItem>? = null
        private set

    private fun nextInPlaylist(current: MediaItem): MediaItem? {
        val list = playContext ?: return null
        val at = list.indexOfFirst { it.id == current.id }
        return if (at in 0 until list.lastIndex) list[at + 1] else null
    }

    /** Whether the video that just ended has another one after it in the playlist being played. */
    fun hasNextInPlaylist(current: MediaItem): Boolean = nextInPlaylist(current) != null

    /** The rows that depend on what the user keeps: favourites, Watch later and the playlists. Read again after each change. */
    fun refreshOrganised() {
        val s = session ?: return
        launchSafe {
            home.favorites = runCatching { io { repo.favorites(s) } }.getOrDefault(home.favorites)
        }
        launchSafe {
            val lists = runCatching { io { repo.videoPlaylists(s) } }.getOrNull() ?: return@launchSafe
            home.playlists = lists.filter { !isWatchLater(it.name) && (it.itemCount ?: 1) > 0 }
            val later = lists.firstOrNull { isWatchLater(it.name) }
            home.watchLater = later?.let { runCatching { io { repo.playlistEntries(s, it.id) } }.getOrNull()?.map { e -> e.item } } ?: emptyList()
        }
    }

    /** Applies [change] to a title wherever it is on screen, so a mark made from a menu shows at once. */
    private fun patch(id: UUID, change: (MediaItem) -> MediaItem) {
        fun List<MediaItem>.p() = if (any { it.id == id }) map { if (it.id == id) change(it) else it } else this
        home.continueRow = home.continueRow.p()
        home.nextUp = home.nextUp.p()
        home.newMovies = home.newMovies.p()
        home.newSeries = home.newSeries.p()
        home.newAnime = home.newAnime.p()
        home.newMusicVideos = home.newMusicVideos.p()
        home.newBooks = home.newBooks.p()
        home.collections = home.collections.p()
        home.watchLater = home.watchLater.p()
        home.favorites = home.favorites.p()
        home.sinceVisit = home.sinceVisit.p()
        home.because = home.because.map { it.copy(items = it.items.p()) }
        for (lib in listOf(movies, series, anime, musicVideos, books, collectionList)) {
            for (i in lib.items.indices) if (lib.items[i].id == id) lib.items[i] = change(lib.items[i])
        }
        for (page in pages) {
            if (page is Page.Detail && page.state.full.id == id) page.state.full = change(page.state.full)
            if (page is Page.VideoPlaylist) page.state.entries = page.state.entries?.map { if (it.item.id == id) it.copy(item = change(it.item)) else it }
        }
    }

    /** What long-pressing OK on a title offers. [inList] is set on a playlist's page. */
    fun openCardMenu(item: MediaItem, inList: PlaylistContext? = null) {
        if (session == null) return
        val choices = ArrayList<DialogChoice>()
        choices += DialogChoice(str(R.string.menu_open)) { open(item) }
        val watchable = item.kind == BaseItemKind.MOVIE || item.kind == BaseItemKind.SERIES || item.kind == BaseItemKind.EPISODE || item.kind == BaseItemKind.MUSIC_VIDEO
        val markable = watchable || item.isBook || item.isAudiobook
        if (item.isPlayable && item.resumeMs >= MIN_RESUME_MS) choices += DialogChoice(str(R.string.menu_start_over)) { play(item, 0) }
        if (inList != null) {
            val entries = inList.state.entries.orEmpty()
            val at = entries.indexOfFirst { it.entryId == inList.entry.entryId }
            choices += DialogChoice(str(R.string.menu_play_from_here)) { playPlaylist(inList.state, at.coerceAtLeast(0)) }
            choices += DialogChoice(str(R.string.menu_remove_from_list)) { removeFromPlaylist(inList.state, inList.entry) }
            if (at > 0) choices += DialogChoice(str(R.string.menu_move_earlier)) { moveInPlaylist(inList.state, inList.entry, -1) }
            if (at in 0 until entries.lastIndex) choices += DialogChoice(str(R.string.menu_move_later)) { moveInPlaylist(inList.state, inList.entry, +1) }
        }
        if (markable) {
            choices += DialogChoice(str(if (item.played) R.string.menu_mark_unwatched else R.string.menu_mark_watched)) { markPlayed(item, !item.played) }
        }
        choices += DialogChoice(str(if (item.favorite) R.string.menu_unfavorite else R.string.menu_favorite)) { markFavorite(item, !item.favorite) }
        if (watchable) {
            if (home.watchLater.any { it.id == item.id }) choices += DialogChoice(str(R.string.menu_remove_watch_later)) { removeFromWatchLater(item) }
            else choices += DialogChoice(str(R.string.menu_watch_later)) { addToWatchLater(item) }
            choices += DialogChoice(str(R.string.menu_add_playlist)) { chooseWhichPlaylist(item) }
        }
        dialog = DialogSpec(item.title, choices)
    }

    private fun markPlayed(item: MediaItem, played: Boolean) {
        val s = session ?: return
        launchSafe {
            io { repo.setPlayed(s, item.id, played) }
            patch(item.id) { it.copy(played = played, progress = null, resumeMs = 0) }
            notice = str(if (played) R.string.notice_marked_watched else R.string.notice_marked_unwatched, item.title)
        }
    }

    private fun markFavorite(item: MediaItem, favorite: Boolean) {
        val s = session ?: return
        launchSafe {
            io { repo.setFavorite(s, item.id, favorite) }
            patch(item.id) { it.copy(favorite = favorite) }
            notice = str(if (favorite) R.string.notice_favorited else R.string.notice_unfavorited, item.title)
            refreshOrganised()
        }
    }

    private fun addToWatchLater(item: MediaItem) {
        val s = session ?: return
        launchSafe {
            val result = io { repo.addToWatchLater(s, item.id, str(R.string.menu_watch_later)) }
            notice = str(if (result == WatchLaterResult.AlreadyThere) R.string.notice_watch_later_already else R.string.notice_watch_later_added, item.title)
            if (result != WatchLaterResult.AlreadyThere) refreshOrganised()
        }
    }

    private fun removeFromWatchLater(item: MediaItem) {
        val s = session ?: return
        launchSafe {
            io { repo.removeFromWatchLater(s, item.id) }
            notice = str(R.string.notice_watch_later_removed, item.title)
            refreshOrganised()
        }
    }

    /** Lists the playlists to put a title in, and a new one. */
    private fun chooseWhichPlaylist(item: MediaItem) {
        val s = session ?: return
        launchSafe {
            val lists = io { repo.videoPlaylists(s) }
            val choices = ArrayList<DialogChoice>()
            lists.filter { !isWatchLater(it.name) }.forEach { list ->
                choices += DialogChoice(list.name) {
                    launchSafe {
                        io { repo.addToPlaylist(s, list.id, listOf(item.id)) }
                        notice = str(R.string.notice_added_to, item.title, list.name)
                        refreshOrganised()
                    }
                }
            }
            choices += DialogChoice(str(R.string.menu_new_playlist)) {
                launchSafe {
                    val name = newPlaylistName(lists.map { it.name }, str(R.string.menu_new_playlist))
                    io { repo.createVideoPlaylist(s, name, listOf(item.id)) }
                    notice = str(R.string.notice_created, name, item.title)
                    refreshOrganised()
                }
            }
            dialog = DialogSpec(str(R.string.menu_add_playlist), choices)
        }
    }

    fun openVideoPlaylist(playlist: VideoPlaylist) {
        val s = session ?: return
        val state = VideoPlaylistState(playlist)
        pages.add(Page.VideoPlaylist(state))
        launchSafe { state.entries = runCatching { io { repo.playlistEntries(s, playlist.id) } }.getOrDefault(emptyList()) }
    }

    /** Plays a playlist from [from], and on to the next title when one ends. */
    fun playPlaylist(state: VideoPlaylistState, from: Int = 0) {
        val entries = state.entries ?: return
        if (from !in entries.indices) return
        playContext = entries.drop(from).map { it.item }
        play(entries[from].item, startMs = 0)
    }

    private fun removeFromPlaylist(state: VideoPlaylistState, entry: PlaylistEntry) {
        val s = session ?: return
        launchSafe {
            io { repo.removeFromPlaylist(s, state.playlist.id, listOf(entry.entryId)) }
            state.entries = state.entries?.filter { it.entryId != entry.entryId }
            notice = str(R.string.notice_removed, entry.item.title)
            refreshOrganised()
        }
    }

    private fun moveInPlaylist(state: VideoPlaylistState, entry: PlaylistEntry, delta: Int) {
        val s = session ?: return
        val before = state.entries ?: return
        val from = before.indexOfFirst { it.entryId == entry.entryId }
        val to = from + delta
        if (from < 0 || to !in before.indices) return
        // Shown at once; if the server refuses, the list is read again.
        state.entries = before.moved(from, to)
        launchSafe {
            try {
                io { repo.moveInPlaylist(s, state.playlist.id, entry.entryId, to) }
            } catch (e: Exception) {
                state.entries = runCatching { io { repo.playlistEntries(s, state.playlist.id) } }.getOrDefault(before)
                throw e
            }
            refreshOrganised()
        }
    }

    /** Asks before deleting a playlist (the titles in it stay where they are). */
    fun confirmDeletePlaylist(state: VideoPlaylistState) {
        val s = session ?: return
        dialog = DialogSpec(
            str(R.string.playlist_delete_confirm, state.playlist.name),
            listOf(
                DialogChoice(str(R.string.playlist_cancel)) {},
                DialogChoice(str(R.string.playlist_delete_yes)) {
                    launchSafe {
                        io { repo.deletePlaylist(s, state.playlist.id) }
                        pages.removeAll { it is Page.VideoPlaylist && it.state === state }
                        refreshOrganised()
                    }
                },
            ),
        )
    }

    // ---- Library filters ---------------------------------------------------------------------------------------

    private fun loadFilterOptions(lib: LibraryState, where: List<Lib>) {
        val s = session ?: return
        launchSafe { lib.options = runCatching { io { repo.filterOptions(s, lib.section, where) } }.getOrNull() }
    }

    /** Applies other filters to a library: the list is read again from the start. */
    fun applyFilters(lib: LibraryState, filters: LibraryFilters) {
        if (filters == lib.filters) return
        lib.filters = filters
        resetLibrary(lib)
        loadMore(lib)
    }

    /** The Filters dialog: each row changes a draft; "Show results" applies it, Back throws it away. */
    fun openFilters(lib: LibraryState) {
        fun any() = str(R.string.filter_any)
        fun build(draft: LibraryFilters): DialogSpec {
            lateinit var spec: DialogSpec
            fun redraw(next: LibraryFilters) { dialog = build(next) }
            fun pick(title: String, values: List<Pair<String, () -> LibraryFilters>>, current: String): () -> Unit = {
                dialog = DialogSpec(
                    title,
                    values.map { (label, change) -> DialogChoice(label, selected = label == current, closes = false) { dialog = build(change()) } },
                    parent = spec,
                )
            }
            val genres = lib.options?.genres
            val ages = lib.options?.ageRatings
            val choices = listOf(
                DialogChoice(
                    str(
                        when (draft.watched) {
                            WatchedFilter.All -> R.string.filter_watched_all
                            WatchedFilter.Unwatched -> R.string.filter_watched_unwatched
                            WatchedFilter.Watched -> R.string.filter_watched_watched
                        },
                    ),
                    closes = false,
                ) { redraw(draft.copy(watched = WatchedFilter.entries[(draft.watched.ordinal + 1) % WatchedFilter.entries.size])) },
                DialogChoice(str(if (draft.favoritesOnly) R.string.filter_favorites_on else R.string.filter_favorites_off), closes = false) {
                    redraw(draft.copy(favoritesOnly = !draft.favoritesOnly))
                },
                DialogChoice(str(R.string.filter_genre, draft.genre ?: any()), closes = false) {
                    if (genres == null) notice = str(R.string.filters_loading)
                    else pick(
                        str(R.string.filter_genre_title),
                        listOf(any() to { draft.copy(genre = null) }) + genres.map { g -> g to { draft.copy(genre = g) } },
                        draft.genre ?: any(),
                    )()
                },
                DialogChoice(str(R.string.filter_decade, draft.decade?.let { "${it}s" } ?: any()), closes = false) {
                    pick(
                        str(R.string.filter_decade_title),
                        listOf(any() to { draft.copy(decade = null) }) + LibraryFilters.DECADES.map { d -> "${d}s" to { draft.copy(decade = d) } },
                        draft.decade?.let { "${it}s" } ?: any(),
                    )()
                },
                DialogChoice(str(R.string.filter_rating, draft.minRating?.let { str(R.string.filter_rating_value, it) } ?: any()), closes = false) {
                    pick(
                        str(R.string.filter_rating_title),
                        listOf(any() to { draft.copy(minRating = null) }) + LibraryFilters.MIN_RATINGS.map { r -> str(R.string.filter_rating_value, r) to { draft.copy(minRating = r) } },
                        draft.minRating?.let { str(R.string.filter_rating_value, it) } ?: any(),
                    )()
                },
                DialogChoice(str(R.string.filter_age, draft.ageRating ?: any()), closes = false) {
                    if (ages == null) notice = str(R.string.filters_loading)
                    else pick(
                        str(R.string.filter_age_title),
                        listOf(any() to { draft.copy(ageRating = null) }) + ages.map { a -> a to { draft.copy(ageRating = a) } },
                        draft.ageRating ?: any(),
                    )()
                },
                DialogChoice(str(if (draft.only4k) R.string.filter_4k_on else R.string.filter_4k_off), closes = false) { redraw(draft.copy(only4k = !draft.only4k)) },
                DialogChoice(str(R.string.filters_clear), closes = false) { redraw(LibraryFilters()) },
                DialogChoice(str(R.string.filters_apply)) { applyFilters(lib, draft) },
            )
            spec = DialogSpec(str(R.string.filters_title), choices)
            return spec
        }
        dialog = build(lib.filters)
    }

    // ---- Title pages ------------------------------------------------------------------------------------------

    fun open(item: MediaItem) {
        val s = session ?: return
        val state = DetailState(item)
        pages.add(if (item.kind == BaseItemKind.BOX_SET) Page.Collection(state) else Page.Detail(state))
        launchSafe {
            runCatching { io { repo.details(s, item.id) } }.getOrNull()?.let { state.full = it }
            // A movie of a collection links to it. Only a library with collections is worth asking.
            val tmdb = state.full.tmdbCollection
            if (item.kind == BaseItemKind.MOVIE && hasCollections && tmdb != null) {
                state.collection = runCatching { io { repo.collectionOf(s, tmdb) } }.getOrNull()
            }
        }
        when (item.kind) {
            BaseItemKind.SERIES -> launchSafe {
                state.nextEpisode = runCatching { io { repo.episodeToPlay(s, item.id) } }.getOrNull()
                val seasons = runCatching { io { repo.seasons(s, item.id) } }.getOrDefault(emptyList())
                state.seasons = seasons
                // Open on the season of the next episode, else the first one.
                val start = seasons.firstOrNull { it.id == state.nextEpisode?.seasonId } ?: seasons.firstOrNull()
                if (start != null) selectSeason(state, start) else state.episodes = emptyList()
            }
            BaseItemKind.BOX_SET -> launchSafe {
                state.members = runCatching { io { repo.collectionItems(s, item.id) } }.getOrDefault(emptyList())
            }
            else -> Unit
        }
    }

    /** Opens a title by its id (a series from an upcoming episode, a rewatched title from the stats). */
    fun openById(id: UUID) {
        val s = session ?: return
        launchSafe { runCatching { io { repo.details(s, id) } }.getOrNull()?.let { open(it) } }
    }

    /** The viewing stats, read when the page opens. */
    fun openStats() {
        val s = session ?: return
        val state = StatsState()
        pages.add(Page.Stats(state))
        launchSafe {
            runCatching { io { repo.watchStats(s) } }
                .onSuccess { state.stats = it }
                .onFailure { state.failed = true }
        }
        launchSafe { state.history = runCatching { io { repo.playHistory(s) } }.getOrNull() }
    }

    /** The seek-bar pictures of what is playing, or null when the server has none. */
    suspend fun trickplay(plan: PlaybackPlan): TrickplayPictures? {
        val s = session ?: return null
        return io { repo.trickplay(s, plan.item.id, plan.mediaSourceId) }
    }

    fun openPerson(person: CastMember) {
        val s = session ?: return
        val state = PersonState(person)
        pages.add(Page.Person(state))
        launchSafe { state.items = runCatching { io { repo.personItems(s, person.id) } }.getOrDefault(emptyList()) }
    }

    fun selectSeason(state: DetailState, season: MediaItem) {
        val s = session ?: return
        state.selectedSeason = season
        state.episodes = null
        launchSafe {
            state.episodes = runCatching { io { repo.episodes(s, state.item.id, season.id) } }.getOrDefault(emptyList())
        }
    }

    fun toggleWatched(state: DetailState) {
        val s = session ?: return
        val item = state.full
        val played = !item.played
        state.full = item.copy(played = played, progress = null, resumeMs = 0)
        launchSafe { runCatching { io { repo.setPlayed(s, item.id, played) } } }
    }

    fun toggleFavorite(state: DetailState) {
        val s = session ?: return
        val item = state.full
        val favorite = !item.favorite
        state.full = item.copy(favorite = favorite)
        launchSafe { runCatching { io { repo.setFavorite(s, item.id, favorite) } } }
    }

    // ---- Playback ---------------------------------------------------------------------------------------------

    /** Plays [first] and then the titles after it in [items] (a collection): when one ends the next starts. */
    fun playThrough(items: List<MediaItem>, first: MediaItem) {
        playContext = playThroughFrom(items, first)
        play(first)
    }

    /** A music video played on its own goes on with the other videos of its folder, like the web app's. */
    private fun queueFolderOf(s: Session, video: MediaItem) {
        val folder = video.parentId ?: return
        launchSafe {
            val siblings = runCatching { io { repo.folderVideos(s, folder) } }.getOrNull() ?: return@launchSafe
            val rest = playThroughFrom(siblings, video) ?: return@launchSafe
            if (playContext == null) playContext = rest
        }
    }

    /** Plays [item] from [startMs] (default: where it was left); a series plays its next episode. */
    fun play(item: MediaItem, startMs: Long = item.resumeMs, mediaSourceId: String? = null) {
        val s = session ?: return
        if (busy) return
        if (playContext?.any { it.id == item.id } != true) playContext = null
        busy = true
        errorText = null
        errorRes = null
        launchSafe {
            try {
                val target = if (item.kind == BaseItemKind.SERIES) io { repo.episodeToPlay(s, item.id) } else item
                if (target == null) {
                    errorRes = R.string.error_nothing_to_play
                } else {
                    val resume = if (target === item) startMs else target.resumeMs
                    val plan = io { repo.plan(s, target, null, null, resume, mediaSourceId = mediaSourceId.takeIf { target === item }, limits = settings.limits) }
                    val top = pages.lastIndex
                    if (top >= 0 && pages[top] is Page.Player) pages[top] = Page.Player(plan) else pages.add(Page.Player(plan))
                    if (target.kind == BaseItemKind.MUSIC_VIDEO && playContext == null) queueFolderOf(s, target)
                }
            } catch (e: DirectOnlyException) {
                errorRes = R.string.error_direct_only
            } catch (e: Exception) {
                fail(e)
                // Say what could not be played: a channel that is off the air is not a failure of the app.
                if (errorRes == R.string.error_generic) errorRes = if (item.isChannel) R.string.error_channel else R.string.error_play
            } finally {
                busy = false
            }
        }
    }

    /** Plays the next episode of the one that just ended, replacing the player; leaves the player when there is none. */
    fun playNext(plan: PlaybackPlan) {
        val s = session ?: return
        launchSafe {
            val next = nextInPlaylist(plan.item) ?: if (playContext != null) null else runCatching { io { repo.episodeAfter(s, plan.item) } }.getOrNull()
            if (next == null) {
                back()
                return@launchSafe
            }
            try {
                val top = pages.lastIndex
                val nextPlan = io { repo.plan(s, next, null, null, 0, limits = settings.limits) }
                if (top >= 0 && pages[top] is Page.Player) pages[top] = Page.Player(nextPlan)
            } catch (e: DirectOnlyException) {
                errorRes = R.string.error_direct_only
                back()
            } catch (e: Exception) {
                fail(e)
                back()
            }
        }
    }

    /**
     * "Search online…" in the player's subtitle menu: choose a language, then one of what the server's subtitle plugin found. The chosen one
     * is saved on the server, next to the video, and switched on; the video carries on from [positionMs].
     */
    fun searchSubtitles(plan: PlaybackPlan, positionMs: Long) {
        val first = defaultSearchLanguage(plan.subtitleLanguage, java.util.Locale.getDefault().language)
        var languages: DialogSpec? = null
        languages = DialogSpec(
            str(R.string.subtitles_search_language),
            SUBTITLE_SEARCH_LANGUAGES.map { (code, name) -> DialogChoice(name, selected = code == first) { findSubtitles(plan, code, positionMs, languages) } },
        )
        showDialog(languages)
    }

    private fun findSubtitles(plan: PlaybackPlan, language: String, positionMs: Long, back: DialogSpec?) {
        val s = session ?: return
        busy = true
        launchSafe {
            try {
                val found = io { repo.searchSubtitles(s, plan.item.id, language) }
                if (found.isEmpty()) {
                    notice = str(R.string.subtitles_none)
                } else {
                    showDialog(
                        DialogSpec(
                            str(R.string.subtitles_results),
                            found.take(40).map { sub -> DialogChoice(subtitleLabel(sub)) { saveSubtitle(plan, sub, positionMs) } },
                            parent = back,
                        ),
                    )
                }
            } catch (e: Exception) {
                notice = subtitleProblem(e)
            } finally {
                busy = false
            }
        }
    }

    /** One line for a subtitle found: a match of the file is starred, then its name, where it comes from and how often it was taken. */
    private fun subtitleLabel(sub: RemoteSubtitle): String =
        listOfNotNull(
            if (sub.exactMatch) "★" else null,
            sub.name.ifBlank { sub.language },
            sub.provider.ifBlank { null },
            sub.downloads?.let { "↓$it" },
            if (sub.machineTranslated) str(R.string.subtitles_machine) else null,
        ).joinToString(" · ")

    private fun saveSubtitle(plan: PlaybackPlan, sub: RemoteSubtitle, positionMs: Long) {
        val s = session ?: return
        busy = true
        launchSafe {
            try {
                io { repo.saveSubtitle(s, plan.item.id, sub.id) }
                // Ask again: the server lists the saved file as one more track of the video, which is then switched on.
                val before = plan.subtitleTracks.map { it.index }
                val refreshed = io { repo.plan(s, plan.item, plan.audioIndex, plan.subtitleIndex, positionMs, plan.directAllowed, plan.mediaSourceId, settings.limits) }
                val added = newSubtitleIndex(before, refreshed.subtitleTracks.map { it.index })
                val next = if (added == null) refreshed else io { repo.plan(s, plan.item, plan.audioIndex, added, positionMs, plan.directAllowed, plan.mediaSourceId, settings.limits) }
                val top = pages.lastIndex
                if (top >= 0 && pages[top] is Page.Player) pages[top] = Page.Player(next)
                notice = str(R.string.subtitles_saved)
            } catch (e: Exception) {
                notice = subtitleProblem(e)
            } finally {
                busy = false
            }
        }
    }

    private fun subtitleProblem(e: Exception): String = when ((e as? org.jellyfin.sdk.api.client.exception.InvalidStatusException)?.status) {
        403 -> str(R.string.subtitles_forbidden)
        404 -> str(R.string.subtitles_no_plugin)
        else -> str(R.string.subtitles_unreachable)
    }

    /** Swaps the playing stream for one with other audio or subtitles, continuing from [positionMs]. */
    fun changeTracks(plan: PlaybackPlan, audio: Int?, subtitle: Int?, positionMs: Long, directAllowed: Boolean = plan.directAllowed) {
        val s = session ?: return
        // The player gave up on the file as it is, and Settings does not let the server convert it: say so instead of looping.
        if (!directAllowed && settings.directOnly) {
            errorRes = R.string.error_direct_only
            back()
            return
        }
        launchSafe {
            try {
                val next = io {
                    repo.plan(
                        s, plan.item, audio ?: plan.audioIndex, subtitle ?: plan.subtitleIndex ?: -1, positionMs, directAllowed,
                        mediaSourceId = plan.mediaSourceId, limits = settings.limits,
                    )
                }
                val top = pages.lastIndex
                if (top >= 0 && pages[top] is Page.Player) pages[top] = Page.Player(next)
            } catch (e: DirectOnlyException) {
                errorRes = R.string.error_direct_only
                back()
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    /** The chapters of what is playing. */
    suspend fun chapters(item: MediaItem): List<Chapter> {
        val s = session ?: return emptyList()
        return io { repo.chapters(s, item.id) }
    }

    /** Intro, recap and credits of what is playing. */
    suspend fun segments(item: MediaItem): List<Segment> {
        val s = session ?: return emptyList()
        return io { repo.segments(s, item.id) }
    }

    fun reportStart(plan: PlaybackPlan, positionMs: Long) {
        val s = session ?: return
        launchSafe { io { repo.reportStart(s, plan, positionMs) } }
    }

    fun reportProgress(plan: PlaybackPlan, positionMs: Long, paused: Boolean) {
        val s = session ?: return
        launchSafe { io { repo.reportProgress(s, plan, positionMs, paused) } }
    }

    fun reportStopped(plan: PlaybackPlan, positionMs: Long) {
        val s = session ?: return
        launchSafe {
            io { repo.reportStopped(s, plan, positionMs) }
            refreshContinue()
        }
    }

    // ---- Back -------------------------------------------------------------------------------------------------

    /** Closes the top page or returns to Home; false when there is nothing left and the system may leave the app. */
    fun back(): Boolean {
        if (pages.isNotEmpty()) {
            pages.removeAt(pages.lastIndex)
            if (pages.isEmpty()) restoreTarget = lastFocused
            return true
        }
        if (tab != Tab.Home) {
            tab = Tab.Home
            return true
        }
        return false
    }

    /** Says what went wrong in words a person can act on, not as an exception's text. */
    private fun fail(e: Exception, fallback: Int = R.string.error_generic) {
        if (e is CancellationException) throw e
        android.util.Log.w("AppViewModel", "A request failed: ${e.javaClass.simpleName}: ${e.message}")
        errorText = null
        val unauthorized = e is InvalidStatusException && e.status == 401
        errorRes = when {
            // A token the server no longer knows: go back to the sign-in screen instead of failing on every request.
            unauthorized && session != null -> {
                signOut()
                R.string.error_session_expired
            }
            unauthorized -> fallback
            e is InvalidStatusException -> fallback
            e is IOException || e is ApiClientException -> R.string.error_network
            else -> fallback
        }
    }

    fun dismissError() {
        errorRes = null
        errorText = null
    }
}
