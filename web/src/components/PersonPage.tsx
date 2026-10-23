import { useCallback } from 'react'
import { getMoviePage, type Movie, type Session } from '../core'
import { BackIcon } from './icons'
import { PagedGrid } from './PagedGrid'
import { t } from '../i18n'

/** Every movie in the library a person is credited in. */
export function PersonPage({
  session,
  id,
  name,
  overrides,
  onOpen,
  onBack,
}: {
  session: Session
  id: string
  name: string
  overrides: Record<string, Movie>
  onOpen: (movie: Movie) => void
  onBack: () => void
}) {
  const load = useCallback(
    (startIndex: number) => getMoviePage(session, { personId: id, startIndex, sort: 'released' }),
    [session, id],
  )
  return (
    <div className="pt-8">
      <button type="button" className="btn mb-4" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>
      <h1 className="mb-1 text-3xl font-bold tracking-tight sm:text-4xl">{name || t('Filmography')}</h1>
      <p className="mb-6 text-sm text-neutral-400">{t('Movies in your library, newest first.')}</p>
      <PagedGrid
        session={session}
        load={load}
        overrides={overrides}
        onOpen={onOpen}
        emptyMessage={t('No movies with this person in your library.')}
        summary={(_, total) => (total === 1 ? t('1 movie') : t('{count} movies', { count: total }))}
      />
    </div>
  )
}
