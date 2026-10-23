package app.jellyflix.tv

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.WatchNextProgram
import app.jellyflix.tv.data.MediaItem
import org.jellyfin.sdk.model.api.BaseItemKind
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID

private const val TAG = "WatchNext"

/**
 * The "Continue watching" row of the Google TV home screen, kept in step with the app's own: what is half watched, and the next
 * episode of each series being followed. Choosing a card opens the app and plays it (see `jellyflix://play/<id>`).
 * It only writes to Android's local database of the TV; nothing is sent anywhere.
 */
object WatchNext {
    fun link(id: UUID): Uri = Uri.parse("jellyflix://play/$id")

    /** Replaces the row with [resuming] (half watched) followed by [upNext] (next episodes). Call from a background thread. */
    fun sync(context: Context, resuming: List<MediaItem>, upNext: List<MediaItem>) {
        runCatching {
            val resolver = context.contentResolver
            resolver.delete(TvContractCompat.WatchNextPrograms.CONTENT_URI, null, null)
            val keep = HashSet<String>()
            var rank = 0L
            fun add(item: MediaItem, kind: Int) {
                val art = saveArt(context, item.landscapeUrl ?: item.backdropUrl ?: item.posterUrl)?.also { keep.add(it.name) }
                val episode = item.kind == BaseItemKind.EPISODE
                val builder = WatchNextProgram.Builder()
                    .setType(
                        if (episode) TvContractCompat.WatchNextPrograms.TYPE_TV_EPISODE else TvContractCompat.WatchNextPrograms.TYPE_MOVIE,
                    )
                    .setWatchNextType(kind)
                    // Newest first: the launcher orders the row by this time.
                    .setLastEngagementTimeUtcMillis((item.lastPlayedAt ?: System.currentTimeMillis()) - rank++)
                    .setTitle(item.title)
                    .setDescription(item.overview ?: "")
                    .setPosterArtAspectRatio(TvContractCompat.WatchNextPrograms.ASPECT_RATIO_16_9)
                    .setIntentUri(link(item.id))
                    .setInternalProviderId(item.id.toString())
                item.runtimeMinutes?.let { builder.setDurationMillis(it * 60_000) }
                if (kind == TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE && item.resumeMs > 0) {
                    builder.setLastPlaybackPositionMillis(item.resumeMs.toInt())
                }
                if (episode) {
                    item.seasonNumber?.let { builder.setSeasonNumber(it) }
                    item.episodeNumber?.let { builder.setEpisodeNumber(it) }
                    builder.setEpisodeTitle(item.name)
                }
                art?.let { builder.setPosterArtUri(WatchNextArt.uriFor(it)) }
                resolver.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, builder.build().toContentValues())
            }
            resuming.forEach { add(it, TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE) }
            upNext.forEach { add(it, TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_NEXT) }
            val stored = resolver.query(TvContractCompat.WatchNextPrograms.CONTENT_URI, arrayOf(TvContractCompat.WatchNextPrograms._ID), null, null, null)?.use { it.count }
            Log.i(TAG, "Home screen row: ${resuming.size + upNext.size} offered, $stored stored")
            // Pictures of what has left the row are no longer needed.
            WatchNextArt.folder(context).listFiles()?.filter { it.name !in keep }?.forEach { it.delete() }
        }.onFailure { Log.w(TAG, "Could not update the home screen row", it) }
    }

    /** Empties the row (when signing out). */
    fun clear(context: Context) {
        runCatching {
            context.contentResolver.delete(TvContractCompat.WatchNextPrograms.CONTENT_URI, null, null)
            WatchNextArt.folder(context).listFiles()?.forEach { it.delete() }
        }
    }

    /** Saves a picture into the folder [WatchNextArt] serves and returns it; null when it cannot be read. */
    private fun saveArt(context: Context, url: String?): File? {
        if (url == null) return null
        val name = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) } + ".jpg"
        val file = File(WatchNextArt.folder(context), name)
        if (file.isFile && file.length() > 0) return file
        return runCatching {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 5_000
            connection.readTimeout = 8_000
            connection.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
            file.takeIf { it.length() > 0 }
        }.getOrNull()
    }
}
