package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerDiscoveryTest {
    private fun read(text: String) = text.toByteArray().let { ServerDiscovery.parseReply(it, it.size) }

    @Test
    fun `a Jellyfin answer gives the name and the address to use`() {
        val server = read("""{"Address":"http://192.168.1.20:8096/","Id":"abc123","Name":"Home server","EndpointAddress":null}""")
        assertEquals(DiscoveredServer("abc123", "Home server", "http://192.168.1.20:8096"), server)
    }

    @Test
    fun `a server without a name is called by its host`() {
        assertEquals("nas.lan", read("""{"Address":"https://nas.lan","Id":"x","Name":"  "}""")?.name)
    }

    @Test
    fun `anything else that arrives is ignored`() {
        assertNull(read("not json at all"))
        assertNull(read("""{"Address":"ftp://192.168.1.20","Id":"x","Name":"n"}"""))
        assertNull(read("""{"Address":"javascript:alert(1)","Id":"x","Name":"n"}"""))
        assertNull(read("""{"Address":"http://192.168.1.20:8096","Name":"no id"}"""))
        assertNull(read("""{"Address":"http://bad host","Id":"x","Name":"n"}"""))
        assertNull(read("""{"Address":"http://","Id":"x","Name":"n"}"""))
        assertNull(read("""[1,2,3]"""))
    }

    @Test
    fun `only the bytes that arrived are read`() {
        val bytes = """{"Address":"http://h:8096","Id":"x","Name":"n"}garbage after""".toByteArray()
        assertEquals("n", ServerDiscovery.parseReply(bytes, bytes.size - "garbage after".length)?.name)
    }
}
