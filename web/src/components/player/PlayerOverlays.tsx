import { episodeCode, FLOW_COUNTDOWN_SECONDS, isEpisode, type activeSegment, type Movie, type StreamRequest, type upNextPhase } from '../../core'
import { t } from '../../i18n'
import { CloseIcon, FullscreenIcon, PauseIcon, PlayIcon, SkipIcon, SkipNextIcon } from '../icons'
import { SeekBar } from '../music/controls'
import { DOCK_BUTTON } from './dock'

/** How long the picture takes to fade in from black (and out at the very end) in cinema mode. */
export const CURTAIN_MS = 1400

/** The black curtain of cinema mode: closed until playback starts, and closing again in the last moments of the title. */
export function Curtain({ down }: { down: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-testid="curtain"
      data-down={down}
      className="pointer-events-none absolute inset-0 bg-black transition-opacity ease-in-out motion-reduce:transition-none"
      style={{ opacity: down ? 1 : 0, transitionDuration: `${CURTAIN_MS}ms` }}
    />
  )
}

/** A short note over the picture ("Subtitles: +0.5 s (later)"). */
export function SyncNote({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center">
      <p role="status" className="rounded-full border border-white/10 bg-black/75 px-4 py-1.5 text-sm tabular-nums text-neutral-100 backdrop-blur-xl">
        {text}
      </p>
    </div>
  )
}

