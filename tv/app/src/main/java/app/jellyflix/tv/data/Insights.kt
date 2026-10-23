package app.jellyflix.tv.data

import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

/**
 * What the Home says about time: what is new since you were last here, what airs soon, and what you have watched. All of it is
 * worked out here from what the server already knows (a title's date added, air date, play count and last play date); nothing is
 * sent anywhere.
 */

// ---- Visits ---------------------------------------------------------------------------------------------------------------

/** A pause longer than this ends a visit; opening the app again sooner counts as the same one. */
const val VISIT_GAP_MS = 30 * 60_000L

/** [since] is when the previous visit was last seen (none the first time); [seen] is the last time the app was opened. */
data class Visit(val since: Long?, val seen: Long)

/**
 * The visit that starts at [now], given what was stored. Coming back within [VISIT_GAP_MS] keeps the earlier "since", so what was
 * new stays new until the viewer really comes back later.
 */
fun nextVisit(storedSeen: Long?, storedSince: Long?, now: Long): Visit = when {
    storedSeen == null || storedSeen <= 0 -> Visit(null, now)
    now - storedSeen > VISIT_GAP_MS -> Visit(storedSeen, now)
    else -> Visit(storedSince?.takeIf { it > 0 }, now)
}

// ---- Coming up ------------------------------------------------------------------------------------------------------------

/** An episode that has not aired yet (or has just), with when it airs (ms since the epoch; null when the server does not say). */
data class UpcomingEpisode(val item: MediaItem, val airsAt: Long?)

/** Soonest first; the ones without a date go last. */
fun sortedUpcoming(list: List<UpcomingEpisode>): List<UpcomingEpisode> = list.sortedBy { it.airsAt ?: Long.MAX_VALUE }

// ---- Stats ----------------------------------------------------------------------------------------------------------------

/** One movie or episode that has been watched. */
data class WatchedTitle(
    val id: UUID,
    val name: String,
    val isEpisode: Boolean,
    /** The series an episode belongs to. */
    val seriesName: String?,
    val runtimeSeconds: Long,
    val playCount: Int,
    /** When it was last played (ms since the epoch). */
    val lastPlayedAt: Long?,
    val genres: List<String>,
)

data class GenreCount(val name: String, val count: Int)

/** Titles last played in one month; [key] is "2026-10". */
data class MonthCount(val key: String, val count: Int)

data class Rewatched(val id: UUID, val name: String, val plays: Int)

data class WatchStats(
    val movies: Int,
    val episodes: Int,
    /** Time spent, counting a title once for every time it was played. */
    val hours: Double,
    val topGenres: List<GenreCount>,
    /** The last [MONTHS_SHOWN] months, oldest first, including the months nothing was played in. */
    val months: List<MonthCount>,
    /** Titles played more than once, the most often first. */
    val rewatched: List<Rewatched>,
) {
    val isEmpty: Boolean get() = movies == 0 && episodes == 0
}

const val MONTHS_SHOWN = 12

/** Titles read per kind: enough for any normal library, bounded so a huge one is still quick. */
const val STATS_MOVIES = 1500
const val STATS_EPISODES = 2500

/** "2026-10" for a time, in the local calendar. */
fun monthKey(ms: Long, zone: ZoneId = ZoneId.systemDefault()): String {
    val date = Instant.ofEpochMilli(ms).atZone(zone)
    return "%04d-%02d".format(date.year, date.monthValue)
}

/** The keys of the last [count] months up to the one of [now], oldest first. */
fun lastMonths(now: Long, count: Int = MONTHS_SHOWN, zone: ZoneId = ZoneId.systemDefault()): List<String> {
    val here = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().withDayOfMonth(1)
    return (count - 1 downTo 0).map { back ->
        val month = here.minusMonths(back.toLong())
        "%04d-%02d".format(month.year, month.monthValue)
    }
}

/** Pure: the numbers of the stats page. */
fun buildStats(titles: List<WatchedTitle>, now: Long, zone: ZoneId = ZoneId.systemDefault()): WatchStats {
    val genres = HashMap<String, Int>()
    val perMonth = HashMap<String, Int>()
    var seconds = 0L
    var movies = 0
    var episodes = 0
    for (title in titles) {
        if (title.isEpisode) episodes += 1 else movies += 1
        seconds += title.runtimeSeconds * title.playCount.coerceAtLeast(1)
        for (genre in title.genres) genres[genre] = (genres[genre] ?: 0) + 1
        title.lastPlayedAt?.let { perMonth.merge(monthKey(it, zone), 1, Int::plus) }
    }
    return WatchStats(
        movies = movies,
        episodes = episodes,
        hours = Math.round(seconds / 3600.0 * 10) / 10.0,
        topGenres = genres.map { GenreCount(it.key, it.value) }.sortedWith(compareByDescending<GenreCount> { it.count }.thenBy { it.name }).take(6),
        months = lastMonths(now, zone = zone).map { MonthCount(it, perMonth[it] ?: 0) },
        rewatched = titles
            .filter { it.playCount > 1 }
            .map { Rewatched(it.id, if (it.isEpisode && it.seriesName != null) "${it.seriesName}: ${it.name}" else it.name, it.playCount) }
            .sortedWith(compareByDescending<Rewatched> { it.plays }.thenBy { it.name })
            .take(5),
    )
}

/** The stats and whether only the latest titles were read (a library with more than the limits). */
data class WatchedStats(val stats: WatchStats, val capped: Boolean)

/** A time as ms since the epoch, from the server's UTC date. */
internal fun java.time.LocalDateTime.toEpochMs(): Long = toInstant(ZoneOffset.UTC).toEpochMilli()

/**
 * How many calendar days from today until [airsAt]; negative for the past. An air date is a day, not a moment (the server stores
 * it as midnight UTC), so it is read as that day wherever the TV is, and compared with today's date there.
 */
fun daysUntil(airsAt: Long, now: Long, zone: ZoneId = ZoneId.systemDefault()): Int {
    val day = Instant.ofEpochMilli(airsAt).atZone(ZoneOffset.UTC).toLocalDate()
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    return java.time.temporal.ChronoUnit.DAYS.between(today, day).toInt()
}
