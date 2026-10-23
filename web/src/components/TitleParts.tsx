import type { ReactNode } from 'react'
import { personImageUrl, type MovieDetails, type Person, type Session } from '../core'
import { formatBitrate, formatBytes, formatDate } from './format'
import { BackIcon } from './icons'
import { Img } from './Img'
import { Subtext } from './Subtext'
import { t } from '../i18n'

/**
 * The full-width banner of a movie or series page: backdrop, scrims, a Back button and the
 * title block (`children`) with the poster beside it on wide screens.
 */
export function TitleHero({
  session,
  backdrop,
  poster,
  name,
  onBack,
  children,
}: {
  session: Session
  backdrop: string | null
  poster: string | null
  name: string
  onBack: () => void
  children: ReactNode
}) {
  return (
    <section className="bleed under-header relative flex min-h-[64vh] items-end overflow-hidden sm:min-h-[72vh]">
      <div className="absolute inset-0 bg-[var(--color-surface)]">
        <Img
          session={session}
          src={backdrop}
          eager
          className="h-full w-full object-cover object-[50%_20%]"
          fallback={<div className="h-full w-full bg-gradient-to-br from-[color-mix(in_srgb,var(--color-accent-deep)_35%,var(--color-bg))] via-[var(--color-surface)] to-[var(--color-bg)]" />}
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-bg)] via-[var(--color-bg)]/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg)] via-[var(--color-bg)]/15 to-[var(--color-bg)]/50" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_85%_10%,color-mix(in_srgb,var(--color-accent-strong)_20%,transparent),transparent)]" />
      <button
        type="button"
        className="btn absolute left-[var(--gutter)] top-[calc(var(--header-h)+0.75rem)] z-10 bg-black/40"
        onClick={onBack}
      >
        <BackIcon /> {t('Back')}
      </button>

      <div className="gutter-x relative flex w-full items-end justify-between gap-10 pb-10 pt-44">
        <div className="min-w-0 max-w-3xl flex-1">{children}</div>
        <div className="rise rise-3 hidden w-52 shrink-0 lg:block xl:w-60">
          <div className="aspect-[2/3] overflow-hidden rounded-2xl bg-[var(--color-surface-2)] shadow-[0_24px_70px_-12px_var(--glow)] ring-1 ring-white/15">
            <Img
              session={session}
              src={poster}
              eager
              className="h-full w-full object-cover"
              fallback={<div className="flex h-full items-center justify-center p-3 text-center text-sm text-neutral-500">{name}</div>}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

export function DetailsSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div role="status" aria-label={t('Loading movie')} className="pb-16">
      <div className="bleed under-header relative flex min-h-[64vh] items-end sm:min-h-[72vh]">
        <div className="skeleton absolute inset-0 !rounded-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg)] via-transparent to-transparent" />
        <button
          type="button"
          className="btn absolute left-[var(--gutter)] top-[calc(var(--header-h)+0.75rem)] z-10 bg-black/40"
          onClick={onBack}
        >
          <BackIcon /> {t('Back')}
        </button>
        <div className="gutter-x relative w-full space-y-3 pb-10">
          <div className="skeleton h-12 w-2/3 max-w-xl" />
          <div className="skeleton h-4 w-1/3 max-w-xs" />
          <div className="skeleton h-16 w-full max-w-2xl" />
        </div>
      </div>
    </div>
  )
}


/** One line under the buttons that says what Play will give you: the picture, the audio it starts with, and how many subtitles there are. */
export function PlaySummary({ media }: { media?: MovieDetails['media'] }) {
  if (!media) return null
  const video = [media.resolution, media.videoCodec?.toUpperCase(), media.videoRange].filter(Boolean).join(' ')
  const audio = (media.audio.find((a) => a.isDefault) ?? media.audio[0])?.label
  const subtitles = media.subtitles.length
  const parts = [video, audio, subtitles > 0 ? t('{count} subtitle tracks', { count: subtitles }) : ''].filter(Boolean)
  if (parts.length === 0) return null
  return (
    <p className="rise rise-3 mt-4 max-w-2xl text-sm text-neutral-400">
      <span className="font-medium text-neutral-300">{t('Plays as')}</span> {parts.join(' · ')}
    </p>
  )
}

export function Facts({ movie }: { movie: MovieDetails }) {
  const media = movie.media
  const rows: Array<[string, ReactNode]> = []
  if (movie.directors.length) rows.push([movie.directors.length > 1 ? t('Directors') : t('Director'), movie.directors.join(', ')])
  if (movie.studios.length) rows.push([t('Studio'), movie.studios.slice(0, 3).join(', ')])
  const released = formatDate(movie.premiereDate)
  if (released) rows.push([t('Released'), released])
  if (media) {
    const video = [media.resolution, media.videoCodec?.toUpperCase(), media.videoRange].filter(Boolean).join(' · ')
    if (video) rows.push([t('Video'), video])
    const file = [media.container?.toUpperCase(), formatBytes(media.sizeBytes), formatBitrate(media.bitrate)].filter(Boolean).join(' · ')
    if (file) rows.push([t('File'), file])
    if (media.audio.length) rows.push([t('Audio'), media.audio.map((a) => a.label).join(' • ')])
    if (media.subtitles.length) rows.push([t('Subtitles'), media.subtitles.map((a) => a.label).join(' • ')])
  }
  if (rows.length === 0) return null
  return (
    <section aria-label={t('Details')} className="glass mt-2 rounded-2xl p-5 sm:p-6">
      <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-3 text-sm sm:grid-cols-[7rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</dt>
            <dd className="min-w-0 text-neutral-200">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function CastCard({ session, person, onSelect }: { session: Session; person: Person; onSelect: (person: Person) => void }) {
  const initials = person.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
  return (
    <button
      type="button"
      onClick={() => onSelect(person)}
      aria-label={t('Movies with {name}', { name: person.name })}
      className="group w-24 shrink-0 snap-start text-center outline-none sm:w-28"
    >
      <div className="mx-auto aspect-square w-20 overflow-hidden rounded-full bg-[var(--color-surface-2)] ring-1 ring-white/10 transition duration-300 group-hover:scale-105 group-hover:shadow-[0_0_28px_-6px_var(--glow)] group-hover:ring-2 group-hover:ring-[var(--color-accent)]/70 group-focus-visible:ring-2 group-focus-visible:ring-[var(--color-accent)] sm:w-24">
        <Img
          session={session}
          src={personImageUrl(session.serverUrl, person)}
          className="h-full w-full object-cover"
          fallback={<Subtext className="flex h-full items-center justify-center text-lg font-medium text-neutral-500" text={initials} />}
        />
      </div>
      <p className="mt-2.5 truncate text-xs font-medium text-neutral-100" title={person.name}>
        {person.name}
      </p>
      {person.role && <Subtext as="p" className="block truncate text-xs text-neutral-500" text={person.role} />}
    </button>
  )
}
