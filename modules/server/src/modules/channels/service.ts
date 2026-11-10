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
} from '../../../../contract/index.ts'
import { transaction, type Db } from '../../db/db.ts'
import { HttpError, type AuthUser } from '../../http/router.ts'
import type { JellyfinClient } from '../../jellyfin/client.ts'
import { newId } from '../../util.ts'
import { emptyState, generate, playable, type ChannelState, type PoolItem } from './engine.ts'
import { loadPool, type Reader } from './pool.ts'
import { createVisibility } from './visibility.ts'

/** How far ahead a schedule is kept, whenever somebody looks at it. */
const HORIZON_SECONDS = 12 * 3600
/** What is already on, and the next couple of hours, is not changed when a channel is edited. */
export const FREEZE_SECONDS = 2 * 3600
/** Past programs are kept this long. */
const KEEP_PAST_SECONDS = 2 * 86400
/** The guide shows at most this much at once. */
const MAX_GUIDE_SECONDS = 48 * 3600

interface ChannelRow {
  id: string
  number: number
  name: string
  def: string
  state: string
  owner: string
  created_at: number
  pool_refreshed_at: number | null
}

interface ProgramRow {
  start: number
  end: number
  item_id: string
  title: string
  subtitle: string | null
  type: string
  series_id: string | null
  runtime: number
}

const toProgram = (r: ProgramRow): Program => ({
  start: r.start,
  end: r.end,
  itemId: r.item_id,
  title: r.title,
  ...(r.subtitle ? { subtitle: r.subtitle } : {}),
  type: r.type === 'Episode' ? 'Episode' : 'Movie',
  ...(r.series_id ? { seriesId: r.series_id } : {}),
  runtime: r.runtime,
})

export interface ChannelsService {
  /** What is on and next, for this person: a program of a title they may not see is a generic note. */
  list(user: AuthUser, now: number): Promise<ChannelSummary[]>
  create(user: AuthUser, def: ChannelDef, now: number): Promise<Channel>
  update(user: AuthUser, id: string, def: ChannelDef, now: number): Promise<Channel>
  remove(id: string): void
  setEnabled(id: string, enabled: boolean, now: number): Channel
  rebuild(id: string, now: number, freeze: number): void
  refreshPool(user: AuthUser, id: string, now: number): Promise<Channel>
  refreshAllAsService(now: number): Promise<number>
  window(user: AuthUser, id: string, at: number, before: number, after: number, now: number): Promise<ChannelWindow>
  guide(user: AuthUser, from: number, to: number, now: number): Promise<Guide>
  preview(user: AuthUser, def: ChannelDef, now: number): Promise<ChannelPreview>
  suggestions(user: AuthUser): Promise<ChannelSuggestions>
  auto(user: AuthUser, request: AutoChannelsRequest, now: number): Promise<Channel[]>
  get(id: string): Channel
  /** The person keeps this channel first (or no longer does). It is only theirs: nobody else sees it. */
  setFavorite(user: AuthUser, id: string, favorite: boolean): { favorite: boolean }
  setImage(id: string, mime: string, bytes: Buffer, now: number): { imageVersion: number }
  removeImage(id: string): void
  image(id: string): { mime: string; data: Buffer; version: number }
}

