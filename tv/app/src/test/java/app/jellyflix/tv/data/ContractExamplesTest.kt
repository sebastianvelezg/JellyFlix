package app.jellyflix.tv.data

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reads the example answers the modules container's own tests keep in modules/contract/examples/ and gives them to this app's parsers.
 * The TV has no generated copy of the contract; if the container changes an answer and Modules.kt is not followed, this fails.
 */
class ContractExamplesTest {
    private fun example(name: String): String {
        val file = File("../../modules/contract/examples/$name.json")
        assertTrue("${file.canonicalPath} is missing (run the container's tests with UPDATE_EXAMPLES=1)", file.exists())
        return file.readText()
    }

    @Test
    fun `the list of channels is read`() {
        val channels = parseChannels(JSONArray(example("channels")))
        assertTrue(channels.isNotEmpty())
        assertTrue(channels.all { it.id.isNotBlank() && it.name.isNotBlank() && it.number > 0 })
    }

    @Test
    fun `the window of a channel is read, with a program on`() {
        val window = parseWindow(JSONObject(example("channel-window")))
        assertTrue(window.id.isNotBlank())
        assertTrue(window.programs.isNotEmpty())
        assertTrue(window.currentIndex in window.programs.indices)
        assertTrue(window.programs.all { it.itemId.isNotBlank() && it.end > it.start && it.title.isNotBlank() })
    }

    @Test
    fun `a Match room being swiped is read`() {
        val room = parseMatchRoom(JSONObject(example("match-room-swiping")))
        assertEquals("swipe", room.phase)
        assertTrue(room.code.isNotBlank() && room.hostId.isNotBlank() && room.me.isNotBlank())
        assertTrue(room.deck.isNotEmpty())
        assertTrue(room.deck.all { it.id.isNotBlank() && it.name.isNotBlank() })
        assertTrue(room.members.isNotEmpty())
        assertEquals("Comedy", room.filters.genre)
    }

    @Test
    fun `a finished Match room is read, with its winner and summary`() {
        val room = parseMatchRoom(JSONObject(example("match-room-done")))
        assertEquals("done", room.phase)
        assertNotNull(room.winner)
        assertTrue(room.winner!!.name.isNotBlank())
        assertNotNull(room.winnerBy)
        val summary = room.summary
        assertNotNull(summary)
        assertTrue(summary!!.rounds >= 1)
        assertNotNull(summary.total)
    }

    @Test
    fun `the list of rooms is read`() {
        val rooms = parseRoomSummaries(JSONArray(example("match-rooms")))
        assertFalse(rooms.isEmpty())
        assertTrue(rooms.all { it.id.isNotBlank() && it.code.isNotBlank() && it.phase.isNotBlank() })
    }
}
