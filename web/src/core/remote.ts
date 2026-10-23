import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api'
import { PlayCommand } from '@jellyfin/sdk/lib/generated-client/models/play-command'
import { PlaystateCommand } from '@jellyfin/sdk/lib/generated-client/models/playstate-command'
import type { Session } from './jellyfin'
import { secondsToTicks, ticksToSeconds } from './ticks'

/**
 * Other Jellyfin apps of the same user that can be told what to play: the TV app, once it is open, this web app in another browser or
 * on a phone, and any other client that offers remote control. The server lists them (`GET /Sessions`); nothing is installed or opened
 * on the other device by this client.
 */
export interface RemoteDevice {
  /** The server's id of the session (not the device id). */
  id: string
  name: string
  client: string
  /** What sort of screen it is, for the icon. */
  kind: DeviceKind
  nowPlaying: {
    itemId: string
    title: string
    positionSeconds: number
    durationSeconds: number
    paused: boolean
    /** `Audio` for music, `Video` for a movie or an episode. */
    mediaType: string
  } | null
}

export type DeviceKind = 'tv' | 'phone' | 'computer'

/** Guesses the sort of device from what the server knows of it: the app (`Jellyflix TV`, `Jellyfin Android TV`...) and the name it gave itself. */
export function deviceKindOf(client: string, name: string): DeviceKind {
  if (/\btv\b|television|shield|chromecast|fire ?stick/i.test(`${client} ${name}`)) return 'tv'
  if (/iphone|ipad|android|phone|mobile|tablet/i.test(name)) return 'phone'
  return 'computer'
}

/** The devices this account can control right now, never including this browser itself. */
export async function getRemoteDevices(session: Session): Promise<RemoteDevice[]> {
  const { data } = await getSessionApi(session.api).getSessions({ controllableByUserId: session.userId, activeWithinSeconds: 960 })
  return data
    .filter((s) => s.SupportsRemoteControl && s.Id && s.DeviceId !== session.deviceId)
    .map((s) => {
      const item = s.NowPlayingItem
      return {
        id: s.Id as string,
        name: s.DeviceName || s.Client || 'Device',
        client: s.Client ?? '',
        kind: deviceKindOf(s.Client ?? '', s.DeviceName ?? ''),
        nowPlaying: item?.Id
          ? {
              itemId: item.Id,
              title: item.SeriesName ? `${item.SeriesName} \u00b7 ${item.Name ?? ''}` : (item.Name ?? ''),
              positionSeconds: ticksToSeconds(s.PlayState?.PositionTicks),
              durationSeconds: ticksToSeconds(item.RunTimeTicks),
              paused: s.PlayState?.IsPaused === true,
              mediaType: String(item.MediaType ?? ''),
            }
          : null,
      }
    })
}

/**
 * Starts a title (or a list of songs, in order) on another device, from [startSeconds] (0 lets the device resume where it was left).
 * [startIndex] is the song to begin with when a list is sent.
 */
export async function playOnDevice(
  session: Session,
  deviceSessionId: string,
  itemId: string | string[],
  startSeconds = 0,
  startIndex = 0,
): Promise<void> {
  await getSessionApi(session.api).play({
    sessionId: deviceSessionId,
    playCommand: PlayCommand.PlayNow,
    itemIds: Array.isArray(itemId) ? itemId : [itemId],
    startPositionTicks: startSeconds > 0 ? secondsToTicks(startSeconds) : undefined,
    startIndex: startIndex > 0 ? startIndex : undefined,
  })
}

export type RemoteCommand = 'pause' | 'resume' | 'stop' | 'next' | 'previous'

const COMMANDS: Record<RemoteCommand, PlaystateCommand> = {
  pause: PlaystateCommand.Pause,
  resume: PlaystateCommand.Unpause,
  stop: PlaystateCommand.Stop,
  next: PlaystateCommand.NextTrack,
  previous: PlaystateCommand.PreviousTrack,
}

export async function controlDevice(session: Session, deviceSessionId: string, command: RemoteCommand): Promise<void> {
  await getSessionApi(session.api).sendPlaystateCommand({ sessionId: deviceSessionId, command: COMMANDS[command] })
}

export async function seekDevice(session: Session, deviceSessionId: string, seconds: number): Promise<void> {
  await getSessionApi(session.api).sendPlaystateCommand({
    sessionId: deviceSessionId,
    command: PlaystateCommand.Seek,
    seekPositionTicks: secondsToTicks(Math.max(0, seconds)),
  })
}
