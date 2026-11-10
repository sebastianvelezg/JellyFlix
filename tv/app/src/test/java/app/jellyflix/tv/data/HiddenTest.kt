package app.jellyflix.tv.data

import org.jellyfin.sdk.model.api.BaseItemKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class HiddenTest {
    private fun id(n: Int) = UUID(0, n.toLong())

    private fun item(n: Int, lastPlayedAt: Long? = null, series: UUID? = null, name: String = "T$n") = MediaItem(
        id = id(n), title = name, name = name, subtitle = null, kind = if (series == null) BaseItemKind.MOVIE else BaseItemKind.EPISODE,
        posterUrl = null, landscapeUrl = null, backdropUrl = null, overview = null, year = null, runtimeMinutes = null, genres = emptyList(),
        rating = null, officialRating = null, progress = null, resumeMs = 20_000, played = false, favorite = false, seriesId = series,
        seasonId = null, episodeNumber = null, seasonNumber = null, lastPlayedAt = lastPlayedAt,
    )

    @Test
    fun `a hidden title leaves Continue watching and the others stay`() {
        val h = HiddenItems().hideFromResume(id(1), 100, "T1", now = 1)
        assertEquals(listOf(id(2)), h.filterResume(listOf(item(1, 100), item(2, 50))).map { it.id })
    }

    @Test
    fun `it stays hidden until it is played again`() {
        val h = HiddenItems().hideFromResume(id(1), 100, "T1", now = 1)
        assertTrue(h.isResumeHidden(id(1), 100))
        assertTrue(h.isResumeHidden(id(1), 90))
        assertFalse(h.isResumeHidden(id(1), 101))
        assertEquals(1, h.filterResume(listOf(item(1, 5_000))).size)
    }

    @Test
    fun `a title with no play date is shown again at its first play`() {
        val h = HiddenItems().hideFromResume(id(1), null, "T1", now = 1)
        assertTrue(h.isResumeHidden(id(1), null))
        assertFalse(h.isResumeHidden(id(1), 1))
    }

    @Test
    fun `only the dates of the server are compared, never this TV's clock`() {
        val h = HiddenItems().hideFromResume(id(1), 100, "T1", now = 9_999_999_999_999)
        assertFalse(h.isResumeHidden(id(1), 200))
    }

    @Test
    fun `a hidden series leaves Next up for good until it is restored`() {
        val series = id(900)
        val h = HiddenItems().hideFromNextUp(series, "Show", now = 1)
        val rows = listOf(item(1, series = series), item(2, series = id(901)), item(3, series = series))
        assertEquals(listOf(id(2)), h.filterNextUp(rows).map { it.id })
        assertEquals(3, h.restored(HiddenKind.NextUp, series.toString()).filterNextUp(rows).size)
    }

    @Test
    fun `the two lists are independent`() {
        val h = HiddenItems().hideFromResume(id(1), null, "T1", 1).hideFromNextUp(id(9), "Show", 2)
        assertEquals(1, h.restored(HiddenKind.NextUp, id(9).toString()).resume.size)
        assertEquals(1, h.restored(HiddenKind.Resume, id(1).toString()).nextUp.size)
        assertEquals(0, h.restoredAll().count)
        assertEquals(1, h.restoredAll(HiddenKind.Resume).count)
    }

    @Test
    fun `the list is newest first`() {
        val h = HiddenItems().hideFromResume(id(1), null, "T1", 10).hideFromNextUp(id(9), "Show", 20)
        assertEquals(listOf(HiddenKind.NextUp, HiddenKind.Resume), h.listed().map { it.kind })
    }

    @Test
    fun `the oldest make room beyond the limit`() {
        var h = HiddenItems()
        for (i in 1..HiddenItems.MAX_HIDDEN + 5) h = h.hideFromResume(id(i), null, "T$i", now = i.toLong())
        assertEquals(HiddenItems.MAX_HIDDEN, h.resume.size)
        assertFalse(h.resume.containsKey(id(1).toString()))
        assertTrue(h.resume.containsKey(id(HiddenItems.MAX_HIDDEN + 5).toString()))
    }

    @Test
    fun `what is stored comes back the same, and damage gives nothing`() {
        val h = HiddenItems().hideFromResume(id(1), 7, "T1", 1).hideFromNextUp(id(9), "Show", 2)
        assertEquals(h, HiddenItems.decode(HiddenItems.encode(h)))
        assertEquals(HiddenItems(), HiddenItems.decode(null))
        assertEquals(HiddenItems(), HiddenItems.decode("{not json"))
        assertEquals(HiddenItems(), HiddenItems.decode("""{"resume":"x","nextUp":5}"""))
    }

    @Test
    fun `an episode is listed with its series and its number`() {
        val episode = item(1, series = id(900), name = "Show").copy(seasonNumber = 2, episodeNumber = 5)
        assertEquals("Show · S2 E5", hiddenLabel(episode))
        assertEquals("Film", hiddenLabel(item(2, name = "Film")))
    }
}
