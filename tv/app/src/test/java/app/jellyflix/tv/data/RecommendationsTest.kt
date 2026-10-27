package app.jellyflix.tv.data

import java.util.UUID
import org.jellyfin.sdk.model.api.BaseItemKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RecommendationsTest {
    private fun id(n: Int) = UUID(0, n.toLong())

    private fun item(n: Int, played: Boolean = false) = MediaItem(
        id = id(n), title = "Title $n", name = "Title $n", subtitle = null, kind = BaseItemKind.MOVIE, posterUrl = null, landscapeUrl = null,
        backdropUrl = null, overview = null, year = null, runtimeMinutes = null, genres = emptyList(), rating = null, officialRating = null,
        progress = null, resumeMs = 0, played = played, favorite = false, seriesId = null, seasonId = null, episodeNumber = null, seasonNumber = null,
    )

    private val seed = Recommendations.Seed(id(1), "Seed")

    @Test fun eachSeedCountsOnce() {
        val seeds = listOf(Recommendations.Seed(id(1), "A"), Recommendations.Seed(id(2), "B"), Recommendations.Seed(id(1), "A again"))
        assertEquals(listOf("A", "B"), Recommendations.distinctSeeds(seeds).map { it.title })
    }

    @Test fun suggestionsLeaveOutWhatWasSeenTheSeedAndWhatIsInAnotherRow() {
        val used = mutableSetOf(id(5))
        val row = Recommendations.take(RecommendationKind.WATCHED, seed, listOf(item(1), item(2), item(3, played = true), item(4), item(5), item(6), item(7)), used)!!
        assertEquals(listOf(2, 4, 6, 7), row.items.map { it.id.leastSignificantBits.toInt() })
        assertEquals("Seed", row.seed)
        // The titles taken are now used: the next row cannot show them again.
        assertEquals(setOf(5L, 2L, 4L, 6L, 7L), used.map { it.leastSignificantBits }.toSet())
    }

    @Test fun tooFewSuggestionsMakeNoRowAndTakeNothing() {
        val used = mutableSetOf<UUID>()
        assertNull(Recommendations.take(RecommendationKind.LIKED, seed, listOf(item(2), item(3)), used))
        assertEquals(emptySet<UUID>(), used)
    }

    @Test fun aRowIsAtMostTheLimit() {
        val row = Recommendations.take(RecommendationKind.WATCHED, seed, (2..40).map { item(it) }, mutableSetOf(), limit = 5)!!
        assertEquals(5, row.items.size)
    }

    @Test fun theRowsAlternateWatchedLikedWatched() {
        fun row(kind: RecommendationKind, name: String) = Recommendation(kind, name, emptyList())
        val watched = listOf(row(RecommendationKind.WATCHED, "w1"), row(RecommendationKind.WATCHED, "w2"))
        val liked = row(RecommendationKind.LIKED, "l")
        assertEquals(listOf("w1", "l", "w2"), Recommendations.arrange(watched, liked).map { it.seed })
        assertEquals(listOf("w1", "w2"), Recommendations.arrange(watched, null).map { it.seed })
        assertEquals(listOf("l"), Recommendations.arrange(emptyList(), liked).map { it.seed })
    }
}
