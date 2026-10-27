package app.jellyflix.tv.data

/**
 * The titles to play through when [first] is started from [items] (a collection, the videos of a folder): [first] and what can be
 * played after it, in order. Null when [first] is not one of them (it is played on its own).
 */
fun playThroughFrom(items: List<MediaItem>, first: MediaItem): List<MediaItem>? {
    val playable = items.filter { it.isPlayable }
    val at = playable.indexOfFirst { it.id == first.id }
    return if (at < 0) null else playable.drop(at)
}
