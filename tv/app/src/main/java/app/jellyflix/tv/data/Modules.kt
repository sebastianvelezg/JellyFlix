package app.jellyflix.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.math.abs

// The optional modules container (see modules/README.md in the repository): retro TV channels and Match. Everything here is plain data
// and plain functions, so it is tested on a computer; the screens that use it are in ui/Modules*.kt.

/** The versions of the modules API this app understands. */
const val SUPPORTED_MODULES_API = 1

/** A moment of a retro TV channel's schedule. Times are seconds since the epoch, in the container's clock. */
data class ModuleProgram(
    val start: Long,
    val end: Long,
    val itemId: String,
    val title: String,
    val subtitle: String?,
    val runtime: Long,
    /** This account may not see the title: the container sends no id and no name for it. Nothing can be played for it. */
    val unavailable: Boolean = false,
) {
    /** The Jellyfin item that is played for it. */
    val itemUuid: UUID get() = uuidOfHex(itemId)
}

/** A retro TV channel as the list shows it: what is on and what comes next. */
data class ModuleChannel(
    val id: String,
    val number: Int,
    val name: String,
    /** "#rrggbb" as an ARGB int. */
    val color: Int,
    val enabled: Boolean,
    val now: ModuleProgram?,
    val next: ModuleProgram?,
)

/** The programs of a channel around a moment, and which of them is on then (-1: none). */
data class ChannelWindow(
    val serverTime: Long,
    val id: String,
    val number: Int,
    val name: String,
    val color: Int,
    val programs: List<ModuleProgram>,
    val currentIndex: Int,
)

/** What a Match may be limited to. Nothing set means any film the host has not watched. */
data class MatchFilters(
    val genre: String? = null,
    /** The first year of a decade: 1990 is 1990 to 1999. */
    val decade: Int? = null,
    /** "short", "medium" or "long". */
    val length: String? = null,
    val series: Boolean = false,
) {
    val isEmpty: Boolean get() = genre == null && decade == null && length == null && !series
}

data class MatchCard(
    val id: String,
    val name: String,
    /** "Movie" or "Series". */
    val kind: String,
    val year: Int?,
    val overview: String?,
    val genres: List<String>,
    val runtimeMinutes: Int?,
) {
    val isSeries: Boolean get() = kind == "Series"
    val itemUuid: UUID get() = uuidOfHex(id)
}

data class MatchMember(val id: String, val name: String, val done: Boolean)

data class MatchSummary(
    val rounds: Int,
    val total: Int?,
    val both: Int?,
    val percent: Int?,
    /** name, how many each liked in the first round. */
    val liked: List<Pair<String, Int>>,
    /** name, the card each chose as favourite. */
    val picks: List<Pair<String, String>>,
)

/** A Match room as one person is shown it. */
data class MatchRoom(
    val id: String,
    val code: String,
    /** "local" or "phones". */
    val mode: String,
    val hostId: String,
    val hostName: String,
    val version: Int,
    /** "lobby", "swipe", "pick" or "done". */
    val phase: String,
    val round: Int,
    val me: String,
    val members: List<MatchMember>,
    val filters: MatchFilters,
    val deck: List<MatchCard>,
    val winner: MatchCard?,
    /** "agreement", "coin", or "none" (no agreement: there is no winner, only [finalists]). */
    val winnerBy: String?,
    val summary: MatchSummary?,
    /** A Match that ended without agreement: the films that came closest, best first. */
    val finalists: List<MatchCard> = emptyList(),
    /** What the person this room is shown to still has to vote on (or choose from). */
    val remaining: List<MatchCard> = emptyList(),
) {
    val isDone: Boolean get() = phase == "done"
}

data class MatchRoomSummary(val id: String, val code: String, val mode: String, val phase: String, val members: List<String>)

// ---- Reading what the container says --------------------------------------------------------------------------------

/** A Jellyfin id as the container gives it (32 hexadecimal digits, no dashes) or as a UUID. */
fun uuidOfHex(hex: String): UUID =
    if ('-' in hex) UUID.fromString(hex)
    else UUID.fromString(hex.replaceFirst(Regex("(\\p{XDigit}{8})(\\p{XDigit}{4})(\\p{XDigit}{4})(\\p{XDigit}{4})(\\p{XDigit}+)"), "$1-$2-$3-$4-$5"))

private fun JSONObject.optStringOrNull(name: String): String? = if (isNull(name)) null else optString(name).takeIf { it.isNotEmpty() }
private fun JSONObject.optIntOrNull(name: String): Int? = if (isNull(name) || !has(name)) null else optInt(name)

/** "#4d8dff" as an opaque ARGB int; a colour that is not one is the accent blue. */
fun parseColor(text: String?): Int {
    val hex = text?.takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) }?.substring(1) ?: "4d8dff"
    return (0xFF000000 or hex.toLong(16)).toInt()
}

