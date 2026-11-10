import type { ChannelDef, Program, TimeBlock } from '../../../../contract/index.ts'
import { hashSeed, seededRandom, shuffled } from '../../util.ts'

/**
 * The schedule maker. Pure: the same channel, titles, state and seed always give the same schedule, and it reads no clock and no
 * network. Everything that touches the database or Jellyfin is in `service.ts`.
 */

/** One title a channel may show. `runtime` is in seconds. */
export interface PoolItem {
  id: string
  /** Which of the channel's sources gave it. */
  source: number
  /** Its place in that source (the order Jellyfin listed it in). */
  ord: number
  name: string
  subtitle?: string
  type: 'Movie' | 'Episode'
  seriesId?: string
  season?: number
  episode?: number
  /** Year of release, when Jellyfin says. */
  year?: number
  runtime: number
}

/** Where a channel is in its list; kept between one run of the engine and the next. */
export interface ChannelState {
  /** How many times the marathon has gone through its list. */
  cycle: number
  /** The list being gone through (title ids), and the place in it. */
  run: string[]
  pos: number
  /** For each series (or group), how far its episodes have gone. */
  cursors: Record<string, number>
  /** The latest titles shown, so they are not repeated at once. */
  recent: string[]
}

export const emptyState = (): ChannelState => ({ cycle: 0, run: [], pos: 0, cursors: {}, recent: [] })

export type EngineDef = Pick<ChannelDef, 'mode' | 'order' | 'blocks' | 'timezone' | 'avoidRepeat'> & Partial<Pick<ChannelDef, 'episodesInARow' | 'maxMinutes'>>

export interface GenerateInput {
  def: EngineDef
  /** Makes the random choices; the channel's id is a good one. */
  seed: string
  pool: PoolItem[]
  state: ChannelState
  /** Where the schedule goes on from (seconds since the epoch): the end of the last program. */
  from: number
  /** Programs are made until one ends at or after this. */
  until: number
  /** A safety stop. */
  maxPrograms?: number
}

export interface GenerateOutput {
  programs: Program[]
  state: ChannelState
}

/** Shortest and longest a program may be: a title with a missing or absurd length is left out. */
export const MIN_RUNTIME = 30
export const MAX_RUNTIME = 12 * 3600

export function usable(item: PoolItem): boolean {
  return Number.isFinite(item.runtime) && item.runtime >= MIN_RUNTIME && item.runtime <= MAX_RUNTIME
}

/**
 * What a channel may show: the titles with a usable length and, when the channel has a longest length, only those that fit it. If
 * nothing fits, the limit is ignored (a channel with a limit nobody can meet would be empty).
 */
export function playable(pool: readonly PoolItem[], def: Pick<EngineDef, 'maxMinutes'>): PoolItem[] {
  const items = distinct(pool)
  const limit = (def.maxMinutes ?? 0) * 60
  if (limit <= 0) return items
  const fits = items.filter((i) => i.runtime <= limit)
  return fits.length ? fits : items
}

const groupKey = (item: PoolItem): string => (item.type === 'Episode' && item.seriesId ? `s:${item.seriesId}` : `i:${item.id}`)

const byPlace = (a: PoolItem, b: PoolItem): number =>
  (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) || a.source - b.source || a.ord - b.ord

