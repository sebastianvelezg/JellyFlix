import type { ChannelSource, ItemSource, RuleSource } from '../../../../contract/index.ts'
import { HttpError } from '../../http/router.ts'
import type { JellyfinClient } from '../../jellyfin/client.ts'
import type { PoolItem } from './engine.ts'

/** The few parts of a Jellyfin item that matter here. */
interface Dto {
  Id?: string
  Name?: string
  Type?: string
  SeriesId?: string
  SeriesName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  RunTimeTicks?: number
}

interface ItemsAnswer {
  Items?: Dto[]
}

export const TICKS_PER_SECOND = 10_000_000
/** The most titles one source may bring (a whole library is fine; this only stops a mistake from reading a huge one). */
const SOURCE_LIMIT = 5000

const pad = (n: number): string => String(n).padStart(2, '0')

export function toPoolItem(dto: Dto, source: number, ord: number): PoolItem | null {
  if (!dto.Id || !dto.Name || !dto.RunTimeTicks) return null
  const type = dto.Type === 'Movie' || dto.Type === 'Video' ? 'Movie' : dto.Type === 'Episode' ? 'Episode' : null
  if (!type) return null
  const subtitle =
    type === 'Episode'
      ? [dto.SeriesName, dto.ParentIndexNumber !== undefined && dto.IndexNumber !== undefined ? `S${pad(dto.ParentIndexNumber)}E${pad(dto.IndexNumber)}` : undefined].filter(Boolean).join(' · ')
      : ''
  return {
    id: dto.Id,
    source,
    ord,
    name: dto.Name,
    ...(subtitle ? { subtitle } : {}),
    type,
    ...(dto.SeriesId ? { seriesId: dto.SeriesId } : {}),
    ...(dto.ParentIndexNumber !== undefined ? { season: dto.ParentIndexNumber } : {}),
    ...(dto.IndexNumber !== undefined ? { episode: dto.IndexNumber } : {}),
    runtime: dto.RunTimeTicks / TICKS_PER_SECOND,
  }
}

export interface Reader {
  jellyfin: JellyfinClient
  token: string
  userId: string
}

async function items(reader: Reader, path: string, query: Record<string, string | number | boolean | string[] | undefined>): Promise<Dto[]> {
  const answer = await reader.jellyfin.get<ItemsAnswer>(path, reader.token, { userId: reader.userId, ...query })
  return answer.Items ?? []
}

async function expandItem(reader: Reader, source: ItemSource): Promise<Dto[]> {
  const found = await items(reader, '/Items', { ids: [source.id] })
  const dto = found[0]
  if (!dto) throw new HttpError(404, `“${source.name}” is not in Jellyfin (or this account cannot see it).`)
  switch (dto.Type) {
    case 'Movie':
    case 'Episode':
    case 'Video':
      return [dto]
    case 'Series':
      return items(reader, `/Shows/${encodeURIComponent(source.id)}/Episodes`, { limit: SOURCE_LIMIT })
    case 'Season':
      return items(reader, `/Shows/${encodeURIComponent(dto.SeriesId ?? '')}/Episodes`, { seasonId: source.id, limit: SOURCE_LIMIT })
    case 'Playlist':
      return items(reader, `/Playlists/${encodeURIComponent(source.id)}/Items`, { limit: SOURCE_LIMIT })
    default:
      // A collection, a library or a folder: whatever films and episodes are inside.
      return items(reader, '/Items', {
        parentId: source.id,
        recursive: true,
        includeItemTypes: ['Movie', 'Episode'],
        sortBy: ['SortName'],
        limit: SOURCE_LIMIT,
      })
  }
}

function yearsOf(rule: RuleSource): string[] | undefined {
  if (rule.yearFrom === undefined && rule.yearTo === undefined) return undefined
  const from = rule.yearFrom ?? rule.yearTo ?? 0
  const to = rule.yearTo ?? rule.yearFrom ?? 0
  const out: string[] = []
  for (let y = from; y <= to && out.length < 150; y += 1) out.push(String(y))
  return out
}

async function expandRule(reader: Reader, rule: RuleSource): Promise<Dto[]> {
  const limit = rule.limit ?? 2000
  return items(reader, '/Items', {
    recursive: true,
    includeItemTypes: rule.types,
    genres: rule.genres.length ? rule.genres : undefined,
    years: yearsOf(rule),
    filters: rule.unwatched ? ['IsUnplayed'] : undefined,
    parentId: rule.libraryId,
    sortBy: rule.limit ? ['Random'] : ['SortName'],
    fields: ['Genres'],
    limit,
  })
}

/**
 * Reads everything a channel can show from Jellyfin, as the person `reader` signs in as. A source that fails is reported and left
 * out, so one bad source does not stop the channel.
 */
export async function loadPool(reader: Reader, sources: readonly ChannelSource[]): Promise<{ items: PoolItem[]; warnings: string[] }> {
  const out: PoolItem[] = []
  const warnings: string[] = []
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index] as ChannelSource
    try {
      const dtos = source.kind === 'item' ? await expandItem(reader, source) : await expandRule(reader, source)
      let ord = 0
      for (const dto of dtos) {
        const item = toPoolItem(dto, index, ord)
        if (item) {
          out.push(item)
          ord += 1
        }
      }
      if (ord === 0) warnings.push(`“${source.name}” gave no titles with a known length.`)
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw e
      warnings.push(e instanceof HttpError ? e.message : `“${source.name}” could not be read.`)
    }
  }
  return { items: out, warnings }
}
