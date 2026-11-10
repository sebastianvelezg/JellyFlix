/**
 * What an account has chosen to leave out of "Continue watching" and "Next up", without touching its history. Jellyfin has no way to hide
 * a title from those rows (only to mark it watched, or to throw its position away), so the choice is the client's: it is kept for each
 * account and the rows are filtered with it.
 *
 * - **Continue watching:** a title is hidden by its id. It comes back by itself when it is played again after it was hidden (its
 *   "last played" date, as the server writes it, is newer than the one seen at the moment of hiding), or when it is restored.
 * - **Next up:** a whole series is hidden by its id and stays hidden until it is restored.
 *
 * Nothing here changes the watched state or the position of anything on the server.
 */
export interface HiddenEntry {
  /** What to show in the list of hidden things: "Series · S1 E2" or a movie's name. */
  name: string
  /** When it was hidden (ms since the epoch, this device's clock): only to sort and show. */
  at: number
  /** The title's last-played date at that moment (the server's clock; 0 when it had none): a later one means it was played again. */
  playedAt: number
}

export interface HiddenItems {
  resume: Record<string, HiddenEntry>
  nextUp: Record<string, HiddenEntry>
}

export const NO_HIDDEN: HiddenItems = { resume: {}, nextUp: {} }

/** The most entries of each kind. A person who hides more than this is better served by restoring them all. */
export const MAX_HIDDEN = 500

export type HiddenKind = 'resume' | 'nextUp'

export interface HiddenListed extends HiddenEntry {
  kind: HiddenKind
  id: string
}

function add(map: Record<string, HiddenEntry>, id: string, entry: HiddenEntry): Record<string, HiddenEntry> {
  const next = { ...map, [id]: entry }
  const ids = Object.keys(next)
  if (ids.length <= MAX_HIDDEN) return next
  // Over the limit: the oldest ones make room.
  ids.sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0))
  for (const old of ids.slice(0, ids.length - MAX_HIDDEN)) delete next[old]
  return next
}

function without(map: Record<string, HiddenEntry>, id: string): Record<string, HiddenEntry> {
  if (!(id in map)) return map
  const next = { ...map }
  delete next[id]
  return next
}

/** Hides a title from "Continue watching". */
export function hideFromResume(hidden: HiddenItems, item: { id: string; lastPlayedAt?: number }, name: string, now: number): HiddenItems {
  return { ...hidden, resume: add(hidden.resume, item.id, { name, at: now, playedAt: item.lastPlayedAt ?? 0 }) }
}

/** Hides a whole series from "Next up". */
export function hideFromNextUp(hidden: HiddenItems, seriesId: string, name: string, now: number): HiddenItems {
  return { ...hidden, nextUp: add(hidden.nextUp, seriesId, { name, at: now, playedAt: 0 }) }
}

export function restoreHidden(hidden: HiddenItems, kind: HiddenKind, id: string): HiddenItems {
  return { ...hidden, [kind]: without(hidden[kind], id) }
}

export function restoreAllHidden(hidden: HiddenItems, kind?: HiddenKind): HiddenItems {
  return { resume: kind === 'nextUp' ? hidden.resume : {}, nextUp: kind === 'resume' ? hidden.nextUp : {} }
}

/** True while the title stays out of "Continue watching": hidden, and not played again since. */
export function isResumeHidden(hidden: HiddenItems, item: { id: string; lastPlayedAt?: number }): boolean {
  const entry = hidden.resume[item.id]
  if (!entry) return false
  return (item.lastPlayedAt ?? 0) <= entry.playedAt
}

export function isNextUpHidden(hidden: HiddenItems, seriesId: string): boolean {
  return seriesId in hidden.nextUp
}

/** The titles of a "Continue watching" row that were not hidden. */
export function filterResume<T extends { id: string; lastPlayedAt?: number }>(hidden: HiddenItems, items: T[]): T[] {
  if (Object.keys(hidden.resume).length === 0) return items
  return items.filter((item) => !isResumeHidden(hidden, item))
}

/** The episodes of a "Next up" row whose series was not hidden. */
export function filterNextUp<T extends { seriesId: string }>(hidden: HiddenItems, items: T[]): T[] {
  if (Object.keys(hidden.nextUp).length === 0) return items
  return items.filter((item) => !isNextUpHidden(hidden, item.seriesId))
}

/** How many extra items to ask the server for, so a row is still full after the hidden ones are taken out. */
export function hiddenMargin(hidden: HiddenItems, kind: HiddenKind): number {
  return Math.min(Object.keys(hidden[kind]).length, 40)
}

export function hiddenCount(hidden: HiddenItems): number {
  return Object.keys(hidden.resume).length + Object.keys(hidden.nextUp).length
}

/** Everything hidden, newest first, for the list where it can be restored. */
export function listHidden(hidden: HiddenItems): HiddenListed[] {
  const rows: HiddenListed[] = []
  for (const kind of ['resume', 'nextUp'] as const) {
    for (const [id, entry] of Object.entries(hidden[kind])) rows.push({ kind, id, ...entry })
  }
  return rows.sort((a, b) => b.at - a.at)
}

function sanitizeMap(value: unknown): Record<string, HiddenEntry> {
  const out: Record<string, HiddenEntry> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!id || id === '__proto__' || id.length > 64 || !raw || typeof raw !== 'object') continue
    const entry = raw as Partial<HiddenEntry>
    const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0
    const playedAt = typeof entry.playedAt === 'number' && Number.isFinite(entry.playedAt) ? entry.playedAt : 0
    const name = typeof entry.name === 'string' ? entry.name.slice(0, 200) : ''
    out[id] = { name, at, playedAt }
  }
  return Object.keys(out).length <= MAX_HIDDEN ? out : trim(out)
}

function trim(map: Record<string, HiddenEntry>): Record<string, HiddenEntry> {
  const ids = Object.keys(map).sort((a, b) => (map[b]?.at ?? 0) - (map[a]?.at ?? 0)).slice(0, MAX_HIDDEN)
  const out: Record<string, HiddenEntry> = {}
  for (const id of ids) out[id] = map[id] as HiddenEntry
  return out
}

/** Whatever was stored, as a valid value: anything that is not one of ours is dropped. */
export function parseHidden(raw: unknown): HiddenItems {
  if (!raw || typeof raw !== 'object') return NO_HIDDEN
  const value = raw as Partial<HiddenItems>
  const resume = sanitizeMap(value.resume)
  const nextUp = sanitizeMap(value.nextUp)
  return Object.keys(resume).length === 0 && Object.keys(nextUp).length === 0 ? NO_HIDDEN : { resume, nextUp }
}
