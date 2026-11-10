/**
 * Optional sync of a few preferences between this account's devices (the web app and the TV app), through the display preferences
 * Jellyfin keeps for each user. The rules live here, apart from any screen, and the TV app follows the same ones.
 *
 * - **What is synced** is chosen by section: `appearance` (the theme, the order and visibility of the menu, the rows of the home page)
 *   and `playback` (autoplay, "Are you still watching?", what to do with intros, recaps, credits and previews). What depends on the
 *   screen or the connection (a TV's margin, text size, bitrate limit, poster size, density) is never synced.
 * - **Off by default,** for each account on each device. Nothing is read or written on the server until it is turned on. The first
 *   time, the person chooses between using what the account already has and uploading this device's choices.
 * - **Each section is its own thing:** the most recent change wins per section (not per file), by the server's clock. A section this
 *   version does not understand (a later format) is left alone, and so is any section it has never heard of.
 * - **Offline:** a change made while the server cannot be reached stays marked and is sent when it can be. If the account's copy is newer
 *   than that change by then, the account's copy wins and the device says so.
 * - It lives in a field of its own, apart from the manual settings file, so older versions that save that file cannot damage it.
 */

export const SYNC_FORMAT = 1
export const SYNC_SECTIONS = ['appearance', 'playback'] as const
export type SyncSectionName = (typeof SYNC_SECTIONS)[number]

/** The most the saved text may be: far more than these two small sections ever are. */
export const MAX_SYNC_CHARS = 50_000

export interface RemoteSection {
  /** The format of `data`; a later one than this version knows is not touched. */
  v: number
  /** When it was saved (ms since the epoch, the server's clock). */
  at: number
  /** Which kind of app saved it ("web" or "tv"), to say where the account's choices came from. */
  by: string
  data: unknown
}

export interface SyncFile {
  v: number
  /** Every section found, those of this version and any other (kept as they were when the file is written back). */
  sections: Record<string, unknown>
}

export const EMPTY_SYNC_FILE: SyncFile = { v: SYNC_FORMAT, sections: {} }

function isRemoteSection(value: unknown): value is RemoteSection {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<RemoteSection>
  return typeof s.v === 'number' && typeof s.at === 'number' && Number.isFinite(s.at) && typeof s.by === 'string' && 'data' in s
}

/** The saved text as a file; anything that is not one of ours is an empty file. */
export function parseSyncFile(text: string | null | undefined): SyncFile {
  if (!text || text.length > MAX_SYNC_CHARS) return EMPTY_SYNC_FILE
  try {
    const root = JSON.parse(text) as { v?: unknown; sections?: unknown }
    if (!root || typeof root !== 'object' || !root.sections || typeof root.sections !== 'object' || Array.isArray(root.sections)) return EMPTY_SYNC_FILE
    const sections: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(root.sections as Record<string, unknown>)) {
      if (name !== '__proto__') sections[name] = value
    }
    return { v: typeof root.v === 'number' ? root.v : SYNC_FORMAT, sections }
  } catch {
    return EMPTY_SYNC_FILE
  }
}

export function serializeSyncFile(file: SyncFile): string {
  return JSON.stringify({ v: SYNC_FORMAT, sections: file.sections })
}

/** A section of the file that this version can read, or null (absent, damaged, or of a later format). */
export function readableSection(file: SyncFile, name: SyncSectionName): RemoteSection | null {
  const value = file.sections[name]
  return isRemoteSection(value) && value.v <= SYNC_FORMAT ? value : null
}

/** True when the file has a section of a later format: it must be left alone, not overwritten. */
export function hasNewerSection(file: SyncFile, name: SyncSectionName): boolean {
  const value = file.sections[name]
  return isRemoteSection(value) && value.v > SYNC_FORMAT
}

/** The file with a section put in it (everything else in the file is kept). */
export function withSection(file: SyncFile, name: SyncSectionName, section: RemoteSection): SyncFile {
  return { v: SYNC_FORMAT, sections: { ...file.sections, [name]: section } }
}

// ---- What a device remembers ----------------------------------------------------------------------------------------------

export interface SectionState {
  /** The `at` of the copy of the account this device last took or wrote (0: never). */
  applied: number
  /** What this device's choices were when they last matched the account's (the canonical text of its data). */
  snapshot: string | null
  /** When this device first saw its choices differ from `snapshot` and could not send them yet (the server's clock). */
  dirtyAt: number | null
}

export interface PrefsSyncState {
  enabled: boolean
  sections: Partial<Record<SyncSectionName, SectionState>>
}