/** Each title once (the first source that has it), in the order the sources gave them. */
function distinct(pool: readonly PoolItem[]): PoolItem[] {
  const seen = new Set<string>()
  const out: PoolItem[] = []
  for (const item of [...pool].sort((a, b) => a.source - b.source || a.ord - b.ord)) {
    if (!usable(item) || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

interface Group {
  key: string
  items: PoolItem[]
}

function groupsOf(items: readonly PoolItem[]): Group[] {
  const map = new Map<string, PoolItem[]>()
  for (const item of items) {
    const key = groupKey(item)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return [...map.entries()].map(([key, list]) => ({ key, items: list.sort(byPlace) }))
}

/**
 * The list a marathon goes through once.
 *  - sequential: as the sources gave them.
 *  - shuffle: in a random order.
 *  - oldest: by year of release, the oldest first (no year: last); the same year keeps the order the sources gave.
 *  - interleave: each series' episodes stay in order, but series and films are mixed (a series with more episodes comes up more often).
 *    A series gives `inARow` episodes (1 to 5) each time it comes up.
 */
export function buildRun(pool: readonly PoolItem[], order: EngineDef['order'], seed: string, inARow = 1): string[] {
  const items = distinct(pool)
  const random = seededRandom(hashSeed(seed))
  if (order === 'sequential') return items.map((i) => i.id)
  if (order === 'shuffle') return shuffled(items, random).map((i) => i.id)
  if (order === 'oldest') return [...items].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.source - b.source || a.ord - b.ord).map((i) => i.id)
  const groups = groupsOf(items).map((g) => ({ ...g, next: 0 }))
  const row = Math.min(5, Math.max(1, Math.floor(inARow) || 1))
  let remaining = items.length
  const out: string[] = []
  while (remaining > 0) {
    let pick = random() * remaining
    for (const g of groups) {
      const left = g.items.length - g.next
      if (left === 0) continue
      if (pick < left) {
        const first = g.items[g.next] as PoolItem
        const take = first.type === 'Episode' ? Math.min(row, left) : 1
        for (let i = 0; i < take; i += 1) out.push((g.items[g.next + i] as PoolItem).id)
        g.next += take
        remaining -= take
        break
      }
      pick -= left
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Time blocks
// ---------------------------------------------------------------------------------------------------------------------

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const formatters = new Map<string, Intl.DateTimeFormat>()

export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

/** The day of the week (0 = Sunday) and the minute of the day at that moment in that time zone. */
export function localParts(epochSeconds: number, timeZone: string): { day: number; minute: number } {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: isTimeZone(timeZone) ? timeZone : 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    formatters.set(timeZone, f)
  }
  let day = 0
  let hour = 0
  let minute = 0
  for (const part of f.formatToParts(new Date(epochSeconds * 1000))) {
    if (part.type === 'weekday') day = WEEKDAY[part.value] ?? 0
    else if (part.type === 'hour') hour = Number(part.value) % 24
    else if (part.type === 'minute') minute = Number(part.value)
  }
  return { day, minute: hour * 60 + minute }
}

const toMinutes = (hhmm: string): number => {
  const [h = '0', m = '0'] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/** The first block that covers this moment, or null. A block that ends before it starts runs past midnight. */
export function activeBlock(blocks: readonly TimeBlock[], epochSeconds: number, timeZone: string): TimeBlock | null {
  if (blocks.length === 0) return null
  const { day, minute } = localParts(epochSeconds, timeZone)
  const yesterday = (day + 6) % 7
  for (const block of blocks) {
    const start = toMinutes(block.start)
    const end = toMinutes(block.end)
    if (start === end) {
      if (block.days.includes(day)) return block
    } else if (start < end) {
      if (block.days.includes(day) && minute >= start && minute < end) return block
    } else if ((block.days.includes(day) && minute >= start) || (block.days.includes(yesterday) && minute < end)) {
      return block
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------------------------------------------------

function programOf(item: PoolItem, start: number): Program {
  const runtime = Math.round(item.runtime)
  return {
    start,
    end: start + runtime,
    itemId: item.id,
    title: item.name,
    ...(item.subtitle ? { subtitle: item.subtitle } : {}),
    type: item.type,
    ...(item.seriesId ? { seriesId: item.seriesId } : {}),
    runtime,
  }
}

/** Makes the next stretch of a channel's schedule, one program right after the other (no gaps). */
export function generate(input: GenerateInput): GenerateOutput {
  const { def, seed, pool, from, until } = input
  const max = input.maxPrograms ?? 2000
  const state: ChannelState = { ...input.state, run: [...input.state.run], cursors: { ...input.state.cursors }, recent: [...input.state.recent] }
  const items = playable(pool, def)
  const byId = new Map(items.map((i) => [i.id, i]))
  const programs: Program[] = []
  if (items.length === 0) return { programs, state }
  let t = from

  if (def.mode === 'marathon') {
    let guard = 0
    while (t < until && programs.length < max) {
      if (state.pos >= state.run.length) {
        state.cycle += 1
        state.run = buildRun(items, def.order, `${seed}:${state.cycle}`, def.episodesInARow)
        state.pos = 0
        guard += 1
        if (state.run.length === 0 || guard > 3) break
      }
      const item = byId.get(state.run[state.pos] as string)
      state.pos += 1
      if (!item) continue // left the sources since this round was made
      guard = 0
      const program = programOf(item, t)
      programs.push(program)
      t = program.end
    }
    return { programs, state }
  }

  // Grid: each moment takes its titles from the block that covers it (or from everything when none does).
  const groupCache = new Map<string, Group[]>()
  const groupsFor = (block: TimeBlock | null): Group[] => {
    const key = block && block.sources.length ? [...block.sources].sort((a, b) => a - b).join(',') : '*'
    let groups = groupCache.get(key)
    if (!groups) {
      const wanted = key === '*' ? null : new Set(block?.sources)
      const chosen = wanted ? items.filter((i) => wanted.has(i.source)) : items
      groups = groupsOf(chosen.length ? chosen : items)
      groupCache.set(key, groups)
    }
    return groups
  }
  while (t < until && programs.length < max) {
    const groups = groupsFor(activeBlock(def.blocks, t, def.timezone))
    const random = seededRandom(hashSeed(`${seed}:${t}`))
    const fresh = groups.filter((g) => {
      const head = g.items[(state.cursors[g.key] ?? 0) % g.items.length] as PoolItem
      return !state.recent.includes(head.id)
    })
    const choices = fresh.length ? fresh : groups
    const group = choices[Math.floor(random() * choices.length)] as Group
    const cursor = state.cursors[group.key] ?? 0
    const item = group.items[cursor % group.items.length] as PoolItem
    state.cursors[group.key] = cursor + 1
    state.recent.push(item.id)
    while (state.recent.length > Math.max(0, def.avoidRepeat)) state.recent.shift()
    const program = programOf(item, t)
    programs.push(program)
    t = program.end
  }
  return { programs, state }
}
