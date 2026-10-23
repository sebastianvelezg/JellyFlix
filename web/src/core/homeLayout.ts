/**
 * Which rows the home page shows, and in what order. The banner at the top always stays on top (it can be turned off); every row
 * below it can be hidden and moved. Rows that need a kind of library the account does not have are left out by the page itself,
 * whatever is chosen here.
 */

export const HOME_ROW_IDS = ['discover', 'continue', 'nextUp', 'upcoming', 'newSinceVisit', 'watchLater', 'because', 'latestMovies', 'collections', 'playlists', 'newSeries', 'newAnime', 'newMusicVideos', 'music'] as const
export type HomeRowId = (typeof HOME_ROW_IDS)[number]

/** English names (the interface translates them). */
export const HOME_ROW_LABEL: Record<HomeRowId, string> = {
  discover: 'Discover',
  continue: 'Continue watching',
  nextUp: 'Next up',
  upcoming: 'Coming up',
  newSinceVisit: 'New since your last visit',
  watchLater: 'Watch later',
  because: 'Because you watched',
  latestMovies: 'Latest movies',
  collections: 'Collections',
  playlists: 'Your playlists',
  newSeries: 'New series',
  newAnime: 'New anime',
  newMusicVideos: 'New music videos',
  music: 'Music',
}

export interface HomeLayout {
  /** The big featured banner at the top. */
  banner: boolean
  /** Every row, in the order they appear. */
  order: HomeRowId[]
  /** The rows that are turned off. */
  hidden: HomeRowId[]
}

export const DEFAULT_HOME_LAYOUT: HomeLayout = { banner: true, order: [...HOME_ROW_IDS], hidden: [] }

const isRowId = (value: unknown): value is HomeRowId => typeof value === 'string' && (HOME_ROW_IDS as readonly string[]).includes(value)

/**
 * Cleans up whatever was saved: unknown and repeated rows are dropped, rows the saved copy has never heard of (added in a later
 * version) are appended after the ones it knows, and nothing else changes.
 */
export function sanitizeHomeLayout(value: unknown): HomeLayout {
  const saved = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof HomeLayout, unknown>>
  const order: HomeRowId[] = []
  for (const id of Array.isArray(saved.order) ? saved.order : []) if (isRowId(id) && !order.includes(id)) order.push(id)
  for (const id of HOME_ROW_IDS) if (!order.includes(id)) order.push(id)
  const hidden = [...new Set((Array.isArray(saved.hidden) ? saved.hidden : []).filter(isRowId))]
  return { banner: saved.banner !== false, order, hidden }
}

/** The rows to draw, in order. */
export function visibleRows(layout: HomeLayout): HomeRowId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id))
}

export function isRowVisible(layout: HomeLayout, id: HomeRowId): boolean {
  return !layout.hidden.includes(id)
}

export function toggleRow(layout: HomeLayout, id: HomeRowId): HomeLayout {
  return { ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id] }
}

/** Moves a row one place up (-1) or down (+1); a row at the end stays where it is. */
export function moveRow(layout: HomeLayout, id: HomeRowId, direction: -1 | 1): HomeLayout {
  const from = layout.order.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= layout.order.length) return layout
  const order = [...layout.order]
  ;[order[from], order[to]] = [order[to] as HomeRowId, order[from] as HomeRowId]
  return { ...layout, order }
}

export function isDefaultHomeLayout(layout: HomeLayout): boolean {
  return layout.banner && layout.hidden.length === 0 && layout.order.every((id, i) => id === HOME_ROW_IDS[i])
}