export const SYNC_OFF: PrefsSyncState = { enabled: false, sections: {} }

export function parseSyncState(raw: unknown): PrefsSyncState {
  if (!raw || typeof raw !== 'object') return SYNC_OFF
  const value = raw as { enabled?: unknown; sections?: unknown }
  const sections: PrefsSyncState['sections'] = {}
  if (value.sections && typeof value.sections === 'object') {
    for (const name of SYNC_SECTIONS) {
      const s = (value.sections as Record<string, unknown>)[name] as Partial<SectionState> | undefined
      if (!s || typeof s !== 'object') continue
      sections[name] = {
        applied: typeof s.applied === 'number' && Number.isFinite(s.applied) ? s.applied : 0,
        snapshot: typeof s.snapshot === 'string' ? s.snapshot : null,
        dirtyAt: typeof s.dirtyAt === 'number' && Number.isFinite(s.dirtyAt) ? s.dirtyAt : null,
      }
    }
  }
  return { enabled: value.enabled === true, sections }
}

// ---- Deciding ------------------------------------------------------------------------------------------------------------------

export type SectionAction =
  /** Nothing to do. */
  | 'none'
  /** Send this device's choices to the account. */
  | 'push'
  /** Take the account's copy. */
  | 'apply'
  /** Take the account's copy although this device had a change waiting (the account's was newer): say so. */
  | 'apply-conflict'
  /** The account's copy is of a later format: leave it alone. */
  | 'skip'

/**
 * What to do with one section. `local` is the canonical text of this device's data now; `now` is the server's clock. Pure.
 *
 * The account's copy is new when its `at` is above the one this device last took or wrote. With no change waiting on this device it is
 * taken; with one waiting, the later of the two wins (the account's, on a tie).
 */
export function planSection(input: { remote: RemoteSection | null; newerFormat: boolean; local: string; state: SectionState | undefined; now: number }): {
  action: SectionAction
  /** The time to remember for a change that is still waiting (null: nothing waiting). */
  dirtyAt: number | null
} {
  const { remote, newerFormat, local, state, now } = input
  if (newerFormat) return { action: 'skip', dirtyAt: state?.dirtyAt ?? null }
  const dirty = state?.snapshot != null && local !== state.snapshot
  const dirtyAt = dirty ? (state?.dirtyAt ?? now) : null
  if (!remote) return { action: 'push', dirtyAt }
  const isNew = remote.at > (state?.applied ?? 0)
  if (!isNew) return { action: dirty ? 'push' : 'none', dirtyAt }
  if (!dirty) return { action: 'apply', dirtyAt: null }
  return dirtyAt !== null && dirtyAt > remote.at ? { action: 'push', dirtyAt } : { action: 'apply-conflict', dirtyAt }
}

/** The time a push is stamped with: now, but always above what is already saved, so it is the newest whatever the clocks say. */
export function pushStamp(now: number, remote: RemoteSection | null): number {
  return Math.max(now, (remote?.at ?? 0) + 1)
}

/** What the first activation should do given what the account already has. */
export type FirstActivation =
  /** The account has nothing of ours: this device's choices simply go up. */
  | { kind: 'upload' }
  /** The account has the same choices: nothing to choose, just start. */
  | { kind: 'same'; applied: Partial<Record<SyncSectionName, number>> }
  /** They differ: the person chooses; `sections` says which sections differ, and who saved them. */
  | { kind: 'ask'; sections: Array<{ name: SyncSectionName; at: number; by: string }> }

export function planFirstActivation(file: SyncFile, locals: Record<SyncSectionName, string>, canonicalOf: (name: SyncSectionName, section: RemoteSection) => string): FirstActivation {
  const present: Array<{ name: SyncSectionName; section: RemoteSection }> = []
  for (const name of SYNC_SECTIONS) {
    const section = readableSection(file, name)
    if (section) present.push({ name, section })
  }
  if (present.length === 0) return { kind: 'upload' }
  const differing = present.filter(({ name, section }) => canonicalOf(name, section) !== locals[name])
  if (differing.length === 0) {
    const applied: Partial<Record<SyncSectionName, number>> = {}
    for (const { name, section } of present) applied[name] = section.at
    return { kind: 'same', applied }
  }
  return { kind: 'ask', sections: differing.map(({ name, section }) => ({ name, at: section.at, by: section.by })) }
}

/** The server's clock from a response's `Date` header (ms), or null when it is missing or not a date. */
export function serverTimeFromHeader(header: string | null | undefined): number | null {
  if (!header) return null
  const ms = Date.parse(header)
  return Number.isFinite(ms) ? ms : null
}
