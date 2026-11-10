import { useCallback, useEffect, useRef, useState } from 'react'
import { collectionPosterUrl, getCollectionPage, getTitlePage, posterUrl, titleKey, type Session, type SortKey } from '../../../core'
import { channelSuggestions, type ChannelSource } from '../../../core/modules'
import { t } from '../../../i18n'
import { CheckIcon } from '../../icons'
import { Img } from '../../Img'
import { useAsync } from '../../useAsync'
import { useModulesClient } from '../ModulesProvider'

type Kind = 'movie' | 'series' | 'collection'

/** One poster of the grid: a film, a series or a collection, as the channel keeps it when it is picked. */
export interface Tile {
  id: string
  name: string
  year?: number
  imageTag?: string
  itemType: 'Movie' | 'Series' | 'BoxSet'
}

/** What the picker asks the library for. */
export interface PickerQuery {
  kind: Kind
  genre: string
  sort: SortKey
  search: string
}

/** The most sources a channel may have (the container refuses more); a rule can bring far more than that. */
export const MAX_SOURCES = 500

/** Titles per request: enough to fill a screen of posters, small enough to answer at once on a large library. */
export const PICKER_PAGE = 48

export interface TilePage {
  tiles: Tile[]
  /** What the library holds for this query. */
  total: number
  /** How many came back, copies included: the position of the next page. */
  loaded: number
}

/** One page of the library as posters. Pure of React so it can be tested on its own. */
export async function fetchTiles(session: Session, query: PickerQuery, startIndex: number): Promise<TilePage> {
  if (query.kind === 'collection') {
    const page = await getCollectionPage(session, { startIndex, limit: PICKER_PAGE, sort: query.sort === 'title' ? 'name' : 'added', search: query.search })
    return {
      tiles: page.items.map((c) => ({ id: c.id, name: c.name, ...(c.imageTag ? { imageTag: c.imageTag } : {}), itemType: 'BoxSet' as const })),
      total: page.total,
      loaded: page.items.length,
    }
  }
  const page = await getTitlePage(session, query.kind, {
    startIndex,
    limit: PICKER_PAGE,
    sort: query.sort,
    search: query.search,
    ...(query.genre ? { genre: query.genre } : {}),
  })
  return {
    tiles: page.movies.map((m) => ({
      id: m.id,
      name: m.name,
      ...(m.year ? { year: m.year } : {}),
      ...(m.imageTag ? { imageTag: m.imageTag } : {}),
      itemType: query.kind === 'series' ? ('Series' as const) : ('Movie' as const),
    })),
    total: page.total,
    loaded: page.movies.length,
  }
}

/** The same film twice (two files, two qualities) is one poster: a channel would play it twice. The first copy stays. Pure. */
export function withoutCopies(tiles: readonly Tile[], seen: ReadonlySet<string> = new Set()): Tile[] {
  const keys = new Set(seen)
  return tiles.filter((tile) => {
    const key = tile.itemType === 'BoxSet' ? tile.id : titleKey(tile)
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}

const itemOf = (tile: Tile): ChannelSource => ({ kind: 'item', id: tile.id, name: tile.name, itemType: tile.itemType })
const isPicked = (source: ChannelSource, id: string) => source.kind === 'item' && source.id === id

type State = { key: string; status: 'loading' | 'ready' | 'error'; tiles: Tile[]; total: number; loaded: number; more: boolean }
const EMPTY: State = { key: '', status: 'loading', tiles: [], total: 0, loaded: 0, more: false }

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'title', label: 'Title (A–Z)' },
  { key: 'added', label: 'Recently added' },
  { key: 'released', label: 'Release year (newest)' },
  { key: 'rating', label: 'Rating (highest)' },
]

/**
 * The library as a wall of posters for filling a channel in a few clicks: pick the kind, narrow it by genre or name, tick the posters
 * (or all those on screen), or add a rule for a whole genre that keeps up with the library by itself.
 */
