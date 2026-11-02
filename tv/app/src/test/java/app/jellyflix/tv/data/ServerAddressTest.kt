package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerAddressTest {
    @Test
    fun `an address at home gets http, one elsewhere gets https`() {
        assertEquals("http://jellyfin.local:8096", ServerAddress.normalize("jellyfin.local:8096"))
        assertEquals("http://192.168.0.10:8096", ServerAddress.normalize("192.168.0.10:8096"))
        assertEquals("http://nas:8096", ServerAddress.normalize("nas:8096"))
        assertEquals("http://[::1]:8096", ServerAddress.normalize("[::1]:8096"))
        assertEquals("https://media.example.com", ServerAddress.normalize("media.example.com"))
        assertEquals("https://8.8.8.8:8096", ServerAddress.normalize("8.8.8.8:8096"))
    }

    @Test
    fun `a typed scheme is kept and a trailing slash is dropped`() {
        assertEquals("http://media.example.com", ServerAddress.normalize("http://media.example.com/"))
        assertEquals("https://192.168.0.10:8920", ServerAddress.normalize("  HTTPS://192.168.0.10:8920/ "))
    }

    @Test
    fun `finds the host in any spelling`() {
        assertEquals("jellyfin.local", ServerAddress.hostOf("http://jellyfin.local:8096/web/index.html"))
        assertEquals("media.example.com", ServerAddress.hostOf("user@media.example.com/path?x=1"))
        assertEquals("::1", ServerAddress.hostOf("http://[::1]:8096"))
        assertEquals("host", ServerAddress.hostOf("HOST"))
    }

    @Test
    fun `knows the private networks`() {
        for (host in listOf("localhost", "nas", "jellyfin.local", "box.home.arpa", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
            "127.0.0.1", "169.254.1.1", "100.64.0.1", "100.127.255.255", "::1", "fd12:3456::1", "fe80::1", "my-tv.tail1234.ts.net")) {
            assertTrue(host, ServerAddress.isPrivateHost(host))
        }
        for (host in listOf("", "example.com", "8.8.8.8", "172.32.0.1", "172.15.0.1", "100.128.0.1", "192.169.0.1", "11.0.0.1", "300.1.1.1", "2001:db8::1")) {
            assertFalse(host, ServerAddress.isPrivateHost(host))
        }
    }

    @Test
    fun `warns only about http to somewhere that is not private`() {
        assertTrue(ServerAddress.isUnencryptedPublic("http://media.example.com"))
        assertTrue(ServerAddress.isUnencryptedPublic("HTTP://8.8.8.8:8096"))
        assertFalse(ServerAddress.isUnencryptedPublic("https://media.example.com"))
        assertFalse(ServerAddress.isUnencryptedPublic("http://192.168.0.10:8096"))
        assertFalse(ServerAddress.isUnencryptedPublic("http://jellyfin.local:8096"))
    }
}
