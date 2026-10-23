package app.jellyflix.tv.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.jellyfin.sdk.model.api.BaseItemKind
import java.io.File
import java.util.UUID

/** What the main page showed last time, so it can be drawn at once next time while the server answers. */
data class HomeSnapshot(
    val libs: Libraries,
    val lineup: List<MediaItem>,
    val continueRow: List<MediaItem>,
    val nextUp: List<MediaItem>,
    val newMovies: List<MediaItem>,
    val newSeries: List<MediaItem>,
    val newAnime: List<MediaItem>,
    val collections: List<MediaItem>,
    val newMusicVideos: List<MediaItem> = emptyList(),
)

/**
 * A small file in the app's private storage. It holds titles and picture addresses only (no token, no password), belongs to one
 * user on one server, and is deleted when that user signs out. A file that cannot be read is simply ignored.
 */
object HomeCache {
    private const val FILE = "home-cache.json"
    private const val VERSION = 1

    fun load(context: Context, session: Session): HomeSnapshot? = runCatching {
        val file = File(context.filesDir, FILE)
        if (!file.exists()) return null
        val root = JSONObject(file.readText())
        if (root.optInt("version") != VERSION || root.optString("user") != session.userId || root.optString("server") != session.serverUrl) {
            return null
        }
        HomeSnapshot(
            libs = libraries(root.getJSONObject("libs")),
            lineup = items(root.getJSONArray("lineup")),
            continueRow = items(root.getJSONArray("continue")),
            nextUp = items(root.getJSONArray("nextUp")),
            newMovies = items(root.getJSONArray("newMovies")),
            newSeries = items(root.getJSONArray("newSeries")),
            newAnime = items(root.getJSONArray("newAnime")),
            collections = items(root.getJSONArray("collections")),
            // A copy saved before music videos existed has no such list.
            newMusicVideos = root.optJSONArray("newMusicVideos")?.let(::items).orEmpty(),
        )
    }.getOrNull()

    fun save(context: Context, session: Session, snapshot: HomeSnapshot) {
        runCatching {
            val root = JSONObject()
                .put("version", VERSION)
                .put("user", session.userId)
                .put("server", session.serverUrl)
                .put("libs", JSONObject()
                    .put("movies", libs(snapshot.libs.movies))
                    .put("series", libs(snapshot.libs.series))
                    .put("anime", libs(snapshot.libs.anime))
                    .put("music", libs(snapshot.libs.music))
                    .put("musicVideos", libs(snapshot.libs.musicVideos)))
                .put("lineup", items(snapshot.lineup))
                .put("continue", items(snapshot.continueRow))
                .put("nextUp", items(snapshot.nextUp))
                .put("newMovies", items(snapshot.newMovies))
                .put("newSeries", items(snapshot.newSeries))
                .put("newAnime", items(snapshot.newAnime))
                .put("collections", items(snapshot.collections))
                .put("newMusicVideos", items(snapshot.newMusicVideos))
            // Write beside the old file and rename, so a power cut cannot leave half a file behind.
            val target = File(context.filesDir, FILE)
            val temp = File(context.filesDir, "$FILE.tmp")
            temp.writeText(root.toString())
            if (!temp.renameTo(target)) {
                target.delete()
                temp.renameTo(target)
            }
        }
    }

    fun clear(context: Context) {
        File(context.filesDir, FILE).delete()
    }

    private fun libs(list: List<Lib>) = JSONArray().also { array ->
        list.forEach { array.put(JSONObject().put("id", it.id.toString()).put("name", it.name)) }
    }

    private fun libraries(json: JSONObject): Libraries {
        fun read(key: String) = (json.optJSONArray(key) ?: JSONArray()).let { a ->
            List(a.length()) { Lib(UUID.fromString(a.getJSONObject(it).getString("id")), a.getJSONObject(it).getString("name")) }
        }
        return Libraries(read("movies"), read("series"), read("anime"), read("music"), read("musicVideos"))
    }

    private fun items(list: List<MediaItem>) = JSONArray().also { array -> list.forEach { array.put(item(it)) } }

    private fun items(array: JSONArray): List<MediaItem> = List(array.length()) { item(array.getJSONObject(it)) }

    private fun item(m: MediaItem) = JSONObject()
        .put("id", m.id.toString())
        .put("title", m.title)
        .put("name", m.name)
        .put("subtitle", m.subtitle ?: JSONObject.NULL)
        .put("kind", m.kind.name)
        .put("poster", m.posterUrl ?: JSONObject.NULL)
        .put("landscape", m.landscapeUrl ?: JSONObject.NULL)
        .put("backdrop", m.backdropUrl ?: JSONObject.NULL)
        .put("overview", m.overview ?: JSONObject.NULL)
        .put("year", m.year ?: JSONObject.NULL)
        .put("runtime", m.runtimeMinutes ?: JSONObject.NULL)
        .put("genres", JSONArray(m.genres))
        .put("rating", m.rating?.toDouble() ?: JSONObject.NULL)
        .put("officialRating", m.officialRating ?: JSONObject.NULL)
        .put("progress", m.progress?.toDouble() ?: JSONObject.NULL)
        .put("resumeMs", m.resumeMs)
        .put("played", m.played)
        .put("favorite", m.favorite)
        .put("seriesId", m.seriesId?.toString() ?: JSONObject.NULL)
        .put("seasonId", m.seasonId?.toString() ?: JSONObject.NULL)
        .put("episode", m.episodeNumber ?: JSONObject.NULL)
        .put("season", m.seasonNumber ?: JSONObject.NULL)
        .put("lastPlayed", m.lastPlayedAt ?: JSONObject.NULL)
        .put("childCount", m.childCount ?: JSONObject.NULL)
        .put("artist", m.artist ?: JSONObject.NULL)

    private fun JSONObject.text(key: String): String? = if (isNull(key)) null else getString(key)
    private fun JSONObject.number(key: String): Int? = if (isNull(key)) null else getInt(key)

    private fun item(j: JSONObject) = MediaItem(
        id = UUID.fromString(j.getString("id")),
        title = j.getString("title"),
        name = j.getString("name"),
        subtitle = j.text("subtitle"),
        kind = BaseItemKind.valueOf(j.getString("kind")),
        posterUrl = j.text("poster"),
        landscapeUrl = j.text("landscape"),
        backdropUrl = j.text("backdrop"),
        overview = j.text("overview"),
        year = j.number("year"),
        runtimeMinutes = j.number("runtime"),
        genres = j.getJSONArray("genres").let { a -> List(a.length()) { a.getString(it) } },
        rating = if (j.isNull("rating")) null else j.getDouble("rating").toFloat(),
        officialRating = j.text("officialRating"),
        progress = if (j.isNull("progress")) null else j.getDouble("progress").toFloat(),
        resumeMs = j.getLong("resumeMs"),
        played = j.getBoolean("played"),
        favorite = j.getBoolean("favorite"),
        seriesId = j.text("seriesId")?.let(UUID::fromString),
        seasonId = j.text("seasonId")?.let(UUID::fromString),
        episodeNumber = j.number("episode"),
        seasonNumber = j.number("season"),
        lastPlayedAt = if (j.isNull("lastPlayed")) null else j.getLong("lastPlayed"),
        childCount = j.number("childCount"),
        artist = if (j.has("artist")) j.text("artist") else null,
    )
}
