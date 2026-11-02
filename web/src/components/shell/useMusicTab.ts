import { useState } from 'react'
import type { MusicTab, Route } from '../route'

/**
 * The music home is kept (hidden) once visited, like the other homes, remembering its tab; its "recently played" lists are read again
 * each time it is opened (`visit` counts the openings).
 */
export function useMusicTab(route: Route) {
  const [musicSeen, setMusicSeen] = useState(false)
  const [musicTab, setMusicTab] = useState<MusicTab>('home')
  const [musicVisit, setMusicVisit] = useState(0)
  const onMusic = route.page === 'music'
  const [wasOnMusic, setWasOnMusic] = useState(false)
  if (onMusic && !musicSeen) setMusicSeen(true)
  if (route.page === 'music' && route.tab !== musicTab) setMusicTab(route.tab)
  if (onMusic !== wasOnMusic) {
    setWasOnMusic(onMusic)
    if (onMusic) setMusicVisit((v) => v + 1)
  }
  return { musicSeen, musicTab, musicVisit, onMusic }
}
