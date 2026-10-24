import { useCallback } from 'react'
import type { Movie, MoviePage, Session } from '../core'
import { CardSkeleton, MovieCard } from './MovieCard'
import { PagedView } from './PagedView'

const GRID = 'poster-grid'
/** Music videos are wide frames: fewer, larger columns. */
const WIDE_GRID = 'poster-grid wide-grid'

/**
 * A responsive poster grid of movies or series, loading one page at a time (see {@link PagedView}).
 * Render it with a `key` that changes whenever `load` means something different.
 */
export function PagedGrid({
  session,
  load,
  overrides,
  emptyMessage,
  onTotal,
  summary,
  onOpen,
  wide = false,
}: {
  session: Session
  /** Fetches movies starting at `startIndex`. */
  load: (startIndex: number) => Promise<MoviePage>
  /** Movies re-read after playback or edits; replaces the matching card. */
  overrides: Record<string, Movie>
  /** Shown when there is nothing; the grid renders nothing at all when this is omitted. */
  emptyMessage?: string
  /** Told the total once the first page has loaded (or after it fails: 0). */
  onTotal?: (total: number) => void
  /** Optional line above the grid, e.g. "60 of 402 movies". */
  summary?: (shown: number, total: number) => string
  onOpen: (movie: Movie) => void
  /** Wide cards (music videos) instead of posters. */
  wide?: boolean
}) {
  const loadItems = useCallback(
    (startIndex: number) => load(startIndex).then((page) => ({ items: page.movies, total: page.total })),
    [load],
  )
  return (
    <PagedView
      load={loadItems}
      className={wide ? WIDE_GRID : GRID}
      placeholder={<CardSkeleton wide={wide} />}
      noun="movies"
      itemClassName="cv-card"
      emptyMessage={emptyMessage}
      onTotal={onTotal}
      summary={summary}
      renderItem={(movie) => <MovieCard session={session} movie={overrides[movie.id] ?? movie} onOpen={onOpen} />}
    />
  )
}
