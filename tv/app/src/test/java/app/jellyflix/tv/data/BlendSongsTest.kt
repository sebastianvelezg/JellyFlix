package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class BlendSongsTest {
    private fun song(name: String, artist: String) = Song(UUID.randomUUID(), name, artist, "", null, null, null, null)

    @Test
    fun `takes one song from each list in turn`() {
        val a = listOf(song("a1", "A"), song("a2", "A"))
        val b = listOf(song("b1", "B"), song("b2", "B"))
        val c = listOf(song("c1", "C"))
        assertEquals(listOf("a1", "b1", "c1", "a2", "b2"), blendSongs(listOf(a, b, c), 10).map { it.name })
    }

    @Test
    fun `stops at the size asked for`() {
        val lists = listOf(List(10) { song("x$it", "X$it") }, List(10) { song("y$it", "Y$it") })
        assertEquals(5, blendSongs(lists, 5).size)
    }

    @Test
    fun `a song that is in two lists is taken once`() {
        val shared = song("shared", "S")
        val out = blendSongs(listOf(listOf(shared, song("a", "A")), listOf(shared, song("b", "B"))), 10)
        assertEquals(listOf("shared", "b", "a").sorted(), out.map { it.name }.sorted())
        assertEquals(3, out.size)
    }

    @Test
    fun `two songs by the same artist do not follow each other when another choice exists`() {
        val first = listOf(song("a1", "A"), song("a2", "A"))
        val second = listOf(song("a3", "A"), song("b1", "B"))
        val out = blendSongs(listOf(first, second), 10)
        assertEquals(4, out.size)
        assertTrue(out.zipWithNext().count { (x, y) -> x.artist == y.artist } <= 1) // only the unavoidable run at the end
        assertEquals("A", out[0].artist)
        assertEquals("B", out[1].artist)
    }

    @Test
    fun `when only one artist is left it is taken rather than ending the mix short`() {
        val only = listOf(song("a1", "A"), song("a2", "A"), song("a3", "A"))
        assertEquals(3, blendSongs(listOf(only), 10).size)
    }
}
