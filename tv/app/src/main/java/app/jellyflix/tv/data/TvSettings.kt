package app.jellyflix.tv.data

import androidx.annotation.StringRes
import app.jellyflix.tv.R

/** How big subtitles are, as a share of the picture's height (ExoPlayer's own scale; 0.0533 is its default). */
enum class SubtitleSize(val fraction: Float, @StringRes val label: Int) {
    Small(0.042f, R.string.size_small),
    Medium(0.0533f, R.string.size_medium),
    Large(0.07f, R.string.size_large),
    Huge(0.09f, R.string.size_huge),
}

enum class SubtitleColor(val argb: Int, @StringRes val label: Int) {
    White(0xFFFFFFFF.toInt(), R.string.color_white),
    Yellow(0xFFFFEB3B.toInt(), R.string.color_yellow),
    Cyan(0xFF4DD0E1.toInt(), R.string.color_cyan),
}

enum class SubtitleBackground(@StringRes val label: Int) {
    Shadow(R.string.bg_shadow),
    Box(R.string.bg_box),
    None(R.string.bg_none),
}

/** Where subtitles sit: [bottomFraction] is the empty space under them, as a share of the picture's height. */
enum class SubtitlePosition(val bottomFraction: Float, @StringRes val label: Int) {
    Low(0.06f, R.string.pos_low),
    High(0.16f, R.string.pos_high),
}

/** The most the server may send per second. Anything above the limit is converted to a smaller stream. */
enum class QualityLimit(val mbps: Int?) {
    Auto(null),
    Mbps40(40),
    Mbps20(20),
    Mbps10(10),
    Mbps4(4),
}

enum class TextSize(val scale: Float, @StringRes val label: Int) {
    Normal(1f, R.string.text_normal),
    Large(1.15f, R.string.text_large),
    Larger(1.3f, R.string.text_larger),
}

/** Space kept empty round the edge of the screen, for TVs that cut the picture off (overscan). */
enum class ScreenMargin(val fraction: Float, @StringRes val label: Int) {
    Off(0f, R.string.margin_off),
    Small(0.02f, R.string.margin_small),
    Medium(0.035f, R.string.margin_medium),
    Large(0.05f, R.string.margin_large),
}

/** Whether to switch the screen to the video's own rate (24 Hz for a film) instead of showing it at 60 Hz. */
enum class FrameRateMode(@StringRes val label: Int) {
    Off(R.string.fr_off),
    Seamless(R.string.fr_seamless),
    Always(R.string.fr_always),
}

/** What the player asks of the server beyond what the TV can decode. */
data class PlayLimits(
    val maxBitrate: Int = DEFAULT_MAX_BITRATE,
    /** False: never let the server convert anything; a title the TV cannot play as it is does not start. */
    val transcodeAllowed: Boolean = true,
) {
    companion object {
        const val DEFAULT_MAX_BITRATE = 120_000_000
    }
}

/** The choices made in Settings. They live on the TV only. */
data class TvSettings(
    val subtitleSize: SubtitleSize = SubtitleSize.Medium,
    val subtitleColor: SubtitleColor = SubtitleColor.White,
    val subtitleBackground: SubtitleBackground = SubtitleBackground.Shadow,
    val subtitlePosition: SubtitlePosition = SubtitlePosition.Low,
    val quality: QualityLimit = QualityLimit.Auto,
    val directOnly: Boolean = false,
    val textSize: TextSize = TextSize.Normal,
    val margin: ScreenMargin = ScreenMargin.Off,
    val frameRate: FrameRateMode = FrameRateMode.Seamless,
) {
    val limits: PlayLimits
        get() = PlayLimits(
            maxBitrate = quality.mbps?.let { it * 1_000_000 } ?: PlayLimits.DEFAULT_MAX_BITRATE,
            transcodeAllowed = !directOnly,
        )

    /** The values as text, to be stored; [decode] reads them back and ignores anything it does not know. */
    fun encode(): Map<String, String> = mapOf(
        "subSize" to subtitleSize.name,
        "subColor" to subtitleColor.name,
        "subBackground" to subtitleBackground.name,
        "subPosition" to subtitlePosition.name,
        "quality" to quality.name,
        "directOnly" to directOnly.toString(),
        "textSize" to textSize.name,
        "margin" to margin.name,
        "frameRate" to frameRate.name,
    )

    companion object {
        fun decode(read: (String) -> String?): TvSettings {
            val d = TvSettings()
            return TvSettings(
                subtitleSize = pick(read("subSize"), d.subtitleSize),
                subtitleColor = pick(read("subColor"), d.subtitleColor),
                subtitleBackground = pick(read("subBackground"), d.subtitleBackground),
                subtitlePosition = pick(read("subPosition"), d.subtitlePosition),
                quality = pick(read("quality"), d.quality),
                directOnly = read("directOnly") == "true",
                textSize = pick(read("textSize"), d.textSize),
                margin = pick(read("margin"), d.margin),
                frameRate = pick(read("frameRate"), d.frameRate),
            )
        }

        private inline fun <reified E : Enum<E>> pick(name: String?, fallback: E): E =
            enumValues<E>().firstOrNull { it.name == name } ?: fallback
    }
}
