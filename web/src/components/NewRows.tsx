import { useCallback } from 'react'
import { episodeCode, getAddedSince, getUpcomingEpisodes, wideImageUrl, type Movie, type Session, type UpcomingEpisode } from '../core'
import { t } from '../i18n'
import { previousVisit } from '../platform/web/lastVisit'
import { Img } from './Img'
import { frame, RowCard } from './MovieCard'
import { Row } from './Row'
import { Subtext } from './Subtext'
import { swrKey, swrScope, useSwr } from './useSwr'

/** What was added to your libraries since you were last here. No row the first time, or when nothing is new. */
export function NewSinceVisitRow({
  session,
  libraryIds,
  overrides,
  onOpenMovie,
  onOpenShow,
}: {
  session: Session
  libraryIds: string[]
  overrides: Record<string, Movie>
  onOpenMovie: (movie: Movie) => void
  onOpenShow: (show: Movie) => void
}) {
  const since = previousVisit()
  const load = useCallback(() => (since === undefined ? Promise.resolve([]) : getAddedSince(session, since, libraryIds)), [session, since, libraryIds])
  const { state } = useSwr(swrKey(swrScope(session), 'home', 'new-since', String(since), libraryIds.join(',')), load, { fresh: 5 * 60_000 })
  if (state.status !== 'ready' || state.data.length === 0) return null
  return (
    <Row title={t('New since your last visit')}>
      {state.data.map((m) => (
        <RowCard key={m.id} session={session} movie={overrides[m.id] ?? m} onOpen={m.isSeries ? onOpenShow : onOpenMovie} />
      ))}
    </Row>
  )
}

/** "Today", "Tomorrow", "In 3 days", or the date. */
export function airsText(airsAt: number | undefined, now = Date.now()): string {
  if (airsAt === undefined) return ''
  const day = (ms: number) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 86_400_000)
  const days = day(airsAt) - day(now)
  if (days <= 0) return t('Today')
  if (days === 1) return t('Tomorrow')
  if (days < 7) return t('In {count} days', { count: days })
  return new Date(airsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function UpcomingCard({ session, episode, onOpen }: { session: Session; episode: UpcomingEpisode; onOpen: (seriesId: string) => void }) {
  const code = episodeCode(episode)
  return (
    <button
      type="button"
      onClick={() => onOpen(episode.seriesId)}
      aria-label={t('Open {label}', { label: `${episode.seriesName} ${code}` })}
      className="group block w-64 shrink-0 snap-start text-left outline-none sm:w-72 lg:w-80"
    >
      <div className={`aspect-video ${frame}`}>
        <Img session={session} src={wideImageUrl(session.serverUrl, episode)} className="h-full w-full object-cover" fallback={null} />
        <span className="absolute left-2 top-2 rounded-full bg-[var(--color-accent-strong)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-accent-ink)]">
          <Subtext text={airsText(episode.airsAt)} />
        </span>
      </div>
      <p className="mt-2.5 truncate text-sm font-medium text-neutral-100 group-hover:text-white">{episode.seriesName}</p>
      <Subtext as="p" className="block truncate text-xs text-neutral-500" text={[code, episode.name].filter(Boolean).join(' · ')} />
    </button>
  )
}

/** Episodes of your series that are about to air. A server that knows of none just has no row. */
export function UpcomingRow({ session, onOpenSeries }: { session: Session; onOpenSeries: (seriesId: string) => void }) {
  const load = useCallback(() => getUpcomingEpisodes(session), [session])
  const { state } = useSwr(swrKey(swrScope(session), 'home', 'upcoming'), load, { fresh: 10 * 60_000 })
  if (state.status !== 'ready' || state.data.length === 0) return null
  return (
    <Row title={t('Coming up')}>
      {state.data.map((episode) => (
        <UpcomingCard key={episode.id} session={session} episode={episode} onOpen={onOpenSeries} />
      ))}
    </Row>
  )
}
