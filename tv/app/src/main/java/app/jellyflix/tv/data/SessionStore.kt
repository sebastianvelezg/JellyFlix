package app.jellyflix.tv.data

import android.content.Context
import androidx.core.content.edit

/** What we remember about the signed-in user. It stays on the device and is never part of the source. */
data class Session(
    val serverUrl: String,
    val accessToken: String,
    val userId: String,
    val userName: String,
)

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

    fun load(): Session? {
        val server = prefs.getString("server", null) ?: return null
        val token = prefs.getString("token", null) ?: return null
        val userId = prefs.getString("userId", null) ?: return null
        return Session(server, token, userId, prefs.getString("userName", "") ?: "")
    }

    fun save(session: Session) = prefs.edit {
        putString("server", session.serverUrl)
        putString("token", session.accessToken)
        putString("userId", session.userId)
        putString("userName", session.userName)
    }

    /** Signing out forgets the session but keeps the last server address, so signing in again is quicker. */
    fun clear() = prefs.edit {
        remove("server")
        remove("token")
        remove("userId")
        remove("userName")
    }

    /**
     * Starts a visit (or carries on with the current one) and says when the previous visit was last seen, or null the first time.
     * Kept on this device only; "New since your last visit" is built on it.
     */
    fun startVisit(now: Long): Long? {
        val visit = nextVisit(
            storedSeen = prefs.getLong("visitSeen", 0L).takeIf { it > 0 },
            storedSince = prefs.getLong("visitSince", 0L).takeIf { it > 0 },
            now = now,
        )
        prefs.edit {
            putLong("visitSeen", visit.seen)
            putLong("visitSince", visit.since ?: 0L)
        }
        return visit.since
    }

    /** How the TV looks: background, accent, poster size and the Home rows (Settings, Appearance). It survives signing out. */
    var appearance: Appearance
        get() = Appearance.decode { prefs.getString("look.$it", null) }
        set(value) = prefs.edit { value.encode().forEach { (key, text) -> putString("look.$key", text) } }

    /** The next episode starts by itself when one ends (on by default, like the web client). */
    var autoplayNext: Boolean
        get() = prefs.getBoolean("autoplayNext", true)
        set(value) = prefs.edit { putBoolean("autoplayNext", value) }

    /** The choices made in Settings (subtitle look, quality, text size...). They survive signing out. */
    var settings: TvSettings
        // (The old single "skip automatically" switch still decides intros, recaps and credits until a choice per kind is saved.)
        get() = TvSettings.decode(legacyAutoSkip = prefs.getBoolean("autoSkip", false)) { prefs.getString("pref.$it", null) }
        set(value) = prefs.edit { value.encode().forEach { (key, text) -> putString("pref.$key", text) } }

    /** The last address typed, so signing in again does not mean typing it again. */
    var lastServer: String
        get() = prefs.getString("lastServer", "") ?: ""
        set(value) = prefs.edit { putString("lastServer", value) }
}
