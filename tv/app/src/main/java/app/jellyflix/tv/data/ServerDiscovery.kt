package app.jellyflix.tv.data

import android.content.Context
import android.net.wifi.WifiManager
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** A Jellyfin server that answered on this network. [address] is the web address it says to use (never anything but http or https). */
data class DiscoveredServer(val id: String, val name: String, val address: String)

/**
 * Finding Jellyfin servers on the home network, so nobody has to type an address with a remote: Jellyfin answers a broadcast of the text
 * "who is JellyfinServer?" on UDP port 7359 with a small JSON note about itself. Only the local network is asked.
 */
object ServerDiscovery {
    private const val PORT = 7359
    private const val QUESTION = "who is JellyfinServer?"

    /** Reads one answer; anything that is not a Jellyfin note with a web address is ignored (any device on the network can send to us). */
    fun parseReply(bytes: ByteArray, length: Int): DiscoveredServer? {
        val text = runCatching { String(bytes, 0, length, Charsets.UTF_8) }.getOrNull() ?: return null
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return null
        val address = json.optString("Address").trim().trimEnd('/')
        val id = json.optString("Id").trim()
        if (id.isEmpty() || id.length > 64) return null
        if (!(address.startsWith("http://") || address.startsWith("https://")) || address.length > 200 || address.any { it.isWhitespace() }) return null
        val host = runCatching { java.net.URI(address).host }.getOrNull()
        if (host.isNullOrEmpty()) return null
        return DiscoveredServer(id, json.optString("Name").trim().take(60).ifEmpty { host }, address)
    }

    /** Asks the network and collects the answers for about [waitMs]. Nothing found (or any failure) is an empty list. */
    suspend fun find(context: Context, waitMs: Long = 2500): List<DiscoveredServer> = withContext(Dispatchers.IO) {
        val lock = runCatching {
            (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.createMulticastLock("jellyflix-discovery")?.apply {
                setReferenceCounted(false)
                acquire()
            }
        }.getOrNull()
        val found = LinkedHashMap<String, DiscoveredServer>()
        try {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = 400
                val question = QUESTION.toByteArray()
                runCatching { socket.send(DatagramPacket(question, question.size, InetAddress.getByName("255.255.255.255"), PORT)) }
                val buffer = ByteArray(2048)
                val until = System.currentTimeMillis() + waitMs
                while (System.currentTimeMillis() < until && found.size < 8) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    try {
                        socket.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }
                    parseReply(packet.data, packet.length)?.let { found.putIfAbsent(it.id, it) }
                }
            }
        } catch (_: Exception) {
            // No network, or the network does not allow it: simply nothing found.
        } finally {
            runCatching { lock?.release() }
        }
        found.values.toList()
    }
}
