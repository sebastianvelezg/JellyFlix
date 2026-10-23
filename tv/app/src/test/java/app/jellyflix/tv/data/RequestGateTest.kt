package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class RequestGateTest {
    /** Starts a reader that waits for a place, notes its name when it gets one, and keeps the place until [hold] is released. */
    private fun reader(
        gate: RequestGate,
        name: String,
        priority: ReadPriority,
        order: MutableList<String>,
        hold: CountDownLatch,
        cancelled: () -> Boolean = { false },
    ) = thread(name = name) {
        if (gate.acquire(priority, cancelled)) {
            order.add(name)
            hold.await(5, TimeUnit.SECONDS)
            gate.release()
        }
    }

    private fun waitUntil(what: String, check: () -> Boolean) {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (!check()) {
            if (System.nanoTime() > end) throw AssertionError("Timed out waiting for $what")
            Thread.sleep(5)
        }
    }

    @Test
    fun onlyTheLimitIsOnItsWayAndTheRestWaitInOrderOfImportance() {
        val gate = RequestGate(2)
        val order = Collections.synchronizedList(ArrayList<String>())
        val hold = CountDownLatch(1)
        // The two that are running let go one at a time, so who takes each freed place is not a race between threads.
        val holdA = CountDownLatch(1)
        val holdB = CountDownLatch(1)
        val running = listOf(
            reader(gate, "a", ReadPriority.Normal, order, holdA),
            reader(gate, "b", ReadPriority.Normal, order, holdB),
        )
        waitUntil("the first two to start") { order.size == 2 }
        // Queued in this order: a slow extra, an ordinary list, then what the screen is made of.
        val waiting = listOf(
            reader(gate, "extra", ReadPriority.Last, order, hold).also { waitUntil("extra to queue") { gate.counts().second == 1 } },
            reader(gate, "list", ReadPriority.Normal, order, hold).also { waitUntil("list to queue") { gate.counts().second == 2 } },
            reader(gate, "first", ReadPriority.First, order, hold).also { waitUntil("first to queue") { gate.counts().second == 3 } },
        )
        assertEquals(2 to 3, gate.counts())
        // Two threads started together: which of them got in first does not matter, that both did does.
        assertEquals(setOf("a", "b"), order.toSet())
        holdA.countDown()
        waitUntil("the most important to start") { order.size == 3 }
        holdB.countDown()
        waitUntil("the ordinary list to start") { order.size == 4 }
        hold.countDown()
        (running + waiting).forEach { it.join(5000) }
        assertEquals(setOf("a", "b"), order.take(2).toSet())
        assertEquals(listOf("first", "list", "extra"), order.drop(2))
        assertEquals(0 to 0, gate.counts())
    }

    @Test
    fun equalPrioritiesGoInTheOrderTheyAsked() {
        val gate = RequestGate(1)
        val order = Collections.synchronizedList(ArrayList<String>())
        val hold = CountDownLatch(1)
        val all = ArrayList<Thread>()
        all += reader(gate, "0", ReadPriority.Normal, order, hold)
        waitUntil("the first to start") { order.size == 1 }
        for (i in 1..4) {
            all += reader(gate, "$i", ReadPriority.Normal, order, hold)
            waitUntil("$i to queue") { gate.counts().second == i }
        }
        hold.countDown()
        all.forEach { it.join(5000) }
        assertEquals(listOf("0", "1", "2", "3", "4"), order.toList())
    }

    @Test
    fun aReadCancelledWhileWaitingTakesNoPlaceAndDoesNotBlockTheOthers() {
        val gate = RequestGate(1)
        val order = Collections.synchronizedList(ArrayList<String>())
        val hold = CountDownLatch(1)
        val cancel = AtomicBoolean(false)
        val running = reader(gate, "running", ReadPriority.Normal, order, hold)
        waitUntil("the first to start") { order.size == 1 }
        val dropped = reader(gate, "dropped", ReadPriority.First, order, hold) { cancel.get() }
        waitUntil("dropped to queue") { gate.counts().second == 1 }
        val later = reader(gate, "later", ReadPriority.Last, order, hold)
        waitUntil("later to queue") { gate.counts().second == 2 }
        cancel.set(true)
        dropped.join(5000)
        assertFalse(dropped.isAlive)
        assertEquals(1 to 1, gate.counts())
        hold.countDown()
        running.join(5000)
        later.join(5000)
        assertEquals(listOf("running", "later"), order.toList())
        assertEquals(0 to 0, gate.counts())
    }

    @Test
    fun releasingMoreOftenThanAcquiringNeverGoesBelowZero() {
        val gate = RequestGate(2)
        gate.release()
        assertTrue(gate.acquire(ReadPriority.Normal))
        assertEquals(1 to 0, gate.counts())
        gate.release()
        assertEquals(0 to 0, gate.counts())
    }

    @Test
    fun whatAScreenIsMadeOfGoesFirstAndTheSlowExtrasGoLast() {
        // Home, music and a title page.
        assertEquals(ReadPriority.First, priorityOf("/UserViews", "userId=x"))
        assertEquals(ReadPriority.First, priorityOf("/UserItems/Resume", "limit=16&enableTotalRecordCount=false"))
        assertEquals(ReadPriority.First, priorityOf("/Shows/NextUp", "limit=20"))
        assertEquals(ReadPriority.First, priorityOf("/Items/Latest", "limit=20"))
        assertEquals(ReadPriority.First, priorityOf("/Shows/abc/Episodes", "userId=x"))
        assertEquals(ReadPriority.First, priorityOf("/Shows/abc/Seasons", "userId=x"))
        assertEquals(ReadPriority.First, priorityOf("/Items/abc/PlaybackInfo", ""))
        assertEquals(ReadPriority.First, priorityOf("/Items/abc", "userId=x"))
        assertEquals(ReadPriority.First, priorityOf("/Items", "ids=a,b"))
        assertEquals(ReadPriority.First, priorityOf("/Items", "searchTerm=matrix&limit=40"))
        // The slow ones.
        assertEquals(ReadPriority.Last, priorityOf("/Items", "sortBy=Random&limit=20"))
        assertEquals(ReadPriority.Last, priorityOf("/Items", "recursive=true&SortBy=Random"))
        assertEquals(ReadPriority.Last, priorityOf("/Items", "filters=IsPlayed&sortBy=DatePlayed&limit=1"))
        assertEquals(ReadPriority.Last, priorityOf("/Items/Filters", "parentId=x"))
        assertEquals(ReadPriority.Last, priorityOf("/Items/abc/Similar", "limit=24"))
        assertEquals(ReadPriority.Last, priorityOf("/Persons", ""))
        // Everything else in between.
        assertEquals(ReadPriority.Normal, priorityOf("/Items", "sortBy=DateCreated,SortName&startIndex=0&limit=60"))
        assertEquals(ReadPriority.Normal, priorityOf("/Artists/AlbumArtists", "startIndex=0"))
    }

    /**
     * The server counts everything a list could return unless told not to, and the SDK asks for the count by default. A list that does
     * not show a total must say so: every call of these list functions in the repository names `enableTotalRecordCount`, so a new row
     * cannot slow the server down by forgetting it.
     */
    @Test
    fun everyListCallSaysWhetherItNeedsACount() {
        val source = File("src/main/java/app/jellyflix/tv/data/JellyfinRepository.kt").readText()
        val call = Regex("""\.(getItems|getResumeItems|getNextUp|getAlbumArtists|getArtists)\(""")
        var seen = 0
        for (m in call.findAll(source)) {
            var depth = 1
            var i = m.range.last + 1
            while (depth > 0) {
                when (source[i]) {
                    '(' -> depth += 1
                    ')' -> depth -= 1
                }
                i += 1
            }
            val body = source.substring(m.range.last + 1, i - 1)
            val line = source.substring(0, m.range.first).count { it == '\n' } + 1
            assertTrue("${m.groupValues[1]} at line $line does not say enableTotalRecordCount", "enableTotalRecordCount" in body)
            seen += 1
        }
        assertTrue("expected to find the list calls, found $seen", seen >= 20)
    }

    @Test
    fun onlyPagedGridsAndTheCountQueryAskForATotal() {
        val source = File("src/main/java/app/jellyflix/tv/data/JellyfinRepository.kt").readText()
        val trues = Regex("""enableTotalRecordCount = true""").findAll(source).count()
        val withTotal = Regex("""enableTotalRecordCount = withTotal""").findAll(source).count()
        // libraryCountBefore (a count is its whole point), and the three paged grids: library, albums and artists.
        assertEquals(1, trues)
        assertEquals(3, withTotal)
    }
}
