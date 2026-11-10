package app.jellyflix.tv.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * What each synced section holds on this TV and how it goes in and out of the TV's choices (see [SyncPrefs.kt]). The data is plain JSON
 * the web app reads and writes too: `appearance` is `{theme:{canvas,accent}, menu:{order,hidden}, home:{banner,order,hidden}}` and
 * `playback` is `{autoplayNext, stillWatching, skip:{intro,recap,outro,preview}}`.
 */
data class SyncValues(val look: Appearance, val settings: TvSettings, val autoplayNext: Boolean)

private val SKIP_KINDS = listOf("intro", "recap", "outro", "preview")

private fun skipName(action: SkipAction) = action.name.lowercase()

private fun skipOf(name: Any?, fallback: SkipAction) = SkipAction.entries.firstOrNull { it.name.equals(name as? String, ignoreCase = true) } ?: fallback

private fun strings(array: JSONArray?): List<String> = (0 until (array?.length() ?: 0)).mapNotNull { array?.optString(it)?.takeIf(String::isNotEmpty) }

/** This TV's data for a section, as JSON. */
fun collectSection(section: SyncSection, v: SyncValues): JSONObject = when (section) {
    SyncSection.Appearance -> JSONObject()
        .put("theme", JSONObject().put("canvas", v.look.theme.canvas).put("accent", v.look.theme.accent))
        .put("menu", JSONObject().put("order", JSONArray(v.look.menu.order.map { it.id })).put("hidden", JSONArray(v.look.menu.hidden.map { it.id })))
        .put("home", JSONObject().put("banner", v.look.home.banner).put("order", JSONArray(v.look.home.order.map { it.id })).put("hidden", JSONArray(v.look.home.hidden.map { it.id })))

    SyncSection.Playback -> JSONObject()
        .put("autoplayNext", v.autoplayNext)
        .put("stillWatching", v.settings.stillWatching.count)
        .put(
            "skip",
            JSONObject()
                .put("intro", skipName(v.settings.skipIntro))
                .put("recap", skipName(v.settings.skipRecap))
                .put("outro", skipName(v.settings.skipOutro))
                .put("preview", skipName(v.settings.skipPreview)),
        )
}

/**
 * What a section would be on this TV if [data] (from the account) were taken: valid parts only. Anything this TV does not know is left
 * out, so two copies that differ only in what another kind of app holds count as the same.
 */
fun sanitizeSection(section: SyncSection, data: JSONObject?, base: SyncValues): SyncValues = when (section) {
    SyncSection.Appearance -> {
        val theme = data?.optJSONObject("theme")
        val menu = data?.optJSONObject("menu")
        val home = data?.optJSONObject("home")
        base.copy(
            look = base.look.copy(
                theme = sanitizeTheme(theme?.optString("canvas"), theme?.optString("accent")),
                menu = MenuLayout.sanitized(strings(menu?.optJSONArray("order")), strings(menu?.optJSONArray("hidden"))),
                home = HomeLayout.sanitized(
                    banner = if (home?.has("banner") == true) home.optBoolean("banner", true) else null,
                    order = strings(home?.optJSONArray("order")),
                    hidden = strings(home?.optJSONArray("hidden")),
                ),
            ),
        )
    }

    SyncSection.Playback -> {
        val skip = data?.optJSONObject("skip")
        val d = base.settings
        base.copy(
            settings = d.copy(
                stillWatching = StillWatching.entries.firstOrNull { it.count == data?.optInt("stillWatching", -1) } ?: StillWatching.Off,
                skipIntro = skipOf(skip?.opt("intro"), SkipAction.Ask),
                skipRecap = skipOf(skip?.opt("recap"), SkipAction.Ask),
                skipOutro = skipOf(skip?.opt("outro"), SkipAction.Ask),
                skipPreview = skipOf(skip?.opt("preview"), SkipAction.Ask),
            ),
            autoplayNext = data?.optBoolean("autoplayNext", true) ?: true,
        )
    }
}

/** The text two copies are compared by: only the synced parts, valid, in a fixed order. */
fun canonicalSection(section: SyncSection, v: SyncValues): String = when (section) {
    SyncSection.Appearance -> listOf(
        v.look.theme.canvas, v.look.theme.accent, v.look.menu.order.joinToString(",") { it.id }, v.look.menu.hidden.map { it.id }.sorted().joinToString(","),
        v.look.home.banner.toString(), v.look.home.order.joinToString(",") { it.id }, v.look.home.hidden.map { it.id }.sorted().joinToString(","),
    ).joinToString("|")

    SyncSection.Playback -> listOf(
        v.autoplayNext.toString(), v.settings.stillWatching.count.toString(),
        v.settings.skipIntro.name, v.settings.skipRecap.name, v.settings.skipOutro.name, v.settings.skipPreview.name,
    ).joinToString("|")
}

/** What taking the account's copy [data] would make this TV's section: for the first activation, to see whether they already agree. */
fun canonicalOfRemote(section: SyncSection, data: JSONObject, base: SyncValues): String = canonicalSection(section, sanitizeSection(section, data, base))

/** Ids another kind of app has (a menu button only the web has, a row only the web has) keep their place in the account's copy. */
private fun keepForeign(mine: List<String>, theirs: JSONArray?, known: (String) -> Boolean): JSONArray {
    val rest = strings(theirs).filter { !known(it) && it !in mine }
    return JSONArray(mine + rest)
}

/** The data to send for a section: this TV's, plus what the account's copy holds that this TV does not know about. */
fun dataToPush(section: SyncSection, v: SyncValues, remoteData: JSONObject?): JSONObject {
    val mine = collectSection(section, v)
    if (section != SyncSection.Appearance) return mine
    val menu = mine.getJSONObject("menu")
    val home = mine.getJSONObject("home")
    val theirMenu = remoteData?.optJSONObject("menu")
    val theirHome = remoteData?.optJSONObject("home")
    val knownMenu = { id: String -> MenuItem.of(id) != null }
    val knownRows = { id: String -> HomeRow.of(id) != null }
    menu.put("order", keepForeign(strings(menu.optJSONArray("order")), theirMenu?.optJSONArray("order"), knownMenu))
    menu.put("hidden", keepForeign(strings(menu.optJSONArray("hidden")), theirMenu?.optJSONArray("hidden"), knownMenu))
    home.put("order", keepForeign(strings(home.optJSONArray("order")), theirHome?.optJSONArray("order"), knownRows))
    home.put("hidden", keepForeign(strings(home.optJSONArray("hidden")), theirHome?.optJSONArray("hidden"), knownRows))
    return mine
}
