package app.jellyflix.tv.data

import org.jellyfin.sdk.model.api.BaseItemKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class LiveTvTest {
    private val hour = 3_600_000L
    private val channelId = UUID.randomUUID()

    private fun program(startH: Long, endH: Long) = TvProgram(UUID.randomUUID(), channelId, "P$startH", null, null, startH * hour, endH * hour)

    private fun item(kind: BaseItemKind = BaseItemKind.TV_CHANNEL, title: String = "News") = MediaItem(
        id = UUID.randomUUID(), title = title, name = title, subtitle = null, kind = kind, posterUrl = null, landscapeUrl = null,
        backdropUrl = null, overview = null, year = null, runtimeMinutes = null, genres = emptyList(), rating = null,
        officialRating = null, progress = null, resumeMs = 0, played = false, favorite = false, seriesId = null, seasonId = null,
        episodeNumber = null, seasonNumber = null,
    )

    private fun channel(number: String? = "4", now: TvProgram? = null) = TvChannel(item(), number, now)

    @Test
    fun `the quality and the notes of a playlist name become tags`() {
        assertEquals(ChannelName("A&E Latin America", listOf("1080p")), splitChannelName("A&E Latin America (1080p)"))
        assertEquals(ChannelName("Alerta Bogota", listOf("720p", "Geo-blocked")), splitChannelName("Alerta Bogota (720p) [Geo-blocked]"))
        assertEquals(ChannelName("Canal 1 (Colombia)", listOf("1080p")), splitChannelName("Canal 1 (Colombia) (1080p)"))
        assertEquals(ChannelName("BUM Television", listOf("720p", "Not 24/7")), splitChannelName("BUM Television (720p) [Not 24/7]"))
        // Nothing to take out, or a name that would be left empty, stays whole.
        assertEquals(ChannelName("Canal 9 Cosmos", emptyList()), splitChannelName("Canal 9 Cosmos"))
        assertEquals(ChannelName("(1080p)", emptyList()), splitChannelName("(1080p)"))
        assertEquals("4 · News", TvChannel(item(title = "News (HD)"), "4", null).label)
    }

    @Test
    fun `a programme knows when it is on and how far it is`() {
        val p = program(10, 12)
        assertFalse(p.isOn(10 * hour - 1))
        assertTrue(p.isOn(10 * hour))
        assertTrue(p.isOn(12 * hour - 1))
        assertFalse(p.isOn(12 * hour))
        assertEquals(0f, p.progressAt(9 * hour), 0f)
        assertEquals(0.5f, p.progressAt(11 * hour), 0f)
        assertEquals(1f, p.progressAt(13 * hour), 0f)
    }

    @Test
    fun `a channel is called by its number and name, and shows what is on only while it is on`() {
        assertEquals("4 · News", channel("4").label)
        assertEquals("News", channel(null).label)
        assertEquals("News", channel(" ").label)
        val c = channel(now = program(10, 11))
        assertEquals("P10", c.onAt(10 * hour + 1)?.title)
        assertNull(c.onAt(11 * hour))
    }

    @Test
    fun `what comes next is the first programme that starts later`() {
        val list = listOf(program(12, 13), program(10, 11), program(11, 12))
        assertEquals("P11", nextProgram(list, 10 * hour + 5)?.title)
        assertEquals("P12", nextProgram(list, 11 * hour)?.title)
        assertNull(nextProgram(list, 12 * hour))
    }

    @Test
    fun `the next and the previous channel go round the ends and nowhere with one channel`() {
        val a = channel("1")
        val b = channel("2")
        val c = channel("3")
        val all = listOf(a, b, c)
        assertEquals(b.id, neighbourChannel(all, a.id, 1)?.id)
        assertEquals(a.id, neighbourChannel(all, c.id, 1)?.id)
        assertEquals(c.id, neighbourChannel(all, a.id, -1)?.id)
        assertNull(neighbourChannel(listOf(a), a.id, 1))
        assertNull(neighbourChannel(all, UUID.randomUUID(), 1))
    }

    @Test
    fun `a channel plays like a video, and an account with only channels is not empty`() {
        assertTrue(item().isChannel)
        assertTrue(item().isPlayable)
        assertFalse(item(BaseItemKind.MOVIE).isChannel)
        val only = Libraries(emptyList(), emptyList(), emptyList(), emptyList(), liveTv = listOf(Lib(UUID.randomUUID(), "Live TV")))
        assertFalse(only.isEmpty)
        assertFalse(only.hasTitles)
    }

    @Test
    fun `a category is found by its key and anything unknown is all of them`() {
        assertEquals(ChannelCategory.Sports, ChannelCategory.of("sports"))
        assertEquals(ChannelCategory.Favorites, ChannelCategory.of("favorites"))
        assertEquals(ChannelCategory.All, ChannelCategory.of("weather"))
        assertEquals(ChannelCategory.All, ChannelCategory.of(null))
        assertEquals(ChannelCategory.values().size, ChannelCategory.values().map { it.key }.toSet().size)
    }
}
