package app.jellyflix.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlainTextTest {
    @Test
    fun `plain text comes back exactly as it is`() {
        assertEquals("A vampire hunter fights to save a city.", plainText("A vampire hunter fights to save a city."))
        assertEquals("Line one\nLine two", plainText("Line one\nLine two"))
        assertNull(plainText(null))
        assertNull(plainText(""))
    }

    @Test
    fun `tags go and paragraphs stay apart`() {
        assertEquals("Bold start. Second paragraph.", plainText("<p><b>Bold start.</b></p> <p>Second <em>paragraph</em>.</p>"))
        assertEquals("One Two Three", plainText("One<br>Two<br/>Three"))
        assertEquals("Dune is a novel.", plainText("<p>Dune</p><p>is a novel.</p>"))
    }

    @Test
    fun `entities become characters`() {
        assertEquals("Rock & roll &mdash; \"live\" '74 A", plainText("Rock &amp; roll &mdash; &quot;live&quot; &#39;74 &#x41;"))
        assertEquals("5 < 6 > 4 now", plainText("5 &lt; 6 &gt; 4&nbsp;now"))
    }

    @Test
    fun `nothing left is nothing`() {
        assertNull(plainText("<p> </p>"))
    }

    @Test
    fun `a lone ampersand or comparison stays`() {
        assertEquals("Tom & Jerry", plainText("Tom & Jerry"))
        assertEquals("2 < 3", plainText("2 < 3"))
    }
}
