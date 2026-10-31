package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatchUpSettingsTest {
    @Test
    fun theTitlesUnderTheCardsAreOnUnlessTurnedOffAndTheChoiceIsKept() {
        assertTrue(Appearance().cardTitles)
        assertTrue(Appearance.decode { null }.cardTitles)
        val off = Appearance(cardTitles = false)
        val stored = off.encode()
        assertFalse(Appearance.decode { stored[it] }.cardTitles)
    }

    @Test
    fun nextUpLooksBackAsFarAsNeededUnlessTold() {
        assertEquals(NextUpWindow.Always, TvSettings().nextUp)
        assertEquals(0, NextUpWindow.Always.days)
        val chosen = TvSettings(nextUp = NextUpWindow.Days90)
        val stored = chosen.encode()
        assertEquals(NextUpWindow.Days90, TvSettings.decode { stored[it] }.nextUp)
        assertEquals(NextUpWindow.Always, TvSettings.decode { if (it == "nextUp") "Forever" else null }.nextUp)
    }
}
