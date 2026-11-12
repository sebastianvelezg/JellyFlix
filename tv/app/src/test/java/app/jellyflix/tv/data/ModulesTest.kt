package app.jellyflix.tv.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModulesTest {
    private fun program(start: Long, end: Long, id: String = "00000000000000000000000000000001") = ModuleProgram(start, end, id, "T$start", null, end - start)

    @Test
    fun `a Jellyfin id without dashes becomes a UUID, and one with dashes is kept`() {
        assertEquals("0123abcd-0123-4567-89ab-0123456789ab", uuidOfHex("0123abcd0123456789ab0123456789ab").toString())
        assertEquals("0123abcd-0123-4567-89ab-0123456789ab", uuidOfHex("0123abcd-0123-4567-89ab-0123456789ab").toString())
    }

    @Test
    fun `a colour is read, and one that is not a colour is the accent blue`() {
        assertEquals(0xFFE5484D.toInt(), parseColor("#e5484d"))
        assertEquals(0xFF4D8DFF.toInt(), parseColor("red"))
        assertEquals(0xFF4D8DFF.toInt(), parseColor(null))
    }

    @Test
    fun `the answer for a channel window is read, with the program that is on`() {
        val json = JSONObject(
            """{"serverTime":1000,"channel":{"id":"c1","number":7,"name":"Comedy","color":"#e5484d"},
               "programs":[{"start":900,"end":1100,"itemId":"a","title":"One","type":"Movie","runtime":200},
                           {"start":1100,"end":1300,"itemId":"b","title":"Two","subtitle":"The Show · S01E02","type":"Episode","runtime":200}],
               "currentIndex":0}""",
        )
        val window = parseWindow(json)
        assertEquals(7, window.number)
        assertEquals(0xFFE5484D.toInt(), window.color)
        assertEquals(2, window.programs.size)
        assertEquals("The Show · S01E02", window.programs[1].subtitle)
        assertNull(window.programs[0].subtitle)
        assertEquals(0, window.currentIndex)
    }

    @Test
    fun `a list of channels is read with what is on and what is next`() {
        val array = JSONArray(
            """[{"id":"c1","number":1,"name":"A","color":"#4d8dff","enabled":true,"mode":"marathon","poolSize":4,
                 "now":{"start":0,"end":10,"itemId":"x","title":"Now","type":"Movie","runtime":10},
                 "next":{"start":10,"end":20,"itemId":"y","title":"Next","type":"Movie","runtime":10}},
                {"id":"c2","number":2,"name":"B","color":"#4d8dff","enabled":false}]""",
        )
        val channels = parseChannels(array)
        assertEquals("Now", channels[0].now?.title)
        assertEquals("Next", channels[0].next?.title)
        assertNull(channels[1].now)
        assertFalse(channels[1].enabled)
    }

    @Test
    fun `the program on and how far into it, and nothing outside the schedule`() {
        val list = listOf(program(0, 100), program(100, 250), program(250, 300))
        assertEquals(0 to 0L, locateProgram(list, 0))
        assertEquals(0 to 99L, locateProgram(list, 99))
        assertEquals(1 to 0L, locateProgram(list, 100))
        assertEquals(2 to 10L, locateProgram(list, 260))
        assertNull(locateProgram(list, 300))
        assertNull(locateProgram(list, -1))
    }

    @Test
    fun `two lists of programs are joined with each moment once and in order`() {
        val merged = mergePrograms(listOf(program(100, 250), program(0, 100)), listOf(program(100, 250), program(250, 300)))
        assertEquals(listOf(0L, 100L, 250L), merged.map { it.start })
    }

    @Test
    fun `being live means being within twenty seconds of the clock`() {
        assertEquals(60L, behindLive(100, 160))
        assertEquals(-40L, behindLive(200, 160))
        assertTrue(isLive(5))
        assertTrue(isLive(-19))
        assertFalse(isLive(21))
    }

    @Test
    fun `an address typed by a person is made into a web address, or refused`() {
        assertEquals("http://192.168.1.5:8097", normalizeModulesAddress("192.168.1.5:8097/"))
        assertEquals("https://modules.example.com", normalizeModulesAddress(" https://modules.example.com "))
        assertEquals("https://example.com/modules", normalizeModulesAddress("https://example.com/modules/"))
        assertNull(normalizeModulesAddress(""))
        assertNull(normalizeModulesAddress("   "))
        assertNull(normalizeModulesAddress("ftp://host"))
        assertNull(normalizeModulesAddress("http://a b"))
    }

    @Test
    fun `the invitation link opens the web app and carries the container address when it is a full one`() {
        assertEquals(
            "http://192.168.1.5:8080/?modules=http%3A%2F%2F192.168.1.5%3A8097#/modules/match?join=ABCDE",
            matchJoinLink("http://192.168.1.5:8080", "http://192.168.1.5:8097", "ABCDE"),
        )
        assertEquals("https://jellyflix.example/#/modules/match?join=ABCDE", matchJoinLink("https://jellyflix.example/", "/modules", "ABCDE"))
    }

    @Test
    fun `the addresses to suggest come from the Jellyfin address`() {
        assertEquals("http://192.168.1.5:8080", suggestedWebAddress("http://192.168.1.5:8096"))
        assertEquals("http://nas.local:8097", suggestedModulesAddress("https://nas.local/jellyfin"))
        assertNull(suggestedModulesAddress("nonsense"))
    }

    @Test
    fun `a Match room is read, in the lobby and when it is over with its summary`() {
        val lobby = parseMatchRoom(
            JSONObject(
                """{"id":"r","code":"ABCDE","mode":"phones","hostId":"h","hostName":"Ana","version":3,"phase":"lobby","round":1,"me":"h",
                    "members":[{"id":"d","name":"Ben","done":false}],"filters":{"genre":"Comedy","decade":1990,"series":true},
                    "deck":[],"myVotes":{},"remaining":[],"lastLiked":[]}""",
            ),
        )
        assertEquals("lobby", lobby.phase)
        assertEquals("Ben", lobby.members.single().name)
        assertEquals(MatchFilters(genre = "Comedy", decade = 1990, length = null, series = true), lobby.filters)
        assertTrue(lobby.deck.isEmpty())

        val done = parseMatchRoom(
            JSONObject(
                """{"id":"r","code":"ABCDE","mode":"phones","hostId":"h","hostName":"Ana","version":9,"phase":"done","round":2,"me":"h",
                    "members":[{"id":"d","name":"Ben","done":true}],"filters":{},"deck":[],
                    "winner":{"id":"0123abcd0123456789ab0123456789ab","name":"Film","kind":"Series","genres":["Drama"],"runtimeMinutes":42},"winnerBy":"coin",
                    "summary":{"rounds":3,"firstRound":{"total":6,"both":2,"percent":33,"liked":[{"id":"h","name":"Ana","count":4},{"id":"d","name":"Ben","count":4}]},
                               "picks":[{"id":"h","name":"Ana","card":"A"},{"id":"d","name":"Ben","card":"B"}]}}""",
            ),
        )
        assertTrue(done.isDone)
        assertTrue(done.winner!!.isSeries)
        assertEquals("coin", done.winnerBy)
        assertEquals(33, done.summary!!.percent)
        assertEquals(listOf("Ana" to 4, "Ben" to 4), done.summary!!.liked)
        assertEquals(listOf("Ana" to "A", "Ben" to "B"), done.summary!!.picks)
    }

    @Test
    fun `a Match that ended without agreement has no winner and keeps its finalists`() {
        val room = parseMatchRoom(
            JSONObject(
                """{"id":"r","code":"ABCDE","mode":"phones","hostId":"h","hostName":"Ana","version":9,"phase":"done","round":3,"me":"h",
                    "members":[{"id":"d","name":"Ben","done":true}],"filters":{},"deck":[],"winnerBy":"none",
                    "finalists":[{"id":"0123abcd0123456789ab0123456789ab","name":"Close one","kind":"Movie","genres":[]},{"id":"1123abcd0123456789ab0123456789ab","name":"Close two","kind":"Series","genres":[]}]}""",
            ),
        )
        assertTrue(room.isDone)
        assertEquals(null, room.winner)
        assertEquals("none", room.winnerBy)
        assertEquals(listOf("Close one", "Close two"), room.finalists.map { it.name })
        assertTrue(room.finalists[1].isSeries)
    }

    @Test
    fun `a program of a title this account may not see is read as unavailable, with no id to play`() {
        val shown = parseProgram(JSONObject("""{"start":10,"end":20,"itemId":"","title":"Program not available","type":"Movie","runtime":10,"unavailable":true}"""))
        assertTrue(shown.unavailable)
        assertEquals("", shown.itemId)
        val normal = parseProgram(JSONObject("""{"start":10,"end":20,"itemId":"00000000000000000000000000000001","title":"Film","type":"Movie","runtime":10}"""))
        assertFalse(normal.unavailable)
    }
}
