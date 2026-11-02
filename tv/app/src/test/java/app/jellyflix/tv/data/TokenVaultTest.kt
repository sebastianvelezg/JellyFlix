package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TokenVaultTest {
    /** A reversible stand-in for the key store; [broken] makes it behave like a device that cannot seal anything. */
    private class FakeVault(private val broken: Boolean = false, private val lostKey: Boolean = false) : TokenVault {
        override fun seal(plain: String): String? = if (broken) null else "sealed:" + plain.reversed()
        override fun open(sealed: String): String? =
            if (lostKey || !sealed.startsWith("sealed:")) null else sealed.removePrefix("sealed:").reversed()
    }

    @Test
    fun `a sealed token is opened and nothing is rewritten`() {
        val read = readToken(sealed = "sealed:cba", plain = null, vault = FakeVault())
        assertEquals("abc", read.token)
        assertNull(read.reseal)
        assertFalse(read.dropPlain)
    }

    @Test
    fun `a plain token from an older version is sealed and erased`() {
        val read = readToken(sealed = null, plain = "abc", vault = FakeVault())
        assertEquals("abc", read.token)
        assertEquals("sealed:cba", read.reseal)
        assertTrue(read.dropPlain)
    }

    @Test
    fun `when this device cannot seal, the plain token keeps working`() {
        val read = readToken(sealed = null, plain = "abc", vault = FakeVault(broken = true))
        assertEquals("abc", read.token)
        assertNull(read.reseal)
        assertFalse(read.dropPlain)
    }

    @Test
    fun `a lost key means signing in again`() {
        val read = readToken(sealed = "sealed:cba", plain = null, vault = FakeVault(lostKey = true))
        assertNull(read.token)
    }

    @Test
    fun `the sealed token wins and a leftover plain copy is erased`() {
        val read = readToken(sealed = "sealed:cba", plain = "old", vault = FakeVault())
        assertEquals("abc", read.token)
        assertTrue(read.dropPlain)
    }

    @Test
    fun `nothing stored gives nothing`() {
        val read = readToken(sealed = null, plain = null, vault = FakeVault())
        assertNull(read.token)
        assertFalse(read.dropPlain)
    }
}
