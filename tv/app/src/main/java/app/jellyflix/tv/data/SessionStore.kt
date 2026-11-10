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

class SessionStore(context: Context, private val vault: TokenVault = KeystoreVault()) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

    // ---- Accounts -------------------------------------------------------------------------------------------------

    private var cachedBook: ProfileBook? = null

    /**
     * Every account saved on this TV and the one in use. Tokens are kept sealed (see [TokenVault], "tokenSealed" inside each entry).
     * The single session older versions kept is turned into the first account the first time this is read.
     */
    val book: ProfileBook
        get() = cachedBook ?: readBook().also { cachedBook = it }

    /** Stores the new state of the accounts. */
    fun commit(next: ProfileBook) {
        cachedBook = next
        prefs.edit { putString("profiles", ProfileCodec.encode(next, vault)) }
    }

    /** The session of the account in use, or null when nobody is (or that account has to sign in again). */
    fun load(): Session? = book.active?.session()

    /** An account signed in: it is saved (or gets its new token) and becomes the one in use. */
    fun save(session: Session, now: Long = System.currentTimeMillis()) {
        commit(book.signedIn(session, now))
        lastServer = session.serverUrl
    }

    /** The account is forgotten, with everything this TV kept for it (its PIN, its remembered tracks and last channel, its visits). */
    fun remove(id: String) {
        prefs.edit {
            for (base in ACCOUNT_OWNED_KEYS) remove("$base.$id")
            for (key in Appearance().encode().keys) remove("look.$key.$id")
        }
        commit(book.removed(id))
    }

    private fun readBook(): ProfileBook {
        prefs.getString("profiles", null)?.let { return ProfileCodec.decode(it, vault) }
        return migrateSingleSession()
    }

    /** Before accounts, the app kept one session and its own data under bare keys: it becomes the first account and owns that data. */
    private fun migrateSingleSession(): ProfileBook {
        val migration = migrateLegacySession(prefs.all, vault, System.currentTimeMillis()) ?: return ProfileBook()
        // One write for the new accounts and the removal of the old keys: a stop in the middle can never leave the TV with neither.
        cachedBook = migration.book
        prefs.edit {
            for (key in migration.erase) remove(key)
            for ((key, value) in migration.moved) {
                when (value) {
                    is String -> putString(key, value)
                    is Long -> putLong(key, value)
                }
            }
            putString("profiles", ProfileCodec.encode(migration.book, vault))
        }
        return migration.book
    }

    /** The key `base` has for the account in use, or null while nobody is. */
    private fun own(base: String): String? = book.activeId?.let { "$base.$it" }

    /** The audio and subtitle language chosen for each series (keyed by the series id), so the next episode starts the same way. */
    var seriesTracks: Map<String, SeriesTracks>
        get() = own("seriesTracks")?.let { decodeSeriesTracks(prefs.getString(it, null)) } ?: emptyMap()
        set(value) {
            val key = own("seriesTracks") ?: return
            prefs.edit { putString(key, encodeSeriesTracks(value)) }
        }

    /** What the account in use has hidden from "Continue watching" and "Next up" (see [HiddenItems]). */
    var hidden: HiddenItems
        get() = own("hidden")?.let { HiddenItems.decode(prefs.getString(it, null)) } ?: HiddenItems()
        set(value) {
            val key = own("hidden") ?: return
            prefs.edit { putString(key, HiddenItems.encode(value)) }
        }

    /**
     * Starts a visit (or carries on with the current one) and says when the previous visit was last seen, or null the first time.
     * Kept on this device only, per account; "New since your last visit" is built on it.
     */
    fun startVisit(now: Long): Long? {
        val seenKey = own("visitSeen") ?: return null
        val sinceKey = own("visitSince") ?: return null
        val visit = nextVisit(
            storedSeen = prefs.getLong(seenKey, 0L).takeIf { it > 0 },
            storedSince = prefs.getLong(sinceKey, 0L).takeIf { it > 0 },
            now = now,
        )
        prefs.edit {
            putLong(seenKey, visit.seen)
            putLong(sinceKey, visit.since ?: 0L)
        }
        return visit.since
    }

    /**
     * How the TV looks: background, accent, poster size and the Home rows (Settings, Appearance). Each account has its own look; what the
     * TV had before accounts (or with nobody signed in) is the one an account starts from.
     */
    var appearance: Appearance
        get() = Appearance.decode { key -> own("look.$key")?.let { prefs.getString(it, null) } ?: prefs.getString("look.$key", null) }
        set(value) = prefs.edit {
            value.encode().forEach { (key, text) -> putString(own("look.$key") ?: "look.$key", text) }
        }

    /** The optional sync of preferences with the account (see [SyncPrefsState]) for the account in use; off until turned on. */
    var syncState: SyncPrefsState
        get() = own("sync")?.let { SyncPrefsState.decode(prefs.getString(it, null)) } ?: SyncPrefsState()
        set(value) {
            val key = own("sync") ?: return
            prefs.edit { putString(key, value.encode()) }
        }

    /** With two or more accounts, "Who is watching?" opens at every start (on by default); off opens the last account straight away. */
    var askWhoAtStart: Boolean
        get() = prefs.getBoolean("askWhoAtStart", true)
        set(value) = prefs.edit { putBoolean("askWhoAtStart", value) }

    /** The next episode starts by itself when one ends (on by default, like the web client). */
    var autoplayNext: Boolean
        get() = prefs.getBoolean("autoplayNext", true)
        set(value) = prefs.edit { putBoolean("autoplayNext", value) }

    /** The choices made in Settings (subtitle look, quality, text size...). They survive signing out. */
    var settings: TvSettings
        // (The old single "skip automatically" switch still decides intros, recaps and credits until a choice per kind is saved.)
        get() = TvSettings.decode(legacyAutoSkip = prefs.getBoolean("autoSkip", false)) { prefs.getString("pref.$it", null) }
        set(value) = prefs.edit { value.encode().forEach { (key, text) -> putString("pref.$key", text) } }

    /** Live TV: the kind of channel the list shows (it opens on the same one next time). */
    var liveCategory: String
        get() = prefs.getString("liveCategory", "all") ?: "all"
        set(value) = prefs.edit { putString("liveCategory", value) }

    /** Live TV: the channel watched last by the account in use, as its id and name. */
    var lastChannel: Pair<String, String>?
        get() {
            val idKey = own("lastChannelId") ?: return null
            val nameKey = own("lastChannelName") ?: return null
            return prefs.getString(idKey, null)?.let { id -> id to (prefs.getString(nameKey, "") ?: "") }
        }
        set(value) {
            val idKey = own("lastChannelId") ?: return
            val nameKey = own("lastChannelName") ?: return
            prefs.edit {
                if (value == null) {
                    remove(idKey)
                    remove(nameKey)
                } else {
                    putString(idKey, value.first)
                    putString(nameKey, value.second)
                }
            }
        }

    /** The optional modules container (retro TV channels, Match): its address, and the web app's, for the QR code of a Match. Empty: not used. */
    var modulesAddress: String
        get() = prefs.getString("modulesAddress", "") ?: ""
        set(value) = prefs.edit { putString("modulesAddress", value) }

    var webAddress: String
        get() = prefs.getString("webAddress", "") ?: ""
        set(value) = prefs.edit { putString("webAddress", value) }

    /** The last address typed, so signing in again does not mean typing it again. */
    var lastServer: String
        get() = prefs.getString("lastServer", "") ?: ""
        set(value) = prefs.edit { putString("lastServer", value) }
}
