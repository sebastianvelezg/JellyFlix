package app.jellyflix.tv.data

import java.util.UUID

/**
 * Rows of suggestions for the Home: "Because you watched X" for a few of the titles you finished most recently and "Because you
 * liked X" for one of your favourites. The server finds the similar titles; this decides which rows to show and in what order.
 */

/** Why a row of suggestions is shown. */
enum class RecommendationKind { WATCHED, LIKED }

/** A row of titles like [seed], which you watched ([RecommendationKind.WATCHED]) or marked as a favourite ([RecommendationKind.LIKED]). */
data class Recommendation(val kind: RecommendationKind, val seed: String, val items: List<MediaItem>)

object Recommendations {
    /** How many rows the Home shows at most. */
    const val ROWS = 3

    /** Fewer suggestions than this are not worth a row. */
    const val MIN_SUGGESTIONS = 3

    /** A title the suggestions start from. */
    data class Seed(val id: UUID, val title: String)

    /** Each seed once, in the order given (an episode counts as its series, so the caller maps it before). */
    fun distinctSeeds(seeds: List<Seed>): List<Seed> = seeds.distinctBy { it.id }

    /**
     * The suggestions of one seed: what the server found without what has been seen, the seed itself and anything already used in
     * another row (they are added to [used]). Null when too few are left for a row.
     */
    fun take(kind: RecommendationKind, seed: Seed, similar: List<MediaItem>, used: MutableSet<UUID>, limit: Int = 16): Recommendation? {
        val items = similar.filter { !it.played && it.id != seed.id && it.id !in used }.take(limit)
        if (items.size < MIN_SUGGESTIONS) return null
        used += items.map { it.id }
        return Recommendation(kind, seed.title, items)
    }

    /** The rows in the order shown: the last title watched, then the favourite, then the others, so the rows do not all look alike. */
    fun arrange(watched: List<Recommendation>, liked: Recommendation?): List<Recommendation> =
        listOfNotNull(watched.firstOrNull(), liked) + watched.drop(1)
}
