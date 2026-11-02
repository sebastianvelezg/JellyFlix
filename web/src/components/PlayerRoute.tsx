import { lazy, useEffect, useState } from 'react'
import {
  getCollectionItems,
  getFolderContents,
  getNextEpisode,
  getPlayable,
  getPlaylistEntries,
  getVideosUnder,
  isEpisode,
  nextInQueue,
  orderQueue,
  type Movie,
  type Session,
} from '../core'
import { readPlayerPrefs, writePlayerPrefs } from '../platform/web/prefs'
import { t } from '../i18n'
import { CloseIcon } from './icons'
import { DockNotice, DOCK_BUTTON } from './player/dock'
import { recallPlayList } from './playQueues'
import type { PlayQueueRef, PlayRoute } from './route'

// The player (with its controls) is only needed once you open it, so it is loaded on demand to keep the first screen quick.
export const loadPlayer = () => import('./player/Player')
const Player = lazy(() => loadPlayer().then((m) => ({ default: m.Player })))

export function PlayerLoading() {
  return (
    <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)] text-neutral-300">
      {t('Preparing playback…')}
    </div>
  )
}

/** The queue a /play route belongs to, as the route's own words. */
export const queueOf = (route: PlayRoute): PlayQueueRef => ({
  listId: route.listId,
  collectionId: route.collectionId,
  folderId: route.folderId,
  libraryId: route.libraryId,
  queueId: route.queueId,
  shuffle: route.shuffle,
})

/** Two play routes with the same key are the same viewing: the player is kept between them, not started again. */
export const playKey = (route: PlayRoute): string => `${route.id}:${route.startOver}:${route.startAt ?? ''}:${JSON.stringify(queueOf(route))}`

/** Looks up what a /play route points at (it may be a deep link or a refresh) and renders the player. */
export function PlayerRoute({
  session,
  id,
  startOver,
  startAt,
  queue,
  mini,
  onNextEpisode,
  onExit,
  onClose,
  onExpand,
  onPlaying,
  onLoaded,
}: {
  session: Session
  id: string
  startOver: boolean
  /** What this is played as part of (a playlist, a collection, a folder...): what follows is the next title of it. */
  queue: PlayQueueRef
  /** Seconds to begin at, when another device handed its playback over. */
  startAt?: number
  /** Drawn as a bar at the bottom of the page (a music video that was left with Back), not over the whole screen. */
  mini: boolean
  onNextEpisode: (next: Movie) => void
  /** Leave the player; `item` is what was playing (null if it could not be loaded). */
  onExit: (item: Movie | null) => void
  /** Stop for good and take the bar away. */
  onClose: () => void
  /** Bring the bar back as the full-screen player. */
  onExpand: () => void
  onPlaying: () => void
  /** The title is known (so the app knows whether it is a music video). */
  onLoaded: (item: Movie) => void
}) {
  const [item, setItem] = useState<Movie | null>(null)
  useEffect(() => {
    if (item) onLoaded(item)
  }, [item, onLoaded])
  // The titles that follow each other (in play order) when this is part of a queue, and the next episode when it is just an episode.
  const [titles, setTitles] = useState<Movie[] | null>(null)
  const [episodeNext, setEpisodeNext] = useState<Movie | null>(null)
  // After the last title of a queue the first one plays again. Chosen in the player and remembered.
  const [loop, setLoop] = useState(() => readPlayerPrefs().repeatQueue)
  const [failed, setFailed] = useState(false)
  const { listId, collectionId, folderId, libraryId, queueId, shuffle } = queue

  useEffect(() => {
    let cancelled = false
    const readQueue = (read: Promise<Movie[]>) =>
      read
        .then((all) => {
          if (!cancelled) setTitles(orderQueue(all, shuffle))
        })
        .catch(() => undefined)
    getPlayable(session, id)
      .then((found) => {
        if (cancelled) return
        setItem(found)
        // What follows is only needed at the end, so it is looked up in the background.
        // (A row or grid it was played from is already known; after a reload it is not, and the folder's other videos follow instead.)
        const fromRow = queueId ? recallPlayList(queueId) : undefined
        if (fromRow) setTitles(orderQueue(fromRow, shuffle))
        else if (listId) void readQueue(getPlaylistEntries(session, listId).then((entries) => entries.map((e) => e.item)))
        else if (collectionId) void readQueue(getCollectionItems(session, collectionId))
        else if (folderId || libraryId) void readQueue(getVideosUnder(session, (folderId ?? libraryId) as string))
        // A music video played on its own goes on with the others of its folder.
        else if (found.musicVideo && found.parentId) void readQueue(getFolderContents(session, found.parentId).then((c) => c.videos))
        else if (isEpisode(found)) {
          getNextEpisode(session, found)
            .then((following) => {
              if (!cancelled) setEpisodeNext(following)
            })
            .catch(() => undefined)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [session, id, listId, collectionId, folderId, libraryId, queueId, shuffle])

  const next = titles ? nextInQueue(titles, id, loop) : episodeNext

  // The bar at the bottom of the page does not cover the page while it waits for the video or when it could not be loaded.
  if (mini && (failed || !item)) {
    return (
      <DockNotice title={failed ? t('That title could not be loaded.') : t('Preparing playback…')} text="">
        <button type="button" aria-label={t('Close the video player')} title={t('Close')} onClick={onClose} className={DOCK_BUTTON}>
          <CloseIcon />
        </button>
      </DockNotice>
    )
  }
  if (failed) {
    return (
      <div
        role="alert"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[var(--color-bg)] p-6 text-center"
      >
        <p className="text-neutral-100">{t('That title could not be loaded.')}</p>
        <button type="button" className="btn" onClick={() => onExit(null)}>
          {t('Back')}
        </button>
      </div>
    )
  }
  if (!item) {
    return (
      <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-black text-neutral-300">
        {t('Preparing playback…')}
      </div>
    )
  }
  return (
    <Player
      session={session}
      movie={item}
      startOver={startOver}
      startAt={startAt}
      next={next}
      onNext={() => next && onNextEpisode(next)}
      onPickEpisode={onNextEpisode}
      repeat={titles ? { enabled: loop, onChange: (on) => { setLoop(on); writePlayerPrefs({ repeatQueue: on }) } } : undefined}
      onExit={() => onExit(item)}
      mini={mini}
      onClose={onClose}
      onExpand={onExpand}
      onPlaying={onPlaying}
    />
  )
}
