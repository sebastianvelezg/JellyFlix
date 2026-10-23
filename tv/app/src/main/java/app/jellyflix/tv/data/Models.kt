package app.jellyflix.tv.data

import androidx.annotation.StringRes
import app.jellyflix.tv.R
import org.jellyfin.sdk.model.api.BaseItemKind
import java.util.UUID

/** A title ready to show: everything the screens need, with no SDK types leaking out. */
data class MediaItem(
    val id: UUID,
    val title: String,
    /** The item's own name: for an episode that is the episode title, while [title] is the series. */
    val name: String,
    val subtitle: String?,
    val kind: BaseItemKind,
    val posterUrl: String?,
    val landscapeUrl: String?,
    val backdropUrl: String?,
    val overview: String?,
    val year: Int?,
    val runtimeMinutes: Int?,
    val genres: List<String>,
    val rating: Float?,
    val officialRating: String?,
    val progress: Float?,
    val resumeMs: Long,
    val played: Boolean,
    val favorite: Boolean,
    val seriesId: UUID?,
    val seasonId: UUID?,
    val episodeNumber: Int?,
    val seasonNumber: Int?,
    /** When it was last played (ms since the epoch), to order mixed lists such as "Continue watching". */
    val lastPlayedAt: Long? = null,
    /** Collections: how many titles it holds. */
    val childCount: Int? = null,
    val cast: List<CastMember> = emptyList(),
    /** The files of a title that has several (only filled in when the full title is loaded); fewer than two means no choice. */
    val versions: List<VersionOption> = emptyList(),
    /** What Play gives, per file (version id, in the file order); only filled in when the full title is loaded. */
    val playsAs: Map<String, PlaysAs> = emptyMap(),
    /** A movie: the id of the TMDb collection it belongs to, when the server knows it (only filled in when the full title is loaded). */
    val tmdbCollection: String? = null,
) {
    val isPlayable get() = kind == BaseItemKind.MOVIE || kind == BaseItemKind.EPISODE
}

/** [total] is null when the page was asked for without a count: the first page of a list says how many there are, the next ones do not. */
data class Page<T>(val items: List<T>, val total: Int?)

/** What a library list shows. */
enum class Section { Movies, Series, Anime, Collections }

data class Lib(val id: UUID, val name: String)

/** The user's libraries by kind. Anime is a TV library whose name says so ("Animation" stays under Series). */
data class Libraries(val movies: List<Lib>, val series: List<Lib>, val anime: List<Lib>, val music: List<Lib>) {
    /** Series and anime together, for rows and picks that mix them. */
    val shows: List<Lib> get() = series + anime
    val hasVideo: Boolean get() = movies.isNotEmpty() || shows.isNotEmpty()
    val isEmpty: Boolean get() = !hasVideo && music.isEmpty()
}

/** Someone credited on a title (an actor), with their picture when the server has one. */
data class CastMember(val id: UUID, val name: String, val role: String?, val imageUrl: String?)

/** A random series nobody has started, and the episode to begin with. */
data class FreshSeries(val show: MediaItem, val episode: MediaItem)

/** A stretch of a video the viewer may want to skip. */
enum class SegmentKind { Intro, Recap, Outro, Preview }

data class Segment(val kind: SegmentKind, val startMs: Long, val endMs: Long)

/** How a library can be ordered; the labels live in strings.xml. */
enum class SortOption(@StringRes val label: Int) {
    Added(R.string.sort_added),
    Name(R.string.sort_name),
    Year(R.string.sort_year),
    Rating(R.string.sort_rating),
}

/** One audio or subtitle choice in a file. */
data class Track(val index: Int, val label: String, val language: String?)

/**
 * How to play one title: where to load it and which tracks it has.
 * [transcoding] is true when the server converts the video (a stream the TV cannot play as it is).
 */
data class PlaybackPlan(
    val item: MediaItem,
    val url: String,
    val transcoding: Boolean,
    val mediaSourceId: String,
    val playSessionId: String?,
    val audioTracks: List<Track>,
    val subtitleTracks: List<Track>,
    val audioIndex: Int?,
    val subtitleIndex: Int?,
    /** A text subtitle delivered as a separate file; null when off, burned in or inside the stream. */
    val subtitleUrl: String?,
    val subtitleLanguage: String?,
    val startMs: Long,
    /** False after a direct play failed on this TV, so later plans for the same title ask for a converted stream. */
    val directAllowed: Boolean,
    /** What the server said about the stream, for the Info panel. */
    val info: StreamInfo = StreamInfo(),
)
