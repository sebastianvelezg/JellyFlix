package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SubtitleSearchTest {
    private fun sub(id: String, exact: Boolean = false, machine: Boolean = false, downloads: Int? = null, rating: Float? = null) =
        RemoteSubtitle(id, id, "OpenSubtitles", "eng", "srt", downloads, rating, exact, machine)

    @Test
    fun `the language searched first is the last one chosen, else the viewer's own, else English`() {
        assertEquals("fra", defaultSearchLanguage("fra", "es"))
        assertEquals("spa", defaultSearchLanguage(null, "es"))
        assertEquals("spa", defaultSearchLanguage("xxx", "es")) // a language the list does not have
        assertEquals("eng", defaultSearchLanguage(null, "de"))
    }

    @Test
    fun `a match of the file comes first and a machine translation last`() {
        val sorted = sortRemoteSubtitles(
            listOf(
                sub("machine", machine = true, downloads = 90_000),
                sub("popular", downloads = 5_000, rating = 8f),
                sub("exact", exact = true),
                sub("plain", downloads = 10),
            ),
        )
        assertEquals(listOf("exact", "popular", "plain", "machine"), sorted.map { it.id })
    }

    @Test
    fun `the track a download added is the first one that was not there before`() {
        assertEquals(7, newSubtitleIndex(listOf(2, 3), listOf(2, 3, 7)))
        assertNull(newSubtitleIndex(listOf(2, 3), listOf(2, 3)))
        assertEquals(2, newSubtitleIndex(emptyList(), listOf(2, 3)))
    }
}
