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

/** How many songs a day's mix holds. */
const val DAY_MIX_SIZE = 60

/**
 * One song from each list in turn, until [size] are taken or the lists run dry: no song twice, and no two songs by the same artist
 * in a row when another choice exists, so no one list or artist fills the start.
 */
fun blendSongs(lists: List<List<Song>>, size: Int): List<Song> {
    val queues = lists.map { it.toMutableList() }
    val taken = HashSet<java.util.UUID>()
    val out = ArrayList<Song>()
    var turn = 0
    while (out.size < size && queues.any { it.isNotEmpty() }) {
        val last = out.lastOrNull()
        // The list whose turn it is, unless it only has the artist just played: then the next list that has another one.
        var chosen: Pair<Int, Int>? = null
        for (step in queues.indices) {
            val list = (turn + step) % queues.size
            queues[list].removeAll { it.id in taken }
            val at = queues[list].indexOfFirst { last == null || it.artist != last.artist }
            if (at >= 0) { chosen = list to at; break }
        }
        // Only the artist just played is left: take it rather than end the mix short.
        val (list, at) = chosen ?: queues.indices.firstNotNullOfOrNull { l -> queues[l].takeIf { it.isNotEmpty() }?.let { l to 0 } } ?: break
        val song = queues[list].removeAt(at)
        taken += song.id
        out += song
        turn = (list + 1) % queues.size
    }
    return out
}

/** Where a cursor on the lyrics goes after Up (-1) or Down (+1): one line at a time, never off either end. */
fun stepLine(cursor: Int, delta: Int, lineCount: Int): Int = (cursor + delta).coerceIn(0, (lineCount - 1).coerceAtLeast(0))
