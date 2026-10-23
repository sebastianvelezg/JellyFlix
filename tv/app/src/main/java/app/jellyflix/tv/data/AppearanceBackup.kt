package app.jellyflix.tv.data

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * The look kept on the server, in the user's own display preferences (where Jellyfin's web client keeps its settings). It is the
 * same file the web client of this project writes, so a look saved on one can be loaded on the other: `{"app":"jellyflix",
 * "version":1,"settings":{"jellyflix.appearance":{...}}}`. Only the choices of this screen are in it, never an account, a password
 * or the server's address; whatever else the file holds (the web client's own choices) is left as it was when the TV saves.
 */
object AppearanceBackup {
    const val KEY = "jellyflix.appearance"

    /** Where it lives on the server: the same display-preferences entry and field the web client uses. */
    const val PREFS_ID = "jellyflix"
    const val PREFS_CLIENT = "jellyflix"
    const val PREFS_FIELD = "settings"

    /** Keeps the server from being filled: far more than any settings file ever is. */
    const val MAX_CHARS = 200_000

    /** The text to save: [existing] (what the server has now, or null) with this look put in it. */
    fun merge(existing: String?, look: Appearance, now: Instant = Instant.now()): String {
        val file = readFile(existing) ?: JSONObject().put("app", "jellyflix").put("version", 1)
        val settings = file.optJSONObject("settings") ?: JSONObject().also { file.put("settings", it) }
        val appearance = settings.optJSONObject(KEY) ?: JSONObject().also { settings.put(KEY, it) }
        val home = appearance.optJSONObject("home") ?: JSONObject()
        appearance.put("theme", JSONObject().put("canvas", look.theme.canvas).put("accent", look.theme.accent))
        appearance.put("posterSize", look.posters.name.lowercase())
        appearance.put("nav", look.nav.id)
        // Rows only the web client knows (its "music" row) keep their place at the end.
        val foreign = { key: String -> strings(home.optJSONArray(key)).filter { HomeRow.of(it) == null } }
        appearance.put(
            "home",
            JSONObject()
                .put("banner", look.home.banner)
                .put("order", JSONArray(look.home.order.map { it.id } + foreign("order")))
                .put("hidden", JSONArray(look.home.hidden.map { it.id } + foreign("hidden"))),
        )
        file.put("exportedAt", now.toString())
        return file.toString()
    }

    /** The look in a saved file, or null when it is not one of ours or has no look in it. */
    fun parse(text: String?): Appearance? {
        val file = readFile(text) ?: return null
        val appearance = file.optJSONObject("settings")?.optJSONObject(KEY) ?: return null
        val theme = appearance.optJSONObject("theme")
        val home = appearance.optJSONObject("home")
        val posters = appearance.optString("posterSize")
        return Appearance(
            theme = sanitizeTheme(theme?.optString("canvas"), theme?.optString("accent")),
            posters = PosterSize.entries.firstOrNull { it.name.equals(posters, ignoreCase = true) } ?: PosterSize.Comfortable,
            home = HomeLayout.sanitized(
                banner = if (home?.has("banner") == true) home.optBoolean("banner", true) else null,
                order = strings(home?.optJSONArray("order")),
                hidden = strings(home?.optJSONArray("hidden")),
            ),
            nav = NavStyle.of(appearance.optString("nav")),
        )
    }

    private fun readFile(text: String?): JSONObject? {
        if (text.isNullOrBlank() || text.length > MAX_CHARS) return null
        return try {
            JSONObject(text).takeIf { it.optString("app") == "jellyflix" && it.optInt("version") == 1 }
        } catch (_: org.json.JSONException) {
            null
        }
    }

    private fun strings(array: JSONArray?): List<String> = (0 until (array?.length() ?: 0)).mapNotNull { array?.optString(it)?.takeIf(String::isNotEmpty) }
}