/** While a subtitle track is being fetched (the first time can take a while), or when it could not be. */
export function SubtitleNotice({
  loading,
  onRetry,
  onTurnOff,
}: {
  loading: boolean
  onRetry: () => void
  onTurnOff: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center">
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-black/75 px-4 py-2 text-sm text-neutral-100 shadow-lg backdrop-blur-xl"
      >
        {loading ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-[var(--color-accent)]" aria-hidden="true" />
            {t('Loading subtitles… the first time can take a little while')}
          </>
        ) : (
          <>
            {t('Could not load subtitles')}
            <button type="button" className="font-semibold text-[var(--color-accent)] hover:underline" onClick={onRetry}>
              {t('Try again')}
            </button>
            <button type="button" className="text-neutral-400 hover:text-white" onClick={onTurnOff}>
              {t('Turn off')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function BufferingSpinner() {
  return (
    <div role="status" aria-label={t('Buffering')} className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="h-14 w-14 animate-spin rounded-full border-4 border-white/15 border-t-[var(--color-accent)]" />
    </div>
  )
}

/** Playback failed: say why, and offer to try again, to let the server transcode (when that could help) or to go back. */
export function ErrorPanel({
  message,
  transcodeInstead,
  onRetry,
  onRequest,
  onBack,
}: {
  message: string
  transcodeInstead: StreamRequest | null
  onRetry: () => void
  onRequest: (request: StreamRequest) => void
  onBack: () => void
}) {
  return (
    <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 p-6 text-center">
      <p className="max-w-md text-neutral-100">{t(message)}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="btn-primary" onClick={onRetry}>
          {t('Try again')}
        </button>
        {transcodeInstead && (
          <button type="button" className="btn" onClick={() => onRequest(transcodeInstead)}>
            {t('Let the server transcode')}
          </button>
        )}
        <button type="button" className="btn" onClick={onBack}>
          {t('Back')}
        </button>
      </div>
    </div>
  )
}

/** "Skip intro", "Skip recap", "Skip preview", "Skip credits" (or the way to the next title) while the playhead is inside such a segment. */
export function SkipSegmentButton({
  segment,
  next,
  onSkip,
}: {
  segment: NonNullable<ReturnType<typeof activeSegment>>
  next: Movie | null
  onSkip: () => void
}) {
  return (
    <button type="button" onClick={onSkip} className="btn-primary absolute bottom-28 right-4 z-20 gap-2 sm:right-6">
      <SkipIcon />
      {segment.kind === 'intro'
        ? t('Skip intro')
        : segment.kind === 'recap'
          ? t('Skip recap')
          : segment.kind === 'preview'
            ? t('Skip preview')
            : next
              ? isEpisode(next)
                ? t('Next episode')
                : t('Next title')
              : t('Skip credits')}
    </button>
  )
}

/** What plays after this title, with the countdown when it will start by itself. */
export function UpNextCard({
  next,
  phase,
  counting,
  flow,
  flowSeconds,
  shownSeconds,
  secondsLeft,
  countdownSeconds,
  onPlayNow,
  onDismiss,
}: {
  next: Movie
  phase: ReturnType<typeof upNextPhase>
  counting: boolean
  flow: boolean
  flowSeconds: number
  shownSeconds: number
  secondsLeft: number
  countdownSeconds: number
  onPlayNow: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      aria-label={t('Up next')}
      className="absolute bottom-28 right-4 z-20 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-black/80 p-4 shadow-[0_24px_70px_-10px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:right-6"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">{t('Up next')}</p>
      <p className="mt-1 truncate font-medium text-white">{next.name}</p>
      <p className="truncate text-sm text-neutral-400">
        {(isEpisode(next) ? [next.seriesName, episodeCode(next)] : [next.year ? String(next.year) : '']).filter(Boolean).join(' · ')}
      </p>
      {counting && <p className="mt-2 text-sm text-neutral-300">{t('Starting in {seconds}s', { seconds: shownSeconds })}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-primary flex-1 py-2" onClick={onPlayNow}>
          {t('Play now')}
        </button>
        {(counting || phase === 'preview') && (
          <button type="button" className="btn py-2" onClick={onDismiss}>
            {counting ? t('Cancel') : t('Close')}
          </button>
        )}
      </div>
      {counting && (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
          <div
            data-testid="countdown-bar"
            className={`h-full bg-[var(--color-accent)] transition-[width] ease-linear motion-reduce:transition-none ${flow ? 'duration-300' : 'duration-1000'}`}
            style={{
              width: `${
                (flow ? flowSeconds / FLOW_COUNTDOWN_SECONDS : Math.max(0, Math.min(1, (secondsLeft - 1) / Math.max(1, countdownSeconds - 1)))) * 100
              }%`,
            }}
          />
        </div>
      )}
    </div>
  )
}

/** The bar at the bottom of the page the video turns into when it is left with Back (the same <video> goes on playing). */
export function MiniBar({
  title,
  movie,
  error,
  buffering,
  upNextTitle,
  paused,
  hasNext,
  currentTime,
  duration,
  onExpand,
  onTogglePlay,
  onNext,
  onRetry,
  onClose,
  onSeek,
}: {
  title: string
  movie: Movie
  error: string | null
  buffering: boolean
  /** The title that follows, while the card for it is showing. */
  upNextTitle: string | null
  paused: boolean
  hasNext: boolean
  currentTime: number
  duration: number
  onExpand?: () => void
  onTogglePlay: () => void
  onNext: () => void
  onRetry: () => void
  onClose: () => void
  onSeek: (seconds: number) => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={onExpand}
        aria-label={t('Open the video full screen: {title}', { title: movie.artist ? `${title} — ${movie.artist}` : title })}
        className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] sm:w-1/4 sm:flex-none"
      >
        <span className="block truncate text-sm font-medium text-white">{title}</span>
        <span className={`block truncate text-xs ${error ? 'text-red-300' : 'text-neutral-400'}`}>
          {error
            ? t(error)
            : buffering
              ? t('Loading…')
              : upNextTitle
                ? t('Up next: {title}', { title: upNextTitle })
                : movie.artist ?? ''}
        </span>
      </button>

      <div className="flex shrink-0 flex-col items-center gap-0.5 sm:flex-1">
        <div className="flex items-center gap-1 sm:gap-2">
          {error ? (
            <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={onRetry}>
              {t('Try again')}
            </button>
          ) : (
            <button
              type="button"
              aria-label={paused ? t('Play') : t('Pause')}
              title={paused ? t('Play') : t('Pause')}
              onClick={onTogglePlay}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition duration-150 hover:scale-105 active:scale-90"
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
          )}
          <button
            type="button"
            aria-label={t('Next title')}
            title={t('Next title')}
            disabled={!hasNext}
            onClick={onNext}
            className={DOCK_BUTTON}
          >
            <SkipNextIcon />
          </button>
        </div>
        <SeekBar value={currentTime} max={duration} onSeek={onSeek} className="hidden w-full max-w-xl sm:flex" />
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1 sm:w-1/4">
        <button type="button" aria-label={t('Full screen')} title={t('Full screen')} onClick={onExpand} className={DOCK_BUTTON}>
          <FullscreenIcon />
        </button>
        <button type="button" aria-label={t('Close the video player')} title={t('Close')} onClick={onClose} className={DOCK_BUTTON}>
          <CloseIcon />
        </button>
      </div>
      {/* On a phone the timeline is a thin line along the top of the bar. */}
      <SeekBar value={currentTime} max={duration} onSeek={onSeek} showTimes={false} className="absolute inset-x-0 -top-2.5 h-5 sm:hidden" />
    </>
  )
}
