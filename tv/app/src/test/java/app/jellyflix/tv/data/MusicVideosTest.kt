package app.jellyflix.tv.data

import org.jellyfin.sdk.model.api.BaseItemKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class MusicVideosTest {
    private fun lib(name: String) = Lib(UUID.randomUUID(), name)

    private fun item(kind: BaseItemKind, artist: String? = null) = MediaItem(
        id = UUID.randomUUID(), title = "T", name = "T", subtitle = null, kind = kind, posterUrl = null, landscapeUrl = null,
        backdropUrl = null, overview = null, year = null, runtimeMinutes = null, genres = emptyList(), rating = null,
        officialRating = null, progress = null, resumeMs = 0, played = false, favorite = false, seriesId = null, seasonId = null,
        episodeNumber = null, seasonNumber = null, artist = artist,
    )

    @Test
    fun `an account with only music videos still has video to show`() {
        val only = Libraries(emptyList(), emptyList(), emptyList(), emptyList(), listOf(lib("Videos")))
        assertTrue(only.hasVideo)
        assertFalse(only.isEmpty)
        assertFalse(Libraries(emptyList(), emptyList(), emptyList(), emptyList()).hasVideo)
        assertTrue(Libraries(emptyList(), emptyList(), emptyList(), emptyList()).isEmpty)
    }

    @Test
    fun `a music video plays like a movie`() {
        assertTrue(item(BaseItemKind.MUSIC_VIDEO, "Someone").isPlayable)
        assertTrue(item(BaseItemKind.MOVIE).isPlayable)
        assertFalse(item(BaseItemKind.SERIES).isPlayable)
        assertFalse(item(BaseItemKind.MUSIC_ALBUM).isPlayable)
    }

    @Test
    fun `the home row is known by the name the web client uses`() {
        assertEquals(HomeRow.NewMusicVideos, HomeRow.of("newMusicVideos"))
        // A layout saved before the row existed gets it added after the others.
        val saved = HomeLayout.sanitized(true, listOf("continue"), emptyList())
        assertEquals(HomeRow.Continue, saved.order.first())
        assertTrue(HomeRow.NewMusicVideos in saved.order)
    }
}
