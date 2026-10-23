package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

class InsightsTest {
    private val utc = ZoneId.of("UTC")
    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    // ---- Visits

    @Test
    fun theFirstVisitHasNothingBeforeIt() {
        assertEquals(Visit(since = null, seen = 1_000), nextVisit(null, null, 1_000))
        // A stored zero is "never", not 1970.
        assertEquals(Visit(since = null, seen = 1_000), nextVisit(0, 0, 1_000))
    }

    @Test
    fun aPauseOfHalfAnHourEndsAVisit() {
        val seen = 10_000_000L
        // Back after more than half an hour: the previous visit ended when the app was last seen.
        assertEquals(Visit(since = seen, seen = seen + VISIT_GAP_MS + 1), nextVisit(seen, null, seen + VISIT_GAP_MS + 1))
        // Half an hour exactly is still the same visit.
        assertEquals(Visit(since = null, seen = seen + VISIT_GAP_MS), nextVisit(seen, null, seen + VISIT_GAP_MS))
    }

    @Test
    fun openingTheAppAgainSoonKeepsWhatWasNewAsNew() {
        val first = nextVisit(storedSeen = 5_000_000L, storedSince = 1_000_000L, now = 5_000_000L + 60_000)
        assertEquals(Visit(since = 1_000_000L, seen = 5_060_000L), first)
        // And again, and again: the "since" does not move until a real pause.
        val again = nextVisit(first.seen, first.since, first.seen + 120_000)
        assertEquals(1_000_000L, again.since)
        val later = nextVisit(again.seen, again.since, again.seen + VISIT_GAP_MS + 5_000)
        assertEquals(again.seen, later.since)
    }

    // ---- Coming up

    private fun episode(name: String): MediaItem = MediaItem(
        id = UUID.nameUUIDFromBytes(name.toByteArray()), title = name, name = name, subtitle = null,
        kind = org.jellyfin.sdk.model.api.BaseItemKind.EPISODE, posterUrl = null, landscapeUrl = null, backdropUrl = null,
        overview = null, year = null, runtimeMinutes = null, genres = emptyList(), rating = null, officialRating = null,
        progress = null, resumeMs = 0, played = false, favorite = false, seriesId = null, seasonId = null,
        episodeNumber = null, seasonNumber = null,
    )

    @Test
    fun theSoonestEpisodeComesFirstAndOnesWithoutADateGoLast() {
        val list = listOf(
            UpcomingEpisode(episode("c"), null),
            UpcomingEpisode(episode("b"), 2_000),
            UpcomingEpisode(episode("a"), 1_000),
        )
        assertEquals(listOf("a", "b", "c"), sortedUpcoming(list).map { it.item.title })
    }

    @Test
    fun anAirDateIsADayWhereverTheTvIs() {
        val airs = at("2026-10-14T00:00:00Z")
        // Bogotá is five hours behind: at 22:00 on the 13th it is still the 13th there, and the episode airs tomorrow.
        assertEquals(1, daysUntil(airs, at("2026-10-14T03:00:00Z"), ZoneId.of("America/Bogota")))
        // Madrid is ahead: shortly after midnight on the 14th it is the day.
        assertEquals(0, daysUntil(airs, at("2026-10-13T22:30:00Z"), ZoneId.of("Europe/Madrid")))
        assertEquals(-2, daysUntil(airs, at("2026-10-16T12:00:00Z"), utc))
        assertEquals(10, daysUntil(airs, at("2026-10-04T12:00:00Z"), utc))
    }

    // ---- Stats

    private fun watched(
        name: String,
        plays: Int = 1,
        minutes: Int = 60,
        episode: Boolean = false,
        series: String? = null,
        last: String? = null,
        genres: List<String> = emptyList(),
    ) = WatchedTitle(
        id = UUID.nameUUIDFromBytes(name.toByteArray()),
        name = name,
        isEpisode = episode,
        seriesName = series,
        runtimeSeconds = minutes * 60L,
        playCount = plays,
        lastPlayedAt = last?.let { at(it) },
        genres = genres,
    )

    @Test
    fun theLastTwelveMonthsAreListedOldestFirstAcrossTheNewYear() {
        val months = lastMonths(at("2026-02-15T12:00:00Z"), zone = utc)
        assertEquals(12, months.size)
        assertEquals("2025-03", months.first())
        assertEquals("2026-02", months.last())
        assertEquals(listOf("2025-12", "2026-01"), months.subList(9, 11))
    }

