package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaysAsTest {
    @Test
    fun aPictureSizeHasTheNameAPersonKnowsIt() {
        assertEquals("4K", resolutionLabel(3840, 2160))
        // A letterboxed film is wide but short.
        assertEquals("4K", resolutionLabel(3840, 1608))
        assertEquals("1080p", resolutionLabel(1920, 800))
        assertEquals("720p", resolutionLabel(1280, 720))
        assertEquals("SD", resolutionLabel(720, 480))
        assertNull(resolutionLabel(null, null))
        assertNull(resolutionLabel(0, 0))
    }

    @Test
    fun aColourRangeIsSaidInWordsAndPlainSdrSaysNothing() {
        assertNull(rangeLabel(null))
        assertNull(rangeLabel("SDR"))
        assertNull(rangeLabel("Unknown"))
        assertEquals("HDR10", rangeLabel("HDR10"))
        assertEquals("HDR10+", rangeLabel("HDR10Plus"))
        assertEquals("Dolby Vision", rangeLabel("DOVIWithHDR10"))
        assertEquals("Dolby Vision", rangeLabel("DOVI"))
        assertEquals("HLG", rangeLabel("HLG"))
    }

    @Test
    fun theAudioIsShortEnoughForOneLine() {
        assertEquals("English · EAC3 · 5.1", audioSummary("English", "eac3", 6))
        assertEquals("Stereo", audioSummary(null, null, 2))
        assertEquals("Japanese · AAC · Stereo", audioSummary("Japanese", "aac", 2))
        assertEquals("DTS", audioSummary("", "dts", null))
        assertEquals("8 ch", channelLabel(null) ?: "8 ch")
        assertNull(audioSummary(null, null, null))
        assertNull(audioSummary(" ", "", 0))
        assertEquals("7.1", channelLabel(8))
        assertEquals("Mono", channelLabel(1))
        assertEquals("4 ch", channelLabel(4))
    }

    @Test
    fun theLineHasThePictureTheAudioAndTheSubtitles() {
        val plays = playsAsOf(1920, 1080, "hevc", "HDR10", "English Dolby Digital 5.1", 12)
        assertEquals(PlaysAs("1080p HEVC HDR10", "English Dolby Digital 5.1", 12), plays)
        assertEquals(PlaysAs("720p H264", null, 0), playsAsOf(1280, 720, "h264", "SDR", "  ", 0))
    }

    @Test
    fun whatTheServerDidNotSayIsLeftOutAndNothingKnownGivesNoLine() {
        assertEquals(PlaysAs(null, null, 3), playsAsOf(null, null, null, null, null, 3))
        assertNull(playsAsOf(null, null, null, null, null, 0))
        assertNull(playsAsOf(null, null, "", "SDR", "", 0))
    }
}
