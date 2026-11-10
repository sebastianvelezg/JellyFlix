import type { Guide, GuideChannel, Program } from '../../../core/modules'

/** The sizes of the time scale of the guide, in pixels per hour (the person steps through them with the + and − buttons). */
export const ZOOMS: readonly number[] = [90, 140, 200, 280, 400]
export const DEFAULT_ZOOM = 200

/** How wide the column of channel names can be, in pixels. */
export const NAME_MIN = 112
export const NAME_MAX = 420
export const NAME_DEFAULT = 176
export const NAME_STEP = 16

export const clampNameWidth = (px: number): number => Math.min(NAME_MAX, Math.max(NAME_MIN, Number.isFinite(px) ? Math.round(px) : NAME_DEFAULT))

/** The next size of the scale one step in or out (`1` closer, `-1` farther); the same one at either end. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const at = ZOOMS.reduce((best, z, i) => (Math.abs(z - current) < Math.abs((ZOOMS[best] as number) - current) ? i : best), 0)
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + direction))] as number
}

/** How far apart the marks of the time ruler are (seconds): every half hour when there is room for the times, else every hour. */
export const markStep = (pxPerHour: number): number => (pxPerHour >= 190 ? 1800 : 3600)

/** The guide is asked for in pieces of this many seconds as the person scrolls on. */
export const CHUNK_SECONDS = 6 * 3600
/** The container shows at most this much at once (counted from where the guide starts). */
export const MAX_SPAN_SECONDS = 48 * 3600

const byStart = (a: Program, b: Program): number => a.start - b.start

/** Two lists of programs of one channel joined, in order, a start only once (the later list wins). */
export function joinPrograms(a: readonly Program[], b: readonly Program[]): Program[] {
  const map = new Map<number, Program>()
  for (const p of a) map.set(p.start, p)
  for (const p of b) map.set(p.start, p)
  return [...map.values()].sort(byStart)
}

/**
 * The guide so far plus a piece that came after it. The channels are in the order of the newest answer (that is where the person
 * keeps favourites first); a channel the newest answer no longer has is dropped.
 */
export function joinGuide(before: Guide, piece: Guide): Guide {
  const old = new Map<string, GuideChannel>(before.channels.map((c) => [c.id, c]))
  return {
    serverTime: piece.serverTime,
    from: Math.min(before.from, piece.from),
    to: Math.max(before.to, piece.to),
    channels: piece.channels.map((c) => ({ ...c, programs: joinPrograms(old.get(c.id)?.programs ?? [], c.programs) })),
  }
}

/** Favourites first, each group by channel number. Stable. */
export function favouritesFirst<T extends { id: string; number: number }>(channels: readonly T[], isFavorite: (id: string) => boolean): T[] {
  return [...channels].sort((a, b) => Number(isFavorite(b.id)) - Number(isFavorite(a.id)) || a.number - b.number)
}

/** True when `seconds` is on another calendar day (in this device's time zone) than `before`. */
export function startsNewDay(before: number, seconds: number): boolean {
  return new Date(before * 1000).toDateString() !== new Date(seconds * 1000).toDateString()
}

/** A setting kept in this browser; anything that goes wrong (no storage, a strange value) gives the fallback. */
export function readSetting(key: string, fallback: number): number {
  try {
    const value = Number(window.localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

export function writeSetting(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // Private windows and blocked storage: the setting lasts until the page is closed.
  }
}
