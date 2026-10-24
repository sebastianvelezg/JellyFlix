package app.jellyflix.tv.data

import org.jellyfin.sdk.model.api.BaseItemKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class BooksTest {
    private fun item(kind: BaseItemKind, artist: String? = null, runtimeMs: Long? = null) = MediaItem(
        id = UUID.randomUUID(), title = "T", name = "Title", subtitle = null, kind = kind, posterUrl = "http://x/cover.jpg", landscapeUrl = null,
        backdropUrl = null, overview = null, year = null, runtimeMinutes = null, genres = emptyList(), rating = null,
        officialRating = null, progress = null, resumeMs = 0, played = false, favorite = false, seriesId = null, seasonId = null,
        episodeNumber = null, seasonNumber = null, artist = artist, runtimeMs = runtimeMs,
    )

    private fun lib() = Lib(UUID.randomUUID(), "Books")

    @Test
    fun `an account with only books has titles to show, but no video`() {
        val only = Libraries(emptyList(), emptyList(), emptyList(), emptyList(), books = listOf(lib()))
        assertTrue(only.hasTitles)
        assertFalse(only.hasVideo)
        assertFalse(only.isEmpty)
        assertTrue(Libraries(emptyList(), emptyList(), emptyList(), emptyList()).isEmpty)
    }

    @Test
    fun `a book is not played as video, an audiobook goes to the music player`() {
        assertFalse(item(BaseItemKind.BOOK).isPlayable)
        assertFalse(item(BaseItemKind.AUDIO_BOOK).isPlayable)
        assertTrue(item(BaseItemKind.BOOK).isBook)
        assertTrue(item(BaseItemKind.AUDIO_BOOK).isAudiobook)
        assertFalse(item(BaseItemKind.MOVIE).isAudiobook)
    }

    @Test
    fun `an audiobook becomes one long song with its author and cover`() {
        val book = item(BaseItemKind.AUDIO_BOOK, artist = "Someone", runtimeMs = 36_000_000L)
        val song = book.toAudiobookSong()
        assertEquals(book.id, song.id)
        assertEquals("Title", song.name)
        assertEquals("Someone", song.artist)
        assertEquals(36_000_000L, song.durationMs)
        assertEquals("http://x/cover.jpg", song.coverUrl)
        assertNull(song.albumId)
        // With no author known it is credited to nobody rather than to a made-up name.
        assertEquals("", item(BaseItemKind.AUDIO_BOOK).toAudiobookSong().artist)
    }

    @Test
    fun `the home row for books is known by the name the web client uses`() {
        assertEquals(HomeRow.NewBooks, HomeRow.of("newBooks"))
        assertTrue(HomeRow.NewBooks in HomeLayout.sanitized(true, listOf("continue"), emptyList()).order)
    }
}
