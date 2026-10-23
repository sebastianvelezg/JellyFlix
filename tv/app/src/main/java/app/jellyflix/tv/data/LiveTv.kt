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

/** A live TV channel with what is on it now (as the server said when the list was read). */
data class TvChannel(val item: MediaItem, val number: String?, val now: TvProgram?) {
    val id: UUID get() = item.id

    /** "12 · News": the number and the name, as the channel is called on screen. */
    val label: String get() = listOfNotNull(number?.takeIf { it.isNotBlank() }, item.title).joinToString(" · ")

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
