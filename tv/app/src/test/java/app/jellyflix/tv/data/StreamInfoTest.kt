package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamInfoTest {
    @Test
    fun readsReasonsFromTheStreamAddress() {
        val url = "/videos/abc/master.m3u8?MediaSourceId=abc&TranscodeReasons=VideoCodecNotSupported,AudioCodecNotSupported&api=1"
        assertEquals(listOf("VideoCodecNotSupported", "AudioCodecNotSupported"), transcodeReasons(url))
    }

    @Test
    fun readsEncodedAndDifferentlyCasedReasons() {
        assertEquals(listOf("ContainerNotSupported", "AudioCodecNotSupported"), transcodeReasons("/x?transcodeReasons=ContainerNotSupported%2CAudioCodecNotSupported"))
    }

    @Test
    fun noReasonsWhenTheAddressHasNone() {
        assertTrue(transcodeReasons(null).isEmpty())
        assertTrue(transcodeReasons("/videos/abc/master.m3u8").isEmpty())
        assertTrue(transcodeReasons("/x?TranscodeReasons=").isEmpty())
    }

    @Test
    fun anAudioOnlyConversionLeavesThePictureAlone() {
        assertTrue(StreamInfo(reasons = listOf("AudioCodecNotSupported", "ContainerNotSupported")).videoCopied)
        assertFalse(StreamInfo(reasons = listOf("VideoCodecNotSupported")).videoCopied)
        // A bitrate over the Settings limit makes the server shrink the picture.
        assertFalse(StreamInfo(reasons = listOf("ContainerBitrateExceedsLimit")).videoCopied)
    }

    @Test
    fun knownReasonsHaveTheirOwnSentence() {
        assertNotNull(reasonText("VideoCodecNotSupported"))
        assertNotNull(reasonText("ContainerBitrateExceedsLimit"))
        assertNull(reasonText("SomethingNew"))
        assertEquals("Something new happened", plainReason("SomethingNewHappened"))
    }
}

class DisplayModeTest {
    private fun mode(id: Int, hz: Float, w: Int = 3840, h: Int = 2160) = DisplayModeInfo(id, w, h, hz)

    private val tv = listOf(mode(1, 60f), mode(2, 59.94f), mode(3, 50f), mode(4, 24f), mode(5, 23.976f), mode(6, 30f), mode(7, 60f, 1920, 1080))

    @Test
    fun aFilmGetsTheMatchingMode() {
        assertEquals(5, bestDisplayMode(23.976f, mode(1, 60f), tv)?.id)
        assertEquals(4, bestDisplayMode(24f, mode(1, 60f), tv)?.id)
    }

    @Test
    fun aVideoThatAlreadyFitsLeavesTheScreenAlone() {
        // 60 Hz shows 30 fps evenly (every frame twice), and 29.97 fps on 59.94 Hz as well.
        assertNull(bestDisplayMode(30f, mode(6, 30f), tv))
        assertNull(bestDisplayMode(29.97f, mode(2, 59.94f), listOf(mode(2, 59.94f), mode(1, 60f))))
    }

    @Test
    fun aScreenWithoutAGoodModeIsNotTouched() {
        // 23.976 fps on a 60 Hz-only screen: every other frame would stay longer, and no mode helps.
        assertNull(bestDisplayMode(23.976f, mode(1, 60f), listOf(mode(1, 60f), mode(2, 59.94f))))
    }

    @Test
    fun aMultipleOfTheRateIsAcceptedWhenTheRateItselfIsMissing() {
        // A film on 120 Hz (every frame five times) beats 60 Hz (2.5 times).
        assertEquals(9, bestDisplayMode(24f, mode(1, 60f), listOf(mode(1, 60f), mode(9, 120f)))?.id)
    }

    @Test
    fun theCleanestMultipleWins() {
        // 24 Hz (every frame once) before 48 Hz (twice).
        assertEquals(4, bestDisplayMode(24f, mode(1, 60f), listOf(mode(1, 60f), mode(8, 48f), mode(4, 24f)))?.id)
    }

    @Test
    fun theSizeOfThePictureNeverChanges() {
        // Only a 1080p 24 Hz mode exists, but the screen is running 4K: leave it.
        assertNull(bestDisplayMode(24f, mode(1, 60f), listOf(mode(1, 60f), mode(10, 24f, 1920, 1080))))
    }

    @Test
    fun nonsenseRatesAreIgnored() {
        assertNull(bestDisplayMode(0f, mode(1, 60f), tv))
        assertNull(bestDisplayMode(500f, mode(1, 60f), tv))
    }
}

class VersionOptionsTest {
    private fun source(id: String?, height: Int?, codec: String?, range: String? = "SDR", gb: Double? = null, name: String? = null) =
        VersionSource(id, name, height, codec, range, gb?.let { (it * 1_073_741_824).toLong() })

    @Test
    fun oneFileMeansNothingToChoose() {
        assertTrue(versionOptionsOf(emptyList()).isEmpty())
        assertTrue(versionOptionsOf(listOf(source("a", 1080, "h264"))).isEmpty())
    }

    @Test
    fun eachFileIsNamedByWhatAPersonWouldAskFor() {
        val options = versionOptionsOf(
            listOf(
                source("a", 2160, "hevc", "HDR10", gb = 28.4),
                source("b", 1080, "h264", gb = 8.0),
            ),
        )
        assertEquals(listOf("a", "b"), options.map { it.id })
        assertEquals("2160p · HEVC HDR10 · 28.4 GB", options[0].label)
        assertEquals("1080p · H264 · 8.0 GB", options[1].label)
    }

    @Test
    fun filesThatLookTheSameAreToldApartByName() {
        val options = versionOptionsOf(listOf(source("a", 1080, "h264", name = "Director's cut"), source("b", 1080, "h264", name = "Theatrical")))
        assertEquals("1080p · H264 (Director's cut)", options[0].label)
        assertEquals("1080p · H264 (Theatrical)", options[1].label)
    }

    @Test
    fun aFileWithoutAnIdCannotBeChosen() {
        val options = versionOptionsOf(listOf(source(null, 1080, "h264"), source("b", 720, "h264")))
        assertEquals(listOf("b"), options.map { it.id })
    }

    @Test
    fun aFileWithNoDetailsFallsBackToItsName() {
        val options = versionOptionsOf(listOf(source("a", null, null, null, name = "Version A"), source("b", null, null, null, name = "Version B")))
        assertEquals(listOf("Version A", "Version B"), options.map { it.label })
    }
}
