package app.jellyflix.tv.data

import androidx.annotation.StringRes
import app.jellyflix.tv.R
import java.net.URLDecoder
import kotlin.math.abs
import kotlin.math.roundToInt

/** What the server told us about the stream being played, for the "Info" panel. All parts may be missing. */
data class StreamInfo(
    /** The name of the version being played (the file's name, or "4K" when versions were merged). */
    val sourceName: String? = null,
    val container: String? = null,
    val totalBitrate: Long? = null,
    val videoCodec: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val fps: Float? = null,
    val bitDepth: Int? = null,
    /** "SDR", "HDR10", "DOVIWithHDR10"... as Jellyfin spells it. */
    val range: String? = null,
    val videoBitrate: Long? = null,
    val audioCodec: String? = null,
    val channels: Int? = null,
    val audioBitrate: Long? = null,
    /** Why the server converts the stream, by Jellyfin's names ("VideoCodecNotSupported"); empty when it plays as it is. */
    val reasons: List<String> = emptyList(),
) {
    /** A conversion that only touches sound or container leaves the picture alone. */
    val videoCopied: Boolean
        get() = reasons.none { it.startsWith("Video") || it == "ContainerBitrateExceedsLimit" }
}

/**
 * What pressing Play would give, for the line on the title page: the picture, the audio it starts with and how many subtitle tracks
 * there are. [video] and [audio] are already in words; either may be missing when the server did not say.
 */
data class PlaysAs(val video: String?, val audio: String?, val subtitles: Int)

/** The name a person knows a picture size by, from its width (a letterboxed film is short but wide). */
fun resolutionLabel(width: Int?, height: Int?): String? {
    val w = width ?: 0
    val h = height ?: 0
    return when {
        w <= 0 && h <= 0 -> null
        w >= 3500 || h >= 2000 -> "4K"
        w >= 1800 || h >= 1000 -> "1080p"
        w >= 1200 || h >= 700 -> "720p"
        else -> "SD"
    }
}

/** Jellyfin's name for a colour range as a person would say it; plain SDR says nothing. */
fun rangeLabel(range: String?): String? = when {
    range.isNullOrBlank() || range == "SDR" || range == "Unknown" -> null
    range.startsWith("DOVI") -> "Dolby Vision"
    range == "HDR10Plus" -> "HDR10+"
    else -> range
}

/** "5.1" for six channels, "Stereo" for two. */
fun channelLabel(channels: Int?): String? = when (channels) {
    null, 0 -> null
    1 -> "Mono"
    2 -> "Stereo"
    6 -> "5.1"
    8 -> "7.1"
    else -> "$channels ch"
}

/** The audio a file starts with, short enough for one line: "English · EAC3 · 5.1" (the server's own title for it is a paragraph). */
fun audioSummary(language: String?, codec: String?, channels: Int?): String? =
    listOfNotNull(language?.takeIf { it.isNotBlank() }, codec?.uppercase()?.takeIf { it.isNotBlank() }, channelLabel(channels))
        .joinToString(" · ").ifBlank { null }

/** Pure: the "Plays as" facts of one file; null when nothing at all is known. */
fun playsAsOf(width: Int?, height: Int?, codec: String?, range: String?, audio: String?, subtitles: Int): PlaysAs? {
    val video = listOfNotNull(resolutionLabel(width, height), codec?.uppercase()?.takeIf { it.isNotBlank() }, rangeLabel(range))
        .joinToString(" ").ifBlank { null }
    val sound = audio?.takeIf { it.isNotBlank() }
    return if (video == null && sound == null && subtitles == 0) null else PlaysAs(video, sound, subtitles)
}

/** A stretch of a video the viewer may jump to. */
data class Chapter(val startMs: Long, val name: String)

/** One file of a title that has several (1080p and 4K, for example). [id] is what the server calls the version. */
data class VersionOption(val id: String, val label: String)

/** What is known about one of a title's files, to name it. */
data class VersionSource(
    val id: String?,
    val name: String?,
    val height: Int?,
    val codec: String?,
    val range: String?,
    val sizeBytes: Long?,
)

/**
 * The choices for a title with several files, each named by what a person would ask for ("2160p · HEVC HDR10 · 28.4 GB").
 * Fewer than two files means there is nothing to choose, so the list is empty. Two files that look the same on paper are told
 * apart by their names.
 */
