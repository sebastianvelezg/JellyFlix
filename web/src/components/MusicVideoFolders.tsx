import { useCallback, useState } from 'react'
import {
  firstOfQueue,
  getFolderContents,
  getFolderTrail,
  getVideosUnder,
  newShuffleSeed,
  type Movie,
  type Session,
  type VideoFolder,
} from '../core'
import { BackIcon, FolderIcon, PlayIcon, ShuffleIcon } from './icons'
import { MovieCard } from './MovieCard'
import type { PlayQueueRef } from './route'
import { StateMessage } from './StateMessage'
import { Subtext } from './Subtext'
import { useAsync } from './useAsync'
import { t } from '../i18n'

/** Starts a folder or a whole library of music videos: `play(parentId, shuffle)` reads what is inside it and begins. */
function usePlayQueue(session: Session, kind: 'folder' | 'library', onPlay: (first: Movie, queue: PlayQueueRef) => void) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const play = useCallback(
    async (parentId: string, shuffle: boolean, queueKind: 'folder' | 'library' = kind) => {
      setBusy(true)
      setProblem(null)
      try {
        const videos = await getVideosUnder(session, parentId)
        const seed = shuffle ? newShuffleSeed() : undefined
        const first = firstOfQueue(videos, seed)
        if (!first) return setProblem(t('There are no videos in here to play.'))
        onPlay(first, { ...(queueKind === 'folder' ? { folderId: parentId } : { libraryId: parentId }), ...(seed ? { shuffle: seed } : {}) })
      } catch {
        setProblem(t('Could not read the videos. Check your connection and try again.'))
      } finally {
        setBusy(false)
      }
    },
    [session, kind, onPlay],
  )
  return { play, busy, problem }
}

/** Play and Shuffle for everything inside a folder or a library: the videos follow each other. */
export function PlayQueueButtons({
  session,
  parentId,
  kind,
  onPlay,
}: {
  session: Session
  parentId: string
  kind: 'folder' | 'library'
  onPlay: (first: Movie, queue: PlayQueueRef) => void
}) {
  const { play, busy, problem } = usePlayQueue(session, kind, onPlay)
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void play(parentId, false)}>
        <PlayIcon /> {kind === 'folder' ? t('Play folder') : t('Play all')}
      </button>
      <button type="button" className="btn" disabled={busy} onClick={() => void play(parentId, true)}>
        <ShuffleIcon /> {t('Shuffle')}
      </button>
      {problem && (
        <p role="alert" className="text-sm text-red-300">
          {problem}
        </p>
      )}
    </div>
  )
}

function FolderCard({
  folder,
  onOpen,
  onPlay,
  busy,
}: {
  folder: VideoFolder
  onOpen: (id: string) => void
  onPlay: (id: string) => void
  busy: boolean
}) {
  return (
    <div className="group/card relative">
      <button
        type="button"
        onClick={() => onOpen(folder.id)}
        aria-label={t('Open folder {name}', { name: folder.name })}
        className="group block w-full text-left outline-none"
      >
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[var(--color-surface-3)] to-[var(--color-surface)] text-neutral-500 ring-1 ring-white/[.08] transition duration-300 ease-out group-hover:scale-[1.03] group-hover:text-[var(--color-accent)] group-hover:ring-[var(--color-accent)]/70 group-focus-visible:ring-[var(--color-accent)]/70">
          <FolderIcon />
        </div>
        <p className="mt-2.5 truncate text-sm font-medium text-neutral-100 transition group-hover:text-white">{folder.name}</p>
        <Subtext
          as="p"
          className="block min-h-4 truncate text-xs text-neutral-500"
          text={folder.childCount == null ? t('Folder') : folder.childCount === 1 ? t('1 item') : t('{count} items', { count: folder.childCount })}
        />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onPlay(folder.id)}
        aria-label={t('Play folder {name}', { name: folder.name })}
        title={t('Play folder')}
        className="absolute right-2 top-2 flex h-10 w-10 translate-y-1 items-center justify-center rounded-full bg-white pl-0.5 text-black opacity-0 shadow-[0_6px_20px_-4px_rgba(0,0,0,0.6)] transition duration-200 hover:scale-110 focus-visible:translate-y-0 focus-visible:opacity-100 group-hover/card:translate-y-0 group-hover/card:opacity-100 disabled:opacity-60 pointer-coarse:translate-y-0 pointer-coarse:opacity-100"
      >
        <PlayIcon />
      </button>
    </div>
  )
}

