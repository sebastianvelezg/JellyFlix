import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info'
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream'
import type { PlaybackInfoResponse } from '@jellyfin/sdk/lib/generated-client/models/playback-info-response'
import { PlayMethod } from '@jellyfin/sdk/lib/generated-client/models/play-method'
import { getMediaInfoApi } from '@jellyfin/sdk/lib/utils/api/media-info-api'
import { buildDeviceProfile, type DeviceCapabilities } from './deviceProfile'
import type { Session } from './jellyfin'
import { audioLabel, subtitleLabel, uniqueLabels } from './tracks'

export type PlaybackProtocol = 'direct' | 'hls' | 'progressive'

/** What is being played: a video file (movies, episodes) or an audio file (music). */
export type MediaType = 'video' | 'audio'

export interface TrackOption {
  /** Jellyfin MediaStream index; this is what the API calls `AudioStreamIndex` / `SubtitleStreamIndex`. */
  index: number
  label: string
  language?: string
  isDefault: boolean
}

/** Everything the player needs to start one stream. URLs never contain credentials. */
export interface PlaybackPlan {
  itemId: string
  mediaSourceId: string
  playSessionId: string
  playMethod: PlayMethod
  protocol: PlaybackProtocol
  mediaType: MediaType
  /** Absolute media URL without any credentials; see `withApiKey` for players that cannot send headers. */
  url: string
  durationTicks?: number
  audioTracks: TrackOption[]
  subtitleTracks: TrackOption[]
  /** The audio track the server will actually deliver (undefined if the file has none). */
  audioIndex?: number
  defaultAudioIndex?: number
  /** Why the server is transcoding (its own codes, such as `VideoCodecNotSupported`); empty for direct play. */
  transcodeReasons: string[]
  /** A live channel: the id of the stream the server opened for it (it has no end, no resume point and cannot be sought). */
  liveStreamId?: string
}

export class PlaybackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaybackError'
  }
}

const CREDENTIAL_PARAMS = ['apikey', 'api_key', 'x-emby-token', 'x-mediabrowser-token']

/** Removes any access-token query parameters (Jellyfin sometimes embeds one in TranscodingUrl). */
export function stripCredentials(input: string): string {
  const url = new URL(input)
  for (const key of [...url.searchParams.keys()]) {
    if (CREDENTIAL_PARAMS.includes(key.toLowerCase())) url.searchParams.delete(key)
  }
  return url.toString()
}

/**
 * Adds the session token as `ApiKey`. Only for requests that cannot carry an
 * Authorization header (`<video src>`); never log or persist the result.
 * `ApiKey` is the spelling Jellyfin itself emits; the lowercase `api_key` is deprecated.
 */
export function withApiKey(input: string, token: string): string {
  const url = new URL(stripCredentials(input))
  url.searchParams.set('ApiKey', token)
  return url.toString()
}