fun versionOptionsOf(sources: List<VersionSource>): List<VersionOption> {
    if (sources.size < 2) return emptyList()
    val labels = sources.map { source ->
        val codec = listOfNotNull(
            source.codec?.uppercase(),
            source.range?.takeIf { it != "SDR" && it != "Unknown" },
        ).joinToString(" ").ifBlank { null }
        val size = source.sizeBytes?.let { "%.1f GB".format(java.util.Locale.US, it / 1_073_741_824.0) }
        listOfNotNull(source.height?.let { "${it}p" }, codec, size).joinToString(" · ").ifBlank { source.name.orEmpty() }
    }
    return sources.mapIndexedNotNull { i, source ->
        val id = source.id?.takeIf { it.isNotEmpty() } ?: return@mapIndexedNotNull null
        val duplicate = labels.count { it == labels[i] } > 1
        VersionOption(id, if (duplicate && !source.name.isNullOrBlank()) "${labels[i]} (${source.name})" else labels[i])
    }
}

/**
 * The reasons for a conversion, read from the stream's address (`TranscodeReasons=VideoCodecNotSupported,AudioCodecNotSupported`).
 * Empty when the address has none.
 */
fun transcodeReasons(url: String?): List<String> {
    if (url.isNullOrBlank()) return emptyList()
    val query = url.substringAfter('?', "")
    val value = query.split('&').firstOrNull { it.substringBefore('=').equals("TranscodeReasons", ignoreCase = true) }
        ?.substringAfter('=', "") ?: return emptyList()
    return runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
        .split(',')
        .map { it.trim() }
        .filter { it.isNotEmpty() }
}

/** A reason with its own sentence in the app's texts, or null (then [plainReason] is shown). */
@StringRes
fun reasonText(reason: String): Int? = when (reason) {
    "ContainerNotSupported" -> R.string.reason_container
    "VideoCodecNotSupported" -> R.string.reason_video_codec
    "AudioCodecNotSupported" -> R.string.reason_audio_codec
    "SubtitleCodecNotSupported" -> R.string.reason_subtitle
    "VideoProfileNotSupported", "VideoLevelNotSupported" -> R.string.reason_video_profile
    "VideoRangeTypeNotSupported" -> R.string.reason_video_range
    "VideoBitDepthNotSupported" -> R.string.reason_video_bit_depth
    "VideoResolutionNotSupported" -> R.string.reason_video_resolution
    "ContainerBitrateExceedsLimit", "VideoBitrateNotSupported", "AudioBitrateNotSupported" -> R.string.reason_bitrate
    "AudioChannelsNotSupported" -> R.string.reason_audio_channels
    "DirectPlayError" -> R.string.reason_direct_play_error
    else -> null
}

/** "VideoCodecNotSupported" as "Video codec not supported". */
fun plainReason(reason: String): String =
    reason.replace(Regex("(?<=[a-z])(?=[A-Z])"), " ").lowercase().replaceFirstChar { it.uppercase() }

// ---- Matching the screen's refresh rate to the video ----------------------------------------------------------------

/** One way the screen can run: its picture size and how many times a second it redraws. */
data class DisplayModeInfo(val id: Int, val width: Int, val height: Int, val refreshRate: Float)

/** How much a screen rate may differ from the video's (or a whole multiple of it) and still look even: 24 Hz for 23.976 fps is 0.1 %. */
private const val RATE_TOLERANCE = 0.005f

/** How well a mode shows a video: the nearest rate first (to a tenth of a percent), then the fewest repeats of each frame. Null: unevenly. */
private fun fitOf(mode: DisplayModeInfo, fps: Float): Pair<Int, Int>? {
    val multiple = (mode.refreshRate / fps).roundToInt()
    if (multiple < 1 || multiple > 5) return null
    val error = abs(mode.refreshRate - multiple * fps) / (multiple * fps)
    return if (error <= RATE_TOLERANCE) (error * 1000).roundToInt() to multiple else null
}

private val FIT_ORDER = compareBy<Pair<Int, Int>>({ it.first }, { it.second })

/**
 * The screen mode that shows a video of [fps] frames a second evenly: the same picture size as [current], and a rate that is
 * the video's own or a whole multiple of it (a film at 24 fps on 24, 48 or 120 Hz, but not on 60 Hz, where every other frame
 * would stay on screen longer). Null when [current] is already as good as it gets or nothing fits, so the screen is left as it is.
 */
fun bestDisplayMode(fps: Float, current: DisplayModeInfo, modes: List<DisplayModeInfo>): DisplayModeInfo? {
    if (fps < 10f || fps > 120f) return null
    val best = modes
        .filter { it.width == current.width && it.height == current.height }
        .mapNotNull { mode -> fitOf(mode, fps)?.let { mode to it } }
        .minWithOrNull { a, b -> FIT_ORDER.compare(a.second, b.second) }
        ?: return null
    val now = fitOf(current, fps)
    return best.first.takeIf { it.id != current.id && (now == null || FIT_ORDER.compare(best.second, now) < 0) }
}