fun parseProgram(o: JSONObject): ModuleProgram = ModuleProgram(
    start = o.getLong("start"),
    end = o.getLong("end"),
    itemId = o.getString("itemId"),
    title = o.optString("title"),
    subtitle = o.optStringOrNull("subtitle"),
    runtime = o.optLong("runtime"),
    unavailable = o.optBoolean("unavailable", false),
)

fun parseChannels(array: JSONArray): List<ModuleChannel> = (0 until array.length()).map { i ->
    val o = array.getJSONObject(i)
    ModuleChannel(
        id = o.getString("id"),
        number = o.getInt("number"),
        name = o.getString("name"),
        color = parseColor(o.optString("color")),
        enabled = o.optBoolean("enabled", true),
        now = o.optJSONObject("now")?.let(::parseProgram),
        next = o.optJSONObject("next")?.let(::parseProgram),
    )
}

fun parseWindow(o: JSONObject): ChannelWindow {
    val channel = o.getJSONObject("channel")
    val programs = o.getJSONArray("programs").let { a -> (0 until a.length()).map { parseProgram(a.getJSONObject(it)) } }
    return ChannelWindow(
        serverTime = o.getLong("serverTime"),
        id = channel.getString("id"),
        number = channel.getInt("number"),
        name = channel.getString("name"),
        color = parseColor(channel.optString("color")),
        programs = programs,
        currentIndex = o.optInt("currentIndex", -1),
    )
}

private fun parseFilters(o: JSONObject?): MatchFilters = if (o == null) MatchFilters() else MatchFilters(
    genre = o.optStringOrNull("genre"),
    decade = o.optIntOrNull("decade"),
    length = o.optStringOrNull("length"),
    series = o.optBoolean("series", false),
)

private fun parseCard(o: JSONObject): MatchCard = MatchCard(
    id = o.getString("id"),
    name = o.optString("name"),
    kind = o.optString("kind", "Movie"),
    year = o.optIntOrNull("year"),
    overview = o.optStringOrNull("overview"),
    genres = o.optJSONArray("genres")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList(),
    runtimeMinutes = o.optIntOrNull("runtimeMinutes"),
)

private fun parseSummary(o: JSONObject): MatchSummary {
    val first = o.optJSONObject("firstRound")
    val liked = first?.optJSONArray("liked")?.let { a -> (0 until a.length()).map { a.getJSONObject(it).let { m -> m.optString("name") to m.optInt("count") } } } ?: emptyList()
    val picks = o.optJSONArray("picks")?.let { a -> (0 until a.length()).map { a.getJSONObject(it).let { p -> p.optString("name") to p.optString("card") } } } ?: emptyList()
    return MatchSummary(
        rounds = o.optInt("rounds"),
        total = first?.optIntOrNull("total"),
        both = first?.optIntOrNull("both"),
        percent = first?.optIntOrNull("percent"),
        liked = liked,
        picks = picks,
    )
}

fun parseMatchRoom(o: JSONObject): MatchRoom {
    val members = o.getJSONArray("members").let { a -> (0 until a.length()).map { a.getJSONObject(it).let { m -> MatchMember(m.getString("id"), m.optString("name"), m.optBoolean("done")) } } }
    val deck = o.optJSONArray("deck")?.let { a -> (0 until a.length()).map { parseCard(a.getJSONObject(it)) } } ?: emptyList()
    return MatchRoom(
        id = o.getString("id"),
        code = o.getString("code"),
        mode = o.optString("mode", "local"),
        hostId = o.optString("hostId"),
        hostName = o.optString("hostName"),
        version = o.getInt("version"),
        phase = o.getString("phase"),
        round = o.optInt("round", 1),
        me = o.optString("me"),
        members = members,
        filters = parseFilters(o.optJSONObject("filters")),
        deck = deck,
        winner = o.optJSONObject("winner")?.let(::parseCard),
        winnerBy = o.optStringOrNull("winnerBy"),
        summary = o.optJSONObject("summary")?.let(::parseSummary),
        remaining = o.optJSONArray("remaining")?.let { a -> (0 until a.length()).map { parseCard(a.getJSONObject(it)) } } ?: emptyList(),
        finalists = o.optJSONArray("finalists")?.let { a -> (0 until a.length()).map { parseCard(a.getJSONObject(it)) } } ?: emptyList(),
    )
}

fun parseRoomSummaries(array: JSONArray): List<MatchRoomSummary> = (0 until array.length()).map { i ->
    val o = array.getJSONObject(i)
    MatchRoomSummary(
        id = o.getString("id"),
        code = o.getString("code"),
        mode = o.optString("mode", "local"),
        phase = o.optString("phase"),
        members = o.optJSONArray("members")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList(),
    )
}

// ---- The channel's timeline ------------------------------------------------------------------------------------------

