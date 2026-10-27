package app.jellyflix.tv.data

/**
 * Subtitles from the internet, through the server's subtitle plugin (Open Subtitles and the like). The plugin does the searching and the
 * downloading; the server saves the file next to the video and from then on lists it as one more track of that video. Searching and
 * saving need an account that may manage subtitles. The same rules as the web app's (`core/subtitleSearch.ts`).
 */
data class RemoteSubtitle(
    val id: String,
    val name: String,
    val provider: String,
    /** Three-letter code, like the tracks of a video use. */
    val language: String,
    val format: String,
    val downloads: Int?,
    val rating: Float?,
    /** The plugin matched the video file itself (same release), so the timing is very likely right. */
    val exactMatch: Boolean,
    val machineTranslated: Boolean,
)

/** The languages offered when searching (the server's own three-letter codes) and their names, in the order they are listed. */
val SUBTITLE_SEARCH_LANGUAGES: List<Pair<String, String>> = listOf(
    "eng" to "English",
    "spa" to "Español",
    "por" to "Português",
    "fra" to "Français",
    "deu" to "Deutsch",
    "ita" to "Italiano",
    "nld" to "Nederlands",
    "pol" to "Polski",
    "rus" to "Русский",
    "tur" to "Türkçe",
    "ara" to "العربية",
    "hin" to "हिन्दी",
    "jpn" to "日本語",
    "kor" to "한국어",
    "zho" to "中文",
)

/** Which language to search first: the one of the subtitles chosen last, else the viewer's own ([deviceLanguage] is a two-letter code), else English. */
fun defaultSearchLanguage(remembered: String?, deviceLanguage: String): String {
    if (SUBTITLE_SEARCH_LANGUAGES.any { it.first == remembered }) return remembered!!
    return if (deviceLanguage == "es") "spa" else "eng"
}

/**
 * Best first: a match of the file itself, then the ones people rate and download most. Subtitles made by a machine come last (a human
 * version of the same language is nearly always better).
 */
fun sortRemoteSubtitles(found: List<RemoteSubtitle>): List<RemoteSubtitle> {
    fun score(s: RemoteSubtitle): Double =
        (if (s.exactMatch) 1_000_000.0 else 0.0) + (if (s.machineTranslated) -500_000.0 else 0.0) + (s.downloads ?: 0) + (s.rating ?: 0f) * 100.0
    return found.sortedByDescending { score(it) }
}

/** The first subtitle track in [after] that was not in [before]: the one a download just added. */
fun newSubtitleIndex(before: List<Int>, after: List<Int>): Int? = after.firstOrNull { it !in before }
