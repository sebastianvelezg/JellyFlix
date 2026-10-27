package app.jellyflix.tv.data

import org.jellyfin.sdk.model.api.BaseItemKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.UUID

class PlayQueueTest {
    private fun item(name: String, kind: BaseItemKind = BaseItemKind.MOVIE) = MediaItem(
        id = UUID.randomUUID(), title = name, name = name, subtitle = null, kind = kind, posterUrl = null, landscapeUrl = null,
        backdropUrl = null, overview = null, year = null, runtimeMinutes = null, genres = emptyList(), rating = null,
        officialRating = null, progress = null, resumeMs = 0, played = false, favorite = false, seriesId = null, seasonId = null,
        episodeNumber = null, seasonNumber = null,
    )

    @Test
    fun `starting in the middle plays that one and what follows it`() {
        val saga = listOf(item("I"), item("II"), item("III"))
        assertEquals(listOf("II", "III"), playThroughFrom(saga, saga[1])?.map { it.name })
        assertEquals(listOf("I", "II", "III"), playThroughFrom(saga, saga[0])?.map { it.name })
    }

    @Test
    fun `what cannot be played is left out, and a title that is not in the list plays alone`() {
        val series = item("A series", BaseItemKind.SERIES)
        val a = item("A")
        val b = item("B")
        assertEquals(listOf("A", "B"), playThroughFrom(listOf(series, a, b), a)?.map { it.name })
        assertNull(playThroughFrom(listOf(a, b), item("Elsewhere")))
    }
}
