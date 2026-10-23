package app.jellyflix.tv.data

import java.util.UUID

/** A playlist of movies and episodes (the ones of songs are [Playlist]). It lives on the server, so it follows the user to every device. */
data class VideoPlaylist(val id: UUID, val name: String, val imageUrl: String?, val itemCount: Int?)

/** One place in a playlist. The same title can be there twice, so each place has its own id. */
data class PlaylistEntry(val entryId: String, val item: MediaItem)

/** The playlist that "Watch later" means. It is recognised by name, in either language of the app (the web client does the same). */
val WATCH_LATER_NAMES = listOf("Watch later", "Ver más tarde")

fun isWatchLater(name: String): Boolean = WATCH_LATER_NAMES.any { it.equals(name.trim(), ignoreCase = true) }

fun findWatchLater(playlists: List<VideoPlaylist>): VideoPlaylist? = playlists.firstOrNull { isWatchLater(it.name) }

/** A name for a new playlist that nobody typed: "New playlist", then "New playlist 2" and so on, skipping the ones that exist. */
fun newPlaylistName(existing: List<String>, base: String): String {
    val taken = existing.map { it.trim().lowercase() }.toSet()
    if (base.lowercase() !in taken) return base
    var n = 2
    while ("$base $n".lowercase() in taken) n += 1
    return "$base $n"
}

/** What happened when a title was put in Watch later. */
enum class WatchLaterResult { Added, Created, AlreadyThere }

/** Whether a list shows what was watched, what was not, or both. */
enum class WatchedFilter { All, Unwatched, Watched }

/**
 * What a library list is narrowed by. The choices are made from lists on the TV (nothing is typed): watched state, favourites,
 * a genre, a decade, a lowest community rating, an age rating and 4K.
 */
data class LibraryFilters(
    val watched: WatchedFilter = WatchedFilter.All,
    val favoritesOnly: Boolean = false,
    val genre: String? = null,
    /** The first year of a decade: 1990 is the nineties. */
    val decade: Int? = null,
    /** Community ratings below this are left out (5, 6, 7 or 8). */
    val minRating: Int? = null,
    val ageRating: String? = null,
    val only4k: Boolean = false,
) {
    /** How many choices are on: shown on the Filters button. */
    val count: Int
        get() = listOf(
            watched != WatchedFilter.All,
            favoritesOnly,
            genre != null,
            decade != null,
            minRating != null,
            ageRating != null,
            only4k,
        ).count { it }

    val isActive: Boolean get() = count > 0

    /** The years the server is asked about for the chosen decade. */
    val years: List<Int>? get() = decade?.let { (it..it + 9).toList() }

    companion object {
        /** The decades offered, newest first. */
        val DECADES: List<Int> = (2020 downTo 1950 step 10).toList()
        val MIN_RATINGS: List<Int> = listOf(5, 6, 7, 8)
    }
}

/** What the server offers to filter a library by: the genres and age ratings that titles in it have. */
data class FilterOptions(val genres: List<String>, val ageRatings: List<String>)
