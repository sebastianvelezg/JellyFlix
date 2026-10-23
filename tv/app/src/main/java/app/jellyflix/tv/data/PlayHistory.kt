package app.jellyflix.tv.data

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * What the Playback Reporting plugin of the server has noted about the signed-in user: real time played, the hours of the day,
 * the devices and how much the server converted. The plugin lets an administrator run a read-only query on its own table
 * (`PlaybackActivity`); the queries are fixed here and the only thing put in them is the user's id, checked to be 32 hexadecimal
 * digits. Without the plugin, or for an account that is not an administrator, the server refuses and nothing is shown. The web
 * client's stats page has the same section (`core/playbackReporting.ts`).
 */

/** The table a query answered: rows of text (the plugin answers every value as text, empty for none). */
data class QueryTable(val rows: List<List<String>>) {
    companion object {
        val Empty = QueryTable(emptyList())
    }
}

data class RecordedDevice(val name: String, val client: String, val plays: Int, val seconds: Long)

data class PlayHistory(
    /** The day of the first play on record for this user ("2026-10-23"), when there is one. */
    val since: String?,
    val plays: Int,
    val seconds: Long,
    /** Seconds played in each hour of the day (24 entries from 00), by the server's clock. */
    val hours: List<Long>,
    /** The devices played on, the most used first. */
    val devices: List<RecordedDevice>,
    /** Seconds played as they are (direct play and direct stream), and converted by the server. */
    val direct: Long,
    val converted: Long,
) {
    /** The plugin is there but has noted nothing yet. */
    val isEmpty: Boolean get() = plays == 0

    /** The share of the time played as it is, 0 to 100. */
    val directPercent: Int get() = if (direct + converted == 0L) 100 else (direct * 100.0 / (direct + converted)).let { Math.round(it).toInt() }
}

/** The user's id as the plugin stores it: 32 lowercase hexadecimal digits. Throws for anything else, so nothing else reaches a query. */
fun cleanUserId(id: String): String {
    val plain = id.replace("-", "").lowercase()
    require(Regex("^[0-9a-f]{32}$").matches(plain)) { "Not a user id" }
    return plain
}

/** The first day of the month 11 months before [today]'s ("2025-11-01"): the twelve months the page covers. */
fun windowStart(today: LocalDate): String = today.withDayOfMonth(1).minusMonths(11).toString()

data class PlaybackQueries(val totals: String, val since: String, val hours: String, val devices: String, val methods: String)

fun playbackQueries(userId: String, today: LocalDate): PlaybackQueries {
    val id = cleanUserId(userId)
    val mine = "FROM PlaybackActivity WHERE UserId = '$id'"
    val recent = "$mine AND DateCreated >= '${windowStart(today)}'"
    return PlaybackQueries(
        totals = "SELECT COUNT(*), SUM(PlayDuration) $recent",
        since = "SELECT MIN(DateCreated) $mine",
        hours = "SELECT substr(DateCreated, 12, 2) AS h, SUM(PlayDuration) $recent GROUP BY h",
        devices = "SELECT DeviceName, ClientName, COUNT(*), SUM(PlayDuration) $recent GROUP BY DeviceName, ClientName ORDER BY 4 DESC LIMIT 6",
        methods = "SELECT PlaybackMethod, SUM(PlayDuration) $recent GROUP BY PlaybackMethod",
    )
}

/** Reads the plugin's answer, `{"colums":[...],"results":[[...]],"message":""}` (it spells "colums"); anything else is an empty table. */
fun parseTable(json: String?): QueryTable {
    val results: JSONArray = try {
        JSONObject(json ?: return QueryTable.Empty).optJSONArray("results") ?: return QueryTable.Empty
    } catch (_: org.json.JSONException) {
        return QueryTable.Empty
    }
    return QueryTable(
        (0 until results.length()).mapNotNull { i ->
            results.optJSONArray(i)?.let { row -> (0 until row.length()).map { c -> if (row.isNull(c)) "" else row.optString(c) } }
        },
    )
}

private fun count(text: String?): Long = text?.toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 }?.toLong() ?: 0L

/** A transcode is a conversion by the server; direct play and direct stream leave the file alone. */
fun isConverted(method: String): Boolean = method.trim().startsWith("transcod", ignoreCase = true)

/** Pure: the numbers of the page from the plugin's answers. */
fun buildPlayHistory(totals: QueryTable, since: QueryTable, hours: QueryTable, devices: QueryTable, methods: QueryTable): PlayHistory {
    val total = totals.rows.firstOrNull().orEmpty()
    val first = since.rows.firstOrNull()?.firstOrNull().orEmpty()
    val perHour = LongArray(24)
    for (row in hours.rows) {
        val h = row.getOrNull(0)?.toIntOrNull() ?: continue
        if (h in 0..23) perHour[h] += count(row.getOrNull(1))
    }
    var direct = 0L
    var converted = 0L
    for (row in methods.rows) {
        if (isConverted(row.getOrNull(0).orEmpty())) converted += count(row.getOrNull(1)) else direct += count(row.getOrNull(1))
    }
    return PlayHistory(
        since = first.takeIf { Regex("^\\d{4}-\\d{2}-\\d{2}").containsMatchIn(it) }?.take(10),
        plays = count(total.getOrNull(0)).toInt(),
        seconds = count(total.getOrNull(1)),
        hours = perHour.toList(),
        devices = devices.rows
            .map { RecordedDevice(it.getOrNull(0).orEmpty().trim(), it.getOrNull(1).orEmpty().trim(), count(it.getOrNull(2)).toInt(), count(it.getOrNull(3))) }
            .filter { it.name.isNotEmpty() || it.client.isNotEmpty() }
            .sortedByDescending { it.seconds },
        direct = direct,
        converted = converted,
    )
}

/** The date the page covers up to, in the TV's own calendar. */
fun todayLocal(now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): LocalDate = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
