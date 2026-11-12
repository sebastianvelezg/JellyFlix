package app.jellyflix.tv

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.jellyflix.tv.data.ChannelWindow
import app.jellyflix.tv.data.JOIN_NOTICE_SECONDS
import app.jellyflix.tv.data.JellyfinRepository
import app.jellyflix.tv.data.MatchCard
import app.jellyflix.tv.data.MatchFilters
import app.jellyflix.tv.data.MatchRoom
import app.jellyflix.tv.data.MatchRoomSummary
import app.jellyflix.tv.data.MediaItem
import app.jellyflix.tv.data.ModuleChannel
import app.jellyflix.tv.data.ModuleProgram
import app.jellyflix.tv.data.ModulesException
import app.jellyflix.tv.data.ModulesGate
import app.jellyflix.tv.data.PREPARE_AHEAD_SECONDS
import app.jellyflix.tv.data.PlayLimits
import app.jellyflix.tv.data.PlaybackPlan
import app.jellyflix.tv.data.Session
import app.jellyflix.tv.data.SessionStore
import app.jellyflix.tv.data.behindLive
import app.jellyflix.tv.data.locateProgram
import app.jellyflix.tv.data.mergePrograms
import app.jellyflix.tv.data.normalizeModulesAddress
import app.jellyflix.tv.data.probeModules
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.UUID

/** The pages of the Modules section. */
enum class ModulesPage { Home, Channels, Match }

/** What a retro TV channel being watched shows over the picture for a moment: what is on, what is next, and (joining late) how far in. */
class ChannelOsdState(val key: Long, val now: ModuleProgram, val next: ModuleProgram?, val joinedMinute: Int?)

/** A program got ready ahead of time (its title and how to play it). */
class PreparedProgram(val start: Long, val item: MediaItem, val plan: PlaybackPlan)

/** A retro TV channel being watched: the schedule around the viewer and where in it they are. The only state is the place on the timeline. */
class ChannelViewing(val id: String, val number: Int, val name: String, val color: Int) {
    var programs by mutableStateOf<List<ModuleProgram>>(emptyList())
    var currentStart by mutableLongStateOf(0L)

    /** The Jellyfin title playing now (what ties this to the player page). */
    var itemId: UUID? = null
    var osd by mutableStateOf<ChannelOsdState?>(null)
    var tunedIn = false
    var prepared: PreparedProgram? = null
    var preparing: Long = -1
    var resumeMs: Long = 0
    var runtimeMs: Long = 0
    var lastPositionMs: Long = 0

    val current: ModuleProgram? get() = programs.firstOrNull { it.start == currentStart }
    val upNext: ModuleProgram? get() = programs.firstOrNull { it.start > currentStart }
}

/** What the player asks of a channel. */
class ChannelUi(
    val view: ChannelViewing,
    val behindSeconds: (positionMs: Long) -> Long,
    val onPrevious: () -> Unit,
    val onStartOver: () -> Unit,
    val onNext: () -> Unit,
    val onLive: () -> Unit,
    val onStep: (Int) -> Unit,
    val onPick: (ModuleProgram) -> Unit,
    val onAllChannels: () -> Unit,
    val onTick: (positionMs: Long, durationMs: Long) -> Unit,
    val loadGuide: suspend () -> Unit,
    /** The container's clock now, in seconds. */
    val liveSeconds: () -> Long,
)

/** What the Match pages hold. */
class MatchUi {
    var genres by mutableStateOf<List<String>>(emptyList())
    var filters by mutableStateOf(MatchFilters())
    var deckSize by mutableIntStateOf(10)
    var rooms by mutableStateOf<List<MatchRoomSummary>>(emptyList())
    var room by mutableStateOf<MatchRoom?>(null)
    var setup by mutableStateOf(false)
    /** Couch mode: how many people share the remote (0: the people vote on their own phones). */
    var couch by mutableIntStateOf(0)
    /** Couch mode: the seat whose turn it is as that seat sees the room, and the seat that has confirmed it is holding the remote. */
    var seatView by mutableStateOf<MatchRoom?>(null)
    var seatReady by mutableStateOf<String?>(null)
    var working by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
}

