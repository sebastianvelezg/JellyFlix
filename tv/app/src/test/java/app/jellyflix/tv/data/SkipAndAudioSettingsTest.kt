package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SkipAndAudioSettingsTest {
    @Test
    fun theChoicePerKindAndTheConvertedSoundComeBackAsTheyWere() {
        val chosen = TvSettings(
            skipIntro = SkipAction.Auto,
            skipRecap = SkipAction.Off,
            skipOutro = SkipAction.Ask,
            skipPreview = SkipAction.Auto,
            convertAudio = setOf(AudioFormat.Dts, AudioFormat.Ac3),
        )
        val stored = chosen.encode()
        assertEquals(chosen, TvSettings.decode { stored[it] })
    }

    @Test
    fun eachKindHasItsOwnAction() {
        val s = TvSettings(skipIntro = SkipAction.Auto, skipOutro = SkipAction.Off)
        assertEquals(SkipAction.Auto, s.skipFor(SegmentKind.Intro))
        assertEquals(SkipAction.Ask, s.skipFor(SegmentKind.Recap))
        assertEquals(SkipAction.Off, s.skipFor(SegmentKind.Outro))
        assertEquals(SkipAction.Ask, s.skipFor(SegmentKind.Preview))
    }

    @Test
    fun theOldSwitchStillDecidesIntrosRecapsAndCreditsUntilAChoiceIsSaved() {
        val migrated = TvSettings.decode(legacyAutoSkip = true) { null }
        assertEquals(SkipAction.Auto, migrated.skipIntro)
        assertEquals(SkipAction.Auto, migrated.skipRecap)
        assertEquals(SkipAction.Auto, migrated.skipOutro)
        assertEquals(SkipAction.Ask, migrated.skipPreview)

        val saved = mapOf("skipIntro" to "Ask")
        assertEquals(SkipAction.Ask, TvSettings.decode(legacyAutoSkip = true) { saved[it] }.skipIntro)
    }

    @Test
    fun nothingSavedAsksEverywhereAndConvertsNothing() {
        val s = TvSettings.decode { null }
        assertTrue(SegmentKind.entries.all { s.skipFor(it) == SkipAction.Ask })
        assertTrue(s.convertAudio.isEmpty())
        assertTrue(s.limits.avoidAudio.isEmpty())
    }

    @Test
    fun anUnknownFormatInTheSavedListIsIgnored() {
        val stored = mapOf("convertAudio" to "Dts,Vorbis,,Eac3")
        assertEquals(setOf(AudioFormat.Dts, AudioFormat.Eac3), TvSettings.decode { stored[it] }.convertAudio)
    }

    @Test
    fun theConvertedFormatsGoToTheServerAsCodecNames() {
        val limits = TvSettings(convertAudio = setOf(AudioFormat.Dts, AudioFormat.TrueHd)).limits
        assertEquals(setOf("dts", "truehd"), limits.avoidAudio)
    }
}
