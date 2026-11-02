package app.jellyflix.tv.data

/**
 * The address of the Jellyfin server, as typed. A server at home is plain http on the local network; one reached over the internet
 * should be https, because http sends the password and the session in clear text. So an address typed without "http://" or
 * "https://" gets http when it is clearly a home address and https otherwise, and a typed "http://" to somewhere else is warned about.
 */
object ServerAddress {
    private val SCHEME = Regex("^https?://", RegexOption.IGNORE_CASE)

    /** The host of an address with or without a scheme ("jellyfin.local:8096/web" gives "jellyfin.local"), lower case; no brackets on IPv6. */
    fun hostOf(raw: String): String {
        var rest = raw.trim().replace(SCHEME, "")
        rest = rest.substringBefore('/').substringBefore('?').substringBefore('#').substringAfterLast('@')
        val host = if (rest.startsWith("[")) rest.substring(1).substringBefore(']') else rest.substringBefore(':')
        return host.lowercase()
    }

    /** "jellyfin.local:8096" becomes "http://jellyfin.local:8096"; "media.example.com" becomes "https://media.example.com". */
    fun normalize(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        if (SCHEME.containsMatchIn(trimmed)) return trimmed.replace(SCHEME) { it.value.lowercase() }
        return (if (isPrivateHost(hostOf(trimmed))) "http://" else "https://") + trimmed
    }

    /** True for an http address to a host that is not on a home or private network: its password and session would travel in clear text. */
    fun isUnencryptedPublic(url: String): Boolean = url.trim().startsWith("http://", ignoreCase = true) && !isPrivateHost(hostOf(url))

    /**
     * Hosts that are on this network or reached through a private tunnel: "localhost", names with no dot (a router names devices like
     * that), ".local" and similar, the private IPv4 ranges (10/8, 172.16/12, 192.168/16), loopback and link-local, the 100.64/10 range
     * Tailscale uses, IPv6 loopback, unique-local and link-local, and Tailscale's own ".ts.net" names.
     */
    fun isPrivateHost(host: String): Boolean {
        val h = host.trim().lowercase().trimEnd('.')
        if (h.isEmpty()) return false
        if (h.contains(':')) return h == "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")
        val octets = h.split('.')
        if (octets.size == 4 && octets.all { it.isNotEmpty() && it.length <= 3 && it.all(Char::isDigit) }) {
            val (a, b) = octets[0].toInt() to octets[1].toInt()
            if (octets.any { it.toInt() > 255 }) return false
            return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) ||
                (a == 169 && b == 254) || (a == 100 && b in 64..127)
        }
        if (!h.contains('.')) return true
        return PRIVATE_SUFFIXES.any { h.endsWith(it) }
    }

    private val PRIVATE_SUFFIXES = listOf(".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain", ".ts.net")
}
