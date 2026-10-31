import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind'
import { GeneralCommandType } from '@jellyfin/sdk/lib/generated-client/models/general-command-type'
import { MediaType } from '@jellyfin/sdk/lib/generated-client/models/media-type'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api'
import type { Session } from './jellyfin'
import { parseSyncMessage, type SyncMessage } from './syncplay'
import { toTrack, type Track } from './music'
import { ticksToSeconds } from './ticks'

/**
 * This browser as a device that other apps can control ("Play on…"): it tells the server what it can play, and listens on the server's
 * WebSocket for what to do. The listening itself needs a browser (see `platform/web/remoteSocket.ts`); everything here is plain data.
 */

/** What Jellyfin sends over the socket, reduced to what this client acts on. */
export type RemoteMessage =
  | { kind: 'play'; itemIds: string[]; startIndex: number; startSeconds: number; mode: 'now' | 'next' | 'last' }
  | { kind: 'playstate'; command: 'pause' | 'resume' | 'toggle' | 'stop' | 'next' | 'previous' | 'seek' | 'rewind' | 'forward'; seekSeconds: number }
  | { kind: 'volume'; level: number }
  | { kind: 'mute'; mute: boolean | 'toggle' }
  | { kind: 'message'; header: string; text: string }
  | { kind: 'keepAlive'; seconds: number }
  /** Something about the group this device watches with (see `syncplay.ts`). */
  | { kind: 'sync'; message: SyncMessage }

const PLAYSTATE: Record<string, Extract<RemoteMessage, { kind: 'playstate' }>['command']> = {
  Pause: 'pause',
  Unpause: 'resume',
  PlayPause: 'toggle',
  Stop: 'stop',
  NextTrack: 'next',
  PreviousTrack: 'previous',
  Seek: 'seek',
  Rewind: 'rewind',
  FastForward: 'forward',
}

/** The commands this client understands besides play and the transport buttons. */
export const SUPPORTED_COMMANDS: GeneralCommandType[] = [
  GeneralCommandType.DisplayMessage,
  GeneralCommandType.SetVolume,
  GeneralCommandType.Mute,
  GeneralCommandType.Unmute,
  GeneralCommandType.ToggleMute,
]

/** Tells the server this session can be told what to play. The server then lists it for the account's other devices. */
export async function announceRemoteControl(session: Session): Promise<void> {
  await getSessionApi(session.api).postFullCapabilities({
    clientCapabilitiesDto: {
      PlayableMediaTypes: [MediaType.Audio, MediaType.Video],
      SupportedCommands: SUPPORTED_COMMANDS,
      SupportsMediaControl: true,
      SupportsPersistentIdentifier: false,
    },
  })
}

/** The address of the server's socket, with the session token (a socket cannot send headers, which is how Jellyfin's own web client does it too). */
export function remoteSocketUrl(session: Pick<Session, 'serverUrl' | 'accessToken' | 'deviceId'>): string {
  const base = new URL(session.serverUrl)
  const scheme = base.protocol === 'https:' ? 'wss:' : 'ws:'
  const path = base.pathname.replace(/\/+$/, '')
  return `${scheme}//${base.host}${path}/socket?ApiKey=${encodeURIComponent(session.accessToken)}&deviceId=${encodeURIComponent(session.deviceId)}`
}

/** The message that keeps the socket open. */
export const KEEP_ALIVE = JSON.stringify({ MessageType: 'KeepAlive' })

const asNumber = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Reads one socket message. Anything that is not something to act on (or is malformed) gives null. */
export function parseRemoteMessage(raw: string): RemoteMessage | null {
  let message: { MessageType?: unknown; Data?: unknown }
  try {
    message = JSON.parse(raw) as typeof message
  } catch {
    return null
  }
  const data = (message.Data ?? {}) as Record<string, unknown>
  switch (message.MessageType) {
    case 'Play': {
      const ids = Array.isArray(data.ItemIds) ? data.ItemIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
      if (ids.length === 0) return null
      const command = data.PlayCommand
      return {
        kind: 'play',
        itemIds: ids,
        startIndex: Math.min(Math.max(0, asNumber(data.StartIndex) ?? 0), ids.length - 1),
        startSeconds: ticksToSeconds(asNumber(data.StartPositionTicks)),
        mode: command === 'PlayNext' ? 'next' : command === 'PlayLast' ? 'last' : 'now',
      }
    }
    case 'Playstate': {
      const command = typeof data.Command === 'string' ? PLAYSTATE[data.Command] : undefined
      if (!command) return null
      return { kind: 'playstate', command, seekSeconds: ticksToSeconds(asNumber(data.SeekPositionTicks)) }
    }
    case 'GeneralCommand': {
      const args = (data.Arguments ?? {}) as Record<string, unknown>
      switch (data.Name) {
        case 'SetVolume': {
          const volume = asNumber(args.Volume)
          return volume === null ? null : { kind: 'volume', level: Math.min(1, Math.max(0, volume / 100)) }
        }
        case 'Mute':
          return { kind: 'mute', mute: true }
        case 'Unmute':
          return { kind: 'mute', mute: false }
        case 'ToggleMute':
          return { kind: 'mute', mute: 'toggle' }
        case 'DisplayMessage':
          return { kind: 'message', header: String(args.Header ?? ''), text: String(args.Text ?? '') }
        default:
          return null
      }
    }
    case 'ForceKeepAlive':
      return { kind: 'keepAlive', seconds: asNumber(message.Data) ?? 60 }
    case 'SyncPlayCommand':
    case 'SyncPlayGroupUpdate': {
      const sync = parseSyncMessage(message.MessageType, message.Data)
      return sync ? { kind: 'sync', message: sync } : null
    }
    default:
      return null
  }
}

/** What a "play" message asks for, once the server has said what the items are. */
export type PlayTarget =
  | { kind: 'audio'; tracks: Track[] }
  | { kind: 'video'; itemId: string; title: string }
  | { kind: 'unsupported' }

const VIDEO_KINDS: ReadonlySet<string> = new Set([BaseItemKind.Movie, BaseItemKind.Episode, BaseItemKind.Video, BaseItemKind.MusicVideo])

/** Looks the items of a "play" message up and says whether they are songs or a video (the ids come in the order they must play). */
export async function resolvePlayTarget(session: Session, itemIds: string[]): Promise<PlayTarget> {
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    ids: itemIds,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  const found = new Map((data.Items ?? []).map((item) => [item.Id, item] as const))
  const items = itemIds.map((id) => found.get(id)).filter((item) => item !== undefined)
  const first = items[0]
  if (!first) return { kind: 'unsupported' }
  if (first.Type === BaseItemKind.Audio) {
    const tracks = items.filter((item) => item.Type === BaseItemKind.Audio).map(toTrack).filter((t): t is Track => t !== null)
    return tracks.length ? { kind: 'audio', tracks } : { kind: 'unsupported' }
  }
  if (first.Id && first.Type && VIDEO_KINDS.has(first.Type)) {
    return { kind: 'video', itemId: first.Id, title: first.SeriesName ? `${first.SeriesName} · ${first.Name ?? ''}` : (first.Name ?? '') }
  }
  return { kind: 'unsupported' }
}
