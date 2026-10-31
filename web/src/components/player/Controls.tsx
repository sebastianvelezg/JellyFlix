import { useState, type ReactNode } from 'react'
import { chapterAt, formatTime, timeLabelText, type Chapter, type TrackOption } from '../../core'
import type { TimeLabel } from '../../platform/web/prefs'
import type { SubtitleStyle } from './SubtitleOverlay'
import type { TrickplayPreview } from './useTrickplay'
import {
  BackIcon,
  ExitFullscreenIcon,
  Forward10Icon,
  FullscreenIcon,
  MuteIcon,
  NextEpisodeIcon,
  PauseIcon,
  PictureInPictureIcon,
  PlayIcon,
  Rewind10Icon,
  VolumeIcon,
} from '../icons'
import { getLanguage, t } from '../../i18n'
import { PlayOnButton } from '../remote/PlayOnButton'
import { EpisodesMenu, type EpisodesControl } from './EpisodesMenu'
import { SettingsMenu } from './SettingsMenu'

const iconButton =
  'relative inline-flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition duration-150 hover:bg-white/12 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 active:scale-90 aria-pressed:text-[var(--color-accent)]'

function IconButton(props: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      className={iconButton}
      aria-label={props.label}
      aria-pressed={props.pressed}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

export interface ControlsProps {
  title: string
  visible: boolean
  paused: boolean
  currentTime: number
  /** Wall-clock time (ms) of the last position update, used for "Ends at". */
  now: number
  duration: number
  /** End of the buffered range containing the current time. */
  bufferedEnd: number
  volume: number
  muted: boolean
  fullscreen: boolean
  speed: number
  audioTracks: TrackOption[]
  audioIndex?: number
  subtitleTracks: TrackOption[]
  subtitleIndex: number | null
  /** The second subtitle track (shown above the first), and how to change it; leaving the handler out hides the choice. */
  secondSubtitleIndex?: number | null
  onSecondSubtitle?: (index: number | null) => void
  subtitleStatus: 'idle' | 'loading' | 'failed'
  subtitleStyle: SubtitleStyle
  /** How many seconds later the subtitles show (negative: earlier). */
  subtitleOffset: number
  /** A subtitle file the viewer loaded from their own device, if one is in use. */
  localSubtitle: string | null
  subtitleFileError: string | null
  onBack: () => void
  onTogglePlay: () => void
  onSkip: (seconds: number) => void
  onSeek: (seconds: number) => void
  onVolume: (volume: number) => void
  onToggleMute: () => void
  onToggleFullscreen: () => void
  onAudio: (index: number) => void
  /** The most the video may stream at, in megabits per second (0 = no limit), and how it is being played now. */
  quality: number
  playback: { method: 'direct' | 'transcode'; reasons: string[] }
  onQuality: (mbps: number) => void
  onSubtitle: (index: number | null) => void
  onSubtitleStyle: (patch: Partial<SubtitleStyle>) => void
  onSubtitleOffset: (seconds: number) => void
  onSubtitleFile: (file: File) => void
  /** Present when subtitles can be searched for on the internet (a video, not a live channel): adds a button to the menu. */
  onFindSubtitles?: () => void
  onSpeed: (speed: number) => void
  /** The settings menu opened or closed; the controls must stay visible while it is open. */
  onMenuOpenChange: (open: boolean) => void
  /** Present for an episode: a button that lists the seasons and episodes of its series. */
  episodes?: EpisodesControl
  /** Present when there is a next episode: adds a skip button. */
  nextEpisode?: { label: string; onPlay: () => void }
  /** Chapter markers on the timeline, and a list in the settings menu. */
  chapters: Chapter[]
  /** Draw where each chapter starts on the seek bar. */
  chapterMarks: boolean
  /** What the labels on the left and the right of the seek bar show. */
  timeLabels: { left: TimeLabel; right: TimeLabel }
  /** The seek bar was grabbed (true) or let go (false): the player may pause meanwhile. */
  onScrubbing?: (scrubbing: boolean) => void
  /** Small pictures of the moment you point at on the timeline, when the server has made them. */
  trickplay?: TrickplayPreview | null
  /** Present when the browser can float the video in its own window. */
  pictureInPicture?: { active: boolean; onToggle: () => void }
  /** The switch of the settings menu that plays a queue again from its first title after the last one. */
  repeatQueue?: { enabled: boolean; onChange: (enabled: boolean) => void }
  /** The cinema mode switch of the settings menu. */
  cinemaMode?: { enabled: boolean; onChange: (enabled: boolean) => void }
  /** Present when there is a next episode: adds the autoplay switch to the settings menu. */
  autoplayNext?: { enabled: boolean; onChange: (enabled: boolean) => void }
}

export function Controls(p: ControlsProps) {
  const hidden = p.visible ? '' : 'pointer-events-none opacity-0'
  const remaining = p.duration > 0 ? Math.max(0, p.duration - p.currentTime) / p.speed : 0
  const endsAt =
    remaining > 0 && !p.paused
      ? new Date(p.now + remaining * 1000).toLocaleTimeString(getLanguage(), { hour: 'numeric', minute: '2-digit' })
      : null
  const labelState = { currentTime: p.currentTime, duration: p.duration, speed: p.speed, now: p.now, locale: getLanguage() }
  const leftLabel = timeLabelText(p.timeLabels.left, labelState)
  const rightLabel = timeLabelText(p.timeLabels.right, labelState)
  // The text "Ends at" below is only for a viewer who did not put the time it ends at beside the bar.
  const endsAtShown = p.timeLabels.left === 'endsAt' || p.timeLabels.right === 'endsAt'

  const iconsLeft = (
    <>
      <IconButton label={p.paused ? t('Play') : t('Pause')} onClick={p.onTogglePlay}>
        {p.paused ? <PlayIcon /> : <PauseIcon />}
      </IconButton>
      <IconButton label={t('Back 10 seconds')} onClick={() => p.onSkip(-10)}>
        <Rewind10Icon />
      </IconButton>
      <IconButton label={t('Forward 10 seconds')} onClick={() => p.onSkip(10)}>
        <Forward10Icon />
      </IconButton>
      {p.nextEpisode && (
        <IconButton label={t('Next episode: {label}', { label: p.nextEpisode.label })} onClick={p.nextEpisode.onPlay}>
          <NextEpisodeIcon />
        </IconButton>
      )}
      <div className="group/volume flex items-center">
        <IconButton label={p.muted || p.volume === 0 ? t('Unmute') : t('Mute')} onClick={p.onToggleMute}>
          {p.muted || p.volume === 0 ? <MuteIcon /> : <VolumeIcon />}
        </IconButton>
        <input
          type="range"
          aria-label={t('Volume')}
          className="music-range hidden w-0 opacity-0 transition-[width,opacity] duration-200 focus-visible:w-20 focus-visible:opacity-100 group-hover/volume:w-20 group-hover/volume:opacity-100 sm:block"
          style={{ '--pct': `${(p.muted ? 0 : p.volume) * 100}%` } as React.CSSProperties}
          min={0}
          max={1}
          step={0.05}
          value={p.muted ? 0 : p.volume}
          onChange={(e) => p.onVolume(Number(e.target.value))}
        />
      </div>
    </>
  )

  return (
    <>
      <div
        className={`absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/80 via-black/30 to-transparent pb-14 pl-[max(1rem,var(--safe-x))] pr-[max(1rem,var(--safe-x))] pt-[max(1rem,var(--safe-top))] transition-opacity duration-200 ${hidden}`}
      >
        <IconButton label={t('Back')} onClick={p.onBack}>
          <BackIcon />
        </IconButton>
        <h2 className="truncate text-base font-semibold tracking-tight text-white sm:text-lg">{p.title}</h2>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent pb-[max(0.75rem,var(--safe-bottom))] pl-[max(1rem,var(--safe-x))] pr-[max(1rem,var(--safe-x))] pt-20 transition-opacity duration-200 ${hidden}`}
      >
        <div className="flex items-center gap-3">
          <span className="min-w-12 shrink-0 text-right text-xs font-medium tabular-nums text-white/90" aria-hidden="true">
            {leftLabel}
          </span>
          <SeekBar
            className="min-w-0 flex-1"
            currentTime={p.currentTime}
            duration={p.duration}
            bufferedEnd={p.bufferedEnd}
            chapters={p.chapters}
            chapterMarks={p.chapterMarks}
            trickplay={p.trickplay}
            onSeek={p.onSeek}
            onScrubbing={p.onScrubbing}
          />
          <span className="min-w-12 shrink-0 text-xs font-medium tabular-nums text-white/60" aria-hidden="true">
            {rightLabel}
          </span>
          <span className="sr-only" aria-label={t('Playback position')}>
            {formatTime(p.currentTime)} / {formatTime(p.duration)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          {iconsLeft}
          {endsAt && !endsAtShown && <span className="ml-3 hidden text-xs text-white/60 lg:inline">{t('Ends at {time}', { time: endsAt })}</span>}

          <div className="ml-auto flex items-center gap-0.5">
            {p.speed !== 1 && <span className="mr-1 rounded-full bg-white/12 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">{p.speed}×</span>}
            {p.episodes && <EpisodesMenu control={p.episodes} iconButton={iconButton} onOpenChange={p.onMenuOpenChange} />}
            <PlayOnButton current up className={iconButton} onOpenChange={p.onMenuOpenChange} />
            <SettingsMenu {...p} iconButton={iconButton} />
            {p.pictureInPicture && (
              <IconButton
                label={p.pictureInPicture.active ? t('Leave picture-in-picture') : t('Picture-in-picture')}
                onClick={p.pictureInPicture.onToggle}
                pressed={p.pictureInPicture.active}
              >
                <PictureInPictureIcon />
              </IconButton>
            )}
            <IconButton
              label={p.fullscreen ? t('Exit fullscreen') : t('Fullscreen')}
              onClick={p.onToggleFullscreen}
              pressed={p.fullscreen}
            >
              {p.fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </IconButton>
          </div>
        </div>
      </div>
    </>
  )
}

/** How wide the picture above the timeline is drawn, in pixels. */
const PREVIEW_WIDTH = 176
const previewWidth = (trickplay?: TrickplayPreview | null) => (trickplay ? PREVIEW_WIDTH : 0)

/** The picture of a moment, cut out of its sheet (or an empty frame of the same size while the sheet loads). */
function TrickplayThumb({ trickplay, seconds }: { trickplay?: TrickplayPreview | null; seconds: number }) {
  if (!trickplay) return null
  const { info } = trickplay
  const scale = PREVIEW_WIDTH / info.width
  const tile = trickplay.at(seconds)
  return (
    <span
      data-testid="trickplay-thumb"
      className="block overflow-hidden rounded-lg border border-white/20 bg-black/80 shadow-lg"
      style={{
        width: PREVIEW_WIDTH,
        height: info.height * scale,
        ...(tile
          ? {
              backgroundImage: `url(${tile.url})`,
              backgroundSize: `${info.tileWidth * info.width * scale}px ${info.tileHeight * info.height * scale}px`,
              backgroundPosition: `-${tile.column * info.width * scale}px -${tile.row * info.height * scale}px`,
            }
          : {}),
      }}
    />
  )
}

function SeekBar({
  className = '',
  currentTime,
  duration,
  bufferedEnd,
  chapters,
  chapterMarks,
  trickplay,
  onSeek,
  onScrubbing,
}: {
  className?: string
  currentTime: number
  duration: number
  bufferedEnd: number
  chapters: Chapter[]
  chapterMarks: boolean
  trickplay?: TrickplayPreview | null
  onSeek: (seconds: number) => void
  onScrubbing?: (scrubbing: boolean) => void
}) {
  const [scrub, setScrub] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; seconds: number } | null>(null)
  const [barWidth, setBarWidth] = useState(0)
  const enabled = duration > 0
  const value = scrub ?? currentTime
  const pct = enabled ? Math.min(100, (value / duration) * 100) : 0
  const bufferedPct = enabled ? Math.min(100, (bufferedEnd / duration) * 100) : 0

  const commit = () => {
    if (scrub !== null) {
      onSeek(scrub)
      setScrub(null)
      onScrubbing?.(false)
    }
  }

  return (
    <div
      className={`group relative h-6 ${className}`}
      onPointerMove={(e) => {
        if (!enabled) return
        const rect = e.currentTarget.getBoundingClientRect()
        setBarWidth(rect.width)
        const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        setHover({ x: e.clientX - rect.left, seconds: fraction * duration })
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/25 transition-all duration-150 group-hover:h-[5px] group-focus-within:h-[5px]">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufferedPct}%` }} />
        {duration > 0 &&
          chapterMarks &&
          chapters
            .filter((c) => c.startSeconds > 0 && c.startSeconds < duration)
            .map((c) => (
              <span
                key={c.startSeconds}
                aria-hidden="true"
                className="absolute inset-y-0 z-[1] w-[3px] -translate-x-1/2 bg-black/80"
                style={{ left: `${(c.startSeconds / duration) * 100}%` }}
              />
            ))}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-white shadow-[0_1px_6px_rgba(0,0,0,0.6)] transition-transform duration-150 group-hover:scale-100 group-focus-within:scale-100"
        style={{ left: `${pct}%` }}
      />
      {hover && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full mb-1.5 flex -translate-x-1/2 flex-col items-center gap-1"
          style={{ left: Math.min(Math.max(hover.x, previewWidth(trickplay) / 2 + 4), Math.max(0, barWidth - previewWidth(trickplay) / 2 - 4)) }}
        >
          <TrickplayThumb trickplay={trickplay} seconds={hover.seconds} />
          <span className="rounded-md bg-black/80 px-2 py-0.5 text-xs font-medium tabular-nums text-white">
            {formatTime(hover.seconds)}
            {chapterAt(chapters, hover.seconds) && chapters.length > 0 ? ` · ${chapterAt(chapters, hover.seconds)?.name}` : ''}
          </span>
        </div>
      )}
      <input
        type="range"
        aria-label={t('Seek')}
        aria-valuetext={t('{time} of {total}', { time: formatTime(value), total: formatTime(duration) })}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        min={0}
        max={enabled ? duration : 0}
        step={1}
        value={Math.min(value, enabled ? duration : 0)}
        disabled={!enabled}
        onChange={(e) => {
          if (scrub === null) onScrubbing?.(true)
          setScrub(Number(e.target.value))
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  )
}
