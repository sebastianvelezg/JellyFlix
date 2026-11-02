import { useEffect, useEffectEvent } from 'react'
import type { Section } from '../../core'
import type { Navigate, Route } from '../route'

/** Where a library's tab leads. */
export const sectionRoute = (section: Section): Route =>
  section === 'movies' ? { page: 'browse' } : section === 'music' ? { page: 'music', tab: 'home' } : { page: 'section', section }

/**
 * Pages that should not be the one shown, and where to go instead (without leaving a step in the history):
 * - In Kids mode a link to Settings, Administration, the stats or Live TV lands on the home page.
 * - An account with a single kind of library has no main page: it starts on that library. The same goes for the movies page of an
 *   account without movies.
 */
export function useSectionRedirects({
  route,
  go,
  homeRoute,
  firstSection,
  hasHome,
  librariesKnown,
  noMovies,
  kids,
}: {
  route: Route
  go: Navigate
  homeRoute: Route
  firstSection: Section | undefined
  hasHome: boolean
  /** The list of libraries has been read. */
  librariesKnown: boolean
  noMovies: boolean
  kids: boolean
}) {
  const shutInKids =
    kids && (route.page === 'settings' || route.page === 'admin' || route.page === 'stats' || route.page === 'live' || (route.page === 'section' && route.section === 'livetv'))
  // (An effect event reads the latest `go` and routes without making the effect run again when they change.)
  const leaveKidsPage = useEffectEvent(() => go(homeRoute, { replace: true }))
  useEffect(() => {
    if (shutInKids) leaveKidsPage()
  }, [shutInKids])

  const onBrowse = route.page === 'browse'
  const onHome = route.page === 'home'
  const toFirstSection = useEffectEvent(() => {
    if (firstSection) go(sectionRoute(firstSection), { replace: true })
  })
  // Only the route and which libraries exist decide this.
  useEffect(() => {
    if (!firstSection) return
    if ((onBrowse && noMovies && firstSection !== 'movies') || (onHome && librariesKnown && !hasHome)) toFirstSection()
  }, [onBrowse, onHome, librariesKnown, hasHome, noMovies, firstSection])
}
