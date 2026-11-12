package app.jellyflix.tv.data

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Every language has every text, and each keeps the placeholders of the English one (a missing one would show English or crash on format). */
class StringsParityTest {
    private val res = listOf(File("src/main/res"), File("app/src/main/res")).first { it.isDirectory }

    private fun read(folder: String): Map<String, String> {
        val xml = File(res, "$folder/strings.xml").readText()
        return Regex("""<string name="([^"]+)"[^>]*>([\s\S]*?)</string>""").findAll(xml).associate { it.groupValues[1] to it.groupValues[2] }
    }

    /** `%1$d`, `%s`, `%%`: the placeholders of a text, in a form that ignores the letters that merely follow them. */
    private fun placeholders(text: String) =
        Regex("""%(\d+\$)?[-#+ 0,(]*\d*(\.\d+)?[sdf]|%%""").findAll(text).map { it.value.replace(Regex("""\.\d+"""), "") }.sorted().toList()

    @Test
    fun `every language has exactly the texts of English, with the same placeholders`() {
        val english = read("values")
        assertTrue(english.size > 600)
        for (language in listOf("es", "pt", "fr", "de")) {
            val other = read("values-$language")
            assertEquals("texts missing or extra in $language", english.keys, other.keys)
            for ((key, text) in english) {
                assertEquals("$language / $key", placeholders(text), placeholders(other.getValue(key)))
            }
        }
    }
}
