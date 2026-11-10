package app.jellyflix.tv.data

import org.json.JSONObject
import java.util.UUID

/**
 * What an account has chosen to leave out of "Continue watching" and "Next up", without touching its history (the same rules as the web
 * client's `core/hidden.ts`). Jellyfin has no way to hide a title from those rows, so the choice is the client's: it is kept for each
 * account on this TV and the rows are filtered with it.
 *
 * - **Continue watching:** a title is hidden by its id and comes back by itself when it is played again (its "last played" date, as the
 *   server writes it, is newer than the one seen when it was hidden), or when it is restored.
 * - **Next up:** a whole series is hidden by its id and stays hidden until it is restored.
 */
data class HiddenEntry(
    /** What the list of hidden things shows: "Series · S1 E2", or a movie's name. */
    val name: String,
    /** When it was hidden (ms since the epoch, this TV's clock): to sort only. */
    val at: Long,
    /** The title's last-played date when it was hidden (the server's clock; 0 when it had none). */
    val playedAt: Long,
)

enum class HiddenKind { Resume, NextUp }

data class HiddenListed(val kind: HiddenKind, val id: String, val entry: HiddenEntry)

data class HiddenItems(
    val resume: Map<String, HiddenEntry> = emptyMap(),
    val nextUp: Map<String, HiddenEntry> = emptyMap(),
) {
    val count: Int get() = resume.size + nextUp.size

    fun hideFromResume(id: UUID, lastPlayedAt: Long?, name: String, now: Long) =
        copy(resume = add(resume, id.toString(), HiddenEntry(name, now, lastPlayedAt ?: 0L)))

    fun hideFromNextUp(seriesId: UUID, name: String, now: Long) =
        copy(nextUp = add(nextUp, seriesId.toString(), HiddenEntry(name, now, 0L)))

    fun restored(kind: HiddenKind, id: String) = when (kind) {
        HiddenKind.Resume -> copy(resume = resume - id)
        HiddenKind.NextUp -> copy(nextUp = nextUp - id)
    }

    fun restoredAll(kind: HiddenKind? = null) = HiddenItems(
        resume = if (kind == HiddenKind.NextUp) resume else emptyMap(),
        nextUp = if (kind == HiddenKind.Resume) nextUp else emptyMap(),
    )

    /** True while the title stays out of "Continue watching": hidden, and not played again since. */
    fun isResumeHidden(id: UUID, lastPlayedAt: Long?): Boolean {
        val entry = resume[id.toString()] ?: return false
        return (lastPlayedAt ?: 0L) <= entry.playedAt
    }

    fun isNextUpHidden(seriesId: UUID?): Boolean = seriesId != null && nextUp.containsKey(seriesId.toString())

    fun filterResume(items: List<MediaItem>): List<MediaItem> =
        if (resume.isEmpty()) items else items.filterNot { isResumeHidden(it.id, it.lastPlayedAt) }

    fun filterNextUp(items: List<MediaItem>): List<MediaItem> =
        if (nextUp.isEmpty()) items else items.filterNot { isNextUpHidden(it.seriesId) }

    /** Everything hidden, newest first. */
    fun listed(): List<HiddenListed> =
        (resume.map { HiddenListed(HiddenKind.Resume, it.key, it.value) } + nextUp.map { HiddenListed(HiddenKind.NextUp, it.key, it.value) })
            .sortedByDescending { it.entry.at }

    private fun add(map: Map<String, HiddenEntry>, id: String, entry: HiddenEntry): Map<String, HiddenEntry> {
        val next = map + (id to entry)
        if (next.size <= MAX_HIDDEN) return next
        // Over the limit: the oldest ones make room.
        return next.entries.sortedByDescending { it.value.at }.take(MAX_HIDDEN).associate { it.key to it.value }
    }

    companion object {
        /** The most entries of each kind. */
        const val MAX_HIDDEN = 500

        /** The text kept on the TV for an account. */
        fun encode(items: HiddenItems): String {
            fun write(map: Map<String, HiddenEntry>) = JSONObject().also { json ->
                for ((id, e) in map) json.put(id, JSONObject().put("name", e.name).put("at", e.at).put("playedAt", e.playedAt))
            }
            return JSONObject().put("v", 1).put("resume", write(items.resume)).put("nextUp", write(items.nextUp)).toString()
        }

        /** Whatever was stored, as a valid value; anything damaged or not ours is dropped. */
        fun decode(text: String?): HiddenItems {
            if (text.isNullOrBlank()) return HiddenItems()
            return runCatching {
                val root = JSONObject(text)
                fun read(key: String): Map<String, HiddenEntry> {
                    val obj = root.optJSONObject(key) ?: return emptyMap()
                    val out = LinkedHashMap<String, HiddenEntry>()
                    for (id in obj.keys()) {
                        val e = obj.optJSONObject(id) ?: continue
                        if (id.isBlank() || id.length > 64) continue
                        out[id] = HiddenEntry(e.optString("name").take(200), e.optLong("at"), e.optLong("playedAt"))
                    }
                    return if (out.size <= MAX_HIDDEN) out else out.entries.sortedByDescending { it.value.at }.take(MAX_HIDDEN).associate { it.key to it.value }
                }
                HiddenItems(read("resume"), read("nextUp"))
            }.getOrDefault(HiddenItems())
        }
    }
}

/** What an item is called in the list of hidden things: a movie by name, an episode as "Series · S1 E2". */
fun hiddenLabel(item: MediaItem): String {
    if (item.seriesId == null) return item.name.ifBlank { item.title }
    val code = listOfNotNull(item.seasonNumber?.let { "S$it" }, item.episodeNumber?.let { "E$it" }).joinToString(" ")
    return listOf(item.title, code).filter { it.isNotBlank() }.joinToString(" · ")
}
