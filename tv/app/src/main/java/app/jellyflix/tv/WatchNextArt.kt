package app.jellyflix.tv

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException

/**
 * Serves the pictures of the Google TV home screen row. The launcher is another app and may refuse plain `http://` addresses
 * (a home server usually is one), so this app saves each picture itself and hands the launcher a `content://` address instead.
 * Only files this app wrote into its own `watchnext` folder, named by a hash, can be read, and only for reading.
 */
class WatchNextArt : ContentProvider() {
    override fun onCreate() = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val name = uri.lastPathSegment ?: throw FileNotFoundException()
        if (mode != "r" || !namePattern.matches(name)) throw FileNotFoundException()
        val file = File(folder(context ?: throw FileNotFoundException()), name)
        if (!file.isFile) throw FileNotFoundException()
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun getType(uri: Uri): String = "image/jpeg"
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

    companion object {
        const val AUTHORITY = "app.jellyflix.tv.art"
        private val namePattern = Regex("[0-9a-f]{40}\\.jpg")

        fun folder(context: Context): File = File(context.cacheDir, "watchnext").also { it.mkdirs() }

        fun uriFor(file: File): Uri = Uri.parse("content://$AUTHORITY/img/${file.name}")
    }
}
