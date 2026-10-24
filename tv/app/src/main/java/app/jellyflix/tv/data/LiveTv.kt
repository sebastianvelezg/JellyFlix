package app.jellyflix.tv.data

import java.util.UUID

/** A programme on a channel. [startMs] and [endMs] are milliseconds since the epoch. */
data class TvProgram(
    val id: UUID,
    val channelId: UUID,
    val title: String,
    val episodeTitle: String?,
    val overview: String?,
    val startMs: Long,
    val endMs: Long,
) {
    fun isOn(nowMs: Long): Boolean = nowMs in startMs until endMs

    /** How far through it is at [nowMs], 0 to 1. */
    fun progressAt(nowMs: Long): Float = ((nowMs - startMs).toFloat() / (endMs - startMs).coerceAtLeast(1)).coerceIn(0f, 1f)
}

/** A channel's name without what playlists put in it (their quality and notes), and those parts apart. */
data class ChannelName(val title: String, val tags: List<String>)

private val QUALITY_TAG = Regex("^(\\d{3,4}[pi]|[248]K|UHD|FHD|HD|SD)$", RegexOption.IGNORE_CASE)
private val NOTE_AT_END = Regex("\\s*\\[([^\\]]+)]\\s*$")
private val PARENTHESES_AT_END = Regex("\\s*\\(([^()]*)\\)\\s*$")

/**
 * Channel lists from the internet name their channels like "Canal 1 (Colombia) (1080p) [Not 24/7]". The name is the part that says
 * what the channel is; the quality in parentheses at the end and the notes in brackets are tags. A name that is only tags is kept whole.
 */
fun splitChannelName(raw: String): ChannelName {
    var title = raw.trim()
    val tags = ArrayList<String>()
    while (true) {
        val note = NOTE_AT_END.find(title)
        if (note != null) {
            tags.add(0, note.groupValues[1].trim())
            title = title.substring(0, note.range.first)
            continue
        }
        val quality = PARENTHESES_AT_END.find(title)
        val label = quality?.groupValues?.get(1)?.trim().orEmpty()
        if (quality != null && QUALITY_TAG.matches(label)) {
            tags.add(0, label)
            title = title.substring(0, quality.range.first)
            continue
        }
        break
    }
    title = title.trim()
    return if (title.isEmpty()) ChannelName(raw.trim(), emptyList()) else ChannelName(title, tags)
}

/** A live TV channel with what is on it now (as the server said when the list was read). */
data class TvChannel(val item: MediaItem, val number: String?, val now: TvProgram?) {
    val id: UUID get() = item.id

    /** The name apart from its quality and notes. */
    val name: ChannelName get() = splitChannelName(item.title)

    /** "12 · News": the number and the name, as the channel is called on screen. */
    val label: String get() = listOfNotNull(number?.takeIf { it.isNotBlank() }, name.title).joinToString(" · ")

    /** What is on at [nowMs]: the programme the server gave, unless it has ended since. */
    fun onAt(nowMs: Long): TvProgram? = now?.takeIf { it.isOn(nowMs) }
}

/** The programme that comes right after the one on at [nowMs] (the first one that starts later), or null. */
fun nextProgram(programs: List<TvProgram>, nowMs: Long): TvProgram? = programs.filter { it.startMs > nowMs }.minByOrNull { it.startMs }

/** The channel [step] places from [currentId] in [channels], going round at the ends; null when there is nowhere to go. */
fun neighbourChannel(channels: List<TvChannel>, currentId: UUID, step: Int): TvChannel? {
    val at = channels.indexOfFirst { it.id == currentId }
    if (channels.size < 2 || at < 0) return null
    return channels[Math.floorMod(at + step, channels.size)]
}
