package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SeriesTracksTest {
    private val audio = listOf(Track(1, "English AC3 5.1", "eng"), Track(2, "Japanese AAC", "jpn"), Track(3, "Español", "SPA"))
    private val subs = listOf(
        Track(4, "English Forced", "eng"),
        Track(5, "English SDH", "eng"),
        Track(6, "English", "eng"),
        Track(7, "Spanish Forced", "spa"),
        Track(8, "Japanese", "jpn"),
    )

    @Test
    fun `audio is the first track in the remembered language, ignoring case`() {
        assertEquals(2, pickAudioIndex(audio, "jpn"))
        assertEquals(3, pickAudioIndex(audio, "spa"))
        assertNull(pickAudioIndex(audio, "fra"))
        assertNull(pickAudioIndex(audio, null))
        assertNull(pickAudioIndex(audio, ""))
    }

    @Test
    fun `subtitles prefer the full dialogue, then SDH, and a forced track last`() {
        assertEquals(6, pickSubtitleIndex(subs, "eng"))
        assertEquals(5, pickSubtitleIndex(subs.filter { it.index != 6 }, "eng"))
        assertEquals(4, pickSubtitleIndex(listOf(subs[0]), "eng"))
        assertEquals(7, pickSubtitleIndex(subs, "spa"))
        assertNull(pickSubtitleIndex(subs, "deu"))
    }

    @Test
    fun `an episode with remembered choices asks for them, and leaves the server's default alone`() {
        val anime = SeriesTracks(audioLanguage = "jpn", subtitleLanguage = "eng")
        assertEquals(TrackPicks(2, 6), rememberedPicks(audio, subs, defaultAudio = 1, remembered = anime))
        // Already the server's pick: nothing to change.
        assertEquals(TrackPicks(null, 6), rememberedPicks(audio, subs, defaultAudio = 2, remembered = anime))
        // A language this episode has no track in: the server decides.
        assertEquals(TrackPicks(null, null), rememberedPicks(audio, subs, 1, SeriesTracks("fra", "fra")))
    }

    @Test
    fun `subtitles turned off are remembered as off`() {
        assertEquals(TrackPicks(null, -1), rememberedPicks(audio, subs, 1, SeriesTracks(subtitleLanguage = SUBTITLES_OFF)))
        assertEquals(TrackPicks(null, null), rememberedPicks(audio, subs, 1, SeriesTracks()))
    }

    @Test
    fun `choices survive being saved and read back, including subtitles off`() {
        val all = linkedMapOf(
            "a" to SeriesTracks("jpn", "eng"),
            "b" to SeriesTracks(null, SUBTITLES_OFF),
            "c" to SeriesTracks("spa", null),
        )
        assertEquals(all, decodeSeriesTracks(encodeSeriesTracks(all)))
    }

    @Test
    fun `unreadable text gives nothing instead of a crash`() {
        assertTrue(decodeSeriesTracks(null).isEmpty())
        assertTrue(decodeSeriesTracks("").isEmpty())
        assertTrue(decodeSeriesTracks("{not json").isEmpty())
        assertTrue(decodeSeriesTracks("""{"x":5,"y":{}}""").isEmpty())
    }

    @Test
    fun `the series used last is kept and the oldest are dropped`() {
        var all = LinkedHashMap<String, SeriesTracks>()
        for (i in 1..SERIES_TRACKS_LIMIT + 5) all = withSeriesTracks(all, "s$i") { it.copy(audioLanguage = "eng") }
        assertEquals(SERIES_TRACKS_LIMIT, all.size)
        assertTrue("s1" !in all && "s${SERIES_TRACKS_LIMIT + 5}" in all)
        // Using an old one again moves it to the end and keeps what was there.
        all = withSeriesTracks(all, "s10") { it.copy(subtitleLanguage = "spa") }
        assertEquals("s10", all.keys.last())
        assertEquals(SeriesTracks("eng", "spa"), all["s10"])
    }
}