export function createChannelsService(db: Db, jellyfin: JellyfinClient): ChannelsService {
  const visibility = createVisibility(jellyfin)
  const rowOf = (id: string): ChannelRow => {
    const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined
    if (!row) throw new HttpError(404, 'That channel does not exist.')
    return row
  }
  const poolSizeOf = (id: string): number => (db.prepare('SELECT COUNT(*) AS n FROM pool_items WHERE channel_id = ?').get(id) as { n: number }).n
  /** The channels this person keeps first. */
  const favoritesOf = (userId: string): Set<string> => new Set((db.prepare('SELECT channel_id FROM channel_favorites WHERE user_id = ?').all(userId) as Array<{ channel_id: string }>).map((r) => r.channel_id))
  /** When each channel picture was last changed (a channel without one is not in it). */
  const imageVersions = (): Map<string, number> => new Map((db.prepare('SELECT channel_id, updated_at FROM channel_images').all() as Array<{ channel_id: string; updated_at: number }>).map((r) => [r.channel_id, r.updated_at]))
  /** Favourites first, each group by number. */
  const favouritesFirst = <T extends { id: string; number: number }>(rows: T[], favorites: Set<string>): T[] =>
    [...rows].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)) || a.number - b.number)
  const channelOf = (row: ChannelRow): Channel => {
    const picture = imageVersions().get(row.id)
    return {
      ...(JSON.parse(row.def) as ChannelDef),
      id: row.id,
      poolSize: poolSizeOf(row.id),
      poolRefreshedAt: row.pool_refreshed_at,
      createdAt: row.created_at,
      ...(picture !== undefined ? { imageVersion: picture } : {}),
    }
  }
  const readerFor = (user: AuthUser): Reader => ({ jellyfin, token: user.token, userId: user.id })

  function poolOf(id: string): PoolItem[] {
    const rows = db.prepare('SELECT data FROM pool_items WHERE channel_id = ?').all(id) as Array<{ data: string }>
    return rows.map((r) => JSON.parse(r.data) as PoolItem)
  }

  function savePool(id: string, items: readonly PoolItem[], now: number): void {
    transaction(db, () => {
      db.prepare('DELETE FROM pool_items WHERE channel_id = ?').run(id)
      const insert = db.prepare('INSERT OR REPLACE INTO pool_items (channel_id, item_id, source, ord, data) VALUES (?, ?, ?, ?, ?)')
      for (const item of items) insert.run(id, item.id, item.source, item.ord, JSON.stringify(item))
      db.prepare('UPDATE channels SET pool_refreshed_at = ? WHERE id = ?').run(now, id)
    })
  }

  function numberFree(number: number, except?: string): boolean {
    const row = db.prepare('SELECT id FROM channels WHERE number = ?').get(number) as { id: string } | undefined
    return !row || row.id === except
  }

  /** Makes sure the channel has a schedule up to `until`. Nothing is read from Jellyfin: it works from the saved list of titles. */
  function ensureTimeline(row: ChannelRow, now: number, until: number): void {
    const def = JSON.parse(row.def) as ChannelDef
    if (!def.enabled) return
    // Most requests find the schedule long enough already: they only read.
    const last = (db.prepare('SELECT MAX(end) AS e FROM programs WHERE channel_id = ?').get(row.id) as { e: number | null }).e
    if (last !== null && last >= until) return
    transaction(db, () => {
      db.prepare('DELETE FROM programs WHERE channel_id = ? AND end < ?').run(row.id, now - KEEP_PAST_SECONDS)
      // A channel nobody watched for a while does not "play" in the meantime: it goes on from now, where it was.
      const from = last !== null && last >= now - 3600 ? last : now
      if (from >= until) return
      const pool = poolOf(row.id)
      if (pool.length === 0) return
      const state = JSON.parse(row.state) as ChannelState
      const out = generate({ def, seed: row.id, pool, state: { ...emptyState(), ...state }, from, until })
      const insert = db.prepare('INSERT OR REPLACE INTO programs (channel_id, start, end, item_id, title, subtitle, type, series_id, runtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      for (const p of out.programs) insert.run(row.id, p.start, p.end, p.itemId, p.title, p.subtitle ?? null, p.type, p.seriesId ?? null, p.runtime)
      db.prepare('UPDATE channels SET state = ? WHERE id = ?').run(JSON.stringify(out.state), row.id)
    })
  }

  const programsBetween = (id: string, from: number, to: number): Program[] =>
    (db.prepare('SELECT * FROM programs WHERE channel_id = ? AND end > ? AND start < ? ORDER BY start').all(id, from, to) as unknown as ProgramRow[]).map(toProgram)

  async function save(user: AuthUser, id: string | null, def: ChannelDef, now: number): Promise<Channel> {
    if (!numberFree(def.number, id ?? undefined)) throw new HttpError(409, `Channel ${def.number} already exists.`)
    const { items } = await loadPool(readerFor(user), def.sources)
    if (items.length === 0) throw new HttpError(422, 'Those sources gave no titles to show (or none with a known length).')
    let channelId = id
    if (!channelId) {
      channelId = newId()
      db.prepare('INSERT INTO channels (id, number, name, def, state, owner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        channelId,
        def.number,
        def.name,
        JSON.stringify(def),
        JSON.stringify(emptyState()),
        user.id,
        now,
      )
    } else {
      const row = rowOf(channelId)
      const state = JSON.parse(row.state) as ChannelState
      transaction(db, () => {
        db.prepare('UPDATE channels SET number = ?, name = ?, def = ? WHERE id = ?').run(def.number, def.name, JSON.stringify(def), channelId)
        // What is on and what comes next is kept; what is further away is made again from the new list. The channel starts a new round of it.
        db.prepare('DELETE FROM programs WHERE channel_id = ? AND start >= ?').run(channelId, now + FREEZE_SECONDS)
        db.prepare('UPDATE channels SET state = ? WHERE id = ?').run(JSON.stringify({ ...state, run: [], pos: 0 }), channelId)
      })
    }
    savePool(channelId, items, now)
    const row = rowOf(channelId)
    ensureTimeline(row, now, now + HORIZON_SECONDS)
    return channelOf(rowOf(channelId))
  }

  return {
    get: (id) => channelOf(rowOf(id)),

    async list(user, now) {
      const favorites = favoritesOf(user.id)
      const pictures = imageVersions()
      const rows = favouritesFirst(db.prepare('SELECT * FROM channels ORDER BY number').all() as unknown as ChannelRow[], favorites)
      const shown = rows.map((row) => {
        const def = JSON.parse(row.def) as ChannelDef
        if (def.enabled) ensureTimeline(row, now, now + HORIZON_SECONDS)
        const upcoming = def.enabled ? programsBetween(row.id, now, now + HORIZON_SECONDS) : []
        return { row, def, current: upcoming.find((p) => p.start <= now), next: upcoming.find((p) => p.start > now) }
      })
      // One question to Jellyfin for all the programs on show.
      const restricted = await visibility.restrict(user, shown.flatMap((s) => [...(s.current ? [s.current] : []), ...(s.next ? [s.next] : [])]))
      let index = 0
      return shown.map(({ row, def, current: rawCurrent, next: rawNext }) => {
        const current = rawCurrent ? restricted[index++] : undefined
        const next = rawNext ? restricted[index++] : undefined
        return {
          id: row.id,
          number: row.number,
          name: row.name,
          color: def.color,
          enabled: def.enabled,
          mode: def.mode,
          poolSize: poolSizeOf(row.id),
          poolRefreshedAt: row.pool_refreshed_at,
          favorite: favorites.has(row.id),
          ...(pictures.has(row.id) ? { imageVersion: pictures.get(row.id) as number } : {}),
          ...(current ? { now: current } : {}),
          ...(next ? { next } : {}),
        }
      })
    },

    create: (user, def, now) => save(user, null, def, now),

    update(user, id, def, now) {
      rowOf(id)
      return save(user, id, def, now)
    },

    remove(id) {
      rowOf(id)
      db.prepare('DELETE FROM channels WHERE id = ?').run(id)
    },

    setEnabled(id, enabled, now) {
      const row = rowOf(id)
      const def = JSON.parse(row.def) as ChannelDef
      db.prepare('UPDATE channels SET def = ? WHERE id = ?').run(JSON.stringify({ ...def, enabled }), id)
      // Turned on again, the schedule goes on from now (it does not "play" while it was off).
      if (enabled) ensureTimeline(rowOf(id), now, now + HORIZON_SECONDS)
      return channelOf(rowOf(id))
    },

    rebuild(id, now, freeze) {
      const row = rowOf(id)
      const state = JSON.parse(row.state) as ChannelState
      transaction(db, () => {
        db.prepare('DELETE FROM programs WHERE channel_id = ? AND start >= ?').run(id, now + freeze)
        db.prepare('UPDATE channels SET state = ? WHERE id = ?').run(JSON.stringify({ ...state, run: [], pos: 0 }), id)
      })
      ensureTimeline(rowOf(id), now, now + HORIZON_SECONDS)
    },

    async refreshPool(user, id, now) {
      const row = rowOf(id)
      const def = JSON.parse(row.def) as ChannelDef
      const { items } = await loadPool(readerFor(user), def.sources)
      if (items.length === 0) throw new HttpError(422, 'Those sources gave no titles to show.')
      savePool(id, items, now)
      return channelOf(rowOf(id))
    },

    async refreshAllAsService(now) {
      if (!jellyfin.hasServiceKey) return 0
      const rows = db.prepare('SELECT * FROM channels').all() as unknown as ChannelRow[]
      let done = 0
      for (const row of rows) {
        try {
          const def = JSON.parse(row.def) as ChannelDef
          const reader: Reader = { jellyfin: { ...jellyfin, get: (path, _token, query) => jellyfin.getAsService(path, query) }, token: '', userId: row.owner }
          const { items } = await loadPool(reader, def.sources)
          if (items.length) {
            savePool(row.id, items, now)
            done += 1
          }
        } catch {
          // The channel keeps the list it had; the next night tries again.
        }
      }
      return done
    },

    async window(user, id, at, before, after, now) {
      const row = rowOf(id)
      ensureTimeline(row, now, Math.max(at, now) + HORIZON_SECONDS)
      const def = JSON.parse(row.def) as ChannelDef
      const current = (db.prepare('SELECT * FROM programs WHERE channel_id = ? AND start <= ? AND end > ?').get(id, at, at) as ProgramRow | undefined)
      const past = (db.prepare('SELECT * FROM programs WHERE channel_id = ? AND end <= ? ORDER BY start DESC LIMIT ?').all(id, current ? current.start : at, before) as unknown as ProgramRow[]).reverse()
      const future = db
        .prepare('SELECT * FROM programs WHERE channel_id = ? AND start >= ? ORDER BY start LIMIT ?')
        .all(id, current ? current.end : at, after) as unknown as ProgramRow[]
      const programs = await visibility.restrict(user, [...past, ...(current ? [current] : []), ...future].map(toProgram))
      return {
        serverTime: now,
        channel: { id: row.id, number: row.number, name: row.name, color: def.color, favorite: favoritesOf(user.id).has(row.id), ...(imageVersions().has(row.id) ? { imageVersion: imageVersions().get(row.id) as number } : {}) },
        programs,
        currentIndex: current ? past.length : -1,
      }
    },

    async guide(user, from, to, now) {
      const end = Math.min(to, from + MAX_GUIDE_SECONDS)
      const favorites = favoritesOf(user.id)
      const pictures = imageVersions()
      const rows = favouritesFirst(db.prepare('SELECT * FROM channels ORDER BY number').all() as unknown as ChannelRow[], favorites)
      const raw = rows
        .filter((row) => (JSON.parse(row.def) as ChannelDef).enabled)
        .map((row) => {
          ensureTimeline(row, now, Math.max(end, now + HORIZON_SECONDS))
          const def = JSON.parse(row.def) as ChannelDef
          return { id: row.id, number: row.number, name: row.name, color: def.color, favorite: favorites.has(row.id), ...(pictures.has(row.id) ? { imageVersion: pictures.get(row.id) as number } : {}), programs: programsBetween(row.id, from, end) }
        })
      // One round of questions to Jellyfin for the whole guide, then each channel gets its own programs back.
      const restricted = await visibility.restrict(user, raw.flatMap((c) => c.programs))
      let index = 0
      const channels = raw.map((c) => ({ ...c, programs: restricted.slice(index, (index += c.programs.length)) }))
      return { serverTime: now, from, to: end, channels }
    },

    setFavorite(user, id, favorite) {
      rowOf(id)
      if (favorite) db.prepare('INSERT OR IGNORE INTO channel_favorites (user_id, channel_id) VALUES (?, ?)').run(user.id, id)
      else db.prepare('DELETE FROM channel_favorites WHERE user_id = ? AND channel_id = ?').run(user.id, id)
      return { favorite }
    },

    setImage(id, mime, bytes, now) {
      rowOf(id)
      // Never the same number twice, so an app that remembers a picture by its version asks for the new one.
      const before = (db.prepare('SELECT updated_at FROM channel_images WHERE channel_id = ?').get(id) as { updated_at: number } | undefined)?.updated_at ?? 0
      const version = Math.max(now, before + 1)
      db.prepare('INSERT OR REPLACE INTO channel_images (channel_id, mime, data, updated_at) VALUES (?, ?, ?, ?)').run(id, mime, bytes, version)
      return { imageVersion: version }
    },

    removeImage(id) {
      rowOf(id)
      db.prepare('DELETE FROM channel_images WHERE channel_id = ?').run(id)
    },

    image(id) {
      const row = db.prepare('SELECT mime, data, updated_at FROM channel_images WHERE channel_id = ?').get(id) as { mime: string; data: Uint8Array; updated_at: number } | undefined
      if (!row) throw new HttpError(404, 'That channel has no picture.')
      return { mime: row.mime, data: Buffer.from(row.data), version: row.updated_at }
    },

    async preview(user, def, now) {
      const { items, warnings } = await loadPool(readerFor(user), def.sources)
      const out = generate({ def, seed: 'preview', pool: items, state: emptyState(), from: now, until: now + 24 * 3600, maxPrograms: 40 })
      return { poolSize: playable(items, def).length, programs: out.programs, warnings }
    },

    async suggestions(user) {
      // Jellyfin does not answer the same on every version: some give the genres only from /Genres, others (12.2) only from the query
      // filters, and without a library the filters can be empty (seen on 12.4). Ask both and join them.
      const asked = await Promise.allSettled([
        jellyfin.get<{ Items?: Array<{ Name?: string }> }>('/Genres', user.token, { userId: user.id, includeItemTypes: ['Movie', 'Series'] }),
        jellyfin.get<{ Genres?: string[] }>('/Items/Filters', user.token, { userId: user.id, includeItemTypes: ['Movie', 'Series'] }),
      ])
      if (asked.every((a) => a.status === 'rejected')) throw (asked[0] as PromiseRejectedResult).reason
      const names = new Set<string>()
      if (asked[0].status === 'fulfilled') for (const g of asked[0].value.Items ?? []) if (g.Name) names.add(g.Name)
      if (asked[1].status === 'fulfilled') for (const g of asked[1].value.Genres ?? []) if (g) names.add(g)
      const boxes = await jellyfin.get<{ Items?: Array<{ Id?: string; Name?: string }> }>('/Items', user.token, {
        userId: user.id,
        recursive: true,
        includeItemTypes: ['BoxSet'],
        sortBy: ['SortName'],
        limit: 300,
      })
      return {
        genres: [...names].sort((a, b) => a.localeCompare(b)),
        collections: (boxes.Items ?? []).filter((c): c is { Id: string; Name: string } => !!c.Id && !!c.Name).map((c) => ({ id: c.Id, name: c.Name })),
      }
    },

    async auto(user, request, now) {
      const taken = new Set((db.prepare('SELECT number FROM channels').all() as Array<{ number: number }>).map((r) => r.number))
      let next = 1
      const freeNumber = (): number => {
        while (taken.has(next)) next += 1
        taken.add(next)
        return next
      }
      const created: Channel[] = []
      const PALETTE = ['#4d8dff', '#e5484d', '#30a46c', '#f5a524', '#8e4ec6', '#12a594', '#e93d82', '#0091ff']
      const base = (name: string, source: ChannelDef['sources'][number], index: number): ChannelDef => ({
        name,
        number: freeNumber(),
        color: PALETTE[index % PALETTE.length] as string,
        sources: [source],
        mode: 'marathon',
        order: 'interleave',
        blocks: [],
        timezone: 'UTC',
        avoidRepeat: 5,
        enabled: true,
      })
      let index = 0
      const types = request.types.length ? request.types : (['Movie'] as Array<'Movie' | 'Episode'>)
      for (const genre of request.genres.slice(0, 60)) {
        try {
          created.push(await save(user, null, base(genre, { kind: 'rule', name: genre, genres: [genre], types }, index), now))
          index += 1
        } catch (e) {
          if (!(e instanceof HttpError) || e.status === 401 || e.status === 403) throw e
          // A genre with nothing to show is skipped; its number was not used.
          taken.delete(next)
        }
      }
      for (const id of request.collectionIds.slice(0, 60)) {
        try {
          const box = await jellyfin.get<{ Items?: Array<{ Name?: string }> }>('/Items', user.token, { userId: user.id, ids: [id] })
          const name = box.Items?.[0]?.Name ?? 'Collection'
          created.push(await save(user, null, base(name, { kind: 'item', id, name, itemType: 'BoxSet' }, index), now))
          index += 1
        } catch (e) {
          if (!(e instanceof HttpError) || e.status === 401 || e.status === 403) throw e
          taken.delete(next)
        }
      }
      return created
    },
  }
}
