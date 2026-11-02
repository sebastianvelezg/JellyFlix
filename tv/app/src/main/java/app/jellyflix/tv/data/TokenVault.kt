package app.jellyflix.tv.data

/**
 * Seals the session token before it is written to the app's storage, so that a copy of the storage (a backup, a rooted device, a
 * forgotten adb pull) does not hold a token that works. The key itself never leaves the device's secure hardware or key store.
 */
interface TokenVault {
    /** The token as text safe to store, or null when this device cannot seal it. */
    fun seal(plain: String): String?

    /** The token back, or null when the text is damaged or its key is gone (a reset key store). */
    fun open(sealed: String): String?
}

/** What reading the stored token found, and what the store should do about it. */
class TokenRead(
    /** The token to use, or null when there is none (the person has to sign in again). */
    val token: String?,
    /** A sealed copy to write now, when an old plain token was found and could be sealed. */
    val reseal: String?,
    /** The plain copy is no longer needed and must be erased. */
    val dropPlain: Boolean,
)

/**
 * Decides what to do with what is stored: [sealed] is the sealed token and [plain] the one older versions of the app wrote in clear.
 * A plain token is sealed on first read (and erased); if this device cannot seal, it keeps working as before rather than signing the
 * person out at every start. A sealed token that cannot be opened means the key is gone: sign in again.
 */
fun readToken(sealed: String?, plain: String?, vault: TokenVault): TokenRead {
    if (sealed != null) return TokenRead(token = vault.open(sealed), reseal = null, dropPlain = plain != null)
    if (plain == null) return TokenRead(token = null, reseal = null, dropPlain = false)
    val now = vault.seal(plain) ?: return TokenRead(token = plain, reseal = null, dropPlain = false)
    return TokenRead(token = plain, reseal = now, dropPlain = true)
}
