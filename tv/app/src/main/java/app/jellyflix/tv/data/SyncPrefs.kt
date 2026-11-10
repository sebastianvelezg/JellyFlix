package app.jellyflix.tv.data

import org.json.JSONObject

/**
 * Optional sync of a few preferences between this account's devices (the web app and the TV app), through the display preferences
 * Jellyfin keeps for each user. The same rules as the web client's `core/syncPrefs.ts`:
 *
 * - Two sections: `appearance` (theme, menu order and visibility, rows of the home page) and `playback` (autoplay, "Are you still
 *   watching?", what to do with intros, recaps, credits and previews). What depends on the screen or the connection (a TV's margin, text
 *   size, bitrate limit, poster size) is never synced.
 * - Off by default, for each account on each device; the first time, the person chooses between the account's settings and this TV's.
 * - Each section is its own: the most recent change wins per section, by the server's clock. A section of a later format, or one this
 *   version has never heard of, is left exactly as it is.
 * - A change made offline stays marked and is sent later; if the account's copy is newer by then, it wins and the TV says so.
 * - It lives in a field of its own, apart from the manual settings file.
 */
const val SYNC_FORMAT = 1

/** The most the saved text may be. */
const val MAX_SYNC_CHARS = 50_000

enum class SyncSection(val key: String) {
    Appearance("appearance"),
    Playback("playback"),
}

/** A section as saved on the account. */
class RemoteSection(val v: Int, val at: Long, val by: String, val data: JSONObject)

/** The saved text as a file: every section found, those of this version and any other (kept as they were when it is written back). */
class SyncFile(private val sections: JSONObject = JSONObject()) {
    private fun raw(section: SyncSection): JSONObject? = sections.optJSONObject(section.key)

    /** The section if this version can read it; null when absent, damaged or of a later format. */
    fun readable(section: SyncSection): RemoteSection? {
        val s = raw(section) ?: return null
        if (!s.has("v") || !s.has("at") || !s.has("by") || !s.has("data")) return null
        val v = s.optInt("v", -1)
        val data = s.optJSONObject("data") ?: return null
        if (v < 0 || v > SYNC_FORMAT) return null
        return RemoteSection(v, s.optLong("at"), s.optString("by"), data)
    }

    /** True when the account has a section of a later format: it must be left alone, not overwritten. */
    fun hasNewer(section: SyncSection): Boolean = (raw(section)?.optInt("v", -1) ?: -1) > SYNC_FORMAT

    fun with(section: SyncSection, value: RemoteSection): SyncFile {
        val copy = JSONObject(sections.toString())
        copy.put(section.key, JSONObject().put("v", value.v).put("at", value.at).put("by", value.by).put("data", value.data))
        return SyncFile(copy)
    }

    fun serialize(): String = JSONObject().put("v", SYNC_FORMAT).put("sections", sections).toString()

    companion object {
        fun parse(text: String?): SyncFile {
            if (text.isNullOrBlank() || text.length > MAX_SYNC_CHARS) return SyncFile()
            return runCatching {
                val root = JSONObject(text)
                val sections = root.optJSONObject("sections") ?: return SyncFile()
                SyncFile(sections)
            }.getOrDefault(SyncFile())
        }
    }
}

/** What this device remembers about one section. */
data class SectionState(
    /** The `at` of the copy of the account this device last took or wrote (0: never). */
    val applied: Long = 0,
    /** What this device's choices were when they last matched the account's (the canonical text of its data). */
    val snapshot: String? = null,
    /** When this device first saw its choices differ from [snapshot] and could not send them yet (the server's clock). */
    val dirtyAt: Long? = null,
)

data class SyncPrefsState(val enabled: Boolean = false, val sections: Map<SyncSection, SectionState> = emptyMap()) {
    fun encode(): String {
        val sections = JSONObject()
        for ((section, s) in this.sections) {
            sections.put(
                section.key,
                JSONObject().put("applied", s.applied).also { json ->
                    s.snapshot?.let { json.put("snapshot", it) }
                    s.dirtyAt?.let { json.put("dirtyAt", it) }
                },
            )
        }
        return JSONObject().put("enabled", enabled).put("sections", sections).toString()
    }

    companion object {
        fun decode(text: String?): SyncPrefsState {
            if (text.isNullOrBlank()) return SyncPrefsState()
            return runCatching {
                val root = JSONObject(text)
                val found = HashMap<SyncSection, SectionState>()
                val sections = root.optJSONObject("sections")
                for (section in SyncSection.entries) {
                    val s = sections?.optJSONObject(section.key) ?: continue
                    found[section] = SectionState(
                        applied = s.optLong("applied"),
                        snapshot = if (s.has("snapshot")) s.optString("snapshot") else null,
                        dirtyAt = if (s.has("dirtyAt")) s.optLong("dirtyAt") else null,
                    )
                }
                SyncPrefsState(root.optBoolean("enabled"), found)
            }.getOrDefault(SyncPrefsState())
        }
    }
}

enum class SectionAction { None, Push, Apply, ApplyConflict, Skip }

class SectionPlan(val action: SectionAction, val dirtyAt: Long?)

/**
 * What to do with one section. [local] is the canonical text of this device's data now; [now] is the server's clock. The account's
 * copy is new when its `at` is above the one this device last took or wrote: with no change waiting here it is taken; with one waiting,
 * the later of the two wins (the account's, on a tie).
 */
fun planSection(remote: RemoteSection?, newerFormat: Boolean, local: String, state: SectionState?, now: Long): SectionPlan {
    if (newerFormat) return SectionPlan(SectionAction.Skip, state?.dirtyAt)
    val dirty = state?.snapshot != null && local != state.snapshot
    val dirtyAt = if (dirty) (state?.dirtyAt ?: now) else null
    if (remote == null) return SectionPlan(SectionAction.Push, dirtyAt)
    val isNew = remote.at > (state?.applied ?: 0L)
    if (!isNew) return SectionPlan(if (dirty) SectionAction.Push else SectionAction.None, dirtyAt)
    if (!dirty) return SectionPlan(SectionAction.Apply, null)
    return if (dirtyAt != null && dirtyAt > remote.at) SectionPlan(SectionAction.Push, dirtyAt) else SectionPlan(SectionAction.ApplyConflict, dirtyAt)
}

/** The time a push is stamped with: now, but always above what is already saved, so it is the newest whatever the clocks say. */
fun pushStamp(now: Long, remote: RemoteSection?): Long = maxOf(now, (remote?.at ?: 0L) + 1)

class AskedSection(val section: SyncSection, val at: Long, val by: String)

/** What the first activation should do given what the account already has. */
sealed interface FirstActivation {
    /** The account has nothing of ours: this device's choices simply go up. */
    data object Upload : FirstActivation

    /** The account has the same choices: nothing to choose, just start. */
    class Same(val applied: Map<SyncSection, Long>) : FirstActivation

    /** They differ: the person chooses. */
    class Ask(val sections: List<AskedSection>) : FirstActivation
}

fun planFirstActivation(file: SyncFile, locals: Map<SyncSection, String>, canonicalOf: (SyncSection, RemoteSection) -> String): FirstActivation {
    val present = SyncSection.entries.mapNotNull { name -> file.readable(name)?.let { name to it } }
    if (present.isEmpty()) return FirstActivation.Upload
    val differing = present.filter { (name, section) -> canonicalOf(name, section) != locals[name] }
    if (differing.isEmpty()) return FirstActivation.Same(present.associate { it.first to it.second.at })
    return FirstActivation.Ask(differing.map { (name, section) -> AskedSection(name, section.at, section.by) })
}
