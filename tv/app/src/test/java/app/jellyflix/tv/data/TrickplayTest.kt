package app.jellyflix.tv.data

import org.jellyfin.sdk.model.api.TrickplayInfoDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class TrickplayTest {
    private fun dto(width: Int, tiles: Int = 10, count: Int = 250, interval: Int = 10_000) =
        TrickplayInfoDto(width = width, height = width * 9 / 16, tileWidth = tiles, tileHeight = tiles, thumbnailCount = count, interval = interval, bandwidth = 0)

    @Test
    fun aServerWithoutPicturesGivesNothing() {
        assertNull(pickTrickplay(null, "abc"))
        assertNull(pickTrickplay(emptyMap(), "abc"))
        assertNull(pickTrickplay(mapOf("abc" to emptyMap()), "abc"))
    }

    @Test
    fun theSizeNearestTo320IsChosen() {
        val offered = mapOf("src" to mapOf("160" to dto(160), "320" to dto(320), "640" to dto(640)))
        assertEquals(320, pickTrickplay(offered, "src")?.width)
        assertEquals(240, pickTrickplay(mapOf("src" to mapOf("240" to dto(240), "1280" to dto(1280))), "src")?.width)
    }

    @Test
    fun sizesTheServerLeftIncompleteAreIgnored() {
        val broken = dto(320).copy(thumbnailCount = 0)
        val offered = mapOf("src" to mapOf("320" to broken, "640" to dto(640)))
        assertEquals(640, pickTrickplay(offered, "src")?.width)
        assertNull(pickTrickplay(mapOf("src" to mapOf("320" to broken)), "src"))
    }

    @Test
    fun theFileIsFoundWhateverWayItsIdIsSpelled() {
        val offered = mapOf("0123456789ABCDEF0123456789abcdef" to mapOf("320" to dto(320)))
        assertNotNull(pickTrickplay(offered, "01234567-89ab-cdef-0123-456789abcdef"))
        assertNotNull(pickTrickplay(offered, "0123456789abcdef0123456789ABCDEF"))
    }

    @Test
    fun aTitleWithOneFileUsesItsPicturesAndWithSeveralItNeedsTheRightOne() {
        val one = mapOf("other" to mapOf("320" to dto(320)))
        assertNotNull(pickTrickplay(one, "src"))
        val two = one + ("another" to mapOf("320" to dto(320)))
        assertNull(pickTrickplay(two, "src"))
        assertNotNull(pickTrickplay(two, "another"))
    }

    @Test
    fun theTileIsFoundOnTheRightSheetAtTheRightPlace() {
        val info = pickTrickplay(mapOf("s" to mapOf("320" to dto(320))), "s")!!
        assertEquals(TrickplayTile(sheet = 0, column = 0, row = 0, index = 0), trickplayTile(info, 0))
        assertEquals(TrickplayTile(0, 9, 0, 9), trickplayTile(info, 95_000))
        // Ten pictures across: the eleventh starts the second row.
        assertEquals(TrickplayTile(0, 0, 1, 10), trickplayTile(info, 100_000))
        // A hundred pictures make a sheet.
        assertEquals(TrickplayTile(1, 0, 0, 100), trickplayTile(info, 1_000_000))
        assertEquals(TrickplayTile(1, 0, 0, 100), trickplayTile(info, 1_009_999))
    }

    @Test
    fun beforeTheStartAndPastTheEndStayOnARealPicture() {
        val info = pickTrickplay(mapOf("s" to mapOf("320" to dto(320))), "s")!!
        assertEquals(0, trickplayTile(info, -5_000).index)
        // 250 pictures: the last is number 249, on the third sheet.
        assertEquals(TrickplayTile(2, 9, 4, 249), trickplayTile(info, 99_999_999))
    }

    @Test
    fun anIdWithOrWithoutDashesBecomesTheSameId() {
        val plain = "0123456789abcdef0123456789abcdef"
        assertEquals(uuidOf(plain), uuidOf("01234567-89ab-cdef-0123-456789abcdef"))
        try {
            uuidOf("nope")
            fail("a short id is not an id")
        } catch (_: IllegalArgumentException) {
            // expected
        }
    }
}
