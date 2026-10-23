import { useCallback } from 'react'
import { collectionPosterUrl, getCollectionPage, type Collection, type Session } from '../core'
import { HeartIcon } from './icons'
import { Img } from './Img'
import { frame } from './MovieCard'
import { Row } from './Row'
import { Subtext } from './Subtext'
import { swrKey, useSwr, swrScope } from './useSwr'
import { t } from '../i18n'

/** "3 titles", "1 title", or nothing when the server did not say. */
export function collectionCount(collection: Pick<Collection, 'itemCount'>): string {
  const n = collection.itemCount
  return n == null ? '' : n === 1 ? t('1 title') : t('{count} titles', { count: n })
}

/** A poster with two sheets peeking out behind it, so a collection reads as a pile of films, not one. */
export function CollectionCard({
  session,
  collection,
  onOpen,
}: {
  session: Session
  collection: Collection
  onOpen: (collection: Collection) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(collection)}
      className="group block w-full text-left outline-none"
      aria-label={t('Open collection {name}', { name: collection.name })}
    >
      <div className="relative mt-2">
        <span
          aria-hidden="true"
          className="absolute inset-x-4 -top-2 h-10 rounded-t-xl bg-white/[.05] ring-1 ring-white/10 transition group-hover:-top-3 group-hover:bg-[var(--color-accent)]/15"
        />
        <span
          aria-hidden="true"
          className="absolute inset-x-2 -top-1 h-10 rounded-t-xl bg-white/[.09] ring-1 ring-white/10 transition group-hover:-top-1.5"
        />
        <div className={`aspect-[2/3] ${frame}`}>
          <Img
            session={session}
            src={collectionPosterUrl(session.serverUrl, collection)}
            className="h-full w-full object-cover"
            fallback={
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-surface-3)] to-[var(--color-surface)] p-3 text-center text-sm font-medium text-neutral-500">
                {collection.name}
              </div>
            }
          />
          {collection.favorite && (
            <span className="absolute left-2 top-2 rounded-full bg-black/60 p-1 text-rose-400 backdrop-blur" title={t('Favorite')}>
              <HeartIcon filled />
            </span>
          )}
        </div>
      </div>
      <p className="mt-2.5 truncate text-sm font-medium text-neutral-100 transition group-hover:text-white">{collection.name}</p>
      <Subtext as="p" className="block min-h-4 text-xs text-neutral-500" text={collectionCount(collection)} />
    </button>
  )
}

export function CollectionRowCard(props: { session: Session; collection: Collection; onOpen: (collection: Collection) => void }) {
  return (
    <div className="w-[var(--poster-w)] shrink-0 snap-start">
      <CollectionCard {...props} />
    </div>
  )
}

/** A handful of collections, a different one each visit, as a row, when the server has any. A server without any (or one that fails) just has no row. */
export function CollectionsRow({
  session,
  onOpen,
  onSeeAll,
}: {
  session: Session
  onOpen: (collection: Collection) => void
  onSeeAll: () => void
}) {
  const load = useCallback(() => getCollectionPage(session, { startIndex: 0, limit: 16, sort: 'random' }), [session])
  // Random each visit, but the copy held is shown while the next handful is fetched.
  const { state } = useSwr(swrKey(swrScope(session), 'collections-row'), load, { fresh: 60_000 })
  if (state.status !== 'ready' || state.data.items.length === 0) return null
  return (
    <Row
      title={t('Collections')}
      action={
        <button type="button" className="text-[var(--color-accent)] hover:underline" onClick={onSeeAll}>
          {t('See all')}{state.data.total > state.data.items.length ? ` ${state.data.total}` : ''}
        </button>
      }
    >
      {state.data.items.map((c) => (
        <CollectionRowCard key={c.id} session={session} collection={c} onOpen={onOpen} />
      ))}
    </Row>
  )
}
