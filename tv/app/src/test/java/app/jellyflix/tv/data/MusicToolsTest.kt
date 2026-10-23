package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class MusicToolsTest {
    @Test
    fun theSleepButtonStepsThroughEveryChoiceAndBackToOff() {
        var choice = SleepChoice.Off
        val seen = ArrayList<SleepChoice>()
        repeat(SleepChoice.entries.size) {
            choice = choice.next()
            seen += choice
        }
        assertEquals(
            listOf(SleepChoice.Minutes15, SleepChoice.Minutes30, SleepChoice.Minutes45, SleepChoice.Minutes60, SleepChoice.AfterSong, SleepChoice.Off),
            seen,
        )
    }

    @Test
    fun onlyTheTimedChoicesHaveMinutes() {
        assertEquals(listOf(null, 15, 30, 45, 60, null), SleepChoice.entries.map { it.minutes })
    }

    @Test
    fun aStartedMinuteCountsAndAnOverTimerIsZero() {
        assertEquals(15, sleepMinutesLeft(endsAtMs = 900_000, nowMs = 0))
        assertEquals(15, sleepMinutesLeft(endsAtMs = 900_000, nowMs = 1))
        assertEquals(14, sleepMinutesLeft(endsAtMs = 900_000, nowMs = 60_000))
        assertEquals(1, sleepMinutesLeft(endsAtMs = 900_000, nowMs = 899_999))
        assertEquals(0, sleepMinutesLeft(endsAtMs = 900_000, nowMs = 900_000))
        assertEquals(0, sleepMinutesLeft(endsAtMs = 900_000, nowMs = 2_000_000))
    }

    @Test
    fun aSongMovesUpOrDownAndTheRestKeepTheirOrder() {
        val queue = listOf("a", "b", "c", "d")
        assertEquals(listOf("a", "c", "b", "d"), queue.moved(1, 2))
        assertEquals(listOf("b", "a", "c", "d"), queue.moved(1, 0))
        assertEquals(listOf("b", "c", "d", "a"), queue.moved(0, 3))
        assertEquals(listOf("d", "a", "b", "c"), queue.moved(3, 0))
    }

    @Test
    fun movingNowhereOrOutsideTheQueueChangesNothing() {
        val queue = listOf("a", "b", "c")
        assertSame(queue, queue.moved(1, 1))
        assertSame(queue, queue.moved(-1, 1))
        assertSame(queue, queue.moved(0, 3))
        assertSame(queue, queue.moved(5, 0))
        assertEquals(listOf("a", "b", "c"), queue)
    }

    @Test
    fun theLyricsCursorMovesOneLineAndStopsAtTheEnds() {
        assertEquals(4, stepLine(3, +1, 10))
        assertEquals(2, stepLine(3, -1, 10))
        assertEquals(0, stepLine(0, -1, 10))
        assertEquals(9, stepLine(9, +1, 10))
        assertEquals(0, stepLine(0, +1, 0))
    }
}
