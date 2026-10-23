package app.jellyflix.tv.data

import java.util.UUID

/** What music scanned without tags is credited to. */
const val UNKNOWN_ARTIST = "Unknown artist"

data class Album(
    val id: UUID,
    val name: String,
    /** Album artist, as shown on a card ("Various Artists" for compilations). */
    val artist: String,
    val artistId: UUID?,
    val year: Int?,
    val coverUrl: String?,
    val trackCount: Int?,
)

data class Artist(val id: UUID, val name: String, val imageUrl: String?, val backdropUrl: String?, val overview: String?)

data class Song(
    val id: UUID,
    val name: String,
    /** All credited artists, joined ("Daft Punk, Pharrell Williams"). */
    val artist: String,
    val album: String,
    val albumId: UUID?,
    val trackNumber: Int?,
    val durationMs: Long?,
    val coverUrl: String?,
)

data class Playlist(val id: UUID, val name: String, val coverUrl: String?, val trackCount: Int?)

enum class AlbumSort(val label: Int) {
    Added(app.jellyflix.tv.R.string.sort_added),
    Name(app.jellyflix.tv.R.string.sort_name),
    Artist(app.jellyflix.tv.R.string.sort_artist),
    Year(app.jellyflix.tv.R.string.sort_year),
}

/** "(1974) - Kiss - Hotter Than Hell [24Bit-96kHz]": what a folder name looks like when the files carry no tags. */
private val FOLDER_NAME = Regex("^\\((\\d{4})\\)\\s*-\\s*(.+?)\\s+-\\s+(.+)$")

/** "Nelly - Sweatsuit": artist and album separated by a dash. */
private val ARTIST_DASH_ALBUM = Regex("^(.+?)\\s+-\\s+(.+)$")

data class CleanAlbum(val name: String, val artist: String? = null, val year: Int? = null)

/** Albums scanned from untagged files take the folder name as title; show its parts properly. */
fun cleanAlbumName(name: String): CleanAlbum {
    FOLDER_NAME.find(name)?.let { return CleanAlbum(name = it.groupValues[3], artist = it.groupValues[2], year = it.groupValues[1].toInt()) }
    ARTIST_DASH_ALBUM.find(name)?.let { return CleanAlbum(name = it.groupValues[2], artist = it.groupValues[1]) }
    return CleanAlbum(name)
}

/** A song title that still starts with its track number ("01. Got To Choose") when the file has no tags. */
fun cleanTrackName(name: String): Pair<String, Int?> {
    val m = Regex("^(\\d{1,3})\\s*[.\\-)]\\s+(\\S.*)$").find(name) ?: return name to null
    return m.groupValues[2] to m.groupValues[1].toInt()
}

/** One line of a song's lyrics; [startMs] is null when the lyrics are not timed. */
data class LyricLine(val startMs: Long?, val text: String)

/** A song's lyrics. [synced] is true when the lines have times, so the current one can be followed. */
data class Lyrics(val lines: List<LyricLine>) {
    val synced: Boolean get() = lines.isNotEmpty() && lines.all { it.startMs != null }

    /** The line being sung at [positionMs], or -1 before the first one. */
    fun currentAt(positionMs: Long): Int {
        if (!synced) return -1
        var found = -1
        for (i in lines.indices) if ((lines[i].startMs ?: Long.MAX_VALUE) <= positionMs) found = i else break
        return found
    }

    companion object {
        /**
         * Lyrics from the server's lines (times in 100-nanosecond ticks, [offsetTicks] from the lyrics file). A line without a time
         * takes the time of the one before it, so one stray header does not make timed lyrics plain; when most lines have none,
         * they are plain. Null when there is no text at all.
         */
        fun parse(raw: List<Pair<Long?, String>>, offsetTicks: Long = 0): Lyrics? {
            if (raw.none { it.second.isNotBlank() }) return null
            val timed = raw.count { it.first != null }
            if (timed == 0 || timed * 2 < raw.size) return Lyrics(raw.map { LyricLine(null, it.second) })
            var previous = 0L
            return Lyrics(raw.map { (ticks, text) ->
                val ms = maxOf(ticks?.let { (it + offsetTicks) / 10_000 } ?: previous, previous)
                previous = ms
                LyricLine(ms, text)
            })
        }
    }
}
