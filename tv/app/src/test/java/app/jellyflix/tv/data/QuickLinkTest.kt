package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickLinkTest {
    @Test
    fun `the link holds the web address and the code and nothing else`() {
        val link = quickConnectLink("http://media.local:8080", "http://jellyfin.local:8096", "123456")
        assertEquals("http://media.local:8080/#/link?code=123456", link)
    }

    @Test
    fun `a trailing slash in the web address is not doubled`() {
        assertEquals("https://jf.example.com/app/#/link?code=123456", quickConnectLink("https://jf.example.com/app/", "http://x", "123456"))
    }

    @Test
    fun `without a web address the usual port on the server's host is guessed`() {
        assertEquals("http://jellyfin.local:8080/#/link?code=123456", quickConnectLink("", "http://jellyfin.local:8096", "123456"))
    }

    @Test
    fun `no secret of the server ever reaches the link`() {
        val link = quickConnectLink("http://media.local:8080", "http://user:pw@jellyfin.local:8096?api_key=SECRET", "123456")!!
        assertFalse(link.contains("pw"))
        assertFalse(link.contains("SECRET"))
        assertFalse(link.contains("8096"))
    }

    @Test
    fun `a code that is not a number gives no link`() {
        assertNull(quickConnectLink("http://media.local:8080", "http://x:1", "12 3456"))
        assertNull(quickConnectLink("http://media.local:8080", "http://x:1", "abc123"))
        assertNull(quickConnectLink("http://media.local:8080", "http://x:1", ""))
    }

    @Test
    fun `an address that is not a web address gives no link`() {
        assertNull(quickConnectLink("javascript:alert(1)", "http://x:1", "123456"))
        assertNull(quickConnectLink("http://bad host", "http://x:1", "123456"))
        assertTrue(quickConnectLink("", "not an address", "123456") == null)
    }
}
