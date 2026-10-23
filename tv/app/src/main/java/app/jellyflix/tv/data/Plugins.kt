package app.jellyflix.tv.data

import androidx.annotation.StringRes
import app.jellyflix.tv.R

/** The Jellyfin plugins this app knows how to use (the web client's `SUPPORTED_PLUGINS` has the same seven). */
enum class PluginKind(
    val title: String,
    @StringRes val gives: Int,
    private val pluginName: Regex,
    private val taskName: Regex,
) {
    IntroSkipper("Intro Skipper", R.string.plugin_gives_intro, Regex("intro\\s*skipper", RegexOption.IGNORE_CASE), Regex("intro skipper|media segments?", RegexOption.IGNORE_CASE)),
    Lyrics("Lyrics", R.string.plugin_gives_lyrics, Regex("lyrics|lrclib", RegexOption.IGNORE_CASE), Regex("lyrics", RegexOption.IGNORE_CASE)),
    Subtitles("Open Subtitles", R.string.plugin_gives_subtitles, Regex("subtitles", RegexOption.IGNORE_CASE), Regex("subtitles", RegexOption.IGNORE_CASE)),
    // "TMDb" on its own is Jellyfin's metadata plugin and stays under "other"; only the Box Sets one brings collections.
    BoxSets("TMDb Box Sets", R.string.plugin_gives_boxsets, Regex("box\\s*sets?", RegexOption.IGNORE_CASE), Regex("box\\s*sets?", RegexOption.IGNORE_CASE)),
    Fanart("Fanart.tv", R.string.plugin_gives_fanart, Regex("fanart", RegexOption.IGNORE_CASE), Regex("fanart", RegexOption.IGNORE_CASE)),
    AniList("AniList", R.string.plugin_gives_anilist, Regex("ani\\s*list", RegexOption.IGNORE_CASE), Regex("ani\\s*list", RegexOption.IGNORE_CASE)),
    PlaybackReporting("Playback Reporting", R.string.plugin_gives_reporting, Regex("playback\\s*reporting", RegexOption.IGNORE_CASE), Regex("playback\\s*reporting", RegexOption.IGNORE_CASE));

    fun matchesPlugin(name: String) = pluginName.containsMatchIn(name)
    fun matchesTask(name: String, category: String) = taskName.containsMatchIn(name) || taskName.containsMatchIn(category)
}

data class ServerPlugin(val name: String, val version: String, val status: String)

data class ServerTask(
    val name: String,
    val category: String,
    val running: Boolean,
    /** 0 to 100 while it runs. */
    val progress: Double?,
    /** "Completed", "Failed", "Cancelled" or "Aborted"; null when it never ran. */
    val lastResult: String?,
    /** When it last finished (ms since the epoch). */
    val lastEndMs: Long?,
)

/** A supported plugin: whether the server has it, and the tasks that belong to it. */
data class PluginCard(val kind: PluginKind, val plugin: ServerPlugin?, val tasks: List<ServerTask>)

/** What Settings shows about the server's plugins. [admin] is false for an account that cannot list them. */
data class PluginsReport(val admin: Boolean, val cards: List<PluginCard>, val others: List<String>) {
    val anyRunning: Boolean get() = cards.any { card -> card.tasks.any { it.running } }

    companion object {
        val NotAdmin = PluginsReport(admin = false, cards = emptyList(), others = emptyList())
    }
}

/** Sorts the server's plugins and tasks into the supported kinds, and the rest. */
fun classifyPlugins(plugins: List<ServerPlugin>, tasks: List<ServerTask>): PluginsReport {
    val known = mutableSetOf<ServerPlugin>()
    val cards = PluginKind.entries.map { kind ->
        val plugin = plugins.firstOrNull { kind.matchesPlugin(it.name) }
        if (plugin != null) known += plugin
        PluginCard(kind, plugin, if (plugin == null) emptyList() else tasks.filter { kind.matchesTask(it.name, it.category) })
    }
    return PluginsReport(admin = true, cards = cards, others = plugins.filter { it !in known }.map { "${it.name} ${it.version}".trim() })
}
