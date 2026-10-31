import { useState } from 'react'
import type { LibrarySections, Movie, MovieLibrary } from '../core'
import { CatalogPage, type CatalogCommon } from './CatalogPage'
import { FolderView, PlayQueueButtons } from './MusicVideoFolders'
import type { PlayQueueRef } from './route'
import { StateMessage } from './StateMessage'
import type { AsyncState } from './useAsync'
import { t, tr } from '../i18n'

type Tab = 'home' | 'folders'

const TABS: Array<[Tab, string]> = [
  ['home', tr('Suggestions')],
  ['folders', tr('Folders')],
]

/** The views of the music video section, like the ones Jellyfin has: suggestions (with all the videos) and folders. */
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
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white'
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

/**
 * The Music videos section: its suggestions and all its videos (the usual catalogue page) and the folders of its libraries (open
 * them, play a folder through or shuffle it). Playing a video goes on to the next one of its folder.
 */
export function MusicVideosPage({
  onOpenFolder,
  onPlayQueue,
  onOpen,
  ...catalog
}: CatalogCommon & {
  sections: AsyncState<LibrarySections>
  retrySections: () => void
  onOpenFolder: (id: string) => void
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
        </div>
      )}
    </>
  )
}
