package app.jellyflix.tv.data

/**
 * The sleep timer's choices, in the order one button of the remote steps through them: off, pause in a quarter of an hour, half an
 * hour, three quarters, an hour, or after the song that is playing.
 */
enum class SleepChoice(val minutes: Int?) {
    Off(null),
    Minutes15(15),
    Minutes30(30),
    Minutes45(45),
    Minutes60(60),
    AfterSong(null),
    ;

    fun next(): SleepChoice = entries[(ordinal + 1) % entries.size]
}

/** Whole minutes left (a started minute counts) of a timer that ends at [endsAtMs]; 0 when it is over. */
fun sleepMinutesLeft(endsAtMs: Long, nowMs: Long): Int = ((endsAtMs - nowMs + 59_999) / 60_000).toInt().coerceAtLeast(0)

/** The queue after the song at [from] is put at [to]; the same list when either is outside it. */
fun <T> List<T>.moved(from: Int, to: Int): List<T> {
    if (from !in indices || to !in indices || from == to) return this
    return toMutableList().also { it.add(to, it.removeAt(from)) }
}

/** Where a cursor on the lyrics goes after Up (-1) or Down (+1): one line at a time, never off either end. */
fun stepLine(cursor: Int, delta: Int, lineCount: Int): Int = (cursor + delta).coerceIn(0, (lineCount - 1).coerceAtLeast(0))
