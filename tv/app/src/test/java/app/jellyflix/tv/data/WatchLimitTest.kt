package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchLimitTest {
    private val now = 1_000_000L

    /** Plays titles in a row the way the TV does: each ends and the next one begins by itself. Returns how many played and why it stopped. */
    private fun run(limit: Int, titles: Int, timer: SleepTimer? = null): Pair<Int, EndDecision> {
        var count = 1
        for (n in 1 until titles) {
            when (val d = decideAtEnd(count, limit, timer, now)) {
                is EndDecision.Continue -> count = d.count
                else -> return count to d
            }
        }
        return count to decideAtEnd(count, limit, timer, now)
    }

    @Test
    fun `nothing changes when it is off`() {
        val (played, decision) = run(0, 12)
        assertEquals(12, played)
        assertTrue(decision is EndDecision.Continue)
    }

    @Test
    fun `the question comes after as many titles as the limit`() {
        val (played, decision) = run(3, 10)
        assertEquals(3, played)
        assertEquals(EndDecision.Ask, decision)
    }

    @Test
    fun `the title a person started counts as the first`() {
        val (played, decision) = run(2, 5)
        assertEquals(2, played)
        assertEquals(EndDecision.Ask, decision)
    }

    @Test
    fun `at the end of this episode stops with no question and no next title`() {
        val (played, decision) = run(3, 4, SleepTimer.EpisodeEnd)
        assertEquals(1, played)
        assertEquals(EndDecision.Stop, decision)
    }

    @Test
    fun `a timer that ran out wins over the next title, one that has not lets it start`() {
        assertEquals(EndDecision.Stop, decideAtEnd(1, 0, SleepTimer.At(now - 1), now))
        assertTrue(decideAtEnd(1, 0, SleepTimer.At(now + 60_000), now) is EndDecision.Continue)
    }

    @Test
    fun `when the limit and the timer both apply the timer stops it and no question is asked`() {
        assertEquals(EndDecision.Stop, decideAtEnd(3, 3, SleepTimer.At(now), now))
        assertEquals(EndDecision.Ask, decideAtEnd(3, 3, SleepTimer.At(now + 600_000), now))
    }

    @Test
    fun `a timer by the clock runs, warns in the last half minute, then is due`() {
        val timer = sleepAfterMinutes(15, now) as SleepTimer.At
        assertEquals(now + 15 * 60_000L, timer.endsAt)
        assertEquals(SleepState.Running, sleepState(timer, now))
        assertEquals(SleepState.Warning, sleepState(timer, timer.endsAt - SLEEP_WARNING_MS))
        assertEquals(SleepState.Due, sleepState(timer, timer.endsAt))
    }
}
