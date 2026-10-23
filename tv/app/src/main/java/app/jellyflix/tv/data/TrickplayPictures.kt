package app.jellyflix.tv.data

import android.graphics.Bitmap
import android.graphics.BitmapRegionDecoder
import android.graphics.Rect
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The seek-bar pictures of one video. Only the sheet that holds the wanted picture is downloaded, once; the two latest sheets are
 * kept, so moving back and forth over a stretch costs nothing, and only the one small picture is cut out of a sheet.
 */
class TrickplayPictures(val info: TrickplayInfo, private val fetchSheet: suspend (sheet: Int) -> ByteArray?) {
    private val sheets = object : LinkedHashMap<Int, ByteArray>(4, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, ByteArray>?) = size > KEPT_SHEETS
    }

    /** Which picture [positionMs] falls on: the same number means the same picture, so it need not be cut out again. */
    fun indexAt(positionMs: Long): Int = trickplayTile(info, positionMs).index

    /** The picture for [positionMs], or null when the sheet cannot be had (the bar then shows just the time). */
    suspend fun pictureAt(positionMs: Long): Bitmap? {
        val tile = trickplayTile(info, positionMs)
        val bytes = synchronized(sheets) { sheets[tile.sheet] }
            ?: fetchSheet(tile.sheet)?.also { synchronized(sheets) { sheets[tile.sheet] = it } }
            ?: return null
        return withContext(Dispatchers.Default) {
            runCatching {
                @Suppress("DEPRECATION")
                val decoder = BitmapRegionDecoder.newInstance(bytes, 0, bytes.size, false)
                try {
                    val left = tile.column * info.width
                    val top = tile.row * info.height
                    // The last sheet may have fewer rows than the others.
                    if (left + info.width > decoder.width || top + info.height > decoder.height) null
                    else decoder.decodeRegion(Rect(left, top, left + info.width, top + info.height), null)
                } finally {
                    decoder.recycle()
                }
            }.getOrNull()
        }
    }

    private companion object {
        const val KEPT_SHEETS = 2
    }
}
