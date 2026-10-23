package app.jellyflix.tv.data

import kotlin.random.Random

/** Pure helpers that decide what the Home banner shows. Same rules as the web client's `home.ts` and `library.ts`. */

/** Round-robin merge: the first of each list, then the second of each... */
fun <T> interleave(lists: List<List<T>>): List<T> {
    val merged = ArrayList<T>()
    val longest = lists.maxOfOrNull { it.size } ?: 0
    for (i in 0 until longest) for (list in lists) if (i < list.size) merged.add(list[i])
    return merged
}

/** Same title, different file: libraries often hold a movie twice. */
fun titleKey(item: MediaItem): String =
    item.name.lowercase().filter { it.isLetterOrDigit() } + "|" + (item.year ?: "")

/**
 * The titles for the banner: the newest one or two (so what you just added is seen), then random picks from the whole
 * library. Copies of the same title are shown once and every title needs a backdrop.
 */
fun buildLineup(
    recent: List<MediaItem>,
    pool: List<MediaItem>,
    count: Int = 8,
    newest: Int = 2,
    random: Random = Random,
): List<MediaItem> {
    val seen = HashSet<String>()
    val lineup = ArrayList<MediaItem>()
    fun add(item: MediaItem) {
        val key = titleKey(item)
        if (lineup.size >= count || key in seen || item.backdropUrl == null) return
        seen.add(key)
        lineup.add(item)
    }
    for (item in recent) if (lineup.size < newest) add(item)
    for (item in pool.shuffled(random)) add(item)
    for (item in recent) add(item)
    return lineup
}

/** The Home banner: movies and series taken in turns so both are seen; a kind with nothing in it gives way to the other. */
fun buildHomeLineup(
    movies: Pair<List<MediaItem>, List<MediaItem>>,
    series: Pair<List<MediaItem>, List<MediaItem>>,
    count: Int = 8,
    random: Random = Random,
): List<MediaItem> {
    val hasMovies = movies.first.size + movies.second.size > 0
    val hasSeries = series.first.size + series.second.size > 0
    val seriesShare = if (hasMovies && hasSeries) (count * 0.4).toInt() else if (hasSeries) count else 0
    val first = buildLineup(movies.first, movies.second, count - seriesShare, newest = 1, random = random)
    val second = buildLineup(series.first, series.second, seriesShare, newest = 1, random = random)
    return interleave(listOf(first, second)).take(count)
}

/** Most recently played first; titles without a date keep their order after the dated ones. */
fun newestFirst(items: List<MediaItem>): List<MediaItem> =
    items.withIndex().sortedWith(compareByDescending<IndexedValue<MediaItem>> { it.value.lastPlayedAt ?: 0L }.thenBy { it.index })
        .map { it.value }
