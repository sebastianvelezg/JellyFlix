/**
 * The buttons at the top (Home, Movies, Series...): in what order they are and which are turned off. Only buttons the account has a
 * library for are drawn, whatever is chosen here. Home cannot be turned off, so there is always a way to the main page.
 */

export const MENU_IDS = ['home', 'movies', 'series', 'anime', 'musicvideos', 'books', 'livetv', 'music'] as const
export type MenuId = (typeof MENU_IDS)[number]

export interface MenuLayout {
  /** Every button, in the order they appear. */
  order: MenuId[]
  /** The buttons that are turned off. */
  hidden: MenuId[]
}

export const DEFAULT_MENU_LAYOUT: MenuLayout = { order: [...MENU_IDS], hidden: [] }

const isMenuId = (value: unknown): value is MenuId => typeof value === 'string' && (MENU_IDS as readonly string[]).includes(value)

/** Cleans up whatever was saved: unknown and repeated buttons go, buttons added in a later version are appended, Home is never off. */
export function sanitizeMenuLayout(value: unknown): MenuLayout {
  const saved = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof MenuLayout, unknown>>
  const order: MenuId[] = []
  for (const id of Array.isArray(saved.order) ? saved.order : []) if (isMenuId(id) && !order.includes(id)) order.push(id)
  for (const id of MENU_IDS) if (!order.includes(id)) order.push(id)
  const hidden = [...new Set((Array.isArray(saved.hidden) ? saved.hidden : []).filter(isMenuId))].filter((id) => id !== 'home')
  return { order, hidden }
}

/** The buttons to draw: those the account has, in the chosen order, without the ones turned off. */
export function arrangeMenu<T extends MenuId>(available: readonly T[], layout: MenuLayout): T[] {
  return layout.order.filter((id): id is T => (available as readonly MenuId[]).includes(id) && !layout.hidden.includes(id))
}

export const isMenuItemVisible = (layout: MenuLayout, id: MenuId): boolean => !layout.hidden.includes(id)

export function toggleMenuItem(layout: MenuLayout, id: MenuId): MenuLayout {
  if (id === 'home') return layout
  return { ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id] }
}

/** Moves a button one place earlier (-1) or later (+1); one at the end stays where it is. */
export function moveMenuItem(layout: MenuLayout, id: MenuId, direction: -1 | 1): MenuLayout {
  const from = layout.order.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= layout.order.length) return layout
  const order = [...layout.order]
  ;[order[from], order[to]] = [order[to] as MenuId, order[from] as MenuId]
  return { ...layout, order }
}

export function isDefaultMenuLayout(layout: MenuLayout): boolean {
  return layout.hidden.length === 0 && layout.order.every((id, i) => id === MENU_IDS[i])
}