export function LibraryPicker({ session, sources, onChange, onClose }: { session: Session; sources: ChannelSource[]; onChange: (next: ChannelSource[]) => void; onClose: () => void }) {
  const { client } = useModulesClient()
  const [kind, setKind] = useState<Kind>('movie')
  const [genre, setGenre] = useState('')
  const [sort, setSort] = useState<SortKey>('title')
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [answer, setAnswer] = useState<State>(EMPTY)
  // A slow answer to an earlier question must not land over a newer one.
  const generation = useRef(0)

  const loadGenres = useCallback(() => channelSuggestions(client), [client])
  const { state: suggestions } = useAsync(loadGenres)
  const genres = suggestions.status === 'ready' ? suggestions.data.genres : []

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(text.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [text])

  const query: PickerQuery = { kind, genre: kind === 'collection' ? '' : genre, sort: kind === 'collection' && sort !== 'title' ? 'added' : sort, search }
  const queryKey = JSON.stringify(query)
  // What was last answered counts only while it answers the question now asked; until the next answer comes, the grid is "loading".
  const state = answer.key === queryKey ? answer : EMPTY

  useEffect(() => {
    const mine = (generation.current += 1)
    fetchTiles(session, JSON.parse(queryKey) as PickerQuery, 0)
      .then((page) => {
        if (generation.current !== mine) return
        setAnswer({ key: queryKey, status: 'ready', tiles: withoutCopies(page.tiles), total: page.total, loaded: page.loaded, more: false })
      })
      .catch(() => {
        if (generation.current === mine) setAnswer({ ...EMPTY, key: queryKey, status: 'error' })
      })
  }, [session, queryKey])

  function loadMore() {
    const mine = generation.current
    setAnswer((s) => ({ ...s, more: true }))
    fetchTiles(session, query, state.loaded)
      .then((page) => {
        if (generation.current !== mine) return
        setAnswer((s) => ({
          key: s.key,
          status: 'ready',
          tiles: [...s.tiles, ...withoutCopies(page.tiles, new Set(s.tiles.map((x) => (x.itemType === 'BoxSet' ? x.id : titleKey(x)))))],
          total: page.total,
          loaded: s.loaded + page.loaded,
          more: false,
        }))
      })
      .catch(() => {
        if (generation.current === mine) setAnswer((s) => ({ ...s, more: false, status: 'error' }))
      })
  }

  const picked = new Set(sources.filter((s) => s.kind === 'item').map((s) => (s.kind === 'item' ? s.id : '')))
  const room = Math.max(0, MAX_SOURCES - sources.length)
  const toggle = (tile: Tile) => {
    if (picked.has(tile.id)) onChange(sources.filter((s) => !isPicked(s, tile.id)))
    else if (room > 0) onChange([...sources, itemOf(tile)])
  }
  const missing = state.tiles.filter((x) => !picked.has(x.id))
  const addShown = () => onChange([...sources, ...missing.slice(0, room).map(itemOf)])
  const clearShown = () => {
    const ids = new Set(state.tiles.map((x) => x.id))
    onChange(sources.filter((s) => !(s.kind === 'item' && ids.has(s.id))))
  }

  const ruleTypes: Array<'Movie' | 'Episode'> = kind === 'series' ? ['Episode'] : ['Movie']
  const hasRule = sources.some((s) => s.kind === 'rule' && s.genres.length === 1 && s.genres[0] === genre && s.types.length === 1 && s.types[0] === ruleTypes[0] && !s.yearFrom && !s.yearTo && !s.unwatched)
  const addRule = () => onChange([...sources, { kind: 'rule', name: genre, genres: [genre], types: ruleTypes }])

  const kinds: Array<{ key: Kind; label: string }> = [
    { key: 'movie', label: t('Movies') },
    { key: 'series', label: t('Series') },
    { key: 'collection', label: t('Collections') },
  ]
  const sorts = kind === 'collection' ? SORTS.slice(0, 2) : SORTS

  return (
    <div className="space-y-3 rounded-xl border border-white/10 p-3" role="region" aria-label={t('Browse the library')}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label={t('What to browse')}>
          {kinds.map((k) => (
            <button key={k.key} type="button" aria-pressed={kind === k.key} className={`chip cursor-pointer ${kind === k.key ? 'chip-accent' : ''}`} onClick={() => setKind(k.key)}>
              {k.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost ml-auto text-sm" onClick={onClose}>
          {t('Hide the library')}
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="min-w-40 flex-1 text-sm text-neutral-300">
          {t('Filter by name')}
          <input className="field mt-1" type="search" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {kind !== 'collection' && genres.length > 0 && (
          <label className="text-sm text-neutral-300">
            {t('Genre')}
            <select className="select mt-1 block" value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">{t('All genres')}</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm text-neutral-300">
          {t('Sort by')}
          <select className="select mt-1 block" value={query.sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {sorts.map((s) => (
              <option key={s.key} value={s.key}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {kind !== 'collection' && genre && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[.04] px-3 py-2 text-sm text-neutral-300">
          <span>{t('Want every {genre} title, now and later?', { genre })}</span>
          <button type="button" className="btn ml-auto !py-1 text-xs" disabled={hasRule} onClick={addRule}>
            {hasRule ? t('Rule added') : t('Add it as a rule')}
          </button>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span role="status" className="text-neutral-400">
          {state.status === 'loading'
            ? t('Loading…')
            : t('Showing {shown} of {total}', { shown: state.tiles.length, total: state.total })}
          {' · '}
          {t('{count} picked for this channel', { count: sources.length })}
        </span>
        {state.tiles.length > 0 && (
          <span className="ml-auto flex gap-2">
            <button type="button" className="btn !py-1 text-xs" disabled={missing.length === 0 || room === 0} onClick={addShown}>
              {t('Pick all shown')}
            </button>
            <button type="button" className="btn-ghost !py-1 text-xs" disabled={missing.length === state.tiles.length} onClick={clearShown}>
              {t('Clear shown')}
            </button>
          </span>
        )}
      </div>

      {room < state.tiles.length && missing.length > room && (
        <p role="status" className="text-sm text-amber-300">
          {t('A channel can hold {max} titles picked one by one. To bring more, add a rule.', { max: MAX_SOURCES })}
        </p>
      )}
      {state.status === 'error' && <p role="alert" className="text-sm text-red-300">{t('Could not read the library. Try again.')}</p>}
      {state.status === 'ready' && state.tiles.length === 0 && <p className="text-sm text-neutral-500">{t('Nothing matches.')}</p>}

      {state.tiles.length > 0 && (
        <ul tabIndex={0} className="grid max-h-[32rem] grid-cols-3 gap-3 overflow-y-auto p-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {state.tiles.map((tile) => {
            const on = picked.has(tile.id)
            const src = tile.itemType === 'BoxSet' ? collectionPosterUrl(session.serverUrl, tile) : posterUrl(session.serverUrl, tile)
            return (
              <li key={tile.id}>
                <button type="button" aria-pressed={on} className="group block w-full text-left outline-none" onClick={() => toggle(tile)}>
                  <div className={`relative aspect-[2/3] overflow-hidden rounded-lg bg-[var(--color-surface-2)] ring-1 transition group-focus-visible:ring-2 group-focus-visible:ring-white ${on ? 'ring-2 ring-[var(--color-accent)]' : 'ring-white/10 group-hover:ring-white/40'}`}>
                    <Img
                      session={session}
                      src={src}
                      className="h-full w-full object-cover"
                      fallback={<div aria-hidden="true" className="flex h-full w-full items-center justify-center p-2 text-center text-xs font-medium text-neutral-500">{tile.name}</div>}
                    />
                    {on && (
                      <>
                        <span className="absolute inset-0 bg-[var(--color-accent)]/20" aria-hidden="true" />
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-[var(--color-accent-strong)] p-0.5 text-[var(--color-accent-ink)]" aria-hidden="true">
                          <CheckIcon />
                        </span>
                      </>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-xs font-medium text-neutral-100">{tile.name}</p>
                  <p className="min-h-4 truncate text-xs text-neutral-500">{tile.year ?? ''}</p>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {state.status !== 'loading' && state.loaded < state.total && (
        <button type="button" className="btn" disabled={state.more} onClick={loadMore}>
          {state.more ? t('Loading…') : t('Load more')}
        </button>
      )}
    </div>
  )
}
