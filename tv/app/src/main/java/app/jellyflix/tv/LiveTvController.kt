package app.jellyflix.tv

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.jellyflix.tv.data.ChannelCategory
import app.jellyflix.tv.data.JellyfinRepository
import app.jellyflix.tv.data.LastChannel
import app.jellyflix.tv.data.MediaItem
import app.jellyflix.tv.data.PlaybackPlan
import app.jellyflix.tv.data.Session
import app.jellyflix.tv.data.SessionStore
import app.jellyflix.tv.data.TvChannel
import app.jellyflix.tv.data.neighbourChannel
import app.jellyflix.tv.data.nextProgram
import app.jellyflix.tv.data.splitChannelName
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext

/**
 * Live TV, seen from the screens: the list of channels (read page by page), what is on next, the guide, the category filter, the
 * channel watched last, and changing channel from the player. Moved out of [AppViewModel] without changing what it does; it gets from
 * the ViewModel only what it needs (the session, a way to launch work, to play and to report a failure).
 */
class LiveTvController(
    private val launch: (suspend CoroutineScope.() -> Unit) -> Job,
    private val repo: JellyfinRepository,
    private val store: SessionStore,
    private val session: () -> Session?,
    private val isBusy: () -> Boolean,
    private val play: (MediaItem) -> Unit,
    private val fail: (Exception) -> Unit,
    private val ioContext: kotlin.coroutines.CoroutineContext = Dispatchers.IO,
) {
    /** What the Live TV screens draw. */
    val state = LiveTvState().also { it.category = ChannelCategory.of(store.liveCategory) }

    /** The channel watched last, kept across visits (and forgotten on signing out). */
    var lastChannel by mutableStateOf(readLast())
        private set

    private suspend fun <T> io(block: suspend () -> T): T = withContext(ioContext) { block() }

    private fun readLast(): LastChannel? = store.lastChannel?.let { (id, name) -> runCatching { LastChannel(UUID.fromString(id), name) }.getOrNull() }

    /** On signing in to an account: its last channel. */
    fun restoreLast() {
        lastChannel = readLast()
    }

    /** On signing out. */
    fun forgetLast() {
        lastChannel = null
    }

    /** Reads the next page of channels (from the start when [restart] is set), then what comes after each one's current programme. */
    fun load(restart: Boolean = false) {
        val s = session() ?: return
        if (restart) state.reset()
        if (state.loading || (state.loaded && state.channels.size >= state.total)) return
        state.loading = true
        val category = state.category
        val generation = state.generation
        launch {
            try {
                val page = io { repo.channels(s, state.channels.size, LIVE_PAGE, category) }
                if (generation != state.generation) return@launch
                state.channels.addAll(page.items)
                page.total?.let { state.total = it }
                state.loaded = true
                refreshUpNext(page.items)
            } catch (e: Exception) {
                fail(e)
            } finally {
                // Only the load that belongs to the list now showing may say it is done.
                if (generation == state.generation) state.loading = false
            }
        }
    }

    private fun refreshUpNext(channels: List<TvChannel>) {
        val s = session() ?: return
        launch {
            val now = System.currentTimeMillis()
            val found = runCatching { io { repo.programs(s, channels.map { it.id }, now, now + 3 * 3_600_000L) } }.getOrDefault(emptyMap())
            state.upNext = state.upNext + found.mapNotNull { (id, programs) -> nextProgram(programs, now)?.let { id to it } }
        }
    }

    fun showGuide(guide: Boolean) {
        state.guide = guide
    }

    /** Narrows the channels to one kind (the arrows of the player then change channel inside it). It is remembered. */
    fun setCategory(category: ChannelCategory) {
        if (state.category == category) return
        state.category = category
        store.liveCategory = category.key
        load(restart = true)
    }

    /** Watches a channel. */
    fun watch(channel: TvChannel) = play(channel.item)

    /** Goes back to the channel watched last. */
    fun watchLast() {
        val s = session() ?: return
        val last = lastChannel ?: return
        state.channels.firstOrNull { it.id == last.id }?.let { return watch(it) }
        launch {
            try {
                play(io { repo.details(s, last.id) })
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    /** The names of the channels before and after this one in the list being browsed, for the hint in the player. */
    fun neighbours(plan: PlaybackPlan): Pair<String, String>? {
        val before = neighbourChannel(state.channels, plan.item.id, -1) ?: return null
        val after = neighbourChannel(state.channels, plan.item.id, 1) ?: return null
        return before.label to after.label
    }

    /** A channel was started: it is the one "last channel" goes back to. */
    fun remember(item: MediaItem) {
        val last = LastChannel(item.id, splitChannelName(item.title).title)
        lastChannel = last
        store.lastChannel = last.id.toString() to last.name
    }

    /** Changes channel from the player: the one [step] places on in the list (the list is read first when it has not been). */
    fun step(plan: PlaybackPlan, step: Int) {
        val s = session() ?: return
        if (isBusy()) return
        launch {
            // The list being browsed (it may be only the favorites); when it does not hold this channel, the first page of all of them.
            var list: List<TvChannel> = state.channels
            if (list.none { it.item.id == plan.item.id }) {
                list = runCatching { io { repo.channels(s, 0, LIVE_PAGE) } }.getOrNull()?.items ?: return@launch
            }
            neighbourChannel(list, plan.item.id, step)?.let { play(it.item) }
        }
    }

    companion object {
        const val LIVE_PAGE = 60
    }
}
