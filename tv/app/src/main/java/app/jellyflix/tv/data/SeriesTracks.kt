package app.jellyflix.tv.data

import org.json.JSONObject

/**
 * What the viewer last chose while watching one series: the language of the audio and of the subtitles, so an anime keeps its
 * Japanese sound with English subtitles from one episode to the next (the web client does the same).
 *
 * [subtitleLanguage] is null when nothing was chosen yet (the server's own default applies) and [SUBTITLES_OFF] when the viewer
 * turned the subtitles off.
 */
data class SeriesTracks(val audioLanguage: String? = null, val subtitleLanguage: String? = null) {
    val isEmpty get() = audioLanguage == null && subtitleLanguage == null
}

/** The value of [SeriesTracks.subtitleLanguage] that means "no subtitles". */
const val SUBTITLES_OFF = ""

/** The tracks to ask the server for at the start of an episode. A null leaves that choice to the server. */
data class TrackPicks(val audio: Int?, val subtitle: Int?)

/**
 * The first audio track in [language], or null when there is none or no language was remembered. Languages are compared ignoring
 * case, so "ENG" and "eng" are the same one.
 */
fun pickAudioIndex(tracks: List<Track>, language: String?): Int? {
    if (language.isNullOrBlank()) return null
    return tracks.firstOrNull { it.language.equals(language, ignoreCase = true) }?.index
}

private val forcedOrSdh = Regex("forced|sdh", RegexOption.IGNORE_CASE)
private val forced = Regex("forced", RegexOption.IGNORE_CASE)

/**
 * The subtitle to switch on for [language]: the full-dialogue track first, then an SDH one, and a "forced" track (only the foreign
 * lines) last. Null when the language has no track.
 */
fun pickSubtitleIndex(tracks: List<Track>, language: String?): Int? {
    if (language.isNullOrBlank()) return null
    val matches = tracks.filter { it.language.equals(language, ignoreCase = true) }
    val regular = matches.firstOrNull { !forcedOrSdh.containsMatchIn(it.label) }
    val notForced = matches.firstOrNull { !forced.containsMatchIn(it.label) }
    return (regular ?: notForced ?: matches.firstOrNull())?.index
}

/**
 * What to ask for at the start of an episode of a series with remembered choices. [defaultAudio] is what the server would play on
 * its own: asking for it again is not a change, so it is left as null. Subtitles the viewer turned off come back as -1 (the
 * server's number for "none"), and a language the episode has no track in leaves the server's default alone.
 */
fun rememberedPicks(
    audioTracks: List<Track>,
    subtitleTracks: List<Track>,
    defaultAudio: Int?,
    remembered: SeriesTracks,
): TrackPicks {
    val audio = pickAudioIndex(audioTracks, remembered.audioLanguage)?.takeIf { it != defaultAudio }
    val subtitle = when (remembered.subtitleLanguage) {
        null -> null
        SUBTITLES_OFF -> -1
        else -> pickSubtitleIndex(subtitleTracks, remembered.subtitleLanguage)
    }
    return TrackPicks(audio, subtitle)
}

/** How many series are remembered at most: the oldest are dropped so this never grows without bound. */
const val SERIES_TRACKS_LIMIT = 100

/** The remembered choices of every series, the most recently used last. */
fun encodeSeriesTracks(all: Map<String, SeriesTracks>): String {
    val root = JSONObject()
    for ((seriesId, tracks) in all.entries.toList().takeLast(SERIES_TRACKS_LIMIT)) {
        if (tracks.isEmpty) continue
        val entry = JSONObject()
        tracks.audioLanguage?.let { entry.put("a", it) }
        tracks.subtitleLanguage?.let { entry.put("s", it) }
        root.put(seriesId, entry)
    }
    return root.toString()
}

/** The inverse of [encodeSeriesTracks]; anything unreadable gives an empty map, never a crash. */
fun decodeSeriesTracks(text: String?): LinkedHashMap<String, SeriesTracks> {
    val out = LinkedHashMap<String, SeriesTracks>()
    if (text.isNullOrBlank()) return out
    try {
        val root = JSONObject(text)
        for (key in root.keys()) {
            val entry = root.optJSONObject(key) ?: continue
            val tracks = SeriesTracks(
                audioLanguage = if (entry.has("a")) entry.optString("a") else null,
                subtitleLanguage = if (entry.has("s")) entry.optString("s") else null,
            )
            if (!tracks.isEmpty) out[key] = tracks
        }
    } catch (_: Exception) {
        out.clear()
    }
    return out
}

/** [all] with [patch] applied to [seriesId], which then counts as the most recently used. */
fun withSeriesTracks(all: Map<String, SeriesTracks>, seriesId: String, patch: (SeriesTracks) -> SeriesTracks): LinkedHashMap<String, SeriesTracks> {
    val out = LinkedHashMap<String, SeriesTracks>()
    val previous = all[seriesId] ?: SeriesTracks()
    for ((id, tracks) in all) if (id != seriesId) out[id] = tracks
    out[seriesId] = patch(previous)
    while (out.size > SERIES_TRACKS_LIMIT) out.remove(out.keys.first())
    return out
}
