package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ScreensaverSettingsTest {
    @Test
    fun theScreensaverIsOffByDefaultAndTheChoicesComeBackAsTheyWere() {
        assertEquals(ScreensaverDelay.Off, TvSettings().screensaver)
        assertEquals(0, TvSettings().screensaver.minutes)
        val chosen = TvSettings(screensaver = ScreensaverDelay.Minutes10, screensaverSource = ScreensaverSource.Series, screensaverRating = ScreensaverRating.Pg13)
        val stored = chosen.encode()
        assertEquals(chosen, TvSettings.decode { stored[it] })
    }

    @Test
    fun anUnknownValueFallsBackToTheDefault() {
        val decoded = TvSettings.decode { if (it.startsWith("screensaver")) "Nope" else null }
        assertEquals(ScreensaverDelay.Off, decoded.screensaver)
        assertEquals(ScreensaverSource.All, decoded.screensaverSource)
        assertEquals(ScreensaverRating.NoLimit, decoded.screensaverRating)
    }

    @Test
    fun onlyTheRatingsWithALimitAskTheServerForOne() {
        assertNull(ScreensaverRating.NoLimit.rating)
        assertEquals("PG-13", ScreensaverRating.Pg13.rating)
        assertEquals(listOf(2, 5, 10, 15), ScreensaverDelay.values().map { it.minutes }.filter { it > 0 })
    }
}
