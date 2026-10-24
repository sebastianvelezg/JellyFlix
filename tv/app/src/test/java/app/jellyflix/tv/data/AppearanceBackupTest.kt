package app.jellyflix.tv.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class AppearanceBackupTest {
    private val now = Instant.parse("2026-10-23T12:00:00Z")
    private val look = Appearance(
        theme = ThemeChoice("midnight", "violet"),
        posters = PosterSize.Compact,
        home = HomeLayout(banner = false, order = HomeRow.entries.reversed(), hidden = setOf(HomeRow.Favorites)),
        nav = NavStyle.Text,
        menu = MenuLayout(MenuItem.entries.reversed(), setOf(MenuItem.Books)),
    )

    @Test
    fun aSavedLookComesBackTheSame() {
        val text = AppearanceBackup.merge(null, look, now)
        assertEquals(look, AppearanceBackup.parse(text))
    }

    @Test
    fun theFileIsTheOneTheWebAppWrites() {
        val file = JSONObject(AppearanceBackup.merge(null, look, now))
        assertEquals("jellyflix", file.getString("app"))
        assertEquals(1, file.getInt("version"))
        assertEquals("2026-10-23T12:00:00Z", file.getString("exportedAt"))
        val saved = file.getJSONObject("settings").getJSONObject("jellyflix.appearance")
        assertEquals("midnight", saved.getJSONObject("theme").getString("canvas"))
        assertEquals("violet", saved.getJSONObject("theme").getString("accent"))
        assertEquals("compact", saved.getString("posterSize"))
        assertEquals("text", saved.getString("nav"))
        assertEquals(false, saved.getJSONObject("home").getBoolean("banner"))
    }

    @Test
    fun whatTheWebAppKeptIsLeftAloneWhenTheTvSaves() {
        val web = """{"app":"jellyflix","version":1,"exportedAt":"x","settings":{
            "jellyflix.player":{"volume":0.5},
            "jellyflix.appearance":{"theme":{"canvas":"pine","accent":"rose"},"posterSize":"large","density":"compact","uiSize":"large","banner":"compact",
              "home":{"banner":true,"order":["music","continue"],"hidden":["music"]}}}}"""
        val saved = JSONObject(AppearanceBackup.merge(web, look, now))
        val settings = saved.getJSONObject("settings")
        assertEquals(0.5, settings.getJSONObject("jellyflix.player").getDouble("volume"), 0.0)
        val appearance = settings.getJSONObject("jellyflix.appearance")
        // The web client's own choices stay; the TV's replace theirs.
        assertEquals("compact", appearance.getString("density"))
        assertEquals("large", appearance.getString("uiSize"))
        assertEquals("compact", appearance.getString("banner"))
        assertEquals("midnight", appearance.getJSONObject("theme").getString("canvas"))
        val order = appearance.getJSONObject("home").getJSONArray("order")
        // The web client's "music" row, which the TV does not have, keeps its place at the end.
        assertEquals("music", order.getString(order.length() - 1))
        assertTrue(appearance.getJSONObject("home").getJSONArray("hidden").toString().contains("music"))
        assertEquals(look, AppearanceBackup.parse(saved.toString()))
    }

    @Test
    fun aLookMadeInTheWebAppIsReadHere() {
        val web = """{"app":"jellyflix","version":1,"settings":{"jellyflix.appearance":
            {"theme":{"canvas":"dusk","accent":"#aabbcc"},"posterSize":"large","home":{"banner":false,"order":["latestMovies","music"],"hidden":["music","nextUp"]}}}}"""
        val look = AppearanceBackup.parse(web)
        assertNotNull(look)
        assertEquals(ThemeChoice("dusk", "#aabbcc"), look!!.theme)
        assertEquals(PosterSize.Large, look.posters)
        assertEquals(HomeRow.LatestMovies, look.home.order.first())
        assertEquals(HomeRow.entries.size, look.home.order.size)
        assertEquals(setOf(HomeRow.NextUp), look.home.hidden)
        assertEquals(false, look.home.banner)
    }

    @Test
    fun whatIsNotOneOfOursIsRefused() {
        assertNull(AppearanceBackup.parse(null))
        assertNull(AppearanceBackup.parse(""))
        assertNull(AppearanceBackup.parse("not json"))
        assertNull(AppearanceBackup.parse("""{"app":"other","version":1,"settings":{}}"""))
        assertNull(AppearanceBackup.parse("""{"app":"jellyflix","version":2,"settings":{}}"""))
        // Ours, but with no look in it.
        assertNull(AppearanceBackup.parse("""{"app":"jellyflix","version":1,"settings":{"jellyflix.player":{}}}"""))
        assertNull(AppearanceBackup.parse("x".repeat(AppearanceBackup.MAX_CHARS + 1)))
    }

    @Test
    fun savingOverSomethingBrokenStartsAFreshFile() {
        val text = AppearanceBackup.merge("{broken", look, now)
        assertEquals(look, AppearanceBackup.parse(text))
        val other = AppearanceBackup.merge("""{"app":"other"}""", look, now)
        assertEquals(look, AppearanceBackup.parse(other))
    }

    @Test
    fun nothingButTheLookIsInTheFile() {
        val text = AppearanceBackup.merge(null, look, now)
        for (word in listOf("token", "password", "server", "http", "userId", "Authorization")) {
            assertTrue("the file mentions $word", !text.contains(word, ignoreCase = true))
        }
    }
}
