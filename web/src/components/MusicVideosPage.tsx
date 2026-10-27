import { useCallback, useState } from 'react'
import { getVideoPlaylists, type LibrarySections, type Movie, type MovieLibrary, type Session } from '../core'
import { CatalogPage, type CatalogCommon } from './CatalogPage'
import { FolderView, PlayQueueButtons } from './MusicVideoFolders'
import { ListCard } from './ListsPage'
import type { PlayQueueRef } from './route'
import { StateMessage } from './StateMessage'
import { useAsync, type AsyncState } from './useAsync'
import { t, tr } from '../i18n'

type Tab = 'home' | 'folders' | 'playlists'

const TABS: Array<[Tab, string]> = [
  ['home', tr('Suggestions')],
  ['folders', tr('Folders')],
  ['playlists', tr('Playlists')],
]

/** The views of the music video section, like the ones Jellyfin has: suggestions (with all the videos), folders and playlists. */
function Views({ tab, onTab, children }: { tab: Tab; onTab: (tab: Tab) => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <nav aria-label={t('Music video views')} className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={id === tab ? 'page' : undefined}
            onClick={() => onTab(id)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition pointer-coarse:py-3 ${
              id === tab
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white shadow-[0_0_18px_-6px_var(--glow)]'
                : 'border-white/10 bg-white/[.04] text-neutral-300 hover:border-white/25 hover:text-white'
            }`}
          >
            {t(label)}
          </button>
        ))}
      </nav>
      {children && <div className="sm:ml-auto">{children}</div>}
    </div>
  )
}

function Playlists({ session, onOpenList }: { session: Session; onOpenList: (id: string) => void }) {
  const load = useCallback(() => getVideoPlaylists(session), [session])
  const { state, retry } = useAsync(load)
  if (state.status === 'loading') return <p role="status" className="py-10 text-neutral-400">{t('Loading your playlists…')}</p>
  if (state.status === 'error') {
    return (
      <StateMessage kind="error" size="section" message={t('Could not load your playlists: {message}', { message: state.message })}>
        <button type="button" className="btn" onClick={retry}>
          {t('Try again')}
        </button>
      </StateMessage>
    )
  }
  if (state.data.length === 0) {
    return <StateMessage kind="empty" size="section" message={t('You have no playlists yet. Make one with the ⋯ menu of any video.')} />
  }
  return (
    <ul aria-label={t('Playlists')} className="poster-grid">
      {state.data.map((list) => (
        <li key={list.id}>
          <ListCard session={session} list={list} onOpen={onOpenList} />
        </li>
      ))}
    </ul>
  )
}

/**
 * The Music videos section: its suggestions and all its videos (the usual catalogue page), the folders of its libraries (open
 * them, play a folder through or shuffle it), and the playlists. Playing a video goes on to the next one of its folder.
 */
export function MusicVideosPage({
  onOpenFolder,
  onOpenList,
  onPlayQueue,
  onOpen,
  ...catalog
}: CatalogCommon & {
  sections: AsyncState<LibrarySections>
  retrySections: () => void
  onOpenFolder: (id: string) => void
  onOpenList: (id: string) => void
  onPlayQueue: (first: Movie, queue: PlayQueueRef) => void
}) {
  const [tab, setTab] = useState<Tab>('home')
  const libraries: MovieLibrary[] = catalog.sections.status === 'ready' ? catalog.sections.data.musicvideos : []
  const only = libraries.length === 1 ? libraries[0] : undefined
  // With one library the section's Play all and Shuffle sit with the views; with several, each library has its own in Folders.
  const views = (
    <Views tab={tab} onTab={setTab}>
      {only && <PlayQueueButtons session={catalog.session} parentId={only.id} kind="library" onPlay={onPlayQueue} />}
    </Views>
  )

  return (
    <>
      <div hidden={tab !== 'home'}>
        <CatalogPage section="musicvideos" onOpen={onOpen} toolbar={views} {...catalog} />
      </div>
      {tab !== 'home' && (
        <div className="pt-6">
          <div className="mb-6">{views}</div>
          {tab === 'folders' &&
            (libraries.length === 0 ? (
              <StateMessage kind="empty" size="section" message={t('There are no music video libraries.')} />
            ) : (
              <div className="space-y-10">
                {libraries.map((library) => (
                  <section key={library.id} aria-label={library.name}>
                    {libraries.length > 1 && (
                      <div className="mb-4 flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-semibold tracking-tight text-white sm:text-xl">{library.name}</h2>
                        <PlayQueueButtons session={catalog.session} parentId={library.id} kind="library" onPlay={onPlayQueue} />
                      </div>
                    )}
                    <FolderView
                      session={catalog.session}
                      parentId={library.id}
                      overrides={catalog.overrides}
                      onOpenFolder={onOpenFolder}
                      onOpenVideo={onOpen}
                      onPlayQueue={onPlayQueue}
                      emptyMessage={t('“{library}” has no folders or videos yet.', { library: library.name })}
                    />
                  </section>
                ))}
              </div>
            ))}
          {tab === 'playlists' && <Playlists session={catalog.session} onOpenList={onOpenList} />}
        </div>
      )}
    </>
  )
}
