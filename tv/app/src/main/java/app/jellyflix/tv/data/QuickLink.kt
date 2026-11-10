package app.jellyflix.tv.data

/**
 * What the QR code beside a Quick Connect code holds: the address of the Jellyflix web app with the code, `<web>/#/link?code=123456`.
 * The phone opens that page, signs in if it has no session, and is asked to confirm the code. Nothing else travels in it: no password,
 * no session, no user name, not even the server's address (the web app already knows its own).
 *
 * [webAddress] is the web app's address as set in Settings; without one the Docker image's usual port on the server's host is guessed
 * (and the screen prints the address, so a wrong guess is visible). Null when there is nothing to build it from, or the code is not
 * a plain number.
 */
fun quickConnectLink(webAddress: String, jellyfinAddress: String, code: String): String? {
    if (!Regex("^\\d{4,10}$").matches(code)) return null
    val base = webAddress.trim().ifBlank { suggestedWebAddress(jellyfinAddress) ?: return null }
    if (!Regex("^https?://[^\\s/?#]+(/[^\\s?#]*)?$", RegexOption.IGNORE_CASE).matches(base)) return null
    return "${base.trimEnd('/')}/#/link?code=$code"
}

/** How long a Quick Connect code is waited for: the server forgets a request after a while, so a new code is offered after this. */
const val QUICK_CONNECT_WINDOW_MS = 600_000L
