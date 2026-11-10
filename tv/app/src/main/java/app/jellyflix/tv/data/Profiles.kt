package app.jellyflix.tv.data

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** The most accounts one TV keeps. The picker shows them in a row, so a handful is plenty. */
const val MAX_PROFILES = 8

/** A PIN is 4 to 6 digits (what a remote can type without pain). */
const val PIN_MIN_DIGITS = 4
const val PIN_MAX_DIGITS = 6

/** What stands in for a PIN: its salted hash. The number itself is never kept. */
class PinLock(val salt: String, val hash: String)

/**
 * One saved account on this TV: who it is, the token that lets this TV act as that person (null when the server no longer accepts it,
 * so only this account has to sign in again) and an optional PIN that guards opening it from here. The PIN protects the use of this TV;
 * what an account may watch is still decided by Jellyfin.
 */
data class Profile(
    val serverUrl: String,
    val userId: String,
    val name: String,
    val token: String?,
    val pin: PinLock? = null,
    /** Wrong PINs in a row, and until when (ms since the epoch) the next try has to wait. */
    val failures: Int = 0,
    val lockedUntil: Long = 0,
    val lastUsed: Long = 0,
) {
    /** The key this account's own data is kept under: the server's user id, without dashes. */
    val id: String get() = profileId(userId)
    val needsSignIn: Boolean get() = token == null
    val hasPin: Boolean get() = pin != null

    /** The session to use; null while the account has to sign in again. */
    fun session(): Session? = token?.let { Session(serverUrl, it, userId, name) }

    /** The account's picture on the server (Jellyfin serves it without a token); a 404 means it has none and initials are drawn. */
    val avatarUrl: String get() = "${serverUrl.trimEnd('/')}/Users/$userId/Images/Primary?maxWidth=240"
}

fun profileId(userId: String): String = userId.replace("-", "").lowercase()

/**
 * Every saved account of this TV and which one is in use. Immutable: each change gives a new book, so what the screen shows and what
 * is stored cannot drift apart.
 */
data class ProfileBook(val profiles: List<Profile> = emptyList(), val activeId: String? = null) {
    val active: Profile? get() = activeId?.let(::find)
    val isEmpty: Boolean get() = profiles.isEmpty()
    val canAdd: Boolean get() = profiles.size < MAX_PROFILES

    fun find(id: String): Profile? = profiles.firstOrNull { it.id == id }

    /**
     * An account signed in (with a password or a Quick Connect code): it is added, or, when it was already saved, gets its new token
     * (and keeps its PIN), and it becomes the one in use. Signing in again is itself proof of who the person is, so wrong PINs are forgotten.
     */
    fun signedIn(session: Session, now: Long): ProfileBook {
        val fresh = Profile(session.serverUrl, session.userId, session.userName, session.accessToken, lastUsed = now)
        val id = fresh.id
        val existing = find(id)
        val merged = if (existing == null) fresh else existing.copy(
            serverUrl = fresh.serverUrl,
            userId = fresh.userId,
            name = fresh.name.ifBlank { existing.name },
            token = fresh.token,
            failures = 0,
            lockedUntil = 0,
            lastUsed = now,
        )
        val list = if (existing == null) profiles + merged else profiles.map { if (it.id == id) merged else it }
        return copy(profiles = list, activeId = id)
    }

    /** This account becomes the one in use (the PIN, if any, was already asked). */
    fun activate(id: String, now: Long): ProfileBook =
        if (find(id) == null) this else copy(profiles = update(id) { it.copy(lastUsed = now) }, activeId = id)

    /** Nobody is using the TV (the picker is showing). */
    fun idle(): ProfileBook = copy(activeId = null)

    /** The server no longer accepts this account's token: only this account has to sign in again. */
    fun expired(id: String): ProfileBook = copy(profiles = update(id) { it.copy(token = null) })

    /** The account is forgotten, with its PIN and token. */
    fun removed(id: String): ProfileBook =
        copy(profiles = profiles.filterNot { it.id == id }, activeId = activeId?.takeIf { it != id })

    fun withPin(id: String, pin: PinLock?): ProfileBook =
        copy(profiles = update(id) { it.copy(pin = pin, failures = 0, lockedUntil = 0) })

    fun withAttempts(id: String, failures: Int, lockedUntil: Long): ProfileBook =
        copy(profiles = update(id) { it.copy(failures = failures, lockedUntil = lockedUntil) })

    private fun update(id: String, change: (Profile) -> Profile) = profiles.map { if (it.id == id) change(it) else it }
}

// ---- PIN ---------------------------------------------------------------------------------------------------------------

/** The result of typing a PIN for a profile. */
sealed interface PinResult {
    /** Right: the profile can be opened. */
    data object Right : PinResult

    /** Wrong: [book] remembers the failure; [waitSeconds] is how long until the next try (0: try again now). */
    class Wrong(val book: ProfileBook, val waitSeconds: Int) : PinResult

    /** Too many wrong tries: no check was made; wait [seconds] first. */
    class Waiting(val seconds: Int) : PinResult
}

object Pins {
    /** Wrong tries in a row before a wait starts, and the longest wait (fifteen minutes): the same rules as the web client's Kids mode. */
    const val FREE_TRIES = 5
    const val MAX_WAIT_SECONDS = 15 * 60
    private const val ROUNDS = 20_000

    fun isValid(pin: String): Boolean = pin.length in PIN_MIN_DIGITS..PIN_MAX_DIGITS && pin.all { it in '0'..'9' }

    fun create(pin: String, random: SecureRandom = SecureRandom()): PinLock {
        require(isValid(pin)) { "A PIN is $PIN_MIN_DIGITS to $PIN_MAX_DIGITS digits" }
        val salt = ByteArray(16).also(random::nextBytes).toHex()
        return PinLock(salt, hash(pin, salt))
    }

