@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package app.jellyflix.tv.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Color as AndroidColor
import android.os.Build
import android.util.Log
import android.view.Display
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.tv.material3.Text
import app.jellyflix.tv.R
import app.jellyflix.tv.data.Chapter
import app.jellyflix.tv.data.DisplayModeInfo
import app.jellyflix.tv.data.FrameRateMode
import app.jellyflix.tv.data.PlaybackPlan
import app.jellyflix.tv.data.SubtitleBackground
import app.jellyflix.tv.data.TvSettings
import app.jellyflix.tv.data.bestDisplayMode
import app.jellyflix.tv.data.plainReason
import app.jellyflix.tv.data.reasonText

private const val TAG = "PlayerExtras"

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

private fun Activity.screen(): Display? = runCatching {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else @Suppress("DEPRECATION") windowManager.defaultDisplay
}.getOrNull()

private fun Display.Mode.info() = DisplayModeInfo(modeId, physicalWidth, physicalHeight, refreshRate)

/** Dresses the player's subtitles the way Settings says: size, color, background and place. */
fun PlayerView.applySubtitleStyle(settings: TvSettings, insetX: Int, insetY: Int) {
    val view = subtitleView ?: return
    // Ours wins over whatever styling the subtitle file carries.
    view.setApplyEmbeddedStyles(false)
    view.setApplyEmbeddedFontSizes(false)
    view.setFractionalTextSize(settings.subtitleSize.fraction)
    view.setBottomPaddingFraction(settings.subtitlePosition.bottomFraction)
    val background = if (settings.subtitleBackground == SubtitleBackground.Box) 0xCC000000.toInt() else AndroidColor.TRANSPARENT
    val edge = if (settings.subtitleBackground == SubtitleBackground.Shadow) CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW else CaptionStyleCompat.EDGE_TYPE_NONE
    view.setStyle(CaptionStyleCompat(settings.subtitleColor.argb, background, AndroidColor.TRANSPARENT, edge, AndroidColor.BLACK, null))
    // The screen margin keeps subtitles off the edge a TV may cut off.
    view.setPadding(insetX, insetY, insetX, insetY)
}

/**
 * With "Always" in Settings, switches the screen to the mode that suits the video's frame rate (24 Hz for a film) while the
 * player is open, and puts the screen back as it was after. "Seamless only" is the player's own doing (see the player's setup).
 */
@Composable
fun MatchDisplayRate(mode: FrameRateMode, fps: Float?) {
    val context = LocalContext.current
    DisposableEffect(mode, fps) {
        val activity = context.findActivity()
        val window = activity?.window
        var changed = false
        val original = window?.attributes?.preferredDisplayModeId ?: 0
        if (mode == FrameRateMode.Always && fps != null && window != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val display = activity.screen()
            if (display != null) {
                val current = display.mode.info()
                val best = bestDisplayMode(fps, current, display.supportedModes.map { it.info() })
                Log.i(TAG, "Video $fps fps, screen ${current.refreshRate} Hz, modes ${display.supportedModes.map { it.refreshRate }}, chosen ${best?.refreshRate}")
                if (best != null) {
                    window.attributes = window.attributes.also { it.preferredDisplayModeId = best.id }
                    changed = true
                }
            }
        }
        onDispose {
            if (changed && window != null) window.attributes = window.attributes.also { it.preferredDisplayModeId = original }
        }
    }
}

/** What the screen is doing now, for the Info panel: "3840×2160 at 23.976 Hz". */
private fun screenLine(context: Context): String? {
    val display = context.findActivity()?.screen() ?: return null
    val mode = display.mode
    return "${mode.physicalWidth}×${mode.physicalHeight} · ${formatFps(display.refreshRate)} Hz"
}

fun formatFps(fps: Float): String = "%.3f".format(java.util.Locale.US, fps).trimEnd('0').trimEnd('.')

private fun formatMbps(bps: Long): String = "%.1f Mbps".format(java.util.Locale.US, bps / 1_000_000.0)

private fun channelsLabel(channels: Int): String = when (channels) {
    1 -> "mono"
    2 -> "stereo"
    6 -> "5.1"
    8 -> "7.1"
    else -> "$channels ch"
}

private fun codecName(mime: String?): String? = when {
    mime == null -> null
    mime.endsWith("hevc") -> "HEVC"
    mime.endsWith("avc") -> "H.264"
    mime.endsWith("av01") -> "AV1"
    mime.contains("vp9") -> "VP9"
    mime.contains("dolby-vision") -> "Dolby Vision"
    else -> mime.substringAfter('/')
}