/** Resolves a server-relative path (as returned in `TranscodingUrl`) against the base URL. */
export function resolveServerPath(serverUrl: string, pathAndQuery: string): string {
  if (/^https?:\/\//i.test(pathAndQuery)) return pathAndQuery
  const base = new URL(serverUrl)
  const basePath = base.pathname.replace(/\/+$/, '')
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  // Some servers already include their configured base path in the returned URL.
  const alreadyPrefixed = basePath !== '' && path.toLowerCase().startsWith(`${basePath.toLowerCase()}/`)
  return `${base.origin}${alreadyPrefixed ? '' : basePath}${path}`
}

export function directPlayUrl(
  serverUrl: string,
  itemId: string,
  source: MediaSourceInfo,
  playSessionId: string,
  deviceId: string,
  mediaType: MediaType = 'video',
): string {
  const url = new URL(`${serverUrl}/${mediaType === 'audio' ? 'Audio' : 'Videos'}/${itemId}/stream`)
  url.searchParams.set('Static', 'true')
  url.searchParams.set('MediaSourceId', source.Id ?? '')
  url.searchParams.set('DeviceId', deviceId)
  url.searchParams.set('PlaySessionId', playSessionId)
  if (source.ETag) url.searchParams.set('Tag', source.ETag)
  return url.toString()
}

function describeStream(stream: MediaStream, kind: 'audio' | 'subtitle'): TrackOption {
  const label = kind === 'audio' ? audioLabel(stream) : subtitleLabel(stream)
  return {
    index: stream.Index ?? 0,
    label,
    language: stream.Language ?? undefined,
    isDefault: stream.IsDefault ?? false,
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  NotAllowed: 'Your account is not allowed to play this item.',
  NoCompatibleStream:
    'The server could not find a way to play this file in your browser (no compatible stream).',
  RateLimitExceeded: 'The server is limiting playback right now. Try again in a moment.',
}

/**
 * Turns a PlaybackInfo response into a concrete plan. Pure (no I/O) so the
 * direct-play / HLS / error decisions can be unit tested.
 */
export function buildPlan(args: {
  serverUrl: string
  itemId: string
  deviceId: string
  response: PlaybackInfoResponse
  requestedAudioIndex?: number
  mediaType?: MediaType
}): PlaybackPlan {
  const { serverUrl, itemId, deviceId, response, requestedAudioIndex, mediaType = 'video' } = args

  if (response.ErrorCode) {
    throw new PlaybackError(ERROR_MESSAGES[response.ErrorCode] ?? `Playback refused: ${response.ErrorCode}.`)
  }
  const source = response.MediaSources?.[0]
  if (!source?.Id) throw new PlaybackError('The server returned no playable media for this item.')
  const playSessionId = response.PlaySessionId
  if (!playSessionId) throw new PlaybackError('The server did not return a playback session id.')

  const streams = source.MediaStreams ?? []
  const audioTracks = uniqueLabels(streams.filter((s) => s.Type === 'Audio').map((s) => describeStream(s, 'audio')))
  // Only text subtitles are offered: the server converts them to WebVTT. Image-based
  // subtitles (PGS/VobSub) would need burn-in transcoding, which is not in the MVP.
  const subtitleTracks = uniqueLabels(
    streams.filter((s) => s.Type === 'Subtitle' && s.IsTextSubtitleStream).map((s) => describeStream(s, 'subtitle')),
  )

  const defaultAudioIndex = source.DefaultAudioStreamIndex ?? audioTracks.find((t) => t.isDefault)?.index ?? audioTracks[0]?.index
  const common = {
    itemId,
    mediaSourceId: source.Id,
    playSessionId,
    durationTicks: source.RunTimeTicks ?? undefined,
    audioTracks,
    subtitleTracks,
    defaultAudioIndex,
    mediaType,
    liveStreamId: source.LiveStreamId ?? undefined,
  }

  if (source.SupportsDirectPlay) {
    return {
      ...common,
      transcodeReasons: [],
      playMethod: PlayMethod.DirectPlay,
      protocol: 'direct',
      url: directPlayUrl(serverUrl, itemId, source, playSessionId, deviceId, mediaType),
      audioIndex: defaultAudioIndex,
    }
  }

  if (source.TranscodingUrl) {
    const url = stripCredentials(resolveServerPath(serverUrl, source.TranscodingUrl))
    const isHls = source.TranscodingSubProtocol === 'hls' || new URL(url).pathname.endsWith('.m3u8')
    const urlAudio = new URL(url).searchParams.get('AudioStreamIndex')
    const reasons = new URL(url).searchParams.get('TranscodeReasons')
    return {
      ...common,
      transcodeReasons: reasons ? reasons.split(',').filter(Boolean) : [],
      playMethod: PlayMethod.Transcode,
      protocol: isHls ? 'hls' : 'progressive',
      url,
      audioIndex: urlAudio !== null ? Number(urlAudio) : (requestedAudioIndex ?? defaultAudioIndex),
    }
  }

  throw new PlaybackError(ERROR_MESSAGES.NoCompatibleStream as string)
}

/** What the server said, in words: how the file is being played, and why it is being converted. */
export function describePlayback(plan: Pick<PlaybackPlan, 'playMethod' | 'transcodeReasons'>): { method: 'direct' | 'transcode'; reasons: string[] } {
  if (plan.playMethod !== PlayMethod.Transcode) return { method: 'direct', reasons: [] }
  return { method: 'transcode', reasons: [...new Set(plan.transcodeReasons.map(transcodeReasonText))] }
}

/** The server's reason codes, in words (the interface translates them). */
export const TRANSCODE_REASONS: Record<string, string> = {
  ContainerNotSupported: 'This browser cannot open the file format',
  VideoCodecNotSupported: 'This browser cannot decode the video',
  AudioCodecNotSupported: 'This browser cannot decode the audio',
  ContainerBitrateExceedsLimit: 'The file is above your quality limit',
  VideoBitrateNotSupported: 'The video is above your quality limit',
  AudioBitrateNotSupported: 'The audio is above your quality limit',
  VideoProfileNotSupported: 'The video profile is not supported here',
  VideoLevelNotSupported: 'The video level is not supported here',
  VideoResolutionNotSupported: 'The picture is larger than this device supports',
  AudioChannelsNotSupported: 'The audio channels are not supported here',
  AudioProfileNotSupported: 'The audio profile is not supported here',
  AudioSampleRateNotSupported: 'The audio sample rate is not supported here',
  AnamorphicVideoNotSupported: 'The picture shape is not supported here',
  InterlacedVideoNotSupported: 'The picture is interlaced',
  SecondaryAudioNotSupported: 'The audio track you chose needs converting',
  AudioIsExternal: 'The audio is in a separate file',
  SubtitleCodecNotSupported: 'The subtitles need converting',
  DirectPlayError: 'Playing the file directly failed',
}

/** One of the server's reason codes as a sentence ("VideoCodecNotSupported" becomes "This browser cannot decode the video"). */
export function transcodeReasonText(code: string): string {
  return TRANSCODE_REASONS[code] ?? code.replace(/([a-z])([A-Z])/g, '$1 $2')
}

export interface NegotiateOptions {
  /** Request a specific audio track; anything but the default makes the server transcode. */
  audioStreamIndex?: number
  /**
   * The media source to play. Required for `audioStreamIndex` to take effect: without it Jellyfin
   * silently falls back to its default audio track.
   */
  mediaSourceId?: string
  /** Skip direct play/stream, e.g. after the browser failed to decode a direct-play file. */
  forceTranscode?: boolean
  /** What this device can decode; the server uses it to choose direct play or a transcode. */
  capabilities: DeviceCapabilities
  /** 'audio' for music; the default is video. */
  mediaType?: MediaType
  /** Do not stream faster than this, in bits per second; the server transcodes a file that is above it. */
  maxBitrate?: number
  /** A live TV channel: the server opens the stream itself, and always sends it as HLS (a live feed cannot be played as a file). */
  live?: boolean
}

/**
 * Asks Jellyfin how to play an item (`POST /Items/{id}/PlaybackInfo`) with this browser's
 * device profile. StartTimeTicks is deliberately omitted: HLS playlists from Jellyfin cover
 * the whole movie, so resuming is a client-side seek and the timeline stays 0-based.
 */
export async function negotiatePlayback(
  session: Session,
  itemId: string,
  opts: NegotiateOptions,
): Promise<PlaybackPlan> {
  const live = opts.live === true
  const forceTranscode = opts.forceTranscode === true || live
  let response: PlaybackInfoResponse
  try {
    const result = await getMediaInfoApi(session.api).getPostedPlaybackInfo({
      itemId,
      playbackInfoDto: {
        UserId: session.userId,
        DeviceProfile: buildDeviceProfile(opts.capabilities),
        MaxStreamingBitrate: opts.maxBitrate && opts.maxBitrate > 0 ? opts.maxBitrate : 120_000_000,
        MediaSourceId: opts.mediaSourceId,
        AudioStreamIndex: opts.audioStreamIndex,
        // -1 = no subtitle stream: subtitles are rendered client-side, never burned in.
        SubtitleStreamIndex: -1,
        AutoOpenLiveStream: live,
        EnableDirectPlay: !forceTranscode,
        EnableDirectStream: !forceTranscode,
        EnableTranscoding: true,
      },
    })
    response = result.data
  } catch (e) {
    throw new PlaybackError(
      e instanceof Error && 'response' in e
        ? 'The server refused the playback request.'
        : 'Could not ask the server how to play this movie.',
    )
  }
  return buildPlan({
    serverUrl: session.serverUrl,
    itemId,
    deviceId: session.deviceId,
    response,
    requestedAudioIndex: opts.audioStreamIndex,
    mediaType: opts.mediaType,
  })
}
