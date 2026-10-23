package app.jellyflix.tv.data

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** How soon a read should go: [First] is what a screen is made of, [Last] the slow extras that nothing waits for. */
enum class ReadPriority { First, Normal, Last }

/**
 * Lets only a few reads be on their way to the server at once, most important first. The same idea as the web client's gate.
 *
 * A screen can ask for a dozen lists in the same moment. The server (often a small box at home) then works on all of them together and
 * every one of them takes longer, and the slow random picks delay the rows you look at first. Holding a few back makes the whole
 * screen arrive sooner: what you see first goes first, and the random picks and the whole-library scans go last.
 *
 * Blocking, because it runs on the HTTP client's own threads. Every successful [acquire] must be matched by one [release].
 */
class RequestGate(private val limit: Int) {
    private class Waiter(val priority: ReadPriority, val seq: Long)

    private val lock = ReentrantLock()
    private val changed = lock.newCondition()
    private val queue = ArrayList<Waiter>()
    private var active = 0
    private var seq = 0L

    private fun first(): Waiter? = queue.minWithOrNull(compareBy<Waiter> { it.priority }.thenBy { it.seq })

    /** Waits for a place and for this request's turn. False when [cancelled] became true while waiting (no place is then held). */
    fun acquire(priority: ReadPriority, cancelled: () -> Boolean = { false }): Boolean = lock.withLock {
        if (active < limit && queue.isEmpty()) {
            active += 1
            return true
        }
        val me = Waiter(priority, seq++)
        queue.add(me)
        while (!(active < limit && first() === me)) {
            if (cancelled()) {
                queue.remove(me)
                changed.signalAll()
                return false
            }
            changed.await(POLL_MS, TimeUnit.MILLISECONDS)
        }
        queue.remove(me)
        active += 1
        changed.signalAll() // the next one may fit too
        true
    }

    fun release() = lock.withLock {
        active = maxOf(0, active - 1)
        changed.signalAll()
    }

    /** For tests and the debug log: how many are on their way and how many wait. */
    fun counts(): Pair<Int, Int> = lock.withLock { active to queue.size }

    private companion object {
        const val POLL_MS = 50L
    }
}

/**
 * How soon a read should go, from its address. Pure.
 * - [ReadPriority.First]: what a screen is built from and what was just asked for (libraries, resume, next up, one title, its seasons and
 *   episodes, search).
 * - [ReadPriority.Last]: random picks, the whole-library filter scan, similar titles, people and "what you played last": slow, and the
 *   screen is complete without waiting for them.
 */
fun priorityOf(path: String, query: String): ReadPriority {
    val p = path.lowercase()
    val q = query.lowercase()
    if (p.endsWith("/items/filters") || p.endsWith("/items/filters2") || p.endsWith("/similar") || p.endsWith("/persons")) return ReadPriority.Last
    if (Regex("sortby=[^&]*(random|dateplayed)").containsMatchIn(q)) return ReadPriority.Last
    if (Regex("/(resume|latest|nextup|episodes|seasons|playbackinfo|userviews)$").containsMatchIn(p)) return ReadPriority.First
    if (Regex("/items/[^/]+$").containsMatchIn(p)) return ReadPriority.First
    if (Regex("(^|&)(ids|searchterm)=").containsMatchIn(q)) return ReadPriority.First
    return ReadPriority.Normal
}

/**
 * Puts the gate in front of the API client's reads. Only GET requests are held (a write or a sign-in must not wait behind lists), the
 * web socket's handshake is let through, and pictures and video use their own clients. The place is given back when the server has
 * answered, so a slow body does not hold the next list for long.
 */
class ReadGateInterceptor(private val gate: RequestGate, private val debug: Boolean = false) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (request.method != "GET" || request.header("Upgrade") != null) return chain.proceed(request)
        val url = request.url
        val priority = priorityOf(url.encodedPath, url.encodedQuery.orEmpty())
        val asked = System.nanoTime()
        if (!gate.acquire(priority) { chain.call().isCanceled() }) throw IOException("Canceled")
        val started = System.nanoTime()
        try {
            return chain.proceed(request)
        } finally {
            gate.release()
            // The path and the names of the options only: never the values (a search text, an id) and never the token.
            if (debug) {
                val (active, waiting) = gate.counts()
                val names = (0 until url.querySize).map { url.queryParameterName(it) }.joinToString(",")
                Log.d(
                    "ReadGate",
                    "$priority ${url.encodedPath} [$names] waited ${(started - asked) / 1_000_000} ms, took ${(System.nanoTime() - started) / 1_000_000} ms (now $active active, $waiting waiting)",
                )
            }
        }
    }
}
