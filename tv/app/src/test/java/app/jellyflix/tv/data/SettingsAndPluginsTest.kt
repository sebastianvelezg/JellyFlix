package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TvSettingsTest {
    @Test
    fun savedChoicesComeBackAsTheyWere() {
        val chosen = TvSettings(
            subtitleSize = SubtitleSize.Huge,
            subtitleColor = SubtitleColor.Yellow,
            subtitleBackground = SubtitleBackground.Box,
            subtitlePosition = SubtitlePosition.High,
            quality = QualityLimit.Mbps10,
            directOnly = true,
            textSize = TextSize.Larger,
            margin = ScreenMargin.Medium,
            frameRate = FrameRateMode.Always,
        )
        val stored = chosen.encode()
        assertEquals(chosen, TvSettings.decode { stored[it] })
    }

    @Test
    fun nothingSavedMeansTheDefaults() {
        assertEquals(TvSettings(), TvSettings.decode { null })
    }

    @Test
    fun aValueFromAnOtherVersionFallsBackToTheDefault() {
        val stored = mapOf("subSize" to "Gigantic", "quality" to "Mbps9000", "directOnly" to "maybe")
        val read = TvSettings.decode { stored[it] }
        assertEquals(SubtitleSize.Medium, read.subtitleSize)
        assertEquals(QualityLimit.Auto, read.quality)
        assertFalse(read.directOnly)
    }

    @Test
    fun theQualityLimitIsSentToTheServerInBitsPerSecond() {
        assertEquals(PlayLimits.DEFAULT_MAX_BITRATE, TvSettings().limits.maxBitrate)
        assertEquals(20_000_000, TvSettings(quality = QualityLimit.Mbps20).limits.maxBitrate)
        assertTrue(TvSettings().limits.transcodeAllowed)
        assertFalse(TvSettings(directOnly = true).limits.transcodeAllowed)
    }

    @Test
    fun optionsGrowInSteps() {
        assertTrue(SubtitleSize.entries.zipWithNext().all { (a, b) -> a.fraction < b.fraction })
        assertTrue(TextSize.entries.zipWithNext().all { (a, b) -> a.scale < b.scale })
        assertTrue(ScreenMargin.entries.zipWithNext().all { (a, b) -> a.fraction < b.fraction })
    }
}

class PluginsTest {
    private fun task(name: String, category: String = "", running: Boolean = false) = ServerTask(name, category, running, null, null, null)

    private val plugins = listOf(
        ServerPlugin("Intro Skipper", "12.0.5", "Active"),
        ServerPlugin("Lyrics", "1.7.2", "Active"),
        ServerPlugin("TMDb", "12.0.0", "Active"),
    )
    private val tasks = listOf(
        task("Detect and Analyze Media Segments", "Intro Skipper"),
        task("Download and upgrade lyrics", "Lyrics"),
        task("Download missing lyrics", "Lyrics", running = true),
        task("Clean cache directories", "Maintenance"),
    )

    @Test
    fun supportedPluginsGetTheirTasks() {
        val report = classifyPlugins(plugins, tasks)
        assertTrue(report.admin)
        val intro = report.cards.first { it.kind == PluginKind.IntroSkipper }
        assertEquals("12.0.5", intro.plugin?.version)
        assertEquals(listOf("Detect and Analyze Media Segments"), intro.tasks.map { it.name })
        assertEquals(2, report.cards.first { it.kind == PluginKind.Lyrics }.tasks.size)
    }

    @Test
    fun aMissingPluginHasNoTasksEvenIfAnotherTaskMatches() {
        val report = classifyPlugins(plugins, tasks + task("Download missing subtitles", "Subtitles"))
        val subtitles = report.cards.first { it.kind == PluginKind.Subtitles }
        assertNull(subtitles.plugin)
        assertTrue(subtitles.tasks.isEmpty())
    }

    @Test
    fun theNewPluginsAreRecognisedAsOnAServerThatHasThem() {
        val server = plugins + listOf(
            ServerPlugin("TMDb Box Sets", "15.0.0.0", "Active"),
            ServerPlugin("Fanart", "15.0.0.0", "Active"),
            ServerPlugin("AniList", "15.0.0.0", "Active"),
            ServerPlugin("Playback Reporting", "19.0.0.0", "Active"),
        )
        val serverTasks = tasks + listOf(
            task("Scan library for new box sets", "TMDb"),
            task("Playback Reporting Run Backup", "Playback Reporting"),
            task("Playback Reporting Trim Db", "Playback Reporting"),
            task("Refresh upcoming and missing episodes (TheMovieDb)", "Library"),
        )
        val report = classifyPlugins(server, serverTasks)
        assertEquals(listOf("Scan library for new box sets"), report.cards.first { it.kind == PluginKind.BoxSets }.tasks.map { it.name })
        assertEquals(2, report.cards.first { it.kind == PluginKind.PlaybackReporting }.tasks.size)
        assertEquals("15.0.0.0", report.cards.first { it.kind == PluginKind.Fanart }.plugin?.version)
        assertTrue(report.cards.first { it.kind == PluginKind.Fanart }.tasks.isEmpty())
        assertEquals("15.0.0.0", report.cards.first { it.kind == PluginKind.AniList }.plugin?.version)
        // The metadata plugin by itself is not the Box Sets one.
        assertEquals(listOf("TMDb 12.0.0"), report.others)
        assertNull(classifyPlugins(plugins, serverTasks).cards.first { it.kind == PluginKind.BoxSets }.plugin)
    }

    @Test
    fun otherPluginsAreListedByName() {
        assertEquals(listOf("TMDb 12.0.0"), classifyPlugins(plugins, tasks).others)
    }

    @Test
    fun aRunningTaskIsNoticed() {
        assertTrue(classifyPlugins(plugins, tasks).anyRunning)
        assertFalse(classifyPlugins(plugins, tasks.map { it.copy(running = false) }).anyRunning)
    }

    @Test
    fun anAccountThatIsNotAnAdministratorSeesNothing() {
        assertFalse(PluginsReport.NotAdmin.admin)
        assertNotNull(PluginsReport.NotAdmin.cards)
        assertTrue(PluginsReport.NotAdmin.cards.isEmpty())
    }
}
