import { StateMessage } from './StateMessage'
import { useCallback, useEffect, useState } from 'react'
import {
  collectionBackdropUrl,
  collectionPlayTarget,
  collectionPosterUrl,
  COLLECTION_SORT_LABELS,
  backdropImageUrl,
  getCollection,
  getCollectionItems,
  getCollectionPage,
  setFavorite,
  type Collection,
  type CollectionDetails,
  type CollectionSort,
  type Movie,
  type Session,
} from '../core'
import { CollectionCard, collectionCount } from './CollectionCard'
import { BackIcon, HeartIcon, PlayIcon } from './icons'
import { CardSkeleton, MovieCard } from './MovieCard'
import { PagedView } from './PagedView'
import { DetailsSkeleton, TitleHero } from './TitleParts'
import { swrKey, swrScope, useSwr } from './useSwr'
import { t } from '../i18n'

const GRID = 'poster-grid'

/** All collections, with a name filter and a sort order. */
export function CollectionsPage({
  session,
  onOpen,
  onBack,
}: {
  session: Session
  onOpen: (collection: Collection) => void
  onBack: () => void
}) {
  const [sort, setSort] = useState<CollectionSort>('name')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(
    (startIndex: number) => getCollectionPage(session, { startIndex, sort, search: term }),
    [session, sort, term],
  )

  return (
    <div className="pt-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button type="button" className="btn" onClick={onBack}>
          <BackIcon /> {t('Back')}
        </button>
        <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight sm:text-2xl">
          <span aria-hidden="true" className="h-6 w-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_14px_var(--glow)]" />
          {t('Collections')}
        </h1>
        <div className="ml-auto flex w-full gap-2 sm:w-auto">
          <input
            type="search"
            aria-label={t('Search collections')}
            placeholder={t('Search collections')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="field w-full rounded-full sm:w-64"
          />
          <select
            className="select"
            aria-label={t('Sort by')}
            value={sort}
            onChange={(e) => setSort(e.target.value as CollectionSort)}
          >
            {(Object.keys(COLLECTION_SORT_LABELS) as Array<keyof typeof COLLECTION_SORT_LABELS>).map((k) => (
              <option key={k} value={k}>
                {t(COLLECTION_SORT_LABELS[k])}
              </option>
            ))}
          </select>
        </div>
      </div>
      <PagedView
        key={`${sort}|${term}`}
        load={load}
        className={GRID}
        placeholder={<CardSkeleton />}
        noun="collections"
        itemClassName="cv-card"
        emptyMessage={
          term ? t('No collections match “{term}”.', { term }) : t('No collections yet. Jellyfin can group a saga’s movies into one: add a movie to a collection from its menu in Jellyfin.')
        }
        summary={(shown, total) => t('{shown} of {total} collections', { shown, total })}
        renderItem={(collection) => <CollectionCard session={session} collection={collection} onOpen={onOpen} />}
      />
    </div>
  )
}

/** One collection: its description and the films in it, oldest first. */
export function CollectionPage({
  session,
  id,
  overrides,
  onPlay,
  onOpen,
  onBack,
}: {
  session: Session
  id: string
  overrides: Record<string, Movie>
  onPlay: (movie: Movie) => void
  onOpen: (movie: Movie) => void
  onBack: () => void
}) {
  const loadCollection = useCallback(() => getCollection(session, id), [session, id])
  const collection = useSwr(swrKey(swrScope(session), 'collection', id), loadCollection, { fresh: 0 })
  const loadItems = useCallback(() => getCollectionItems(session, id), [session, id])
  const items = useSwr(swrKey(swrScope(session), 'collection-items', id), loadItems, { fresh: 0 }).state

  if (collection.state.status === 'loading') return <DetailsSkeleton onBack={onBack} />
  if (collection.state.status === 'error') {
    return (
      <StateMessage kind="error" message={t('Could not load this collection: {message}', { message: collection.state.message })}>
        <button type="button" className="btn" onClick={collection.retry}>
          {t('Try again')}
        </button>
        <button type="button" className="btn" onClick={onBack}>
          {t('Back')}
        </button>
      </StateMessage>
    )
  }
  const details = collection.state.data
  const titles = items.status === 'ready' ? items.data.map((m) => overrides[m.id] ?? m) : []
  return (
    <CollectionContent
      session={session}
      collection={details}
      titles={titles}
      loading={items.status === 'loading'}
      failed={items.status === 'error'}
      onPlay={onPlay}
      onOpen={onOpen}
      onBack={onBack}
      onChange={(next) => collection.update(() => next)}
    />
  )
}

function CollectionContent({
  session,
  collection,
  titles,
  loading,
  failed,
  onPlay,
  onOpen,
  onBack,
  onChange,
}: {
  session: Session
  collection: CollectionDetails
  titles: Movie[]
  loading: boolean
  failed: boolean
  onPlay: (movie: Movie) => void
  onOpen: (movie: Movie) => void
  onBack: () => void
  onChange: (next: CollectionDetails) => void
}) {
  const [error, setError] = useState(false)
  useEffect(() => {
    const previous = document.title
    document.title = `${collection.name} · Jellyflix`
    return () => {
      document.title = previous
    }
  }, [collection.name])

  const target = collectionPlayTarget(titles)
  const watched = titles.filter((m) => m.played).length
  const backdrop =
    collectionBackdropUrl(session.serverUrl, collection) ??
    (titles.length > 0 ? backdropImageUrl(session.serverUrl, titles.find((m) => m.backdropTag) ?? titles[0]!) : null)
  const poster = collectionPosterUrl(session.serverUrl, collection, 450) ?? null

  function toggleFavorite() {
    const want = !collection.favorite
    setError(false)
    onChange({ ...collection, favorite: want })
    setFavorite(session, collection.id, want)
      .then((state) => onChange({ ...collection, favorite: state.favorite }))
      .catch(() => {
        onChange(collection)
        setError(true)
      })
  }

  return (
    <article className="pb-16" aria-label={collection.name}>
      <TitleHero session={session} backdrop={backdrop} poster={poster} name={collection.name} onBack={onBack}>
        <p className="rise chip-accent">{t('Collection')}</p>
        <h1 className="rise rise-2 mt-3 text-balance text-4xl font-extrabold tracking-tight text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.8)] sm:text-6xl">
          {collection.name}
        </h1>
        <div className="rise rise-2 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral-200">
          {(titles.length > 0 || collection.itemCount != null) && (
            <span>{collectionCount({ itemCount: titles.length || collection.itemCount })}</span>
          )}
          {titles.length > 0 && (
            <span className="chip">
              {t('{watched} of {total} watched', { watched, total: titles.length })}
            </span>
          )}
        </div>
        <div className="rise rise-3 mt-6 flex flex-wrap items-center gap-2.5">
          <button type="button" className="btn-primary px-6 py-3 text-base" disabled={!target} onClick={() => target && onPlay(target)}>
            <PlayIcon />
            {loading ? t('Play') : target ? (target.resumeTicks > 0 ? t('Resume') : watched > 0 && !target.played ? t('Play next') : t('Play')) : t('Nothing to play')}
          </button>
          <button
            type="button"
            className={`btn py-3 ${collection.favorite ? 'border-rose-400/40 text-rose-400' : ''}`}
            aria-pressed={collection.favorite}
            onClick={toggleFavorite}
          >
            <HeartIcon filled={collection.favorite} /> {collection.favorite ? t('Favorite') : t('Add to favorites')}
          </button>
        </div>
        {error && (
          <p role="alert" className="alert-error mt-3 max-w-xl">
            {t('Could not update the favorite. Check your connection and try again.')}
          </p>
        )}
        {collection.overview && (
          <p className="rise rise-4 mt-6 max-w-2xl text-pretty text-base leading-relaxed text-neutral-300">{collection.overview}</p>
        )}
      </TitleHero>

      <section aria-label={t('In this collection')} className="mt-10">
        <h2 className="mb-4 flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white sm:text-xl">
          <span aria-hidden="true" className="h-5 w-1 rounded-full bg-[var(--color-accent)] shadow-[0_0_14px_var(--glow)]" />
          {t('In this collection')}
        </h2>
        {loading && (
          <div role="status" aria-label={t('Loading titles')} className={GRID}>
            {Array.from({ length: 4 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        )}
        {failed && (
          <p role="alert" className="alert-error">
            {t('Could not load the titles of this collection.')}
          </p>
        )}
        {!loading && !failed && titles.length === 0 && <p className="text-sm text-neutral-400">{t('This collection is empty.')}</p>}
        {titles.length > 0 && (
          <ul className={GRID}>
            {titles.map((movie) => (
              <li key={movie.id}>
                <MovieCard session={session} movie={movie} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}