/** The program that is on at [time] and how many seconds into it that is; null when nothing is scheduled then. */
fun locateProgram(programs: List<ModuleProgram>, time: Long): Pair<Int, Long>? {
    val index = programs.indexOfFirst { it.start <= time && time < it.end }
    return if (index < 0) null else index to (time - programs[index].start)
}

/** Two lists of programs of one channel joined into one, in order, each moment once. */
fun mergePrograms(a: List<ModuleProgram>, b: List<ModuleProgram>): List<ModuleProgram> = (a + b).associateBy { it.start }.values.sortedBy { it.start }

/** Seconds the viewer is behind (positive) or ahead of (negative) the channel's live moment. */
fun behindLive(viewerSeconds: Long, liveSeconds: Long): Long = liveSeconds - viewerSeconds

/** Within this many seconds of live counts as live (files are a little shorter or longer than Jellyfin says). */
const val LIVE_TOLERANCE_SECONDS = 20L

fun isLive(behindSeconds: Long): Boolean = abs(behindSeconds) <= LIVE_TOLERANCE_SECONDS

/** Joining a program that is already this far along is worth a word (and an offer to start it over). */
const val JOIN_NOTICE_SECONDS = 60L

/** The next program is got ready when this little of the one in view is left. */
const val PREPARE_AHEAD_SECONDS = 45L

// ---- Addresses and the invitation link ----------------------------------------------------------------------------------------

/** An address typed by a person: "host:8097" gets http://, a trailing slash goes; anything that is not a web address is null. */
fun normalizeModulesAddress(raw: String?): String? {
    var value = raw?.trim().orEmpty().trimEnd('/')
    if (value.isEmpty()) return null
    if (!Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(value)) value = "http://$value"
    return if (Regex("^https?://[^\\s/]+(:\\d+)?(/[^\\s?#]*)?$", RegexOption.IGNORE_CASE).matches(value)) value else null
}

/**
 * What the QR code of a Match holds: the web app's address with the room's code. The address of the modules container is added when
 * it is a full address, as the web app does, so a phone that has never seen it knows where it is.
 */
fun matchJoinLink(webAddress: String, modulesAddress: String, code: String): String {
    val enc = { text: String -> URLEncoder.encode(text, "UTF-8") }
    val modules = if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(modulesAddress)) "?modules=${enc(modulesAddress)}" else ""
    return "${webAddress.trimEnd('/')}/$modules#/modules/match?join=${enc(code)}"
}

/** A guess for the web app's address: the Jellyfin server's host with the port the Docker image uses by default. */
fun suggestedWebAddress(jellyfinAddress: String): String? {
    val host = Regex("^https?://([^/:]+)", RegexOption.IGNORE_CASE).find(jellyfinAddress)?.groupValues?.get(1) ?: return null
    return "http://$host:8080"
}

/** A guess for the modules container's address, the same way. */
fun suggestedModulesAddress(jellyfinAddress: String): String? {
    val host = Regex("^https?://([^/:]+)", RegexOption.IGNORE_CASE).find(jellyfinAddress)?.groupValues?.get(1) ?: return null
    return "http://$host:8097"
}

// ---- Talking to the container --------------------------------------------------------------------------------------------

class ModulesException(val status: Int, message: String) : Exception(message)

/** What asking the container "are you there?" found. */
sealed interface ModulesGate {
    data object Absent : ModulesGate
    data class Incompatible(val api: Int, val version: String) : ModulesGate
    data class Ready(val client: ModulesClient, val isAdmin: Boolean, val modules: List<String>, val skewSeconds: Long, val version: String) : ModulesGate
}

