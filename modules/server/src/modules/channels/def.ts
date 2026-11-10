import type { ChannelDef, ChannelOrder, ChannelSource, TimeBlock } from '../../../../contract/index.ts'
import { HttpError } from '../../http/router.ts'
import { isTimeZone } from './engine.ts'

const bad = (message: string): never => {
  throw new HttpError(400, message)
}

const text = (value: unknown, what: string, max: number): string => {
  if (typeof value !== 'string' || !value.trim()) return bad(`${what} is needed.`)
  return value.trim().slice(0, max)
}

const integer = (value: unknown, what: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return bad(`${what} must be a whole number from ${min} to ${max}.`)
  return value
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const COLOR = /^#[0-9a-fA-F]{6}$/
const ORDERS: ChannelOrder[] = ['interleave', 'sequential', 'shuffle', 'oldest']
/** The most sources one channel may have (a wall of posters can tick hundreds; they are read in batches). */
export const MAX_SOURCES = 500

function source(raw: unknown, index: number): ChannelSource {
  const o = (raw ?? {}) as Record<string, unknown>
  if (o.kind === 'item') {
    const id = text(o.id, `Source ${index + 1} needs an id`, 64)
    if (!/^[A-Za-z0-9-]+$/.test(id)) return bad(`Source ${index + 1} has an id that is not valid.`)
    return { kind: 'item', id, name: typeof o.name === 'string' ? o.name.slice(0, 120) : id, ...(typeof o.itemType === 'string' ? { itemType: o.itemType.slice(0, 40) } : {}) }
  }
  if (o.kind === 'rule') {
    const types = (Array.isArray(o.types) ? o.types : []).filter((x): x is 'Movie' | 'Episode' => x === 'Movie' || x === 'Episode')
    const genres = (Array.isArray(o.genres) ? o.genres : []).filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 20)
    const yearFrom = o.yearFrom === undefined ? undefined : integer(o.yearFrom, 'The first year', 1880, 2200)
    const yearTo = o.yearTo === undefined ? undefined : integer(o.yearTo, 'The last year', 1880, 2200)
    if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) bad('The first year is after the last one.')
    const libraryId = typeof o.libraryId === 'string' && /^[A-Za-z0-9-]+$/.test(o.libraryId) ? o.libraryId : undefined
    return {
      kind: 'rule',
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 120) : 'Rule',
      genres,
      types: types.length ? [...new Set(types)] : ['Movie'],
      ...(yearFrom !== undefined ? { yearFrom } : {}),
      ...(yearTo !== undefined ? { yearTo } : {}),
      ...(o.unwatched === true ? { unwatched: true } : {}),
      ...(libraryId ? { libraryId } : {}),
      ...(o.limit === undefined ? {} : { limit: integer(o.limit, 'The limit', 1, 5000) }),
    }
  }
  return bad(`Source ${index + 1} is not valid.`)
}

function block(raw: unknown, sourceCount: number): TimeBlock {
  const o = (raw ?? {}) as Record<string, unknown>
  const days = [...new Set((Array.isArray(o.days) ? o.days : []).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))]
  if (days.length === 0) bad('A time block needs at least one day.')
  if (typeof o.start !== 'string' || !HHMM.test(o.start) || typeof o.end !== 'string' || !HHMM.test(o.end)) bad('A time block needs times like 16:00.')
  const sources = (Array.isArray(o.sources) ? o.sources : []).filter((s): s is number => Number.isInteger(s) && (s as number) >= 0 && (s as number) < sourceCount)
  return { days, start: o.start as string, end: o.end as string, sources: [...new Set(sources)] }
}

/** Checks what an admin's app sent and turns it into a channel definition (anything odd is refused with a plain message). */
export function parseChannelDef(raw: unknown): ChannelDef {
  if (!raw || typeof raw !== 'object') return bad('The channel is missing.')
  const o = raw as Record<string, unknown>
  const sourcesRaw = Array.isArray(o.sources) ? o.sources : []
  if (sourcesRaw.length === 0) bad('A channel needs at least one source.')
  if (sourcesRaw.length > MAX_SOURCES) bad(`A channel can have up to ${MAX_SOURCES} sources. A rule (a genre, a decade) can bring many more.`)
  const sources = sourcesRaw.map(source)
  const mode = o.mode === 'grid' ? 'grid' : 'marathon'
  const order = ORDERS.includes(o.order as ChannelOrder) ? (o.order as ChannelOrder) : 'interleave'
  const timezone = typeof o.timezone === 'string' && isTimeZone(o.timezone) ? o.timezone : 'UTC'
  const blocksRaw = Array.isArray(o.blocks) ? o.blocks : []
  if (blocksRaw.length > 40) bad('A channel can have up to 40 time blocks.')
  return {
    name: text(o.name, 'The name', 60),
    number: integer(o.number, 'The number', 1, 9999),
    color: typeof o.color === 'string' && COLOR.test(o.color) ? o.color : '#4d8dff',
    sources,
    mode,
    order,
    blocks: mode === 'grid' ? blocksRaw.map((b) => block(b, sources.length)) : [],
    timezone,
    avoidRepeat: o.avoidRepeat === undefined ? 5 : integer(o.avoidRepeat, 'Avoid repeating', 0, 50),
    episodesInARow: o.episodesInARow === undefined ? 1 : integer(o.episodesInARow, 'Episodes in a row', 1, 5),
    maxMinutes: o.maxMinutes === undefined ? 0 : integer(o.maxMinutes, 'The longest length', 0, 600),
    enabled: o.enabled !== false,
  }
}