    @Test
    fun aTitleCountsInTheMonthItWasLastPlayedIn() {
        // Late on the 31st in UTC is already the next month in Madrid.
        val ms = at("2026-03-31T23:30:00Z")
        assertEquals("2026-03", monthKey(ms, utc))
        assertEquals("2026-04", monthKey(ms, ZoneId.of("Europe/Madrid")))
    }

    @Test
    fun hoursCountEveryPlayAndMoviesAndEpisodesAreCountedApart() {
        val stats = buildStats(
            listOf(
                watched("Heat", plays = 2, minutes = 170),
                watched("Pilot", minutes = 45, episode = true, series = "Lost"),
                watched("Alien", minutes = 117),
                // A play count of zero (never reported) still counts as one watch.
                watched("Odd", plays = 0, minutes = 60),
            ),
            now = at("2026-10-23T12:00:00Z"),
            zone = utc,
        )
        assertEquals(3, stats.movies)
        assertEquals(1, stats.episodes)
        // 170*2 + 45 + 117 + 60 = 562 minutes.
        assertEquals(9.4, stats.hours, 0.0001)
        assertFalse(stats.isEmpty)
    }

    @Test
    fun noTitlesGiveAnEmptyPageNotAnError() {
        val stats = buildStats(emptyList(), now = at("2026-10-23T12:00:00Z"), zone = utc)
        assertTrue(stats.isEmpty)
        assertEquals(0.0, stats.hours, 0.0)
        assertEquals(12, stats.months.size)
        assertTrue(stats.months.all { it.count == 0 })
        assertTrue(stats.topGenres.isEmpty() && stats.rewatched.isEmpty())
    }

    @Test
    fun monthsCountTitlesAndKeepTheMonthsNothingWasPlayedIn() {
        val stats = buildStats(
            listOf(
                watched("a", last = "2026-10-02T10:00:00Z"),
                watched("b", last = "2026-10-20T10:00:00Z"),
                watched("c", last = "2026-08-05T10:00:00Z"),
                // Too old for the last twelve months: counted in the totals but not drawn.
                watched("d", last = "2024-01-05T10:00:00Z"),
                watched("e"),
            ),
            now = at("2026-10-23T12:00:00Z"),
            zone = utc,
        )
        val byKey = stats.months.associate { it.key to it.count }
        assertEquals(2, byKey["2026-10"])
        assertEquals(0, byKey["2026-09"])
        assertEquals(1, byKey["2026-08"])
        assertEquals(5, stats.movies)
        assertEquals("2025-11", stats.months.first().key)
    }

    @Test
    fun genresAreRankedByCountThenNameAndOnlyTheTopSixShow() {
        val titles = listOf(
            watched("1", genres = listOf("Drama", "Crime")),
            watched("2", genres = listOf("Drama")),
            watched("3", genres = listOf("Comedy")),
            watched("4", genres = listOf("Action", "Sci-Fi", "Horror", "Western")),
        )
        val genres = buildStats(titles, now = at("2026-10-23T12:00:00Z"), zone = utc).topGenres
        assertEquals(6, genres.size)
        assertEquals(GenreCount("Drama", 2), genres.first())
        // The rest have one each: alphabetical.
        assertEquals(listOf("Drama", "Action", "Comedy", "Crime", "Horror", "Sci-Fi"), genres.map { it.name })
    }

    @Test
    fun whatWasWatchedMoreThanOnceIsNamedWithItsSeriesAndRankedByPlays() {
        val titles = listOf(
            watched("Once", plays = 1),
            watched("Heat", plays = 3),
            watched("Pilot", plays = 5, episode = true, series = "Lost"),
            watched("Alien", plays = 3),
            watched("e1", plays = 2), watched("e2", plays = 2), watched("e3", plays = 2),
        )
        val rewatched = buildStats(titles, now = at("2026-10-23T12:00:00Z"), zone = utc).rewatched
        assertEquals(5, rewatched.size)
        assertEquals(listOf("Lost: Pilot", "Alien", "Heat"), rewatched.take(3).map { it.name })
        assertEquals(listOf(5, 3, 3, 2, 2), rewatched.map { it.plays })
        assertNull(rewatched.firstOrNull { it.name == "Once" })
    }
}
