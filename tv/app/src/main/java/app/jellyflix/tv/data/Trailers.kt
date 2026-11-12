package app.jellyflix.tv.data

import android.content.Intent
import android.net.Uri

/** Trailers the server lists by address: only YouTube ones are used, and only through the YouTube app. */
object Trailers {
    private val hosts = setOf("youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be")
    private val videoId = Regex("^[A-Za-z0-9_-]{6,20}$")

    /** The `https://www.youtube.com/watch?v=…` address of a trailer, or null when it is not a YouTube video (never any other address). */
    fun youtubeWatchUrl(raw: String?): String? {
        val uri = runCatching { Uri.parse(raw ?: return null) }.getOrNull() ?: return null
        if (uri.scheme != "https" || uri.host?.lowercase() !in hosts) return null
        val id = if (uri.host.equals("youtu.be", true)) uri.lastPathSegment else uri.getQueryParameter("v")
        return id?.takeIf { videoId.matches(it) }?.let { "https://www.youtube.com/watch?v=$it" }
    }

    fun youtubeIntent(url: String): Intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage("com.google.android.youtube.tv")
}
