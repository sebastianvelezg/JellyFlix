import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type'
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by'
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order'
import { getLiveTvApi } from '@jellyfin/sdk/lib/utils/api/live-tv-api'
import { itemImageUrl } from './images'
import type { Session } from './jellyfin'

/** A programme on a channel: what is on, from when to when. */
export interface Program {
  id: string
  channelId: string
  name: string
  /** The title of the episode, when the programme is an episode of something. */
  episodeTitle?: string
  overview?: string
  /** Start and end, in milliseconds since the epoch. */
  startMs: number
  endMs: number
  genres: string[]
}

/** A TV channel, with what is on it right now when the server says. */
export interface Channel {
  id: string
  name: string
  /** The number the channel has on the tuner or the playlist ("12", "4.1"). */
  number?: string
  imageTag?: string
  favorite: boolean
  now?: Program
}

/** A channel's name without what playlists put in it (their quality and notes), and those parts apart. */
export interface ChannelName {
  title: string
  /** "1080p", "Geo-blocked", "Not 24/7": what was in brackets or in parentheses at the end of the name. */
  tags: string[]
}

const QUALITY_TAG = /^(\d{3,4}[pi]|[248]K|UHD|FHD|HD|SD)$/i

/**
 * Channel lists from the internet name their channels like "Canal 1 (Colombia) (1080p) [Not 24/7]". The name is the part that says
 * what the channel is; the quality in parentheses at the end and the notes in brackets are tags. A name that is only tags is kept whole.
 */
export function splitChannelName(raw: string): ChannelName {
  let title = raw.trim()
  const tags: string[] = []
  for (;;) {
    const note = /\s*\[([^\]]+)\]\s*$/.exec(title)
    if (note) {
      tags.unshift((note[1] ?? '').trim())
      title = title.slice(0, note.index)
      continue
    }
    const quality = /\s*\(([^()]*)\)\s*$/.exec(title)
    const label = (quality?.[1] ?? '').trim()
    if (quality && QUALITY_TAG.test(label)) {
      tags.unshift(label)
      title = title.slice(0, quality.index)
      continue
    }
    break
  }
  title = title.trim()
  return title ? { title, tags } : { title: raw.trim(), tags: [] }
}

/** Whether a channel is the one being looked for: its name (as the server has it) or its number has the text in it. */
export function matchesChannel(channel: Pick<Channel, 'name' | 'number'>, text: string): boolean {
  const wanted = text.trim().toLowerCase()
  if (!wanted) return true
  return channel.name.toLowerCase().includes(wanted) || (channel.number ?? '').toLowerCase().includes(wanted)
}

function toTime(value: string | null | undefined): number | undefined {
  const ms = value ? Date.parse(value) : NaN
  return Number.isNaN(ms) ? undefined : ms
}

export function toProgram(dto: BaseItemDto): Program | null {
  const startMs = toTime(dto.StartDate)
  const endMs = toTime(dto.EndDate)
  if (!dto.Id || !dto.Name || startMs === undefined || endMs === undefined || endMs <= startMs) return null
  return {
    id: dto.Id,
    channelId: dto.ChannelId ?? '',
    name: dto.Name,
    episodeTitle: dto.EpisodeTitle ?? undefined,
    overview: dto.Overview ?? undefined,
    startMs,
    endMs,
    genres: dto.Genres ?? [],
  }
}

export function toChannel(dto: BaseItemDto): Channel | null {
  if (!dto.Id || !dto.Name) return null
  const now = dto.CurrentProgram ? toProgram({ ...dto.CurrentProgram, ChannelId: dto.CurrentProgram.ChannelId ?? dto.Id }) : null
  return {
    id: dto.Id,
    name: dto.Name,
    number: dto.ChannelNumber ?? undefined,
    imageTag: dto.ImageTags?.Primary ?? undefined,
    favorite: dto.UserData?.IsFavorite ?? false,
    now: now ?? undefined,
  }
}

export const channelLogoUrl = (serverUrl: string, channel: Pick<Channel, 'id' | 'imageTag'>, width = 160): string | null =>
  channel.imageTag ? itemImageUrl(serverUrl, channel.id, 'Primary', { tag: channel.imageTag, width }) : null

/** How far through a programme it is at [nowMs], 0 to 1 (0 before it starts, 1 after it ends). */
export function programProgress(program: Pick<Program, 'startMs' | 'endMs'>, nowMs: number): number {
  return Math.min(1, Math.max(0, (nowMs - program.startMs) / (program.endMs - program.startMs)))
}

export const isOnNow = (program: Pick<Program, 'startMs' | 'endMs'>, nowMs: number): boolean => program.startMs <= nowMs && nowMs < program.endMs

export interface ChannelPage {
  channels: Channel[]
  total: number
}

/** The ways the channels can be narrowed: the server tells a channel's kind from what it broadcasts, favourites are the account's own. */
export const CHANNEL_CATEGORIES = ['all', 'favorites', 'movies', 'series', 'sports', 'news', 'kids'] as const
export type ChannelCategory = (typeof CHANNEL_CATEGORIES)[number]

