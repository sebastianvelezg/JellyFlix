import { useEffect, useRef } from 'react'
import { t, tr } from '../../i18n'
import { formatRoute, type Route } from '../route'

/** Page titles for the pages that do not set their own. */
const SIMPLE_TITLES: Partial<Record<Route['page'], string>> = {
  home: tr('Home'),
  browse: tr('Movies'),
  collections: tr('Collections'),
  settings: tr('Settings'),
}
const SECTION_TITLES = { series: tr('Series'), anime: tr('Anime'), musicvideos: tr('Music videos'), books: tr('Books'), livetv: tr('Live TV') } as const

/** Changes when the page changes, but not when only what is typed in the search box does. */
function routeKeyForFocus(route: Route): string {
  return route.page === 'search' ? 'search' : formatRoute(route)
}

/**
 * Keyboard and screen-reader users: each page gets a title (the detail pages set their own), and after moving to another page focus
 * goes to the top of the content (`mainRef`), unless they are typing (the search box changes the page too).
 */
export function usePageFocus(route: Route) {
  const mainRef = useRef<HTMLElement>(null)
  const pageTitleText =
    SIMPLE_TITLES[route.page] ??
    (route.page === 'section' ? SECTION_TITLES[route.section] : route.page === 'music' ? tr('Music') : undefined)
  const pageTitle = route.page === 'search' ? t('Search: {query}', { query: route.q }) : pageTitleText ? t(pageTitleText) : undefined
  const firstRoute = useRef(true)
  const focusKey = routeKeyForFocus(route)
  const playing = route.page === 'play'
  useEffect(() => {
    if (pageTitle) document.title = `${pageTitle} · Jellyflix`
  }, [pageTitle])
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false
      return
    }
    const active = document.activeElement
    const typing = active instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)
    if (!playing && !typing) mainRef.current?.focus({ preventScroll: true })
  }, [focusKey, playing])
  return mainRef
}