class ModulesClient(
    val baseUrl: String,
    private val token: String,
    private val http: OkHttpClient = DEFAULT_HTTP,
) {
    private suspend fun call(method: String, path: String, body: JSONObject?): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder()
            .url(baseUrl + path)
            .header("Authorization", "MediaBrowser Token=\"$token\"")
        val payload = (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType())
        when (method) {
            "GET" -> builder.get()
            "DELETE" -> builder.delete()
            else -> builder.method(method, payload)
        }
        try {
            http.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val message = runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty()
                    throw ModulesException(response.code, message.ifEmpty { "The modules container answered with an error (HTTP ${response.code})." })
                }
                text
            }
        } catch (e: java.io.IOException) {
            throw ModulesException(0, "The modules container did not answer.")
        }
    }

    suspend fun getObject(path: String): JSONObject = JSONObject(call("GET", path, null))
    suspend fun getArray(path: String): JSONArray = JSONArray(call("GET", path, null))
    suspend fun postObject(path: String, body: JSONObject? = null): JSONObject = JSONObject(call("POST", path, body))
    suspend fun delete(path: String) {
        call("DELETE", path, null)
    }

    // Retro TV
    suspend fun channels(): List<ModuleChannel> = parseChannels(getArray("/v1/channels"))
    suspend fun window(channelId: String, atSeconds: Long? = null, before: Int = 2, after: Int = 8): ChannelWindow {
        val at = if (atSeconds != null) "&at=$atSeconds" else ""
        return parseWindow(getObject("/v1/channels/$channelId/window?before=$before&after=$after$at"))
    }

    // Match
    suspend fun matchOptions(): List<String> = getObject("/v1/match/options").getJSONArray("genres").let { a -> (0 until a.length()).map { a.getString(it) } }
    suspend fun myRooms(): List<MatchRoomSummary> = parseRoomSummaries(getArray("/v1/match/rooms"))
    /** [players]: couch mode, the names of the people on the sofa (the TV then holds a seat for each); empty: a Match for phones. */
    suspend fun createRoom(filters: MatchFilters, deckSize: Int, players: List<String> = emptyList()): MatchRoom {
        val body = JSONObject().put("mode", if (players.isEmpty()) "phones" else "local").put("deckSize", deckSize)
        if (players.isNotEmpty()) body.put("players", JSONArray(players))
        filters.genre?.let { body.put("genre", it) }
        filters.decade?.let { body.put("decade", it) }
        filters.length?.let { body.put("length", it) }
        if (filters.series) body.put("series", true)
        return parseMatchRoom(postObject("/v1/match/rooms", body))
    }
    /** A vote (or a choice of favourite) for a seat of a couch Match. */
    suspend fun swipeAs(id: String, seat: String, cardId: String, like: Boolean): MatchRoom =
        parseMatchRoom(postObject("/v1/match/rooms/$id/swipe", JSONObject().put("cardId", cardId).put("vote", if (like) "like" else "pass").put("as", seat)))
    suspend fun pickAs(id: String, seat: String, cardId: String): MatchRoom =
        parseMatchRoom(postObject("/v1/match/rooms/$id/pick", JSONObject().put("cardId", cardId).put("as", seat)))
    suspend fun startMatch(id: String): MatchRoom = parseMatchRoom(postObject("/v1/match/rooms/$id/start"))
    suspend fun playAgain(id: String): MatchRoom = parseMatchRoom(postObject("/v1/match/rooms/$id/again"))
    /** The host gives up on agreeing: the Match ends and shows the films that came closest. */
    suspend fun endMatch(id: String): MatchRoom = parseMatchRoom(postObject("/v1/match/rooms/$id/end"))
    suspend fun closeRoom(id: String) = delete("/v1/match/rooms/$id")

    /** The room as it is now, or null when it has not moved since [since]. */
    suspend fun readRoom(id: String, since: Int?, seat: String? = null): MatchRoom? {
        val query = listOfNotNull(since?.let { "since=$it" }, seat?.let { "as=" + java.net.URLEncoder.encode(it, "UTF-8") }).joinToString("&")
        val o = getObject("/v1/match/rooms/$id" + if (query.isNotEmpty()) "?$query" else "")
        return if (o.optBoolean("unchanged", false)) null else parseMatchRoom(o)
    }

    companion object {
        val DEFAULT_HTTP: OkHttpClient by lazy {
            OkHttpClient.Builder().connectTimeout(4, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
        }
        val PROBE_HTTP: OkHttpClient by lazy {
            OkHttpClient.Builder().callTimeout(2500, TimeUnit.MILLISECONDS).build()
        }
    }
}

/**
 * Finds out whether a modules container is there: one quick request. Any failure (nothing listening, refused, an odd answer) is simply
 * "absent": the app then looks and behaves as if modules did not exist.
 */
suspend fun probeModules(address: String?, token: String, nowSeconds: () -> Long = { System.currentTimeMillis() / 1000 }): ModulesGate {
    val url = normalizeModulesAddress(address) ?: return ModulesGate.Absent
    return try {
        val manifest = ModulesClient(url, token, ModulesClient.PROBE_HTTP).getObject("/v1/manifest")
        val api = manifest.optInt("api", -1)
        val modulesJson = manifest.optJSONArray("modules") ?: return ModulesGate.Absent
        if (api < 0) return ModulesGate.Absent
        if (api != SUPPORTED_MODULES_API) return ModulesGate.Incompatible(api, manifest.optString("version"))
        ModulesGate.Ready(
            client = ModulesClient(url, token),
            isAdmin = manifest.optJSONObject("user")?.optBoolean("isAdmin") == true,
            modules = (0 until modulesJson.length()).map { modulesJson.getJSONObject(it).getString("id") },
            skewSeconds = manifest.optLong("serverTime") - nowSeconds(),
            version = manifest.optString("version"),
        )
    } catch (e: Exception) {
        if (e is kotlinx.coroutines.CancellationException) throw e
        ModulesGate.Absent
    }
}