    fun matches(pin: String, lock: PinLock): Boolean =
        MessageDigest.isEqual(hash(pin, lock.salt).toByteArray(), lock.hash.toByteArray())

    /** How long to wait before the next try: nothing for the first few wrong ones, then 30 s, doubling, up to fifteen minutes. */
    fun waitSeconds(failures: Int): Int =
        if (failures < FREE_TRIES) 0 else minOf(MAX_WAIT_SECONDS.toLong(), 30L shl minOf(failures - FREE_TRIES, 20)).toInt()

    /** Checks [pin] against the profile's lock at time [now] and says what happened to the book. */
    fun attempt(book: ProfileBook, id: String, pin: String, now: Long): PinResult {
        val profile = book.find(id) ?: return PinResult.Right
        val lock = profile.pin ?: return PinResult.Right
        if (now < profile.lockedUntil) return PinResult.Waiting(((profile.lockedUntil - now + 999) / 1000).toInt())
        if (matches(pin, lock)) return PinResult.Right
        val failures = profile.failures + 1
        val wait = waitSeconds(failures)
        return PinResult.Wrong(book.withAttempts(id, failures, if (wait > 0) now + wait * 1000L else 0L), wait)
    }

    private fun hash(pin: String, salt: String): String {
        val spec = PBEKeySpec(pin.toCharArray(), salt.toByteArray(), ROUNDS, 256)
        return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded.toHex()
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}

// ---- Storage format ----------------------------------------------------------------------------------------------------

/** Turns the book into the text kept on the device (tokens sealed by the [TokenVault]) and back. */
object ProfileCodec {
    private const val VERSION = 1

    fun encode(book: ProfileBook, vault: TokenVault): String {
        val array = JSONArray()
        for (p in book.profiles) {
            val json = JSONObject()
                .put("server", p.serverUrl)
                .put("userId", p.userId)
                .put("name", p.name)
                .put("failures", p.failures)
                .put("lockedUntil", p.lockedUntil)
                .put("lastUsed", p.lastUsed)
            p.token?.let { token ->
                val sealed = vault.seal(token)
                // A device that cannot seal keeps the token as older versions did, rather than losing the account.
                if (sealed != null) json.put("tokenSealed", sealed) else json.put("token", token)
            }
            p.pin?.let { json.put("pinSalt", it.salt).put("pinHash", it.hash) }
            array.put(json)
        }
        return JSONObject().put("v", VERSION).put("active", book.activeId ?: JSONObject.NULL).put("profiles", array).toString()
    }

    /** A text that cannot be read gives an empty book (everybody signs in again) instead of a crash. */
    fun decode(text: String?, vault: TokenVault): ProfileBook = runCatching {
        if (text.isNullOrBlank()) return ProfileBook()
        val root = JSONObject(text)
        val array = root.optJSONArray("profiles") ?: return ProfileBook()
        val profiles = buildList {
            for (i in 0 until array.length()) {
                val j = array.optJSONObject(i) ?: continue
                val userId = j.optString("userId").takeIf { it.isNotBlank() } ?: continue
                val server = j.optString("server").takeIf { it.isNotBlank() } ?: continue
                val token = readToken(j.optString("tokenSealed").takeIf { it.isNotEmpty() }, j.optString("token").takeIf { it.isNotEmpty() }, vault).token
                val salt = j.optString("pinSalt")
                val hash = j.optString("pinHash")
                add(
                    Profile(
                        serverUrl = server,
                        userId = userId,
                        name = j.optString("name"),
                        token = token,
                        pin = if (salt.isNotEmpty() && hash.isNotEmpty()) PinLock(salt, hash) else null,
                        failures = j.optInt("failures"),
                        lockedUntil = j.optLong("lockedUntil"),
                        lastUsed = j.optLong("lastUsed"),
                    ),
                )
            }
        }.distinctBy { it.id }.take(MAX_PROFILES)
        val active = root.optString("active").takeIf { id -> profiles.any { it.id == id } }
        ProfileBook(profiles, active)
    }.getOrDefault(ProfileBook())
}

// ---- From the single session older versions kept --------------------------------------------------------------------------

/** What to do with the storage of a version that kept one session: the first account, and where its data goes. */
class LegacyMigration(
    val book: ProfileBook,
    /** Values to write under their new, account-owned key. */
    val moved: Map<String, Any>,
    /** The old keys to erase afterwards. */
    val erase: List<String>,
)

/** Keys older versions kept for the one session; the data ones are owned by the account from now on ("<name>.<account id>"). */
val LEGACY_SESSION_KEYS = listOf("server", "token", "tokenSealed", "userId", "userName")
val ACCOUNT_OWNED_KEYS = listOf("seriesTracks", "lastChannelId", "lastChannelName", "visitSeen", "visitSince", "hidden", "sync")

/** Null when there was no session to carry over. [all] is everything the old storage held. */
fun migrateLegacySession(all: Map<String, *>, vault: TokenVault, now: Long): LegacyMigration? {
    val server = all["server"] as? String ?: return null
    val userId = all["userId"] as? String ?: return null
    val token = readToken(all["tokenSealed"] as? String, all["token"] as? String, vault).token
    val profile = Profile(server, userId, all["userName"] as? String ?: "", token, lastUsed = now)
    val moved = buildMap<String, Any> {
        for (base in ACCOUNT_OWNED_KEYS) {
            when (val value = all[base]) {
                is String -> put("$base.${profile.id}", value)
                is Long -> put("$base.${profile.id}", value)
            }
        }
    }
    return LegacyMigration(ProfileBook(listOf(profile), profile.id), moved, LEGACY_SESSION_KEYS + ACCOUNT_OWNED_KEYS)
}