/** The "Info" panel: how the title is being played, what the server sent, what the player decodes and what the screen shows. */
@Composable
fun InfoOverlay(plan: PlaybackPlan, player: ExoPlayer, tick: Long, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val info = plan.info
    // [tick] changes with the clock, so this is read again and the dropped frames and the screen's rate stay current.
    val decoded = player.videoFormat
    val dropped = player.videoDecoderCounters?.droppedBufferCount ?: 0
    val lines = buildList {
        add(
            stringResource(R.string.stats_method) + ": " + when {
                !plan.transcoding -> stringResource(R.string.stats_direct)
                info.videoCopied -> stringResource(R.string.stats_converted_copied)
                else -> stringResource(R.string.stats_converted_encoded)
            },
        )
        if (info.reasons.isNotEmpty()) {
            add(
                stringResource(R.string.stats_why) + ": " +
                    info.reasons.map { reason -> reasonText(reason)?.let { stringResource(it) } ?: plainReason(reason) }.joinToString("; "),
            )
        }
        val file = listOfNotNull(info.container?.uppercase(), info.totalBitrate?.let { formatMbps(it) }, info.sourceName).joinToString(" · ")
        if (file.isNotBlank()) add(stringResource(R.string.stats_file) + ": " + file)
        val video = listOfNotNull(
            info.videoCodec?.uppercase(),
            if (info.width != null && info.height != null) "${info.width}×${info.height}" else null,
            info.fps?.let { formatFps(it) + " fps" },
            info.bitDepth?.let { "$it-bit" },
            info.range?.takeIf { it != "Unknown" },
            info.videoBitrate?.let { formatMbps(it) },
        ).joinToString(" · ")
        if (video.isNotBlank()) add(stringResource(R.string.stats_video) + ": " + video)
        val audio = listOfNotNull(info.audioCodec?.uppercase(), info.channels?.let { channelsLabel(it) }, info.audioBitrate?.let { "${it / 1000} kbps" }).joinToString(" · ")
        if (audio.isNotBlank()) add(stringResource(R.string.stats_audio) + ": " + audio)
        if (decoded != null) {
            val live = listOfNotNull(
                codecName(decoded.sampleMimeType),
                if (decoded.width > 0) "${decoded.width}×${decoded.height}" else null,
                decoded.frameRate.takeIf { it > 0f }?.let { formatFps(it) + " fps" },
            ).joinToString(" · ")
            add(stringResource(R.string.stats_decoding) + ": " + live + " · " + stringResource(R.string.stats_dropped, dropped))
        }
        screenLine(context)?.let { add(stringResource(R.string.stats_screen) + ": " + it) }
    }
    Column(
        modifier = modifier
            .width(620.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xCC000000))
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        lines.forEach { Text(it, fontSize = 13.sp, color = Color(0xFFE6E6E6)) }
    }
}

/** Chapter choices. Picking one jumps there. */
@Composable
fun ChaptersPanel(chapters: List<Chapter>, current: Chapter?, onChoose: (Chapter) -> Unit, onClose: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestFocusSoon() }
    Box(Modifier.fillMaxSize().background(Color(0x99000000))) {
        Column(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .width(520.dp)
                .fillMaxHeight()
                .background(Palette.Surface.copy(alpha = 0.95f))
                .verticalScroll(rememberScrollState())
                .padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(stringResource(R.string.player_chapters), fontSize = 20.sp, color = Color.White)
            chapters.forEachIndexed { i, chapter ->
                val isCurrent = chapter == current
                Pill(
                    text = (if (isCurrent) "✓ " else "") + formatTime(chapter.startMs) + "  " + chapterName(i, chapter),
                    onClick = { onChoose(chapter) },
                    selected = isCurrent,
                    modifier = if (isCurrent || (current == null && i == 0)) Modifier.focusRequester(first) else Modifier,
                )
            }
            Pill(stringResource(R.string.player_close), onClick = onClose, modifier = Modifier.padding(top = 16.dp))
        }
    }
}

/** A chapter's name, or "Chapter N" when the file gives none. */
@Composable
fun chapterName(index: Int, chapter: Chapter): String = chapter.name.ifBlank { stringResource(R.string.player_chapter, index + 1) }
