package app.jellyflix.tv.data

private val LINE_BREAKS = Regex("<\\s*(br|/p|/div|/li|/h[1-6])\\b[^>]*>", RegexOption.IGNORE_CASE)
private val TAGS = Regex("</?[a-z][^>]*>", RegexOption.IGNORE_CASE)
private val ENTITY = Regex("&(?:#(\\d{1,6})|#x([0-9a-f]{1,5})|([a-z]+));", RegexOption.IGNORE_CASE)
private val SPACES = Regex("\\s+")
private val ENTITIES = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ")

/**
 * A description as plain text. Some providers (the ones books come from, for one) send HTML, and the screens show text,
 * so `<p><b>Hello</b></p>` would be drawn with its tags. Paragraph and line breaks become a space, every other tag goes,
 * and the common entities are turned back into their characters. Text without any of that comes back as it was.
 * (The web app does the same: `plainText` in `core/plainText.ts`.)
 */
fun plainText(description: String?): String? {
    if (description.isNullOrEmpty()) return null
    if (description.none { it == '<' || it == '&' }) return description
    // Taking a tag out can leave a new one behind (`<<b>script>`), so it goes on until nothing changes.
    var stripped = description.replace(LINE_BREAKS, " ")
    do {
        val before = stripped
        stripped = stripped.replace(TAGS, "")
    } while (stripped != before)
    val text = stripped
        .replace(ENTITY) { m ->
            val name = m.groupValues[3]
            if (name.isNotEmpty()) {
                ENTITIES[name.lowercase()] ?: m.value
            } else {
                val code = m.groupValues[1].takeIf { it.isNotEmpty() }?.toInt() ?: m.groupValues[2].toInt(16)
                if (code in 1..0x10FFFF) String(Character.toChars(code)) else m.value
            }
        }
        .replace(SPACES, " ")
        .trim()
    return text.ifEmpty { null }
}
