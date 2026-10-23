package app.jellyflix.tv.data

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.util.Log
import android.view.Display
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities

private const val TAG = "TvCapabilities"

/** What one kind of video the TV's decoders can play. */
data class VideoSupport(
    val maxWidth: Int,
    val maxHeight: Int,
    val tenBit: Boolean,
    /** Profile names the way Jellyfin spells them ("high", "main 10"...); empty when the decoder does not say. */
    val profiles: Set<String>,
    /** The decoder's own limit in bits per second, when it says one. */
    val maxBitrate: Int?,
    val hardware: Boolean,
)

/**
 * What this TV can play, asked of the device itself: the video decoders (codec, size, 10-bit, profiles), the audio it can
 * decode or send on over HDMI, and what the screen can show (size, HDR). The server uses it to play every file as it is
 * whenever possible, and at its own resolution: a 4K file is sent as 4K, a 1080p file as 1080p.
 */
class TvCapabilities private constructor(
    /** Keyed by Jellyfin's codec names: h264, hevc, vp9, av1. Codecs this TV cannot decode are missing. */
    val video: Map<String, VideoSupport>,
    /** Jellyfin's audio codec names this TV plays itself (decoded or passed through). */
    val audio: Set<String>,
    val screenWidth: Int,
    val screenHeight: Int,
    val hdr10: Boolean,
    val hdr10Plus: Boolean,
    val hlg: Boolean,
    val dolbyVision: Boolean,
) {
    /** The HDR kinds Jellyfin tells apart (`VideoRangeType`) that this screen can show without the server converting them. */
    val rangeTypes: List<String>
        get() = buildList {
            add("SDR")
            if (hdr10 || dolbyVision) {
                add("HDR10")
                add("HDR10Plus") // plays as plain HDR10
                add("DOVIWithHDR10") // the HDR10 layer of a Dolby Vision file
            }
            if (hlg || hdr10 || dolbyVision) {
                add("HLG")
                add("DOVIWithHLG")
            }
            add("DOVIWithSDR")
            if (dolbyVision) add("DOVI")
        }

    /** A short list for the Settings screen and the log. */
    fun summary(): List<String> {
        val videoLine = video.entries.joinToString("  ·  ") { (codec, v) ->
            val size = when {
                v.maxHeight >= 4320 -> "8K"
                v.maxHeight >= 2160 -> "4K"
                v.maxHeight >= 1440 -> "1440p"
                v.maxHeight >= 1080 -> "1080p"
                else -> "${v.maxHeight}p"
            }
            "${codec.uppercase()} $size${if (v.tenBit) " 10-bit" else ""}"
        }
        val hdr = listOfNotNull(
            "HDR10".takeIf { hdr10 },
            "HDR10+".takeIf { hdr10Plus },
            "HLG".takeIf { hlg },
            "Dolby Vision".takeIf { dolbyVision },
        ).ifEmpty { listOf("SDR") }.joinToString(", ")
        return listOf(
            "Screen: ${screenWidth}×$screenHeight  ·  $hdr",
            "Video: ${videoLine.ifEmpty { "none" }}",
            "Audio: ${audio.joinToString(", ") { it.uppercase() }}",
        )
    }

    companion object {
        @Volatile
        private var cached: TvCapabilities? = null

        /** Asked once per run: the answers do not change while the app is open. */
        fun get(context: Context): TvCapabilities =
            cached ?: synchronized(this) { cached ?: detect(context.applicationContext).also { cached = it } }

        // Numeric values of MediaCodecInfo.CodecProfileLevel, so that older API levels still compile.
        private const val AVC_BASELINE = 0x01
        private const val AVC_MAIN = 0x02
        private const val AVC_HIGH = 0x08
        private const val AVC_HIGH10 = 0x10
        private const val AVC_CONSTRAINED_BASELINE = 0x10000
        private const val AVC_CONSTRAINED_HIGH = 0x80000
        private const val HEVC_MAIN = 0x01
        private const val HEVC_MAIN10 = 0x02
        private const val HEVC_MAIN10_HDR10 = 0x1000
        private const val HEVC_MAIN10_HDR10_PLUS = 0x2000
        private const val VP9_PROFILE2 = 0x04
        private const val VP9_PROFILE2_HDR = 0x1000
        private const val VP9_PROFILE2_HDR10_PLUS = 0x2000
        private const val AV1_MAIN10 = 0x02
        private const val AV1_MAIN10_HDR10 = 0x1000
        private const val AV1_MAIN10_HDR10_PLUS = 0x2000

        private val sizes = listOf(7680 to 4320, 4096 to 2304, 3840 to 2160, 2560 to 1440, 1920 to 1080, 1280 to 720)

        private val videoMimes = mapOf(
            "h264" to MediaFormat.MIMETYPE_VIDEO_AVC,
            "hevc" to MediaFormat.MIMETYPE_VIDEO_HEVC,
            "vp9" to MediaFormat.MIMETYPE_VIDEO_VP9,
            "av1" to "video/av01",
        )

        private fun detect(context: Context): TvCapabilities {
            val infos = runCatching { MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder } }.getOrDefault(emptyList())
            val video = videoMimes.mapNotNull { (codec, mime) -> videoSupport(infos, codec, mime)?.let { codec to it } }.toMap()

            val (width, height, hdrTypes) = screen(context)
            val caps = TvCapabilities(
                video = video,
                audio = audioCodecs(context, infos),
                screenWidth = width,
                screenHeight = height,
                hdr10 = 2 in hdrTypes,
                hdr10Plus = 4 in hdrTypes,
                hlg = 3 in hdrTypes,
                dolbyVision = 1 in hdrTypes,
            )
            caps.summary().forEach { Log.i(TAG, it) }
            return caps
        }

        private fun isHardware(info: MediaCodecInfo): Boolean =
            if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated && !info.isSoftwareOnly
            else !info.name.startsWith("OMX.google.") && !info.name.startsWith("c2.android.")

        private fun videoSupport(infos: List<MediaCodecInfo>, codec: String, mime: String): VideoSupport? {
            val decoders = infos.filter { info -> info.supportedTypes.any { it.equals(mime, ignoreCase = true) } }
            if (decoders.isEmpty()) return null
            // Hardware decoders decide: a software one that "can" decode 4K would stutter on a TV's processor. On a machine with
            // only software decoders (an emulator) they are all there is.
            val hardware = decoders.filter(::isHardware)
            val chosen = hardware.ifEmpty { decoders }
            var width = 0
            var height = 0
            var bitrate: Int? = null
            var tenBit = false
            val profiles = HashSet<String>()
            for (info in chosen) {
                val caps = runCatching { info.getCapabilitiesForType(mime) }.getOrNull() ?: continue
                val video = caps.videoCapabilities ?: continue
                sizes.firstOrNull { (w, h) -> video.isSizeSupported(w, h) }?.let { (w, h) ->
                    if (h > height) {
                        width = w
                        height = h
                    }
                }
                val upper = runCatching { video.bitrateRange.upper }.getOrNull()
                if (upper != null && upper > (bitrate ?: 0)) bitrate = upper
                for (level in caps.profileLevels) {
                    val p = level.profile
                    when (codec) {
                        "h264" -> {
                            if (p == AVC_HIGH10) tenBit = true
                            profileName(codec, p)?.let(profiles::add)
                        }
                        "hevc" -> {
                            if (p == HEVC_MAIN10 || p == HEVC_MAIN10_HDR10 || p == HEVC_MAIN10_HDR10_PLUS) tenBit = true
                            profileName(codec, p)?.let(profiles::add)
                        }
                        "vp9" -> if (p == VP9_PROFILE2 || p == VP9_PROFILE2_HDR || p == VP9_PROFILE2_HDR10_PLUS) tenBit = true
                        "av1" -> if (p == AV1_MAIN10 || p == AV1_MAIN10_HDR10 || p == AV1_MAIN10_HDR10_PLUS) tenBit = true
                    }
                }
            }
            if (height == 0) return null
            return VideoSupport(width, height, tenBit, profiles, bitrate, hardware.isNotEmpty())
        }

        private fun profileName(codec: String, profile: Int): String? = when (codec) {
            "h264" -> when (profile) {
                AVC_BASELINE -> "baseline"
                AVC_CONSTRAINED_BASELINE -> "constrained baseline"
                AVC_MAIN -> "main"
                AVC_HIGH, AVC_CONSTRAINED_HIGH -> "high"
                AVC_HIGH10 -> "high 10"
                else -> null
            }
            "hevc" -> when (profile) {
                HEVC_MAIN -> "main"
                HEVC_MAIN10, HEVC_MAIN10_HDR10, HEVC_MAIN10_HDR10_PLUS -> "main 10"
                else -> null
            }
            else -> null
        }

        /** The screen's largest picture and the HDR kinds it reports (Display.HdrCapabilities numbers). */
        @Suppress("DEPRECATION")
        private fun screen(context: Context): Triple<Int, Int, Set<Int>> {
            val display = runCatching {
                (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).getDisplay(Display.DEFAULT_DISPLAY)
            }.getOrNull() ?: return Triple(1920, 1080, emptySet())
            val modes = display.supportedModes
            val best = modes.maxByOrNull { it.physicalWidth.toLong() * it.physicalHeight }
            val hdr = runCatching { display.hdrCapabilities?.supportedHdrTypes?.toSet() }.getOrNull().orEmpty()
            return Triple(best?.physicalWidth ?: 1920, best?.physicalHeight ?: 1080, hdr)
        }

        /** Audio the TV plays: always the common ones, and Dolby / DTS / TrueHD when a decoder or the HDMI link takes them. */
        @androidx.annotation.OptIn(UnstableApi::class)
        private fun audioCodecs(context: Context, infos: List<MediaCodecInfo>): Set<String> {
            val result = linkedSetOf("aac", "mp3", "opus", "flac", "vorbis", "pcm_s16le")
            fun decoder(mime: String) = infos.any { info -> info.supportedTypes.any { it.equals(mime, ignoreCase = true) } }
            val passthrough = runCatching { AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null) }.getOrNull()
            fun link(encoding: Int) = passthrough?.supportsEncoding(encoding) == true
            if (decoder(MediaFormat.MIMETYPE_AUDIO_AC3) || link(C.ENCODING_AC3)) result.add("ac3")
            if (decoder(MediaFormat.MIMETYPE_AUDIO_EAC3) || decoder("audio/eac3-joc") || link(C.ENCODING_E_AC3) || link(C.ENCODING_E_AC3_JOC)) result.add("eac3")
            // Jellyfin calls both DTS and DTS-HD "dts" (the HD part is a profile), so either one opens the door.
            if (decoder("audio/vnd.dts") || decoder("audio/vnd.dts.hd") || link(C.ENCODING_DTS) || link(C.ENCODING_DTS_HD)) result.add("dts")
            if (decoder("audio/true-hd") || link(C.ENCODING_DOLBY_TRUEHD)) result.add("truehd")
            return result
        }
    }
}
