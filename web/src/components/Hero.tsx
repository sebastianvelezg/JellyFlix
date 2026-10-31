import { useCallback, useEffect, useState } from 'react'
import { backdropImageUrl, formatRuntime, getMovieDetails, ticksToSeconds, type Movie, type Session } from '../core'
import { PlayOnButton } from './remote/PlayOnButton'
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon, PlayIcon, StarIcon } from './icons'
import { Img } from './Img'
import { detailsKey, useSwr } from './useSwr'
import { t } from '../i18n'

/** How long each featured title stays up before the banner moves on. */
export const ROTATE_SECONDS = 10

/** Same footprint as the real banner, so the page does not jump when it loads. */
const SIZE = 'min-h-[var(--hero-min)]'

export function HeroSkeleton() {
  return <div aria-hidden="true" className={`bleed under-header skeleton !rounded-none ${SIZE}`} />
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The featured banner at the top of a home page. With several titles it moves to the next one every
 * {@link ROTATE_SECONDS} seconds, pausing while you hover or focus it (or the tab is hidden); the dots
 * and arrows go to a title directly. With reduced motion, or when turned off in Settings, it stays put.
 */
export function HeroCarousel({
  session,
  items,
  rotate,
  onPlay,
  onOpen,
  onBackdropFail,
}: {
  session: Session
  items: Movie[]
  /** Move on by itself. */
  rotate: boolean
  onPlay: (movie: Movie) => void
  onOpen: (movie: Movie) => void
  /** A backdrop could not be loaded; the page should drop that title from the banner. */
  onBackdropFail: (movie: Movie) => void
}) {
  const [chosen, setChosen] = useState(0)
  const [hovering, setHovering] = useState(false)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [reduced] = useState(prefersReducedMotion)

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const count = items.length
  const index = Math.min(chosen, count - 1)
  const movie = items[index] as Movie
  const go = useCallback((to: number) => setChosen(((to % count) + count) % count), [count])

  // Warm the next backdrop so the change is not a blank flash.
  const nextUrl = count > 1 ? backdropImageUrl(session.serverUrl, items[(index + 1) % count] as Movie) : null
  const nextTitle = count > 1 ? (items[(index + 1) % count] as Movie) : null
  useEffect(() => {
    if (!nextUrl || !nextTitle) return
    const image = new Image()
    image.onerror = () => onBackdropFail(nextTitle)
    image.src = nextUrl
    return () => {
      image.onerror = null
    }
    // Only a different next title matters, not a new callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextUrl])

  const moving = rotate && !reduced && count > 1
  const paused = hovering || hidden

  return (
    <section
      aria-label={t('Featured')}
      aria-roledescription="carousel"
      className={`group/hero bleed under-header relative flex items-end overflow-hidden ${SIZE}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      <Slide
        key={movie.id}
        session={session}
        movie={movie}
        position={count > 1 ? t('{number} of {count}', { number: index + 1, count }) : undefined}
        onPlay={onPlay}
        onOpen={onOpen}
        onBackdropFail={() => onBackdropFail(movie)}
      />

      {count > 1 && (
        <>
          <div className="gutter-x absolute inset-x-0 bottom-[4.75rem] z-10 flex items-center gap-2 sm:bottom-20">
            <div role="group" aria-label={t('Choose a featured title')} className="flex items-center gap-2">
              {items.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={t('Featured title {number} of {count}: {name}', { number: i + 1, count, name: item.name })}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => go(i)}
                  className="group/dot flex h-6 items-center pointer-coarse:h-11 pointer-coarse:px-2.5"
                >
                  <span
                    className={`relative block h-1 overflow-hidden rounded-full bg-white/25 transition-all duration-300 group-hover/dot:bg-white/45 ${
                      i === index ? 'w-10' : 'w-4'
                    }`}
                  >
                    {i === index && (
                      <span
                        key={movie.id}
                        className={`absolute inset-y-0 left-0 block rounded-full bg-[var(--color-accent)] ${
                          moving ? 'hero-progress' : 'w-full'
                        }`}
                        style={moving ? { animationDuration: `${ROTATE_SECONDS}s`, animationPlayState: paused ? 'paused' : 'running' } : undefined}
                        onAnimationEnd={moving ? () => go(index + 1) : undefined}
                      />
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="gutter-x pointer-events-none absolute inset-x-0 bottom-[4.5rem] z-10 hidden justify-end gap-2 sm:bottom-[4.75rem] lg:flex">
            <button
              type="button"
              aria-label={t('Previous featured title')}
              onClick={() => go(index - 1)}
              className="btn pointer-events-auto h-10 w-10 !p-0 opacity-0 transition focus-visible:opacity-100 group-hover/hero:opacity-100"
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              aria-label={t('Next featured title')}
              onClick={() => go(index + 1)}
              className="btn pointer-events-auto h-10 w-10 !p-0 opacity-0 transition focus-visible:opacity-100 group-hover/hero:opacity-100"
            >
              <ChevronRightIcon />
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/** One featured title: a full-width backdrop with its name, a short description and the two obvious actions. */
function Slide({
  session,
  movie,
  position,
  onPlay,
  onOpen,
  onBackdropFail,
}: {
  session: Session
  movie: Movie
  position?: string
  onPlay: (movie: Movie) => void
  onOpen: (movie: Movie) => void
  onBackdropFail: () => void
}) {
  // The description and rating are not part of list results, so fetch the one title's details.
  // The banner works without them if that request fails.
  const load = useCallback(() => getMovieDetails(session, movie.id), [session, movie.id])
  const details = useSwr(detailsKey(session, movie.id), load, { fresh: 5 * 60_000 }).state
  const info = details.status === 'ready' ? details.data : null

  const resuming = movie.resumeTicks > 0
  const runtime = formatRuntime(ticksToSeconds(info?.runtimeTicks ?? movie.runtimeTicks ?? 0))

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={position ? `${movie.name}, ${position}` : movie.name}
      className="hero-slide relative flex w-full items-end self-stretch"
    >
      <div className="absolute inset-0 bg-[var(--color-surface)]">
        <Img
          session={session}
          src={backdropImageUrl(session.serverUrl, movie)}
          eager
          className="h-full w-full object-cover object-[50%_20%]"
          fallback={null}
          onFail={onBackdropFail}
        />
      </div>
      {/* Legibility scrims, plus a soft blue bloom in the corner. */}
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-bg)] via-[var(--color-bg)]/60 to-transparent sm:via-[var(--color-bg)]/45" />
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg)] via-[var(--color-bg)]/10 to-[var(--color-bg)]/50" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_85%_10%,color-mix(in_srgb,var(--color-accent-strong)_22%,transparent),transparent)]" />

      <div className="gutter-x relative w-full pb-28 pt-40 sm:pb-32">
        <div className="max-w-2xl">
          <p className="rise chip-accent">{resuming ? t('Continue watching') : t('Featured')}</p>
          <h2 className="rise rise-2 mt-3 text-balance text-4xl font-extrabold tracking-tight text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.8)] sm:text-6xl">
            {movie.name}
          </h2>

          <div className="rise rise-3 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral-200">
            {info?.communityRating != null && (
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-accent)]" title={t('Community rating')}>
                <StarIcon /> {info.communityRating.toFixed(1)}
              </span>
            )}
            {movie.year && <span>{movie.year}</span>}
            {info?.officialRating && <span className="chip">{info.officialRating}</span>}
            {runtime && <span>{runtime}</span>}
            {info?.media?.resolution && <span className="chip-accent">{info.media.resolution}</span>}
          </div>

          {info?.overview && (
            <p className="rise rise-3 mt-4 line-clamp-3 max-w-xl text-pretty text-[0.95rem] leading-relaxed text-neutral-300 sm:text-base">
              {info.overview}
            </p>
          )}

          <div className="rise rise-4 mt-6 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary px-6 py-3 text-base" onClick={() => onPlay(movie)}>
              <PlayIcon />
              {resuming ? t('Resume') : t('Play')}
            </button>
            <button type="button" className="btn px-5 py-3 text-base" onClick={() => onOpen(movie)}>
              <InfoIcon /> {t('More info')}
            </button>
            {!movie.isSeries && <PlayOnButton itemId={movie.id} up />}
          </div>
        </div>
      </div>
    </div>
  )
}
