/**
 * A small per-tab copy of the lists the app has read (rows, genres, collections...), so that after a reload the
 * screen can be drawn at once from what was seen a moment ago while the fresh lists are fetched. Kept in
 * sessionStorage: it ends with the tab and is never shared. Every call is allowed to fail silently.
 */

const PREFIX = 'jellyflix.swr:'
const INDEX = 'jellyflix.swr.index'
/** How many lists are kept; the least recently written go first. */
const MAX_ENTRIES = 80
/** A list bigger than this is only kept in memory. */
const MAX_ENTRY_CHARS = 200_000

export interface Stored {
  data: unknown
  at: number
}

function readIndex(): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(INDEX) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

export function readStored(key: string): Stored | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Stored>
    return typeof parsed.at === 'number' && 'data' in parsed ? { data: parsed.data, at: parsed.at } : null
  } catch {
    return null
  }
}

export function writeStored(key: string, value: Stored): void {
  try {
    const text = JSON.stringify(value)
    if (text.length > MAX_ENTRY_CHARS) return
    const index = readIndex().filter((k) => k !== key)
    index.push(key)
    while (index.length > MAX_ENTRIES) {
      const oldest = index.shift()
      if (oldest) sessionStorage.removeItem(PREFIX + oldest)
    }
    sessionStorage.setItem(PREFIX + key, text)
    sessionStorage.setItem(INDEX, JSON.stringify(index))
  } catch {
    // Storage full or unavailable: the app just works from memory.
  }
}

export function clearStored(): void {
  try {
    for (const key of readIndex()) sessionStorage.removeItem(PREFIX + key)
    sessionStorage.removeItem(INDEX)
  } catch {
    // Nothing to clean up.
  }
}
