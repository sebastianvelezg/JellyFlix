package app.jellyflix.tv.data

import org.jellyfin.sdk.model.api.CodecProfile
import org.jellyfin.sdk.model.api.CodecType
import org.jellyfin.sdk.model.api.DeviceProfile
import org.jellyfin.sdk.model.api.DirectPlayProfile
import org.jellyfin.sdk.model.api.DlnaProfileType
import org.jellyfin.sdk.model.api.EncodingContext
import org.jellyfin.sdk.model.api.MediaStreamProtocol
import org.jellyfin.sdk.model.api.ProfileCondition
import org.jellyfin.sdk.model.api.ProfileConditionType
import org.jellyfin.sdk.model.api.ProfileConditionValue
import org.jellyfin.sdk.model.api.SubtitleDeliveryMethod
import org.jellyfin.sdk.model.api.SubtitleProfile
import org.jellyfin.sdk.model.api.TranscodingProfile

/**
 * What this TV can play, taken from the TV itself ([TvCapabilities]) instead of a fixed list. Whatever its decoders take is
 * played as it is, at the file's own size (a 4K file stays 4K, a 1080p file stays 1080p); the server converts only what the
 * TV cannot decode (an audio format, 10-bit video on a TV without it, HDR on a screen without it) and keeps the picture size.
 */
internal fun buildDeviceProfile(caps: TvCapabilities, avoidAudio: Set<String> = emptySet()): DeviceProfile {
    // Formats chosen in Settings are left out, so the server converts them although the TV could play them.
    val audio = caps.audio.filterNot { it in avoidAudio }.joinToString(",")
    val codecProfiles = caps.video.map { (codec, v) ->
        val conditions = buildList {
            add(condition(ProfileConditionValue.VIDEO_BIT_DEPTH, ProfileConditionType.LESS_THAN_EQUAL, if (v.tenBit) "10" else "8"))
            add(condition(ProfileConditionValue.WIDTH, ProfileConditionType.LESS_THAN_EQUAL, v.maxWidth.toString()))
            add(condition(ProfileConditionValue.HEIGHT, ProfileConditionType.LESS_THAN_EQUAL, v.maxHeight.toString()))
            v.maxBitrate?.let { add(condition(ProfileConditionValue.VIDEO_BITRATE, ProfileConditionType.LESS_THAN_EQUAL, it.toString())) }
            if (v.profiles.isNotEmpty()) add(condition(ProfileConditionValue.VIDEO_PROFILE, ProfileConditionType.EQUALS_ANY, v.profiles.joinToString("|")))
            // Colour range: HDR the screen cannot show is converted (tone mapped) by the server instead of looking washed out.
            add(condition(ProfileConditionValue.VIDEO_RANGE_TYPE, ProfileConditionType.EQUALS_ANY, caps.rangeTypes.joinToString("|")))
        }
        CodecProfile(type = CodecType.VIDEO, codec = codec, conditions = conditions, applyConditions = emptyList())
    }
    return DeviceProfile(
        name = "Jellyflix TV",
        directPlayProfiles = listOf(
            DirectPlayProfile(
                container = "mp4,m4v,mkv,webm,mov,ts,m2ts",
                type = DlnaProfileType.VIDEO,
                videoCodec = caps.video.keys.joinToString(","),
                audioCodec = audio,
            ),
        ),
        transcodingProfiles = listOf(
            TranscodingProfile(
                container = "ts",
                type = DlnaProfileType.VIDEO,
                videoCodec = "h264",
                audioCodec = "aac",
                protocol = MediaStreamProtocol.HLS,
                context = EncodingContext.STREAMING,
                maxAudioChannels = "6",
                minSegments = 1,
                segmentLength = 6,
                breakOnNonKeyFrames = true,
                conditions = emptyList(),
            ),
        ),
        containerProfiles = emptyList(),
        codecProfiles = codecProfiles,
        // Text subtitles travel as separate WebVTT files; image ones (PGS, VobSub) make the server burn them in.
        subtitleProfiles = listOf(SubtitleProfile(format = "vtt", method = SubtitleDeliveryMethod.EXTERNAL)),
    )
}

private fun condition(property: ProfileConditionValue, type: ProfileConditionType, value: String) =
    ProfileCondition(condition = type, property = property, value = value, isRequired = false)
