import { sanitizeHomeLayout, sanitizeMenuLayout, STILL_WATCHING_CHOICES, type RemoteSection, type SyncSectionName } from '../../core'
import { sanitizeTheme, type ThemeChoice } from '../../theme/themes'
import { applyAppearance, readAppearance, writeAppearance } from './appearance'
import { readPlayerPrefs, SKIP_ACTIONS, SKIP_KINDS, writePlayerPrefs, type SkipAction, type SkipKind } from './prefs'

/**
 * What each synced section holds on this device and how it goes in and out of this device's preferences (see core/syncPrefs.ts).
 * Only what means the same on every screen is here: the theme, the order and visibility of the menu, the rows of the home page, and the
 * playback choices that do not depend on the connection. Poster size, density, interface size and the like are never synced.
 *
 * The data of a section is plain JSON the TV app reads and writes too, so its shape is shared: `appearance` is
 * `{theme:{canvas,accent}, menu:{order,hidden}, home:{banner,order,hidden}}` and `playback` is
 * `{autoplayNext, stillWatching, skip:{intro,recap,outro,preview}}`.
 */

interface AppearanceData {
  theme: { canvas: string; accent: string }
  menu: { order: string[]; hidden: string[] }
  home: { banner: boolean; order: string[]; hidden: string[] }
}

interface PlaybackData {
  autoplayNext: boolean
  stillWatching: number
  skip: Record<SkipKind, SkipAction>
}

function localAppearance(): AppearanceData {
  const { theme, menu, home } = readAppearance()
  return { theme: { canvas: theme.canvas, accent: theme.accent }, menu: { order: [...menu.order], hidden: [...menu.hidden] }, home: { banner: home.banner, order: [...home.order], hidden: [...home.hidden] } }
}

function localPlayback(): PlaybackData {
  const p = readPlayerPrefs()
  return { autoplayNext: p.autoplayNext, stillWatching: p.stillWatchingAfter, skip: { ...p.skipActions } }
}

/** This device's data for a section, as plain JSON. */
export function collectSection(name: SyncSectionName): object {
  return name === 'appearance' ? localAppearance() : localPlayback()
}

/** What a section would be on this device if `data` (from the account) were taken: valid parts only, in a fixed order, as text. */
function sanitized(name: SyncSectionName, data: unknown): object {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (name === 'appearance') {
    const theme = sanitizeTheme(d.theme as Partial<ThemeChoice> | undefined)
    const menu = sanitizeMenuLayout(d.menu)
    const home = sanitizeHomeLayout(d.home)
    return { theme: { canvas: theme.canvas, accent: theme.accent }, menu: { order: [...menu.order], hidden: [...menu.hidden] }, home: { banner: home.banner, order: [...home.order], hidden: [...home.hidden] } }
  }
  const skip = (d.skip && typeof d.skip === 'object' ? d.skip : {}) as Record<string, unknown>
  return {
    autoplayNext: d.autoplayNext !== false,
    stillWatching: (STILL_WATCHING_CHOICES as readonly number[]).includes(d.stillWatching as number) ? (d.stillWatching as number) : 0,
    skip: Object.fromEntries(SKIP_KINDS.map((kind) => [kind, SKIP_ACTIONS.includes(skip[kind] as SkipAction) ? skip[kind] : 'ask'])),
  }
}

/** The text two copies are compared by. */
export function canonical(data: object): string {
  return JSON.stringify(data)
}

export function canonicalLocal(name: SyncSectionName): string {
  return canonical(sanitized(name, collectSection(name)))
}

/** What this device's data would be after taking the account's copy: for the first activation, to see whether they already agree. */
export function canonicalOfRemote(name: SyncSectionName, section: RemoteSection): string {
  return canonical(sanitized(name, section.data))
}

/** Takes the account's copy: only the synced parts of this device's preferences change. */
export function applySection(name: SyncSectionName, data: unknown): void {
  const clean = sanitized(name, data) as unknown as AppearanceData & PlaybackData
  if (name === 'appearance') {
    writeAppearance({
      theme: sanitizeTheme(clean.theme as Partial<ThemeChoice>),
      menu: sanitizeMenuLayout(clean.menu),
      home: sanitizeHomeLayout(clean.home),
    })
    applyAppearance()
    return
  }
  writePlayerPrefs({ autoplayNext: clean.autoplayNext, stillWatchingAfter: clean.stillWatching, skipActions: clean.skip })
}

/** Ids another kind of app has (a menu button only the TV has, a row only the web has) keep their place in the account's copy. */
function keepForeign(mine: string[], theirs: unknown, known: (id: string) => boolean): string[] {
  const rest = (Array.isArray(theirs) ? theirs : []).filter((id): id is string => typeof id === 'string' && !known(id) && !mine.includes(id))
  return [...mine, ...rest]
}

/** The data to send for a section: this device's, plus what the account's copy holds that this device does not know about. */
export function dataToPush(name: SyncSectionName, remoteData: unknown): object {
  const mine = collectSection(name)
  if (name !== 'appearance') return mine
  const a = mine as AppearanceData
  const their = (remoteData && typeof remoteData === 'object' ? remoteData : {}) as Partial<Record<keyof AppearanceData, { order?: unknown; hidden?: unknown }>>
  const knownMenu = new Set(sanitizeMenuLayout({ order: ['home'] }).order as string[])
  const knownRows = new Set(sanitizeHomeLayout({ order: ['discover'] }).order as string[])
  return {
    theme: a.theme,
    menu: {
      order: keepForeign(a.menu.order, their.menu?.order, (id) => knownMenu.has(id)),
      hidden: keepForeign(a.menu.hidden, their.menu?.hidden, (id) => knownMenu.has(id)),
    },
    home: {
      banner: a.home.banner,
      order: keepForeign(a.home.order, their.home?.order, (id) => knownRows.has(id)),
      hidden: keepForeign(a.home.hidden, their.home?.hidden, (id) => knownRows.has(id)),
    },
  }
}
