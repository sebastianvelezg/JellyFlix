package app.jellyflix.tv.data

import org.jellyfin.sdk.model.api.TrickplayInfoDto
import kotlin.math.abs

/**
 * The small pictures that show where you are in a video ("trickplay"). The server makes them into sheets: each sheet is a grid of
 * [TrickplayInfo.tileWidth] x [TrickplayInfo.tileHeight] pictures, one every [TrickplayInfo.interval] milliseconds. A server that has
 * not made them for a title simply has none, and the seek bar just shows the time.
 */
data class TrickplayInfo(
    /** Size of one picture, in pixels. */
    val width: Int,
    val height: Int,
    /** How many pictures a sheet holds across and down. */
    val tileWidth: Int,
    val tileHeight: Int,
    val thumbnailCount: Int,
    /** Milliseconds between two pictures. */
    val interval: Int,
)

/** Where one picture is: which sheet (0 is the first), and its column and row on it. */
data class TrickplayTile(val sheet: Int, val column: Int, val row: Int, val index: Int)

/** The width worth using on a TV bar: the nearest to this. */
private const val PREFERRED_WIDTH = 320

private fun TrickplayInfoDto.usable(): TrickplayInfo? {
    if (width <= 0 || height <= 0 || tileWidth <= 0 || tileHeight <= 0 || thumbnailCount <= 0 || interval <= 0) return null
    return TrickplayInfo(width, height, tileWidth, tileHeight, thumbnailCount, interval)
}

/** A file's id as the server spells it in different places: with or without dashes, in either case. */
private fun plainId(id: String) = id.replace("-", "").lowercase()

/**
 * Pure: what to use out of what a title offers (the sizes made for each version of the file), or null when there is nothing usable.
 * [offered] is the title's `Trickplay` map: version id, then width, then the details.
 */
fun pickTrickplay(offered: Map<String, Map<String, TrickplayInfoDto>?>?, mediaSourceId: String): TrickplayInfo? {
    if (offered.isNullOrEmpty()) return null
    val wanted = plainId(mediaSourceId)
    val sizes = (offered.entries.firstOrNull { plainId(it.key) == wanted }?.value ?: offered.values.singleOrNull())
        ?.values?.mapNotNull { it.usable() }
        .orEmpty()
    return sizes.minByOrNull { abs(it.width - PREFERRED_WIDTH) }
}

/** Pure: where the picture for [positionMs] into the video is. */
fun trickplayTile(info: TrickplayInfo, positionMs: Long): TrickplayTile {
    val index = (positionMs.coerceAtLeast(0) / info.interval).toInt().coerceIn(0, info.thumbnailCount - 1)
    val perSheet = info.tileWidth * info.tileHeight
    val within = index % perSheet
    return TrickplayTile(sheet = index / perSheet, column = within % info.tileWidth, row = within / info.tileWidth, index = index)
}

/** An id as an object: the server writes some ids with dashes and some (a file's id, a playlist's) as 32 hex digits without. */
fun uuidOf(id: String): java.util.UUID {
    val plain = id.replace("-", "")
    require(plain.length == 32) { "Not an id: $id" }
    return java.util.UUID.fromString(
        "${plain.substring(0, 8)}-${plain.substring(8, 12)}-${plain.substring(12, 16)}-${plain.substring(16, 20)}-${plain.substring(20)}",
    )
}
