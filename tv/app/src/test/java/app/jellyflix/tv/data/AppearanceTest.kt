package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppearanceTest {
    private fun surfaces(c: ThemeColors) = listOf(c.bg, c.surface, c.surface2, c.surface3, c.surface4)

    @Test
    fun theDefaultLookIsTheOneTheTvAlwaysHad() {
        val c = resolveTheme(ThemeChoice())
        assertEquals("#000000", c.bg)
        assertEquals("#111111", c.surface)
        assertEquals("#151515", c.surface2)
        assertEquals("#1c1c1c", c.surface3)
        assertEquals("#b3b3b3", c.muted)
        assertEquals("#4d8dff", c.accent)
        assertEquals(Appearance(), Appearance.decode { null })
    }

    @Test
    fun contrastIsMeasuredTheWcagWay() {
        assertEquals(21.0, contrastRatio("#000000", "#ffffff"), 0.01)
        assertEquals(1.0, contrastRatio("#336699", "#336699"), 0.0001)
        assertTrue(contrastRatio("#4d8dff", "#000000") > 4.5)
    }

    @Test
    fun everyAccentReadsOnEveryBackgroundAndItsTextReadsOnIt() {
        for (canvas in CANVASES) for (accent in ACCENTS) {
            val c = resolveTheme(ThemeChoice(canvas.id, accent.id))
            for (surface in surfaces(c)) {
                assertTrue("${accent.id} on ${canvas.id} $surface: ${contrastRatio(c.accent, surface)}", contrastRatio(c.accent, surface) >= 4.5)
            }
            assertTrue("text on ${accent.id}: ${contrastRatio(c.ink, c.accent)}", contrastRatio(c.ink, c.accent) >= 4.5)
        }
    }

    @Test
    fun secondaryTextReadsOnEverySurfaceOfEveryBackground() {
        for (canvas in CANVASES) {
            val c = resolveTheme(ThemeChoice(canvas.id, DEFAULT_ACCENT))
            for (surface in surfaces(c)) {
                assertTrue("muted on ${canvas.id} $surface: ${contrastRatio(c.muted, surface)}", contrastRatio(c.muted, surface) >= 4.5)
            }
        }
    }

    @Test
    fun aColourFromABackupOfTheWebAppWorksWhateverItIs() {
        for (hex in listOf("#000000", "#0a0a0a", "#7f7f7f", "#ff0000", "#00ff00", "#0000ff", "#ffffff", "#123456")) {
            for (canvas in CANVASES) {
                val c = resolveTheme(ThemeChoice(canvas.id, hex))
                for (surface in surfaces(c)) assertTrue("$hex on ${canvas.id}", contrastRatio(c.accent, surface) >= 4.5)
                assertTrue("text on $hex", contrastRatio(c.ink, c.accent) >= 4.5)
            }
        }
    }

    @Test
    fun aBrokenChoiceFallsBackToTheDefault() {
        assertEquals(ThemeChoice("black", "ocean"), sanitizeTheme(null, null))
        assertEquals(ThemeChoice("black", "ocean"), sanitizeTheme("neon", "plaid"))
        assertEquals(ThemeChoice("pine", "rose"), sanitizeTheme("pine", "rose"))
        // A typed colour is kept, spelled the same way; a short one is made long.
        assertEquals(ThemeChoice("dusk", "#aabbcc"), sanitizeTheme("dusk", "#AABBCC"))
        assertEquals(ThemeChoice("dusk", "#aabbcc"), sanitizeTheme("dusk", "#abc"))
        assertEquals("#4d8dff", accentColor("plaid"))
    }

    @Test
    fun theRowsAreMovedAndTurnedOffOneAtATime() {
        val start = HomeLayout()
        assertTrue(start.isDefault)
        val moved = start.moved(HomeRow.NextUp, -1)
        assertEquals(listOf(HomeRow.Discover, HomeRow.NextUp, HomeRow.Continue), moved.order.take(3))
        assertFalse(moved.isDefault)
        // At the ends a row stays where it is.
        assertEquals(start, start.moved(HomeRow.Discover, -1))
        assertEquals(start, start.moved(HomeRow.entries.last(), 1))
        val off = start.toggled(HomeRow.Favorites)
        assertFalse(HomeRow.Favorites in off.visible)
        assertEquals(HomeRow.entries.size - 1, off.visible.size)
        assertEquals(start, off.toggled(HomeRow.Favorites))
        // Moving does not bring a hidden row back.
        assertFalse(HomeRow.Favorites in off.moved(HomeRow.Favorites, -1).visible)
    }

    @Test
    fun aSavedHomeIsCleanedUp() {
        val layout = HomeLayout.sanitized(
            banner = false,
            order = listOf("latestMovies", "bogus", "continue", "latestMovies", null, 7),
            hidden = listOf("continue", "music", "continue"),
        )
        // Known rows first in the saved order, once each; the ones the copy never heard of follow.
        assertEquals(listOf(HomeRow.LatestMovies, HomeRow.Continue), layout.order.take(2))
        assertEquals(HomeRow.entries.size, layout.order.size)
        assertEquals(HomeRow.entries.toSet(), layout.order.toSet())
        assertEquals(setOf(HomeRow.Continue), layout.hidden)
        assertFalse(layout.banner)
        // Nothing saved is the default, banner on.
        assertTrue(HomeLayout.sanitized(null, null, null).isDefault)
    }

    @Test
    fun theLookSurvivesBeingStoredAsText() {
        val look = Appearance(
            theme = ThemeChoice("cocoa", "amber"),
            posters = PosterSize.Large,
            home = HomeLayout(banner = false, order = HomeRow.entries.reversed(), hidden = setOf(HomeRow.Because, HomeRow.NewAnime)),
            nav = NavStyle.Icons,
            menu = MenuLayout(MenuItem.entries.reversed(), setOf(MenuItem.Books, MenuItem.Music)),
        )
        val stored = look.encode()
        assertEquals(look, Appearance.decode { stored[it] })
        // Anything unreadable falls back, part by part.
        val bad = mapOf("canvas" to "x", "posters" to "Huge", "rows" to "nope,continue", "banner" to "maybe")
        val decoded = Appearance.decode { bad[it] }
        assertEquals(ThemeChoice(), decoded.theme)
        assertEquals(PosterSize.Comfortable, decoded.posters)
        assertEquals(HomeRow.Continue, decoded.home.order.first())
        assertFalse(decoded.home.banner)
        assertEquals(NavStyle.Full, decoded.nav)
    }

    @Test
    fun theTopMenuFollowsTheChosenOrderAndLeavesOutWhatIsOffOrMissing() {
        val layout = MenuLayout().moved(MenuItem.Music, -1).toggled(MenuItem.Series)
        // Music went before Live TV; Series is off; the account has no anime, books or collections.
        assertEquals(
            listOf(MenuItem.Home, MenuItem.Movies, MenuItem.Music, MenuItem.LiveTv),
            layout.arrange(setOf(MenuItem.Home, MenuItem.Movies, MenuItem.Series, MenuItem.LiveTv, MenuItem.Music)),
        )
        assertTrue(MenuLayout().isDefault)
        assertFalse(layout.isDefault)
        // Home never goes off or out of the list; the ends stay where they are.
        assertEquals(MenuLayout(), MenuLayout().toggled(MenuItem.Home))
        assertEquals(MenuLayout(), MenuLayout().moved(MenuItem.Home, -1))
        assertEquals(MenuLayout(), MenuLayout().moved(MenuItem.Collections, 1))
        // What was saved is cleaned up: unknown and repeated names go, missing ones come last, Home is on.
        val saved = MenuLayout.sanitized(listOf("music", "nope", "music", "books"), listOf("home", "books", 7))
        assertEquals(listOf(MenuItem.Music, MenuItem.Books), saved.order.take(2))
        assertEquals(MenuItem.entries.toSet(), saved.order.toSet())
        assertEquals(setOf(MenuItem.Books), saved.hidden)
    }

    @Test
    fun theMenuShowsNamesOnlyWhileTheyFit() {
        val names = listOf("Home", "Movies", "Series", "Music videos", "Books", "Live TV", "Music", "Collections", "Search", "Settings")
        // A wide screen keeps the names; a narrow one keeps the pictures.
        assertEquals(NavStyle.Full, navStyleFor(NavStyle.Full, names, 1400f))
        assertEquals(NavStyle.Icons, navStyleFor(NavStyle.Full, names, 700f))
        // Few sections fit where many do not.
        assertEquals(NavStyle.Full, navStyleFor(NavStyle.Full, names.take(4), 700f))
        // What was chosen is never changed by the room: names alone scroll, pictures alone always fit.
        assertEquals(NavStyle.Text, navStyleFor(NavStyle.Text, names, 100f))
        assertEquals(NavStyle.Icons, navStyleFor(NavStyle.Icons, names, 5000f))
        assertTrue(navButtonWidth("Movies", NavStyle.Icons) < navButtonWidth("Movies", NavStyle.Text))
        assertTrue(navButtonWidth("Movies", NavStyle.Text) < navButtonWidth("Movies", NavStyle.Full))
        assertEquals(NavStyle.Full, NavStyle.of("nonsense"))
        assertEquals(NavStyle.Text, NavStyle.of("text"))
    }

    @Test
    fun smallerPostersFitAnotherColumnAndLargerOnesLoseOne() {
        assertEquals(7, 6 + PosterSize.Compact.columnsOffset)
        assertEquals(6, 6 + PosterSize.Comfortable.columnsOffset)
        assertEquals(5, 6 + PosterSize.Large.columnsOffset)
        assertTrue(PosterSize.Compact.scale < PosterSize.Comfortable.scale && PosterSize.Comfortable.scale < PosterSize.Large.scale)
        assertEquals(1f, PosterSize.Comfortable.scale)
    }
}
