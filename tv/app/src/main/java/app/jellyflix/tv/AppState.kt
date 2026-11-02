package app.jellyflix.tv

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import app.jellyflix.tv.data.Album
import app.jellyflix.tv.data.Artist
import app.jellyflix.tv.data.CastMember
import app.jellyflix.tv.data.ChannelCategory
import app.jellyflix.tv.data.FilterOptions
import app.jellyflix.tv.data.FreshSeries
import app.jellyflix.tv.data.LibraryFilters
import app.jellyflix.tv.data.Lyrics
import app.jellyflix.tv.data.MediaItem
import app.jellyflix.tv.data.PlayHistory
import app.jellyflix.tv.data.PlaybackPlan
import app.jellyflix.tv.data.Playlist
import app.jellyflix.tv.data.PlaylistEntry
import app.jellyflix.tv.data.Recommendation
import app.jellyflix.tv.data.Section
import app.jellyflix.tv.data.Song
import app.jellyflix.tv.data.SortOption
import app.jellyflix.tv.data.TvChannel
import app.jellyflix.tv.data.TvProgram
import app.jellyflix.tv.data.UpcomingEpisode
import app.jellyflix.tv.data.VideoPlaylist
import app.jellyflix.tv.data.WatchedStats
import java.util.UUID

// What the screens show and remember (the lists, their paging and scroll, the pages open): the plain holders of state that
// [AppViewModel] fills in. Kept apart so that file is about what the app does, not about what it keeps.

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
    var category by mutableStateOf(ChannelCategory.All)
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
