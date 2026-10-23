package app.jellyflix.tv.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class InFlightTest {
    @Test
    fun readersAskingTogetherShareOneRequest() = runBlocking {
        val shared = InFlight<String, Int>()
        val runs = AtomicInteger()
        val gate = CompletableDeferred<Unit>()
        suspend fun read() = shared.share("newest") {
            runs.incrementAndGet()
            gate.await()
            7
        }
        val a = async { read() }
        val b = async { read() }
        delay(50)
        gate.complete(Unit)
        assertEquals(listOf(7, 7), listOf(a.await(), b.await()))
        assertEquals(1, runs.get())
    }

    @Test
    fun afterItHasAnsweredTheNextReaderAsksAgain() = runBlocking {
        val shared = InFlight<String, Int>()
        val runs = AtomicInteger()
        suspend fun read() = shared.share("newest") { runs.incrementAndGet() }
        assertEquals(1, read())
        assertEquals(2, read())
    }

    @Test
    fun differentQuestionsAreNotMixedUp() = runBlocking {
        val shared = InFlight<String, String>()
        val a = async { shared.share("movies") { delay(20); "movies" } }
        val b = async { shared.share("series") { delay(20); "series" } }
        assertEquals("movies" to "series", a.await() to b.await())
    }

    @Test
    fun aReaderThatLeavesDoesNotTakeTheRequestFromTheOthers() = runBlocking {
        val shared = InFlight<String, Int>()
        val gate = CompletableDeferred<Unit>()
        val first = async { shared.share("k") { gate.await(); 5 } }
        val second = async { shared.share("k") { 99 } }
        delay(50)
        first.cancel()
        gate.complete(Unit)
        assertEquals(5, second.await())
    }

    @Test
    fun aFailureReachesEveryReaderAndIsNotRemembered() = runBlocking {
        val shared = InFlight<String, Int>()
        val tries = AtomicInteger()
        val failing = suspend { shared.share("k") { if (tries.incrementAndGet() == 1) error("down") else 3 } }
        val result = runCatching { failing() }
        assertEquals("down", result.exceptionOrNull()?.message)
        assertEquals(3, failing())
    }
}
