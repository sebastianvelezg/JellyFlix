package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class OrganiseTest {
    @Test
    fun watchLaterIsRecognisedByNameInEitherLanguage() {
        assertTrue(isWatchLater("Watch later"))
        assertTrue(isWatchLater("  watch LATER "))
        assertTrue(isWatchLater("Ver más tarde"))
        assertFalse(isWatchLater("Weekend movies"))
        val lists = listOf(
            VideoPlaylist(UUID.randomUUID(), "Weekend movies", null, 3),
            VideoPlaylist(UUID.randomUUID(), "Ver más tarde", null, 1),
        )
        assertEquals("Ver más tarde", findWatchLater(lists)?.name)
        assertNull(findWatchLater(lists.take(1)))
    }

    @Test
    fun aNewPlaylistGetsANameNobodyTypedThatIsNotTaken() {
        assertEquals("New playlist", newPlaylistName(emptyList(), "New playlist"))
        assertEquals("New playlist 2", newPlaylistName(listOf("New playlist"), "New playlist"))
        assertEquals("New playlist 3", newPlaylistName(listOf("new playlist", "New playlist 2", "Other"), "New playlist"))
        assertEquals("New playlist", newPlaylistName(listOf("Other"), "New playlist"))
    }

    @Test
    fun theFiltersButtonCountsEveryChoiceThatIsOn() {
        assertEquals(0, LibraryFilters().count)
        assertFalse(LibraryFilters().isActive)
        val some = LibraryFilters(watched = WatchedFilter.Unwatched, genre = "Drama", only4k = true)
        assertEquals(3, some.count)
        assertTrue(some.isActive)
        val all = LibraryFilters(WatchedFilter.Watched, true, "Drama", 1990, 7, "PG-13", true)
        assertEquals(7, all.count)
    }

    @Test
    fun aDecadeIsTenYearsStartingAtItsFirst() {
        assertNull(LibraryFilters().years)
        assertEquals((1990..1999).toList(), LibraryFilters(decade = 1990).years)
        assertEquals(10, LibraryFilters(decade = 2020).years?.size)
    }

    @Test
    fun theDecadesOfferedAreNewestFirstAndTheRatingsAreWholeNumbers() {
        assertEquals(listOf(2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950), LibraryFilters.DECADES)
        assertEquals(listOf(5, 6, 7, 8), LibraryFilters.MIN_RATINGS)
    }

    @Test
    fun clearingTheChoicesGivesTheDefaultsBack() {
        assertEquals(LibraryFilters(), LibraryFilters(watched = WatchedFilter.Watched, favoritesOnly = true).let { LibraryFilters() })
        assertEquals(WatchedFilter.All, LibraryFilters().watched)
        assertEquals(3, WatchedFilter.entries.size)
    }
}
