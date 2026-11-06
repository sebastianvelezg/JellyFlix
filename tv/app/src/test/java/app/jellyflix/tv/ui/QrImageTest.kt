package app.jellyflix.tv.ui

import app.jellyflix.tv.data.matchJoinLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QrImageTest {
    @Test
    fun `the QR code of an invitation is a square with the three finder squares of every QR code`() {
        val link = matchJoinLink("http://192.168.1.5:8080", "http://192.168.1.5:8097", "ABCDE")
        val matrix = qrMatrix(link)
        assertNotNull(matrix)
        matrix!!
        val size = matrix.size
        // A QR code of version v is 4v + 17 modules wide.
        assertEquals(0, (size - 17) % 4)
        assertTrue(size in 21..57)
        matrix.forEach { assertEquals(size, it.size) }
        for ((x0, y0) in listOf(0 to 0, size - 7 to 0, 0 to size - 7)) {
            // Each finder square: a dark ring, a light ring inside it and a dark 3x3 centre.
            for (i in 0 until 7) {
                assertTrue(matrix[y0][x0 + i])
                assertTrue(matrix[y0 + 6][x0 + i])
                assertTrue(matrix[y0 + i][x0])
                assertTrue(matrix[y0 + i][x0 + 6])
            }
            assertFalse(matrix[y0 + 1][x0 + 1])
            assertFalse(matrix[y0 + 5][x0 + 5])
            assertTrue(matrix[y0 + 3][x0 + 3])
        }
    }

    @Test
    fun `a text that is too long for a QR code gives no picture instead of a crash`() {
        assertEquals(null, qrMatrix("x".repeat(5000)))
    }
}