export const isChannelCategory = (value: unknown): value is ChannelCategory => CHANNEL_CATEGORIES.includes(value as ChannelCategory)

/** The filter the server takes for a category (nothing for "all"). */
export function categoryFilter(category: ChannelCategory): { isFavorite?: true; isMovie?: true; isSeries?: true; isSports?: true; isNews?: true; isKids?: true } {
  switch (category) {
    case 'favorites':
      return { isFavorite: true }
    case 'movies':
      return { isMovie: true }
    case 'series':
      return { isSeries: true }
    case 'sports':
      return { isSports: true }
    case 'news':
      return { isNews: true }
    case 'kids':
      return { isKids: true }
    default:
      return {}
  }
}

export const CHANNEL_PAGE_SIZE = 60

/** Looking for a channel reads this many (the server cannot search them), which is more than any list has. */
export const CHANNEL_SEARCH_LIMIT = 2000

/** One page of the user's channels in the order the server keeps them, each with what is on now. */
export async function getChannels(session: Session, opts: { startIndex?: number; limit?: number; category?: ChannelCategory } = {}): Promise<ChannelPage> {
  const { data } = await getLiveTvApi(session.api).getLiveTvChannels({
    userId: session.userId,
    startIndex: opts.startIndex ?? 0,
    limit: opts.limit ?? CHANNEL_PAGE_SIZE,
    ...categoryFilter(opts.category ?? 'all'),
    addCurrentProgram: true,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
    enableImageTypes: [ImageType.Primary],
    sortBy: [ItemSortBy.SortName],
    sortOrder: SortOrder.Ascending,
  })
  const channels = (data.Items ?? []).map(toChannel).filter((c): c is Channel => c !== null)
  return { channels, total: data.TotalRecordCount ?? channels.length }
}

/** One channel by its id (for the player's title and for the channels around it). */
export async function getChannel(session: Session, id: string): Promise<Channel> {
  const { data } = await getLiveTvApi(session.api).getChannel({ channelId: id, userId: session.userId })
  const channel = toChannel(data)
  if (!channel) throw new Error('That channel is no longer available.')
  return channel
}

/** What is on each of these channels between two moments (ms since the epoch), by channel, in time order. */
export async function getGuide(session: Session, channelIds: string[], fromMs: number, toMs: number): Promise<Map<string, Program[]>> {
  const guide = new Map<string, Program[]>(channelIds.map((id) => [id, []]))
  if (channelIds.length === 0) return guide
  const { data } = await getLiveTvApi(session.api).getPrograms({
    getProgramsDto: {
      ChannelIds: channelIds,
      UserId: session.userId,
      // Everything that is on at some point of the window: it ends after the window starts and starts before it ends.
      MinEndDate: new Date(fromMs).toISOString(),
      MaxStartDate: new Date(toMs).toISOString(),
      SortBy: [ItemSortBy.StartDate],
      SortOrder: [SortOrder.Ascending],
      EnableImages: false,
      EnableTotalRecordCount: false,
    },
  })
  for (const dto of data.Items ?? []) {
    const program = toProgram(dto)
    if (program) guide.get(program.channelId)?.push(program)
  }
  for (const programs of guide.values()) programs.sort((a, b) => a.startMs - b.startMs)
  return guide
}

/** A programme drawn in a row of the guide: where it starts and how wide it is, as parts of the window (0 to 1). */
export interface GuideBlock {
  program: Program
  left: number
  width: number
  /** It began before the window (or ends after it): the block shows only the part inside. */
  cutBefore: boolean
  cutAfter: boolean
}

/** The programmes of one channel as blocks of a window; programmes outside the window are left out. Pure. */
export function guideBlocks(programs: Program[], windowStartMs: number, windowEndMs: number): GuideBlock[] {
  const span = windowEndMs - windowStartMs
  return programs
    .filter((p) => p.endMs > windowStartMs && p.startMs < windowEndMs)
    .map((program) => {
      const start = Math.max(program.startMs, windowStartMs)
      const end = Math.min(program.endMs, windowEndMs)
      return { program, left: (start - windowStartMs) / span, width: (end - start) / span, cutBefore: program.startMs < windowStartMs, cutAfter: program.endMs > windowEndMs }
    })
}

/** The start of the guide's window: now, put back to the previous half hour. */
export function guideStart(nowMs: number): number {
  const half = 30 * 60_000
  return Math.floor(nowMs / half) * half
}

/** The channel next to this one in a list ([step] 1 or -1), going round at the ends. Null when there is nowhere to go. */
export function neighbourChannel(channels: Pick<Channel, 'id'>[], currentId: string, step: 1 | -1): string | null {
  const at = channels.findIndex((c) => c.id === currentId)
  if (channels.length < 2 || at < 0) return null
  return channels[(at + step + channels.length) % channels.length]?.id ?? null
}
