package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfilesTest {
    private class FakeVault(private val broken: Boolean = false, private val lostKey: Boolean = false) : TokenVault {
        override fun seal(plain: String): String? = if (broken) null else "sealed:" + plain.reversed()
        override fun open(sealed: String): String? =
            if (lostKey || !sealed.startsWith("sealed:")) null else sealed.removePrefix("sealed:").reversed()
    }

    private fun session(user: String, token: String = "t-$user", name: String = user) =
        Session("http://jellyfin.local:8096", token, "0000000000000000000000000000000$user".takeLast(32).let {
            // A dashed UUID, the way the SDK writes ids.
            "${it.substring(0, 8)}-${it.substring(8, 12)}-${it.substring(12, 16)}-${it.substring(16, 20)}-${it.substring(20)}"
        }, name)

    @Test
    fun `signing in adds an account and makes it the one in use`() {
        val book = ProfileBook().signedIn(session("a"), now = 10)
        assertEquals(1, book.profiles.size)
        assertEquals(book.profiles[0].id, book.activeId)
        assertEquals("t-a", book.active?.token)
    }

    @Test
    fun `ids ignore dashes and case so the same person is never saved twice`() {
        val s = session("a")
        val book = ProfileBook().signedIn(s, 1).signedIn(s.copy(userId = s.userId.replace("-", "").uppercase(), accessToken = "new"), 2)
        assertEquals(1, book.profiles.size)
        assertEquals("new", book.active?.token)
    }

    @Test
    fun `signing in again keeps the PIN and forgets the wrong tries`() {
        val first = ProfileBook().signedIn(session("a"), 1)
        val id = first.activeId!!
        val locked = first.withPin(id, Pins.create("1234")).withAttempts(id, 7, 99_000)
        val again = locked.signedIn(session("a", token = "fresh"), 2)
        assertTrue(again.active!!.hasPin)
        assertEquals(0, again.active!!.failures)
        assertEquals("fresh", again.active!!.token)
    }

    @Test
    fun `two accounts live side by side and switching only changes who is in use`() {
        val book = ProfileBook().signedIn(session("a"), 1).signedIn(session("b"), 2)
        assertEquals(2, book.profiles.size)
        val a = book.profiles.first { it.name == "a" }
        val back = book.activate(a.id, 3)
        assertEquals(a.id, back.activeId)
        assertEquals("t-b", back.profiles.first { it.name == "b" }.token)
    }

    @Test
    fun `a refused token marks only that account`() {
        val book = ProfileBook().signedIn(session("a"), 1).signedIn(session("b"), 2)
        val b = book.active!!
        val after = book.expired(b.id)
        assertTrue(after.find(b.id)!!.needsSignIn)
        assertNull(after.find(b.id)!!.session())
        assertFalse(after.profiles.first { it.name == "a" }.needsSignIn)
    }

    @Test
    fun `removing the account in use leaves nobody in use`() {
        val book = ProfileBook().signedIn(session("a"), 1).signedIn(session("b"), 2)
        val removed = book.removed(book.activeId!!)
        assertEquals(1, removed.profiles.size)
        assertNull(removed.activeId)
        assertNull(removed.active)
    }

    @Test
    fun `activating an unknown account changes nothing`() {
        val book = ProfileBook().signedIn(session("a"), 1)
        assertEquals(book, book.activate("nope", 5))
    }

    @Test
    fun `the book stops offering new accounts at the limit`() {
        var book = ProfileBook()
        for (i in 1..MAX_PROFILES) book = book.signedIn(session(i.toString().padStart(2, '0')), i.toLong())
        assertFalse(book.canAdd)
    }

    // ---- storage ----

    @Test
    fun `the book survives being stored and read, with tokens sealed`() {
        val vault = FakeVault()
        val book = ProfileBook().signedIn(session("a"), 1).signedIn(session("b"), 2)
        val withPin = book.withPin(book.profiles[0].id, Pins.create("4321"))
        val text = ProfileCodec.encode(withPin, vault)
        assertFalse("tokens must not be stored in clear", text.contains("t-a") || text.contains("t-b"))
        val read = ProfileCodec.decode(text, vault)
        assertEquals(withPin.profiles.map { it.id }, read.profiles.map { it.id })
        assertEquals("t-b", read.active!!.token)
        assertTrue(read.profiles[0].hasPin)
        assertFalse(read.profiles[1].hasPin)
    }

    @Test
    fun `the PIN is stored as a hash and never as the number`() {
        val book = ProfileBook().signedIn(session("a"), 1)
        val text = ProfileCodec.encode(book.withPin(book.activeId!!, Pins.create("2468")), FakeVault())
        assertFalse(text.contains("2468"))
    }

    @Test
    fun `a device that cannot seal keeps the token so nobody is signed out`() {
        val vault = FakeVault(broken = true)
        val text = ProfileCodec.encode(ProfileBook().signedIn(session("a"), 1), vault)
        assertEquals("t-a", ProfileCodec.decode(text, vault).active!!.token)
    }

    @Test
    fun `a lost key signs out every account but keeps them in the list`() {
        val text = ProfileCodec.encode(ProfileBook().signedIn(session("a"), 1), FakeVault())
        val read = ProfileCodec.decode(text, FakeVault(lostKey = true))
        assertEquals(1, read.profiles.size)
        assertTrue(read.profiles[0].needsSignIn)
    }

    @Test
    fun `damaged or empty storage gives an empty book`() {
        assertTrue(ProfileCodec.decode(null, FakeVault()).isEmpty)
        assertTrue(ProfileCodec.decode("", FakeVault()).isEmpty)
        assertTrue(ProfileCodec.decode("{not json", FakeVault()).isEmpty)
        assertTrue(ProfileCodec.decode("""{"profiles":"x"}""", FakeVault()).isEmpty)
    }

    @Test
    fun `an active id that is not in the list is dropped, and repeated accounts are read once`() {
        val one = ProfileBook().signedIn(session("a"), 1)
        val text = ProfileCodec.encode(one, FakeVault()).replace(one.activeId!!, "gone")
        assertNull(ProfileCodec.decode(text, FakeVault()).activeId)
        val doubled = """{"v":1,"profiles":[{"server":"http://x","userId":"AA","name":"a"},{"server":"http://x","userId":"aa","name":"b"}]}"""
        assertEquals(1, ProfileCodec.decode(doubled, FakeVault()).profiles.size)
    }

    // ---- from the single session of older versions ----

    @Test
    fun `the session of an older version becomes the first account and keeps its data`() {
        val old = mapOf(
            "server" to "http://jellyfin.local:8096",
            "userId" to "11111111-2222-3333-4444-555555555555",
            "userName" to "Ana",
            "tokenSealed" to "sealed:cba",
            "seriesTracks" to "{...}",
            "lastChannelId" to "c1",
            "visitSeen" to 99L,
            "autoplayNext" to true,
        )
        val migration = migrateLegacySession(old, FakeVault(), now = 5)!!
        val account = migration.book.active!!
        assertEquals("abc", account.token)
        assertEquals("Ana", account.name)
        assertEquals("{...}", migration.moved["seriesTracks.${account.id}"])
        assertEquals("c1", migration.moved["lastChannelId.${account.id}"])
        assertEquals(99L, migration.moved["visitSeen.${account.id}"])
        assertFalse("device settings stay where they are", migration.moved.keys.any { it.startsWith("autoplayNext") })
        assertTrue("token" in migration.erase && "seriesTracks" in migration.erase)
    }

    @Test
    fun `an older version that was signed out gives nothing to migrate`() {
        assertNull(migrateLegacySession(mapOf("lastServer" to "http://x"), FakeVault(), 0))
    }

    @Test
    fun `an older session whose key is gone becomes an account that signs in again`() {
        val old = mapOf("server" to "http://x", "userId" to "aa", "userName" to "Ana", "tokenSealed" to "sealed:cba")
        val account = migrateLegacySession(old, FakeVault(lostKey = true), 0)!!.book.profiles[0]
        assertTrue(account.needsSignIn)
    }

    // ---- PIN ----

    @Test
    fun `a PIN is four to six digits`() {
        assertTrue(Pins.isValid("1234"))
        assertTrue(Pins.isValid("123456"))
        assertFalse(Pins.isValid("123"))
        assertFalse(Pins.isValid("1234567"))
        assertFalse(Pins.isValid("12a4"))
        assertFalse(Pins.isValid(""))
    }

    @Test
    fun `two PINs with the same digits get different salts and hashes`() {
        val a = Pins.create("1234")
        val b = Pins.create("1234")
        assertNotEquals(a.salt, b.salt)
        assertNotEquals(a.hash, b.hash)
        assertTrue(Pins.matches("1234", a))
        assertFalse(Pins.matches("1235", a))
    }

    @Test
    fun `the right PIN opens, a wrong one is counted`() {
        val base = ProfileBook().signedIn(session("a"), 1)
        val id = base.activeId!!
        val book = base.withPin(id, Pins.create("1234"))
        assertTrue(Pins.attempt(book, id, "1234", now = 0) is PinResult.Right)
        val wrong = Pins.attempt(book, id, "0000", now = 0)
        assertTrue(wrong is PinResult.Wrong)
        assertEquals(1, (wrong as PinResult.Wrong).book.find(id)!!.failures)
        assertEquals(0, wrong.waitSeconds)
    }

    @Test
    fun `a profile with no PIN needs none`() {
        val book = ProfileBook().signedIn(session("a"), 1)
        assertTrue(Pins.attempt(book, book.activeId!!, "", 0) is PinResult.Right)
    }

    @Test
    fun `after five wrong tries a wait starts and doubles up to fifteen minutes`() {
        assertEquals(0, Pins.waitSeconds(4))
        assertEquals(30, Pins.waitSeconds(5))
        assertEquals(60, Pins.waitSeconds(6))
        assertEquals(120, Pins.waitSeconds(7))
        assertEquals(15 * 60, Pins.waitSeconds(40))
    }

    @Test
    fun `while waiting even the right PIN is not checked`() {
        val base = ProfileBook().signedIn(session("a"), 1)
        val id = base.activeId!!
        var book = base.withPin(id, Pins.create("1234"))
        var now = 1_000L
        repeat(5) {
            val result = Pins.attempt(book, id, "0000", now) as PinResult.Wrong
            book = result.book
        }
        val waiting = Pins.attempt(book, id, "1234", now + 1_000)
        assertTrue(waiting is PinResult.Waiting)
        assertTrue((waiting as PinResult.Waiting).seconds in 1..30)
        // Once the wait is over the right PIN opens again.
        now += 31_000
        assertTrue(Pins.attempt(book, id, "1234", now) is PinResult.Right)
    }

    @Test
    fun `moving the date of the TV forward does not end the wait`() {
        val base = ProfileBook().signedIn(session("a"), 1)
        val id = base.activeId!!
        var book = base.withPin(id, Pins.create("1234"))
        // Five wrong tries at 1 s of wall time and 50 s of running time.
        repeat(5) { book = (Pins.attempt(book, id, "0000", now = 1_000, elapsed = 50_000) as PinResult.Wrong).book }
        // The date is put a day ahead, but only 2 s of running time went by.
        val dayLater = 1_000 + 86_400_000L
        val result = Pins.attempt(book, id, "1234", now = dayLater, elapsed = 52_000)
        assertTrue(result is PinResult.Waiting)
        assertEquals(28, (result as PinResult.Waiting).seconds)
        // After the 30 s really pass, the right PIN opens.
        assertTrue(Pins.attempt(book, id, "1234", now = dayLater, elapsed = 81_000) is PinResult.Right)
    }

    @Test
    fun `after a restart the running clock starts over and the date decides`() {
        val base = ProfileBook().signedIn(session("a"), 1)
        val id = base.activeId!!
        var book = base.withPin(id, Pins.create("1234"))
        repeat(5) { book = (Pins.attempt(book, id, "0000", now = 1_000, elapsed = 900_000) as PinResult.Wrong).book }
        // Restarted: the running clock reads 5 s (less than when the wait began); 10 s of date went by.
        val result = Pins.attempt(book, id, "1234", now = 11_000, elapsed = 5_000)
        assertTrue(result is PinResult.Waiting)
        assertEquals(20, (result as PinResult.Waiting).seconds)
        assertTrue(Pins.attempt(book, id, "1234", now = 40_000, elapsed = 34_000) is PinResult.Right)
    }

    @Test
    fun `the tries survive storage so restarting the app does not reset them`() {
        val base = ProfileBook().signedIn(session("a"), 1)
        val id = base.activeId!!
        val book = base.withPin(id, Pins.create("1234")).withAttempts(id, 6, 123_456)
        val read = ProfileCodec.decode(ProfileCodec.encode(book, FakeVault()), FakeVault())
        assertEquals(6, read.find(id)!!.failures)
        assertEquals(123_456L, read.find(id)!!.lockedUntil)
        assertNotNull(read.find(id)!!.pin)
    }
}