/**
 * What is directly inside a library or a folder of music videos: its folders first, then its videos (as wide cards). Folders open,
 * play and shuffle; the videos play through the rest of their folder.
 */
export function FolderView({
  session,
  parentId,
  overrides,
  onOpenFolder,
  onOpenVideo,
  onPlayQueue,
  emptyMessage,
}: {
  session: Session
  parentId: string
  overrides: Record<string, Movie>
  onOpenFolder: (id: string) => void
  onOpenVideo: (video: Movie) => void
  onPlayQueue: (first: Movie, queue: PlayQueueRef) => void
  emptyMessage: string
}) {
  const load = useCallback(() => getFolderContents(session, parentId), [session, parentId])
  const { state, retry } = useAsync(load)
  const { play, busy, problem } = usePlayQueue(session, 'folder', onPlayQueue)

  if (state.status === 'loading') return <p role="status" className="py-10 text-neutral-400">{t('Loading folders…')}</p>
  if (state.status === 'error') {
    return (
      <StateMessage kind="error" size="section" message={t('Could not load this folder: {message}', { message: state.message })}>
        <button type="button" className="btn" onClick={retry}>
          {t('Try again')}
        </button>
      </StateMessage>
    )
  }
  const { folders, videos } = state.data
  if (folders.length === 0 && videos.length === 0) return <StateMessage kind="empty" size="section" message={emptyMessage} />
  return (
    <div>
      {problem && (
        <p role="alert" className="alert-error mb-4">
          {problem}
        </p>
      )}
      <ul aria-label={t('Folders and videos')} className="poster-grid wide-grid">
        {folders.map((folder) => (
          <li key={folder.id}>
            <FolderCard folder={folder} onOpen={onOpenFolder} onPlay={(id) => void play(id, false)} busy={busy} />
          </li>
        ))}
        {videos.map((video) => (
          <li key={video.id}>
            {/* From a folder, a video goes on through what is under that folder (its folders first, as "Play folder" does). */}
            <MovieCard session={session} movie={overrides[video.id] ?? video} onOpen={onOpenVideo} queue={{ folderId: parentId }} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A folder of music videos as a page of its own: where it is (a way back up), play and shuffle, and what is inside. */
export function FolderPage({
  session,
  id,
  overrides,
  onOpenFolder,
  onOpenLibrary,
  onOpenVideo,
  onPlayQueue,
  onBack,
}: {
  session: Session
  id: string
  overrides: Record<string, Movie>
  onOpenFolder: (id: string) => void
  /** The library at the top of the trail (its Folders view). */
  onOpenLibrary: () => void
  onOpenVideo: (video: Movie) => void
  onPlayQueue: (first: Movie, queue: PlayQueueRef) => void
  onBack: () => void
}) {
  const load = useCallback(() => getFolderTrail(session, id), [session, id])
  const { state } = useAsync(load)
  const info = state.status === 'ready' ? state.data : null
  return (
    <div className="pt-8">
      <button type="button" className="btn mb-5" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>
      {info && (
        <nav aria-label={t('Where this folder is')} className="mb-2 flex flex-wrap items-center gap-1 text-sm text-neutral-400">
          {info.trail.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <button
                type="button"
                className="hover:text-white hover:underline"
                onClick={() => (i === 0 ? onOpenLibrary() : onOpenFolder(crumb.id))}
              >
                {crumb.name}
              </button>
              <span aria-hidden="true">›</span>
            </span>
          ))}
        </nav>
      )}
      <h1 className="mb-5 text-3xl font-bold tracking-tight sm:text-4xl">{info?.name ?? t('Folder')}</h1>
      <div className="mb-7">
        <PlayQueueButtons session={session} parentId={id} kind="folder" onPlay={onPlayQueue} />
      </div>
      <FolderView
        key={id}
        session={session}
        parentId={id}
        overrides={overrides}
        onOpenFolder={onOpenFolder}
        onOpenVideo={onOpenVideo}
        onPlayQueue={onPlayQueue}
        emptyMessage={t('This folder is empty.')}
      />
    </div>
  )
}