/**
 * The optional modules container, seen from the TV: whether it is there (and so whether the Modules tab is), the retro TV channels and
 * how they are watched, and Match, where the TV is the screen (it shows a QR code and plays the winner; the people swipe on their phones).
 * With no address set nothing here makes a request and the app is the app without modules.
 */
class ModulesController(
    private val launch: (suspend CoroutineScope.() -> Unit) -> Job,
    private val repo: JellyfinRepository,
    private val store: SessionStore,
    private val session: () -> Session?,
    private val limits: () -> PlayLimits,
    private val showPlayer: (PlaybackPlan) -> Unit,
    private val leavePlayer: () -> Unit,
    private val setBusy: (Boolean) -> Unit,
    private val notify: (String) -> Unit,
    private val fail: (Exception) -> Unit,
    private val str: (Int, Array<out Any>) -> String,
    private val playById: (UUID) -> Unit,
    private val openById: (UUID) -> Unit,
    private val ioContext: kotlin.coroutines.CoroutineContext = Dispatchers.IO,
) {
    var gate by mutableStateOf<ModulesGate>(ModulesGate.Absent)
        private set
    var checking by mutableStateOf(false)
        private set
    var page by mutableStateOf(ModulesPage.Home)

    val ready: ModulesGate.Ready? get() = gate as? ModulesGate.Ready

    /** The addresses chosen in Settings (kept on this device). */
    var address by mutableStateOf(store.modulesAddress)
        private set
    var webAddress by mutableStateOf(store.webAddress)
        private set

    private suspend fun <T> io(block: suspend () -> T): T = withContext(ioContext) { block() }

    /** A film's picture, from the Jellyfin server (pictures need no sign-in). */
    fun posterUrl(id: String): String? = session()?.serverUrl?.let { "$it/Items/$id/Images/Primary?fillWidth=360&quality=85" }

    // ---- Is it there? ----------------------------------------------------------------------------------------------

    /** Asks the container once whether it is there. With no address it does nothing at all. */
    fun start() {
        val s = session() ?: return
        if (normalizeModulesAddress(address) == null) {
            gate = ModulesGate.Absent
            return
        }
        checking = true
        launch {
            try {
                gate = probeModules(address, s.accessToken)
            } finally {
                checking = false
            }
        }
    }

    fun saveAddresses(modules: String, web: String) {
        val m = normalizeModulesAddress(modules).orEmpty()
        val w = normalizeModulesAddress(web).orEmpty()
        store.modulesAddress = m
        store.webAddress = w
        address = m
        webAddress = w
        page = ModulesPage.Home
        start()
    }

    /** Forgets everything of the account (signing out). */
    fun reset() {
        leaveChannel()
        gate = ModulesGate.Absent
        page = ModulesPage.Home
        channels.clear()
        channelsLoaded = false
        match.room = null
        match.setup = false
    }

    /** Back inside the Modules section: true when it went to the page before. */
    fun back(): Boolean {
        if (match.room != null) {
            match.room = null
            return true
        }
        if (match.setup) {
            match.setup = false
            return true
        }
        if (page != ModulesPage.Home) {
            page = ModulesPage.Home
            return true
        }
        return false
    }

    // ---- Retro TV: the list ----------------------------------------------------------------------------------------

    val channels = mutableStateListOf<ModuleChannel>()
    var channelsLoaded by mutableStateOf(false)
        private set
    var channelsError by mutableStateOf<String?>(null)
        private set
    var guide by mutableStateOf(false)

    fun loadChannels() {
        val client = ready?.client ?: return
        launch {
            try {
                val list = io { client.channels() }.filter { it.enabled }
                channels.clear()
                channels.addAll(list)
                channelsError = null
            } catch (e: ModulesException) {
                channelsError = e.message
            } finally {
                channelsLoaded = true
            }
        }
    }

    // ---- Retro TV: watching ----------------------------------------------------------------------------------------

    var viewing: ChannelViewing? by mutableStateOf(null)
        private set

    /** The container's clock now, in seconds. */
    private fun liveSeconds(): Long = System.currentTimeMillis() / 1000 + (ready?.skewSeconds ?: 0)

    /** Retro TV: whether opening the channels goes straight to the last one watched, and which that was. */
    var autoTune by mutableStateOf(store.retroAutoTune)
        private set
    var lastChannelId: String? by mutableStateOf(store.lastRetroChannel)
        private set

    fun chooseAutoTune(on: Boolean) {
        autoTune = on
        store.retroAutoTune = on
    }

    /** Opens the channels page and, when the viewer wants it, tunes the last channel at once (a channel that is gone just leaves the list). */
    fun openChannels() {
        page = ModulesPage.Channels
        loadChannels()
        if (autoTune) lastChannelId?.let { tune(it) }
    }

    fun tune(channel: ModuleChannel) = tune(channel.id)

    /** Tunes in: what is on, at the minute it is at. */
    fun tune(channelId: String) {
        val client = ready?.client ?: return
        launch {
            setBusy(true)
            try {
                val window = io { client.window(channelId) }
                val on = window.programs.getOrNull(window.currentIndex)
                if (on == null) {
                    notify(str(R.string.modules_channel_empty, emptyArray()))
                    return@launch
                }
                leaveChannel()
                store.lastRetroChannel = window.id
                lastChannelId = window.id
                val view = ChannelViewing(window.id, window.number, window.name, window.color)
                view.programs = window.programs
                viewing = view
                play(view, on, maxOf(0L, window.serverTime - on.start))
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (e is ModulesException) notify(e.message.orEmpty()) else fail(e)
            } finally {
                setBusy(false)
            }
        }
    }

    /** Plays [program] of the channel from [seekSeconds] into it. A program that was got ready ahead of time starts without asking again. */
    private suspend fun play(view: ChannelViewing, program: ModuleProgram, seekSeconds: Long) {
        val s = session() ?: return
        if (program.unavailable) {
            // A title this account may not watch is skipped: the channel goes on to the next program that it may.
            val next = view.programs.firstOrNull { it.start >= program.end && !it.unavailable }
            if (next == null) {
                leaveChannel()
                notify(str(R.string.modules_channel_unavailable, emptyArray()))
                return
            }
            return play(view, next, 0)
        }
        tidy(view)
        val early = view.prepared?.takeIf { it.start == program.start && seekSeconds == 0L }
        view.prepared = null
        view.preparing = -1
        val item = early?.item ?: io { repo.details(s, program.itemUuid) }
        val plan = early?.plan ?: io { repo.plan(s, item, null, null, seekSeconds * 1000, limits = limits()) }
        view.currentStart = program.start
        view.itemId = item.id
        view.resumeMs = item.resumeMs
        view.runtimeMs = program.runtime * 1000
        view.lastPositionMs = 0
        val seek = seekSeconds
        view.osd = ChannelOsdState(
            key = program.start,
            now = program,
            next = view.programs.firstOrNull { it.start >= program.end },
            joinedMinute = if (!view.tunedIn && seek >= JOIN_NOTICE_SECONDS) (seek / 60).toInt() else null,
        )
        view.tunedIn = true
        showPlayer(plan)
    }

    private fun runPlay(view: ChannelViewing, program: ModuleProgram, seekSeconds: Long) {
        launch {
            try {
                play(view, program, seekSeconds)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                fail(e)
                leavePlayer()
            }
        }
    }

    /** The program after the one in view, asking the container for more when the list has run out. */
    fun advance() {
        val view = viewing ?: return
        val client = ready?.client ?: return
        val after = view.programs.firstOrNull { it.start > view.currentStart }
        if (after != null) return runPlay(view, after, 0)
        val here = view.current ?: return
        launch {
            try {
                val window = io { client.window(view.id, atSeconds = here.end, before = 0, after = 8) }
                view.programs = mergePrograms(view.programs, window.programs)
                val next = view.programs.firstOrNull { it.start >= here.end } ?: return@launch leavePlayer()
                play(view, next, 0)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                fail(e)
                leavePlayer()
            }
        }
    }

    fun startOver() {
        val view = viewing ?: return
        view.current?.let { runPlay(view, it, 0) }
    }

    fun previous() {
        val view = viewing ?: return
        val client = ready?.client ?: return
        val here = view.current ?: return
        val before = view.programs.lastOrNull { it.start < here.start }
        if (before != null) return runPlay(view, before, 0)
        launch {
            try {
                val window = io { client.window(view.id, atSeconds = here.start - 1, before = 3, after = 0) }
                view.programs = mergePrograms(view.programs, window.programs)
                // A channel made a moment ago has nothing before this program: "previous" then plays this one from its start.
                val earlier = view.programs.lastOrNull { it.start < here.start }
                play(view, earlier ?: here, 0)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                fail(e)
            }
        }
    }

    fun goLive() {
        val view = viewing ?: return
        val client = ready?.client ?: return
        launch {
            try {
                val window: ChannelWindow = io { client.window(view.id, before = 1, after = 8) }
                view.programs = mergePrograms(view.programs, window.programs)
                val found = locateProgram(window.programs, window.serverTime) ?: return@launch notify(str(R.string.modules_channel_empty, emptyArray()))
                play(view, window.programs[found.first], found.second)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                fail(e)
            }
        }
    }

    /** A program picked in the guide: the live one takes the viewer back to live, any other starts from its beginning. */
    fun pick(program: ModuleProgram) {
        val view = viewing ?: return
        val live = liveSeconds()
        if (program.start <= live && live < program.end) goLive() else runPlay(view, program, 0)
    }

    /** Changes channel: the one [step] places on in the list (the list is read first when it has not been). */
    fun step(step: Int) {
        val view = viewing ?: return
        val client = ready?.client ?: return
        launch {
            try {
                if (channels.isEmpty()) channels.addAll(io { client.channels() }.filter { it.enabled })
                if (channels.size < 2) return@launch
                val at = channels.indexOfFirst { it.id == view.id }
                val target = channels[((at + step) % channels.size + channels.size) % channels.size]
                if (target.id != view.id) tune(target)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                fail(e)
            }
        }
    }

    /** A longer look ahead than the player keeps, asked for when the guide opens. */
    suspend fun loadGuide() {
        val view = viewing ?: return
        val client = ready?.client ?: return
        runCatching { io { client.window(view.id, before = 3, after = 12) } }.getOrNull()?.let { view.programs = mergePrograms(view.programs, it.programs) }
    }

    /** Near the end of the program in view, gets the next one ready (its title and how to play it) so it starts without a wait. */
    private fun prepareAhead(view: ChannelViewing, positionMs: Long, durationMs: Long) {
        val s = session() ?: return
        val here = view.current ?: return
        val next = view.programs.firstOrNull { it.start > here.start && !it.unavailable } ?: return
        val left = (if (durationMs > 0) durationMs else here.runtime * 1000) - positionMs
        if (left > PREPARE_AHEAD_SECONDS * 1000 || view.preparing == next.start || view.prepared?.start == next.start) return
        view.preparing = next.start
        launch {
            try {
                val item = io { repo.details(s, next.itemUuid) }
                val plan = io { repo.plan(s, item, null, null, 0, limits = limits()) }
                if (viewing === view) view.prepared = PreparedProgram(next.start, item, plan)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                // Getting ready failed: the program then starts the usual way.
                view.preparing = -1
            }
        }
    }

    /** What the player of [plan] needs, when [plan] is the title of the channel being watched; otherwise null (an ordinary video). */
    fun uiFor(plan: PlaybackPlan): ChannelUi? {
        val view = viewing ?: return null
        if (view.itemId != plan.item.id) return null
        return ChannelUi(
            view = view,
            behindSeconds = { positionMs -> behindLive((view.current?.start ?: 0) + positionMs / 1000, liveSeconds()) },
            onPrevious = ::previous,
            onStartOver = ::startOver,
            onNext = ::advance,
            onLive = ::goLive,
            onStep = ::step,
            onPick = ::pick,
            onAllChannels = { leavePlayer() },
            onTick = { position, duration ->
                view.lastPositionMs = position
                prepareAhead(view, position, duration)
            },
            loadGuide = ::loadGuide,
            liveSeconds = ::liveSeconds,
        )
    }

    /** The video ended: a channel goes on with its next program. Returns true when it handled it. */
    fun ended(plan: PlaybackPlan): Boolean {
        val view = viewing ?: return false
        if (view.itemId != plan.item.id) return false
        advance()
        return true
    }

    /**
     * A channel is not a place to resume: when the viewer leaves a program before the end, the position the title had before the channel
     * touched it is put back (a program watched to the end counts as watched and is left alone).
     */
    private fun tidy(view: ChannelViewing) {
        val s = session() ?: return
        val id = view.itemId ?: return
        val played = view.lastPositionMs
        val runtime = view.runtimeMs
        val before = view.resumeMs
        if (runtime > 0 && played.toDouble() / runtime >= 0.9) return
        launch {
            delay(1500)
            runCatching { io { repo.setResumePosition(s, id, before * 10_000) } }
        }
    }

    /** The player was left: the channel stops being watched. */
    fun leaveChannel() {
        val view = viewing ?: return
        tidy(view)
        viewing = null
    }

    /** The player page was closed (Back, or a remote command). */
    fun playerClosed() = leaveChannel()

    // ---- Match -----------------------------------------------------------------------------------------------------

    val match = MatchUi()

    /** Opens the Match page: what to choose from, and the rooms of this person that can be resumed. */
    fun openMatch() {
        val client = ready?.client ?: return
        page = ModulesPage.Match
        launch {
            runCatching { io { client.matchOptions() } }.getOrNull()?.let { match.genres = it }
            runCatching { io { client.myRooms() } }.getOrNull()?.let { list -> match.rooms = list.filter { it.mode == "phones" && it.phase != "done" }.take(3) }
        }
    }

    fun createMatch() {
        val client = ready?.client ?: return
        if (match.working) return
        match.working = true
        match.error = null
        launch {
            try {
                val players = (1..match.couch).map { str(R.string.match_player_n, arrayOf(it)) }
                match.seatView = null
                match.seatReady = null
                match.room = io { client.createRoom(match.filters, match.deckSize, players) }
                match.setup = false
            } catch (e: ModulesException) {
                match.error = e.message
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                fail(e)
            } finally {
                match.working = false
            }
        }
    }

    fun resumeMatch(id: String) {
        val client = ready?.client ?: return
        launch {
            try {
                match.room = io { client.readRoom(id, null) }
            } catch (e: ModulesException) {
                match.error = e.message
            }
        }
    }

    /** Couch mode: reads the room as a seat sees it (what that person still has to vote on). */
    fun loadSeat(room: MatchRoom, seatId: String) {
        val client = ready?.client ?: return
        launch {
            try {
                match.seatView = io { client.readRoom(room.id, null, seatId) }
            } catch (e: ModulesException) {
                match.error = e.message
            }
        }
    }

    /** Couch mode: one vote for the seat whose turn it is, then the room is read again for who has finished. */
    fun couchVote(room: MatchRoom, seatId: String, card: MatchCard, like: Boolean) = couchAct(room) { client -> client.swipeAs(room.id, seatId, card.id, like) }

    fun couchPick(room: MatchRoom, seatId: String, card: MatchCard) = couchAct(room) { client -> client.pickAs(room.id, seatId, card.id) }

    private fun couchAct(room: MatchRoom, call: suspend (app.jellyflix.tv.data.ModulesClient) -> MatchRoom) {
        val client = ready?.client ?: return
        if (match.working) return
        match.working = true
        match.error = null
        launch {
            try {
                match.seatView = io { call(client) }
                io { client.readRoom(room.id, null) }?.let { match.room = it }
            } catch (e: ModulesException) {
                match.error = e.message
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                fail(e)
            } finally {
                match.working = false
            }
        }
    }

    fun startSwiping() = roomAction { client, room -> client.startMatch(room.id) }
    fun anotherRound() = roomAction { client, room -> client.playAgain(room.id) }
    fun endWithoutAgreement() = roomAction { client, room -> client.endMatch(room.id) }

    /** A finalist of a Match that ended without agreement: a film plays, a series opens. */
    fun playFinalist(card: MatchCard) {
        if (card.isSeries) openById(card.itemUuid) else playById(card.itemUuid)
    }

    private fun roomAction(call: suspend (app.jellyflix.tv.data.ModulesClient, MatchRoom) -> MatchRoom) {
        val client = ready?.client ?: return
        val room = match.room ?: return
        if (match.working) return
        match.working = true
        match.error = null
        launch {
            try {
                match.room = io { call(client, room) }
            } catch (e: ModulesException) {
                match.error = e.message
            } finally {
                match.working = false
            }
        }
    }

    /** Closes the Match for everybody (the screen that started it ends it). */
    fun closeMatch() {
        val client = ready?.client ?: return
        val room = match.room ?: return
        match.room = null
        launch { runCatching { io { client.closeRoom(room.id) } } }
    }

    /** Plays the winner on this TV; a series opens its page instead. */
    fun playWinner(room: MatchRoom) {
        val winner = room.winner ?: return
        if (winner.isSeries) openById(winner.itemUuid) else playById(winner.itemUuid)
    }

    /**
     * Keeps the room up to date while the Match page is on the screen: the container is asked again every few seconds (an answer of
     * "unchanged" costs nothing), and what changed is said in a short message. It ends when the page leaves the screen.
     */
    suspend fun followRoom(id: String) {
        val client = ready?.client ?: return
        while (true) {
            val before = match.room
            val version = before?.version
            try {
                val next = io { client.readRoom(id, version) }
                if (next != null) {
                    if (before != null) announce(before, next)
                    match.room = next
                }
            } catch (e: ModulesException) {
                // The room was closed (or the container went away): nothing more to follow.
                if (e.status == 404 || e.status == 403) {
                    match.room = null
                    return
                }
            }
            delay(2500)
        }
    }

    private fun announce(before: MatchRoom, next: MatchRoom) {
        when {
            next.isDone && !before.isDone -> notify(next.winner?.let { str(R.string.modules_match_done_title, arrayOf(it.name)) } ?: str(R.string.modules_match_done, emptyArray()))
            before.phase == "lobby" && next.phase == "swipe" -> Unit
            next.round != before.round && next.phase == "swipe" -> notify(str(R.string.modules_match_round, arrayOf(next.round, next.deck.size)))
            next.phase != before.phase && next.phase == "pick" -> notify(str(R.string.modules_match_pick, emptyArray()))
            else -> next.members.forEach { m ->
                val was = before.members.firstOrNull { it.id == m.id }
                if (was == null) notify(str(R.string.modules_match_joined, arrayOf(m.name)))
                else if (!was.done && m.done && before.round == next.round && before.phase == next.phase) {
                    notify(str(if (next.phase == "pick") R.string.modules_match_chose else R.string.modules_match_finished, arrayOf(m.name)))
                }
            }
        }
    }
}
