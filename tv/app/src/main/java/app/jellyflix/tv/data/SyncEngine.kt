package app.jellyflix.tv.data

import kotlinx.coroutines.CancellationException

/** What the account holds: the saved text and the server's clock at that moment (null when the answer had no Date header). */
class RemoteText(val text: String?, val serverTime: Long?)

/** How a run went. */
data class SyncReport(
    val pushed: List<SyncSection> = emptyList(),
    val applied: List<SyncSection> = emptyList(),
    val conflicts: List<SyncSection> = emptyList(),
    /** Why it could not sync; null when it did. */
    val error: String? = null,
    /** When it ended (this TV's clock). */
    val at: Long = 0L,
)

/**
 * The sync of preferences with the account (rules in [SyncPrefs.kt]), with everything it touches given as functions so it can be
 * tested: reading and writing the account's text, this TV's values and what this TV remembers.
 */
class SyncEngine(
    private val load: suspend () -> RemoteText,
    private val save: suspend (String) -> Unit,
    private val values: () -> SyncValues,
    private val setValues: (SyncValues) -> Unit,
    private val state: () -> SyncPrefsState,
    private val setState: (SyncPrefsState) -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
    /** Which kind of app saves a section, to say where the account's choices came from. */
    private val by: String = "tv",
) {
    private var offset = 0L
    private fun serverNow() = clock() + offset

    private suspend fun readAccount(): SyncFile {
        val remote = load()
        remote.serverTime?.let { offset = it - clock() }
        return SyncFile.parse(remote.text)
    }

    private fun localCanonical(section: SyncSection) = canonicalSection(section, values())

    /** Brings this TV and the account together, section by section. */
    suspend fun run(): SyncReport {
        val start = state()
        if (!start.enabled) return SyncReport(at = clock())
        val next = HashMap(start.sections)
        val file = try {
            readAccount()
        } catch (e: Exception) {
            // Leaving the account stops the run; it is not a failure to remember.
            if (e is CancellationException) throw e
            // The account cannot be reached: a change made here is marked with the time it was seen, to be judged by when it was made.
            val now = serverNow()
            for (section in SyncSection.entries) {
                val s = start.sections[section]
                if (s?.snapshot != null && localCanonical(section) != s.snapshot && s.dirtyAt == null) next[section] = s.copy(dirtyAt = now)
            }
            setState(start.copy(sections = next))
            return SyncReport(error = e.message ?: "The server could not be reached.", at = clock())
        }

        val now = serverNow()
        var out = file
        var toSend = false
        val pushed = ArrayList<SyncSection>()
        val applied = ArrayList<SyncSection>()
        val conflicts = ArrayList<SyncSection>()
        for (section in SyncSection.entries) {
            val remote = file.readable(section)
            val plan = planSection(remote, file.hasNewer(section), localCanonical(section), start.sections[section], now)
            when (plan.action) {
                SectionAction.Apply, SectionAction.ApplyConflict -> {
                    if (remote == null) continue
                    setValues(sanitizeSection(section, remote.data, values()))
                    next[section] = SectionState(applied = remote.at, snapshot = localCanonical(section), dirtyAt = null)
                    applied += section
                    if (plan.action == SectionAction.ApplyConflict) conflicts += section
                }
                SectionAction.Push -> {
                    val at = pushStamp(now, remote)
                    out = out.with(section, RemoteSection(SYNC_FORMAT, at, by, dataToPush(section, values(), remote?.data)))
                    next[section] = SectionState(applied = at, snapshot = localCanonical(section), dirtyAt = null)
                    pushed += section
                    toSend = true
                }
                SectionAction.None, SectionAction.Skip -> start.sections[section]?.let { next[section] = it.copy(dirtyAt = plan.dirtyAt) }
            }
        }
        var error: String? = null
        if (toSend) {
            val text = out.serialize()
            try {
                if (text.length > MAX_SYNC_CHARS) error("Those settings are too big to save on the server.")
                save(text)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                // Not sent: what was to be sent stays marked as waiting, and the rest of the run still counts.
                for (section in pushed) {
                    val before = start.sections[section] ?: SectionState()
                    next[section] = if (before.snapshot != null && before.dirtyAt == null) before.copy(dirtyAt = now) else before
                }
                pushed.clear()
                error = e.message ?: "The server could not be reached."
            }
        }
        setState(start.copy(sections = next))
        return SyncReport(pushed, applied, conflicts, error, clock())
    }

    /** What turning sync on would find in the account, to show the choice (when there is one) before anything is changed. */
    suspend fun preview(): FirstActivation {
        val file = readAccount()
        val locals = SyncSection.entries.associateWith { localCanonical(it) }
        return planFirstActivation(file, locals) { section, remote -> canonicalOfRemote(section, remote.data, values()) }
    }

    /**
     * Turns it on. [useAccount]: take what the account has; otherwise this TV's choices go up (over what the account has). With nothing
     * to choose from (the account has nothing, or the same) either one simply starts.
     */
    suspend fun enable(useAccount: Boolean): SyncReport {
        val file = readAccount()
        val sections = HashMap<SyncSection, SectionState>()
        for (section in SyncSection.entries) {
            val remote = file.readable(section)
            if (useAccount && remote != null) {
                setValues(sanitizeSection(section, remote.data, values()))
                sections[section] = SectionState(remote.at, localCanonical(section), null)
            } else if (remote != null && canonicalOfRemote(section, remote.data, values()) == localCanonical(section)) {
                sections[section] = SectionState(remote.at, localCanonical(section), null)
            } else {
                // Not on the account yet, or this TV's choices are to go over it: marked as waiting; the run below sends them.
                sections[section] = SectionState(remote?.at ?: 0L, "", serverNow())
            }
        }
        setState(SyncPrefsState(true, sections))
        return run()
    }

    fun disable() = setState(SyncPrefsState())
}
