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

/** What to do when playback enters a stretch that can be skipped (an intro, a recap, the credits, a preview). */
enum class SkipAction(@StringRes val label: Int) {
    /** Show a button and wait for the viewer. */
    Ask(R.string.skip_ask),
    /** Skip it at once. */
    Auto(R.string.skip_auto),
    /** Play it: no button, no skipping. */
    Off(R.string.skip_off),
}

/** Audio formats the server can be asked to convert even though the TV could play them (a receiver that stays silent on one of them). */
enum class AudioFormat(val codec: String, @StringRes val label: Int) {
    Ac3("ac3", R.string.audio_ac3),
    Eac3("eac3", R.string.audio_eac3),
    Dts("dts", R.string.audio_dts),
    TrueHd("truehd", R.string.audio_truehd),
}

/** How far back "Next up" looks for a series you were watching. */
enum class NextUpWindow(val days: Int, @StringRes val label: Int) {
    Always(0, R.string.nextup_always),
    Days30(30, R.string.nextup_30),
    Days90(90, R.string.nextup_90),
    Days180(180, R.string.nextup_180),
    Days365(365, R.string.nextup_365),
}

/** After how long without a key press the screensaver starts. */
enum class ScreensaverDelay(val minutes: Int, @StringRes val label: Int) {
    Off(0, R.string.screensaver_off),
    Minutes2(2, R.string.screensaver_2),
    Minutes5(5, R.string.screensaver_5),
    Minutes10(10, R.string.screensaver_10),
    Minutes15(15, R.string.screensaver_15),
}

/** Which titles' pictures the screensaver shows. */
enum class ScreensaverSource(@StringRes val label: Int) {
    All(R.string.screensaver_all),
    Movies(R.string.screensaver_movies),
    Series(R.string.screensaver_series),
}

/** The highest age rating a picture may have (the server's names for them); [rating] is null for no limit. */
enum class ScreensaverRating(val rating: String?, @StringRes val label: Int) {
    NoLimit(null, R.string.screensaver_any_rating),
    G("G", R.string.screensaver_rating_g),
    Pg("PG", R.string.screensaver_rating_pg),
    Pg13("PG-13", R.string.screensaver_rating_pg13),
    Restricted("R", R.string.screensaver_rating_r),
}

/** What the player asks of the server beyond what the TV can decode. */
data class PlayLimits(
    val maxBitrate: Int = DEFAULT_MAX_BITRATE,
    /** False: never let the server convert anything; a title the TV cannot play as it is does not start. */
    val transcodeAllowed: Boolean = true,
    /** Audio codecs (Jellyfin's names) to leave out of what the TV says it plays, so the server converts them. */
    val avoidAudio: Set<String> = emptySet(),
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
    val skipIntro: SkipAction = SkipAction.Ask,
    val skipRecap: SkipAction = SkipAction.Ask,
    val skipOutro: SkipAction = SkipAction.Ask,
    val skipPreview: SkipAction = SkipAction.Ask,
    val convertAudio: Set<AudioFormat> = emptySet(),
    val nextUp: NextUpWindow = NextUpWindow.Always,
    val screensaver: ScreensaverDelay = ScreensaverDelay.Off,
    val screensaverSource: ScreensaverSource = ScreensaverSource.All,
    val screensaverRating: ScreensaverRating = ScreensaverRating.NoLimit,
) {
    val limits: PlayLimits
        get() = PlayLimits(
            maxBitrate = quality.mbps?.let { it * 1_000_000 } ?: PlayLimits.DEFAULT_MAX_BITRATE,
            transcodeAllowed = !directOnly,
            avoidAudio = convertAudio.map { it.codec }.toSet(),
        )

    /** What to do in a stretch of this kind. */
    fun skipFor(kind: SegmentKind): SkipAction = when (kind) {
        SegmentKind.Intro -> skipIntro
        SegmentKind.Recap -> skipRecap
        SegmentKind.Outro -> skipOutro
        SegmentKind.Preview -> skipPreview
    }

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
        "skipIntro" to skipIntro.name,
        "skipRecap" to skipRecap.name,
        "skipOutro" to skipOutro.name,
        "skipPreview" to skipPreview.name,
        "convertAudio" to convertAudio.joinToString(",") { it.name },
        "nextUp" to nextUp.name,
        "screensaver" to screensaver.name,
        "screensaverSource" to screensaverSource.name,
        "screensaverRating" to screensaverRating.name,
    )

    companion object {
        /**
         * [legacyAutoSkip] is the old single switch ("skip intros, recaps and credits automatically"): until a choice per kind was
         * saved, it still decides those three.
         */
        fun decode(legacyAutoSkip: Boolean = false, read: (String) -> String?): TvSettings {
            val d = TvSettings()
            val migrated = if (read("skipIntro") == null && legacyAutoSkip) SkipAction.Auto else null
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
                skipIntro = pick(read("skipIntro"), migrated ?: d.skipIntro),
                skipRecap = pick(read("skipRecap"), migrated ?: d.skipRecap),
                skipOutro = pick(read("skipOutro"), migrated ?: d.skipOutro),
                skipPreview = pick(read("skipPreview"), d.skipPreview),
                convertAudio = read("convertAudio")?.split(',')?.mapNotNull { name -> AudioFormat.entries.firstOrNull { it.name == name } }?.toSet() ?: emptySet(),
                nextUp = pick(read("nextUp"), d.nextUp),
                screensaver = pick(read("screensaver"), d.screensaver),
                screensaverSource = pick(read("screensaverSource"), d.screensaverSource),
                screensaverRating = pick(read("screensaverRating"), d.screensaverRating),
            )
        }

        private inline fun <reified E : Enum<E>> pick(name: String?, fallback: E): E =
            enumValues<E>().firstOrNull { it.name == name } ?: fallback
    }
}
