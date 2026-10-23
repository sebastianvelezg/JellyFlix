package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LyricsTest {
    private val second = 10_000_000L

    @Test fun timedLinesFollowThePosition() {
        val lyrics = Lyrics.parse(listOf(0L to "a", 10 * second to "b", 20 * second to "c"))!!
        assertTrue(lyrics.synced)
        assertEquals(0, lyrics.currentAt(0))
        assertEquals(0, lyrics.currentAt(9_999))
        assertEquals(1, lyrics.currentAt(10_000))
        assertEquals(2, lyrics.currentAt(500_000))
    }

    @Test fun aLineWithoutATimeTakesTheOneBefore() {
        val lyrics = Lyrics.parse(listOf(null to "header", 5 * second to "a", null to "gap", 9 * second to "b"))!!
        assertTrue(lyrics.synced)
        assertEquals(listOf(0L, 5_000L, 5_000L, 9_000L), lyrics.lines.map { it.startMs })
    }

    @Test fun theOffsetOfTheFileMovesEveryLine() {
        val lyrics = Lyrics.parse(listOf(5 * second to "a", 9 * second to "b"), offsetTicks = -2 * second)!!
        assertEquals(listOf(3_000L, 7_000L), lyrics.lines.map { it.startMs })
    }

    @Test fun mostlyUntimedLyricsArePlain() {
        val lyrics = Lyrics.parse(listOf(second to "a", null to "b", null to "c"))!!
        assertFalse(lyrics.synced)
        assertEquals(-1, lyrics.currentAt(60_000))
    }

    @Test fun noTextMeansNoLyrics() {
        assertNull(Lyrics.parse(listOf(null to " ", null to "")))
    }
}
