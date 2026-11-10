package app.jellyflix.tv.data

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncTest {
    // ---- the rules ----

    private fun section(at: Long, by: String = "web") = RemoteSection(1, at, by, JSONObject())

    @Test
    fun `nothing happens when neither side changed, and a new copy of the account is taken`() {
        assertEquals(SectionAction.None, planSection(section(5), false, "L", SectionState(5, "L"), 100).action)
        assertEquals(SectionAction.Apply, planSection(section(9), false, "L", SectionState(5, "L"), 100).action)
    }

    @Test
    fun `a change made here is sent and keeps its time when it could not be`() {
        val plan = planSection(section(5), false, "MINE", SectionState(5, "L"), 6_000)
        assertEquals(SectionAction.Push, plan.action)
        assertEquals(6_000L, plan.dirtyAt)
        assertEquals(6_000L, planSection(section(5), false, "MINE", SectionState(5, "L", plan.dirtyAt), 99_000).dirtyAt)
    }

    @Test
    fun `when both sides changed the later change wins, per section`() {
        assertEquals(SectionAction.ApplyConflict, planSection(section(9_000), false, "MINE", SectionState(5_000, "L", 8_000), 10_000).action)
        assertEquals(SectionAction.Push, planSection(section(9_000), false, "MINE", SectionState(5_000, "L", 9_500), 10_000).action)
    }

    @Test
    fun `a copy of a later format is left alone and a push is stamped above what is saved`() {
        assertEquals(SectionAction.Skip, planSection(null, true, "L", null, 1).action)
        assertEquals(501L, pushStamp(100, section(500)))
        assertEquals(1_000L, pushStamp(1_000, section(500)))
    }

    @Test
    fun `the saved file keeps sections it does not know and ignores later formats`() {
        val text = """{"v":1,"sections":{"appearance":{"v":1,"at":5,"by":"web","data":{"theme":{"canvas":"pine"}}},"playback":{"v":2,"at":1,"by":"web","data":{}},"extra":{"v":1,"at":1,"by":"x","data":{"keep":1}}}}"""
        val file = SyncFile.parse(text)
        assertNotNull(file.readable(SyncSection.Appearance))
        assertNull(file.readable(SyncSection.Playback))
        assertTrue(file.hasNewer(SyncSection.Playback))
        val written = file.with(SyncSection.Appearance, RemoteSection(1, 9, "tv", JSONObject().put("a", 1))).serialize()
        assertTrue(written.contains("\"extra\""))
        assertTrue(written.contains("\"keep\""))
        assertEquals(9L, SyncFile.parse(written).readable(SyncSection.Appearance)?.at)
        assertNull(SyncFile.parse("{not json").readable(SyncSection.Appearance))
    }

    @Test
    fun `what a device remembers survives being stored`() {
        val state = SyncPrefsState(true, mapOf(SyncSection.Appearance to SectionState(5, "x", 7), SyncSection.Playback to SectionState(2, null, null)))
        assertEquals(state, SyncPrefsState.decode(state.encode()))
        assertEquals(SyncPrefsState(), SyncPrefsState.decode("garbage"))
    }

    // ---- the data ----

    private val base = SyncValues(Appearance(), TvSettings(), true)

    @Test
    fun `the theme and the menu of the web arrive, what depends on the screen does not`() {
        val data = JSONObject("""{"theme":{"canvas":"midnight","accent":"violet"},"menu":{"order":["music","home"],"hidden":["books"]},"home":{"banner":false,"order":["continue"],"hidden":[]}}""")
        val tv = base.copy(look = base.look.copy(posters = PosterSize.Large), settings = base.settings.copy(margin = ScreenMargin.entries.last()))
        val result = sanitizeSection(SyncSection.Appearance, data, tv)
        assertEquals("midnight", result.look.theme.canvas)
        assertFalse(result.look.home.banner)
        assertEquals(PosterSize.Large, result.look.posters)
        assertEquals(tv.settings.margin, result.settings.margin)
    }

    @Test
    fun `playback choices go through the same words on both apps`() {
        val tv = base.copy(settings = base.settings.copy(stillWatching = StillWatching.After4, skipIntro = SkipAction.Auto, skipPreview = SkipAction.Off), autoplayNext = false)
        val json = collectSection(SyncSection.Playback, tv)
        assertEquals("auto", json.getJSONObject("skip").getString("intro"))
        assertEquals(4, json.getInt("stillWatching"))
        assertEquals(tv, sanitizeSection(SyncSection.Playback, json, base).let { base.copy(settings = base.settings.copy(stillWatching = it.settings.stillWatching, skipIntro = it.settings.skipIntro, skipPreview = it.settings.skipPreview), autoplayNext = it.autoplayNext) })
        // Nonsense becomes the defaults.
        val clean = sanitizeSection(SyncSection.Playback, JSONObject("""{"stillWatching":7,"skip":{"intro":"explode"},"autoplayNext":"x"}"""), tv)
        assertEquals(StillWatching.Off, clean.settings.stillWatching)
        assertEquals(SkipAction.Ask, clean.settings.skipIntro)
    }

    @Test
    fun `ids only the web has keep their place when this TV sends its order`() {
        val remote = JSONObject("""{"theme":{"canvas":"black","accent":"blue"},"menu":{"order":["home","futuristic"],"hidden":["futuristic"]},"home":{"banner":true,"order":["discover","music"],"hidden":["music"]}}""")
        val pushed = dataToPush(SyncSection.Appearance, base, remote)
        assertTrue(pushed.getJSONObject("menu").getJSONArray("order").toString().contains("futuristic"))
        assertTrue(pushed.getJSONObject("home").getJSONArray("hidden").toString().contains("music"))
        // And this TV's own ids are all there.
        assertTrue(pushed.getJSONObject("menu").getJSONArray("order").toString().contains("collections"))
    }

    // ---- the engine ----

    /** An account in memory, a TV with values and a state, and a clock. */
    private class Rig {
        var remote: String? = null
        var offline = false
        var values = SyncValues(Appearance(), TvSettings(), true)
        var state = SyncPrefsState()
        var now = 1_000_000L
        val engine = SyncEngine(
            load = { if (offline) throw java.io.IOException("offline"); RemoteText(remote, null) },
            save = { if (offline) throw java.io.IOException("offline"); remote = it },
            values = { values },
            setValues = { values = it },
            state = { state },
            setState = { state = it },
            clock = { now },
        )

        fun file() = SyncFile.parse(remote)
    }

    @Test
    fun `it does nothing while it is off`() = runBlocking {
        val rig = Rig()
        val report = rig.engine.run()
        assertEquals(SyncReport(at = rig.now), report)
        assertNull(rig.remote)
    }

    @Test
    fun `turned on with an empty account it uploads this TV's choices, saying who saved them`() = runBlocking {
        val rig = Rig()
        rig.values = rig.values.copy(look = rig.values.look.copy(theme = sanitizeTheme("pine", "blue")))
        assertEquals(FirstActivation.Upload, rig.engine.preview())
        val report = rig.engine.enable(useAccount = false)
        assertEquals(setOf(SyncSection.Appearance, SyncSection.Playback), report.pushed.toSet())
        val saved = rig.file().readable(SyncSection.Appearance)!!
        assertEquals("tv", saved.by)
        assertEquals("pine", saved.data.getJSONObject("theme").getString("canvas"))
        assertTrue(rig.state.enabled)
    }

    @Test
    fun `a theme saved by the web reaches this TV without touching its margin`() = runBlocking {
        val rig = Rig()
        rig.values = rig.values.copy(settings = rig.values.settings.copy(margin = ScreenMargin.entries.last()))
        rig.engine.enable(false)
        val web = SyncFile.parse(rig.remote).with(
            SyncSection.Appearance,
            RemoteSection(1, rig.now + 60_000, "web", JSONObject("""{"theme":{"canvas":"midnight","accent":"violet"},"menu":{"order":[],"hidden":[]},"home":{"banner":false,"order":[],"hidden":[]}}""")),
        )
        rig.remote = web.serialize()
        val report = rig.engine.run()
        assertEquals(listOf(SyncSection.Appearance), report.applied)
        assertEquals("midnight", rig.values.look.theme.canvas)
        assertEquals(ScreenMargin.entries.last(), rig.values.settings.margin)
    }

    @Test
    fun `a change made here is sent and is the newest on the account`() = runBlocking {
        val rig = Rig()
        rig.engine.enable(false)
        val before = rig.file().readable(SyncSection.Playback)!!.at
        rig.now += 10_000
        rig.values = rig.values.copy(settings = rig.values.settings.copy(stillWatching = StillWatching.After3))
        val report = rig.engine.run()
        assertEquals(listOf(SyncSection.Playback), report.pushed)
        val after = rig.file().readable(SyncSection.Playback)!!
        assertTrue(after.at > before)
        assertEquals(3, after.data.getInt("stillWatching"))
    }

    @Test
    fun `the first time it asks when the account has different choices, and each answer does what it says`() = runBlocking {
        val rig = Rig()
        rig.remote = SyncFile().with(SyncSection.Appearance, RemoteSection(1, 5_000, "web", JSONObject("""{"theme":{"canvas":"midnight","accent":"violet"}}"""))).serialize()
        val preview = rig.engine.preview()
        assertTrue(preview is FirstActivation.Ask)
        assertEquals(SyncSection.Appearance, (preview as FirstActivation.Ask).sections.single().section)
        // Asking changed nothing.
        assertEquals("black", rig.values.look.theme.canvas)
        rig.engine.enable(useAccount = true)
        assertEquals("midnight", rig.values.look.theme.canvas)
        rig.engine.disable()
        rig.values = rig.values.copy(look = rig.values.look.copy(theme = sanitizeTheme("pine", "blue")))
        rig.engine.enable(useAccount = false)
        assertEquals("pine", rig.file().readable(SyncSection.Appearance)!!.data.getJSONObject("theme").getString("canvas"))
    }

    @Test
    fun `a change made offline is sent later, judged by when it was made`() = runBlocking {
        val rig = Rig()
        rig.engine.enable(false)
        rig.offline = true
        rig.now += 5_000
        rig.values = rig.values.copy(settings = rig.values.settings.copy(stillWatching = StillWatching.After6))
        val failed = rig.engine.run()
        assertNotNull(failed.error)
        assertNotNull(rig.state.sections[SyncSection.Playback]?.dirtyAt)
        // Back online, the account has nothing newer: it goes up.
        rig.offline = false
        rig.now += 60_000
        val report = rig.engine.run()
        assertEquals(listOf(SyncSection.Playback), report.pushed)
        assertEquals(6, rig.file().readable(SyncSection.Playback)!!.data.getInt("stillWatching"))
    }

    @Test
    fun `an offline change loses to an account copy that is newer, and the TV says so`() = runBlocking {
        val rig = Rig()
        rig.engine.enable(false)
        rig.offline = true
        rig.now += 5_000
        rig.values = rig.values.copy(settings = rig.values.settings.copy(stillWatching = StillWatching.After6))
        rig.engine.run()
        rig.offline = false
        val newer = JSONObject("""{"autoplayNext":false,"stillWatching":8,"skip":{"intro":"auto","recap":"ask","outro":"ask","preview":"ask"}}""")
        rig.remote = rig.file().with(SyncSection.Playback, RemoteSection(1, rig.now + 3_600_000, "web", newer)).serialize()
        val report = rig.engine.run()
        assertEquals(listOf(SyncSection.Playback), report.conflicts)
        assertEquals(StillWatching.After8, rig.values.settings.stillWatching)
        assertFalse(rig.values.autoplayNext)
    }

    @Test
    fun `a section of a later format and sections it does not know stay exactly as they were`() = runBlocking {
        val rig = Rig()
        rig.remote = SyncFile().with(SyncSection.Playback, RemoteSection(2, 5_000, "web", JSONObject("""{"future":true}"""))).serialize()
        rig.remote = JSONObject(rig.remote!!).also { it.getJSONObject("sections").put("extra", JSONObject("""{"v":1,"at":1,"by":"x","data":{"keep":"me"}}""")) }.toString()
        rig.engine.enable(false)
        rig.values = rig.values.copy(look = rig.values.look.copy(theme = sanitizeTheme("pine", "blue")))
        rig.engine.run()
        val sections = JSONObject(rig.remote!!).getJSONObject("sections")
        assertEquals(2, sections.getJSONObject("playback").getInt("v"))
        assertTrue(sections.getJSONObject("playback").getJSONObject("data").getBoolean("future"))
        assertEquals("me", sections.getJSONObject("extra").getJSONObject("data").getString("keep"))
    }

    @Test
    fun `leaving the account while the server answers stops the run and writes nothing into the state`() {
        // The account was left while the request was going: the run ends by cancellation and the state, which by then belongs to
        // whoever is in use now, is not touched (it must not be remembered as "the server could not be reached").
        var state = SyncPrefsState(true, mapOf(SyncSection.Appearance to SectionState(5_000L, "x", null)))
        var writes = 0
        val reading = SyncEngine(
            load = { throw kotlinx.coroutines.CancellationException("The account was left") },
            save = { },
            values = { SyncValues(Appearance(), TvSettings(), true) },
            setValues = { },
            state = { state },
            setState = { state = it; writes++ },
        )
        val cancelled = runCatching { runBlocking { reading.run() } }.exceptionOrNull()
        assertTrue(cancelled is kotlinx.coroutines.CancellationException)
        assertEquals(0, writes)

        val saving = SyncEngine(
            load = { RemoteText(null, null) },
            save = { throw kotlinx.coroutines.CancellationException("The account was left") },
            values = { SyncValues(Appearance(), TvSettings(), true) },
            setValues = { },
            state = { state },
            setState = { state = it; writes++ },
        )
        val cancelledSaving = runCatching { runBlocking { saving.run() } }.exceptionOrNull()
        assertTrue(cancelledSaving is kotlinx.coroutines.CancellationException)
        assertEquals(0, writes)
    }
}
