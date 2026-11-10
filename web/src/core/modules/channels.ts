import type {
  AutoChannelsRequest,
  Channel,
  ChannelDef,
  ChannelPreview,
  ChannelSuggestions,
  ChannelSummary,
  ChannelWindow,
  Guide,
  Program,
} from './contract'
import type { ModulesClient } from './client'

export const listChannels = (client: ModulesClient) => client.get<ChannelSummary[]>('/v1/channels')
export const getChannel = (client: ModulesClient, id: string) => client.get<Channel>(`/v1/channels/${encodeURIComponent(id)}`)
export const createChannel = (client: ModulesClient, def: ChannelDef) => client.post<Channel>('/v1/channels', def)
export const updateChannel = (client: ModulesClient, id: string, def: ChannelDef) => client.put<Channel>(`/v1/channels/${encodeURIComponent(id)}`, def)
export const deleteChannel = (client: ModulesClient, id: string) => client.del<{ ok: true }>(`/v1/channels/${encodeURIComponent(id)}`)
export const rebuildChannel = (client: ModulesClient, id: string) => client.post<Channel>(`/v1/channels/${encodeURIComponent(id)}/rebuild`)
export const refreshChannel = (client: ModulesClient, id: string) => client.post<Channel>(`/v1/channels/${encodeURIComponent(id)}/refresh`)
export const previewChannel = (client: ModulesClient, def: ChannelDef) => client.post<ChannelPreview>('/v1/channels/preview', def)
export const channelSuggestions = (client: ModulesClient) => client.get<ChannelSuggestions>('/v1/channels/suggestions')
export const autoChannels = (client: ModulesClient, request: AutoChannelsRequest) => client.post<{ created: Channel[] }>('/v1/channels/auto', request)

/** The programs around a moment (seconds, in the container's clock); the moment defaults to now. */
export function channelWindow(client: ModulesClient, id: string, options: { at?: number; before?: number; after?: number } = {}) {
  const query = new URLSearchParams()
  if (options.at !== undefined) query.set('at', String(Math.floor(options.at)))
  if (options.before !== undefined) query.set('before', String(options.before))
  if (options.after !== undefined) query.set('after', String(options.after))
  const text = query.toString()
  return client.get<ChannelWindow>(`/v1/channels/${encodeURIComponent(id)}/window${text ? `?${text}` : ''}`)
}

export function channelGuide(client: ModulesClient, from: number, to: number) {
  return client.get<Guide>(`/v1/guide?from=${Math.floor(from)}&to=${Math.floor(to)}`)
}

// ---------------------------------------------------------------------------------------------------------------------
// Where a viewer is on a channel
// ---------------------------------------------------------------------------------------------------------------------

/** Now in the container's clock (seconds), given how far this device's clock is from it (the `skew` the probe measured). */
export const liveTime = (skew: number, nowMs: number): number => nowMs / 1000 + skew

/** The program that is on at `time` and how far into it that is; null when nothing is scheduled then. */
export function locate(programs: readonly Program[], time: number): { index: number; offset: number } | null {
  const index = programs.findIndex((p) => p.start <= time && time < p.end)
  const found = programs[index]
  return found ? { index, offset: time - found.start } : null
}

/**
 * A viewer's place on the channel's timeline. It is the only thing that has to be known: being "live" is it equalling the clock,
 * "start over" moves it to the start of the program, "next" to the start of the following one.
 */
export function viewerTime(program: Program, playedSeconds: number): number {
  return program.start + Math.max(0, playedSeconds)
}

/** Seconds the viewer is behind (positive) or ahead of (negative) the channel's live moment. */
export const behindLive = (viewer: number, live: number): number => live - viewer

/** Within this many seconds of live counts as live (files are a little shorter or longer than Jellyfin says). */
export const LIVE_TOLERANCE_SECONDS = 20

export const isLive = (behind: number): boolean => Math.abs(behind) <= LIVE_TOLERANCE_SECONDS

/** The programs of a window the viewer can still go to from `index`. */
export const programAfter = (programs: readonly Program[], index: number): Program | undefined => programs[index + 1]
export const programBefore = (programs: readonly Program[], index: number): Program | undefined => (index > 0 ? programs[index - 1] : undefined)

/** "14 min", "1 h 05 min" for a distance in time. */
export function describeSpan(seconds: number): string {
  const total = Math.round(Math.abs(seconds) / 60)
  if (total < 60) return `${Math.max(1, total)} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`
}

/** Two lists of programs of one channel joined into one, in order, each moment once. */
export function mergePrograms(a: readonly Program[], b: readonly Program[]): Program[] {
  const byStart = new Map<number, Program>()
  for (const p of [...a, ...b]) byStart.set(p.start, p)
  return [...byStart.values()].sort((x, y) => x.start - y.start)
}

export const setChannelEnabled = (client: ModulesClient, id: string, enabled: boolean) =>
  client.post<Channel>(`/v1/channels/${encodeURIComponent(id)}/enabled`, { enabled })

/** Keeps a channel first for the person signed in (or no longer does). The container remembers it for them, on every device. */
export const setChannelFavorite = (client: ModulesClient, id: string, favorite: boolean) =>
  client.post<{ favorite: boolean }>(`/v1/channels/${encodeURIComponent(id)}/favorite`, { favorite })

/** `data` is the picture in base64 (a PNG, a JPEG or a WebP, up to 150 kB). */
export const setChannelImage = (client: ModulesClient, id: string, data: string) => client.put<{ imageVersion: number }>(`/v1/channels/${encodeURIComponent(id)}/image`, { data })
export const removeChannelImage = (client: ModulesClient, id: string) => client.del<{ ok: true }>(`/v1/channels/${encodeURIComponent(id)}/image`)

const pictures = new Map<string, Promise<string>>()

/**
 * An address a picture of a channel can be shown from. The picture is read once per version (the version changes when it does) and
 * kept for as long as the page lives; one that could not be read is asked for again next time.
 */
export function channelPicture(client: ModulesClient, id: string, version: number): Promise<string> {
  const key = `${client.baseUrl}|${id}|${version}`
  let found = pictures.get(key)
  if (!found) {
    found = client.blob(`/v1/channels/${encodeURIComponent(id)}/image?v=${version}`).then((blob) => URL.createObjectURL(blob))
    found.catch(() => pictures.delete(key))
    pictures.set(key, found)
  }
  return found
}
