package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.LocalDate

class PlayHistoryTest {
    private fun table(vararg rows: List<String>) = QueryTable(rows.toList())

    @Test
    fun onlyAnIdEverReachesAQuery() {
        assertEquals("0123456789abcdef0123456789abcdef", cleanUserId("01234567-89AB-CDEF-0123-456789ABCDEF"))
        assertEquals("0123456789abcdef0123456789abcdef", cleanUserId("0123456789abcdef0123456789abcdef"))
        for (bad in listOf("", "abc", "x'; DROP TABLE PlaybackActivity; --", "0123456789abcdef0123456789abcde", "zz23456789abcdef0123456789abcdef")) {
            try {
                cleanUserId(bad)
                fail("accepted: $bad")
            } catch (_: IllegalArgumentException) {
                // expected
            }
        }
    }

    @Test
    fun theQueriesOnlyReadAndOnlyAboutOneUser() {
        val q = playbackQueries("01234567-89AB-CDEF-0123-456789ABCDEF", LocalDate.of(2026, 10, 23))
        for (sql in listOf(q.totals, q.since, q.hours, q.devices, q.methods)) {
            assertTrue(sql.startsWith("SELECT "))
            assertTrue(sql.contains("UserId = '0123456789abcdef0123456789abcdef'"))
            assertFalse(Regex(";|--|\\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|PRAGMA)\\b", RegexOption.IGNORE_CASE).containsMatchIn(sql))
        }
        // Twelve months back, but all the history for "since".
        assertEquals("2025-11-01", windowStart(LocalDate.of(2026, 10, 23)))
        assertEquals("2025-03-01", windowStart(LocalDate.of(2026, 2, 15)))
        assertTrue(q.totals.contains("DateCreated >= '2025-11-01'"))
        assertFalse(q.since.contains("DateCreated >="))
    }

    @Test
    fun thePluginAnswerIsReadWhateverItLooksLike() {
        val answer = """{"colums":["a","b"],"results":[["1",null],[2,"x"]],"message":""}"""
        assertEquals(listOf(listOf("1", ""), listOf("2", "x")), parseTable(answer).rows)
        for (odd in listOf(null, "", "not json", "[]", "{}", """{"results":"nope"}""", """{"colums":[],"results":[],"message":"Query executed, no data returned."}""")) {
            assertTrue("rows of $odd", parseTable(odd).rows.isEmpty())
        }
    }

    @Test
    fun aConversionIsATranscodeAndNothingElse() {
        assertTrue(isConverted("Transcode (v:h264 a:aac)"))
        assertTrue(isConverted("transcode"))
        assertFalse(isConverted("DirectPlay"))
        assertFalse(isConverted("DirectStream"))
        assertFalse(isConverted(""))
    }

    @Test
    fun nothingRecordedYetIsAnEmptyHistory() {
        val h = buildPlayHistory(table(listOf("0", "")), table(listOf("")), QueryTable.Empty, QueryTable.Empty, QueryTable.Empty)
        assertTrue(h.isEmpty)
        assertNull(h.since)
        assertEquals(0L, h.seconds)
        assertEquals(24, h.hours.size)
        assertTrue(h.devices.isEmpty())
        assertEquals(100, h.directPercent)
    }

    @Test
    fun theAnswersGoWhereTheyBelong() {
        val h = buildPlayHistory(
            totals = table(listOf("5", "14400")),
            since = table(listOf("2026-08-14 20:05:11.0000000")),
            hours = table(listOf("20", "9000"), listOf("21", "5400"), listOf("25", "7"), listOf("x", "7")),
            devices = table(listOf("Phone", "Jellyflix", "2", "5400"), listOf("Living room TV", "Jellyflix TV", "3", "9000"), listOf("", "", "1", "60")),
            methods = table(listOf("DirectPlay", "10800"), listOf("Transcode (v:h264 a:aac)", "3600")),
        )
        assertFalse(h.isEmpty)
        assertEquals("2026-08-14", h.since)
        assertEquals(5, h.plays)
        assertEquals(14400L, h.seconds)
        assertEquals(9000L, h.hours[20])
        assertEquals(5400L, h.hours[21])
        // Hours that are not hours are dropped.
        assertEquals(14400L, h.hours.sum())
        // The most used device first; one with no name at all is left out.
        assertEquals(listOf("Living room TV", "Phone"), h.devices.map { it.name })
        assertEquals(10800L, h.direct)
        assertEquals(3600L, h.converted)
        assertEquals(75, h.directPercent)
    }

    @Test
    fun numbersThatAreNotNumbersCountAsNothing() {
        val h = buildPlayHistory(table(listOf("abc", "-4")), QueryTable.Empty, table(listOf("3", "many")), QueryTable.Empty, QueryTable.Empty)
        assertEquals(0, h.plays)
        assertEquals(0L, h.seconds)
        assertEquals(0L, h.hours[3])
    }
}
