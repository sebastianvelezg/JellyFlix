/**
 * What the viewer chose on the title page before pressing Play: which version of the file (4K or 1080p), which audio track and
 * which subtitle. The player reads it once, when that title starts, and then forgets it.
 */
export interface PlayChoice {
  /** The version (media source) to play; the server's own first one when not set. */
  mediaSourceId?: string
  /** The audio track of that version; the usual choice (the language you watched in, or the file's default) when not set. */
  audioIndex?: number
  /** The subtitle track; `null` is "off", and not set is the usual choice (the language you used last). */
  subtitleIndex?: number | null
}

/** A choice nobody picked up in this long is stale (the viewer pressed Play on something else). */
const KEEP_MS = 60_000

let held: { itemId: string; choice: PlayChoice; at: number } | null = null

export function setPlayChoice(itemId: string, choice: PlayChoice, now = Date.now()): void {
  held = { itemId, choice, at: now }
}

/** The choice made for this title, once; `undefined` when there is none (or it is old). */
export function takePlayChoice(itemId: string, now = Date.now()): PlayChoice | undefined {
  const found = held
  if (!found || found.itemId !== itemId) return undefined
  held = null
  return now - found.at <= KEEP_MS ? found.choice : undefined
}

/** One version of a title: the same film in another resolution or edition. */
export interface VersionRef {
  id: string
  /** The picture it has ("4K", "1080p"). */
  resolution?: string
}

/** The version to offer first: the resolution you picked last time if this title has it, else the server's first. */
export function defaultVersion(versions: VersionRef[], preferredResolution: string | null | undefined): string | undefined {
  if (versions.length === 0) return undefined
  return (preferredResolution ? versions.find((v) => v.resolution === preferredResolution) : undefined)?.id ?? versions[0]?.id
}
