package app.jellyflix.tv.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async

/**
 * Readers that ask for the same list at the same moment share one request (the banner and the "Latest movies" row both want the newest
 * movies). Once it has answered, the next reader asks again, so nothing is ever older than the question that started it.
 *
 * The shared request runs on its own scope: a reader that is cancelled (the screen was left) stops waiting but does not cancel the
 * request for the others. Only for reads.
 */
class InFlight<K : Any, V> {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = HashMap<K, Deferred<V>>()

    suspend fun share(key: K, run: suspend () -> V): V {
        val job = synchronized(running) {
            running[key] ?: scope.async { run() }.also { job ->
                running[key] = job
                job.invokeOnCompletion { synchronized(running) { if (running[key] === job) running.remove(key) } }
            }
        }
        return job.await()
    }
}
