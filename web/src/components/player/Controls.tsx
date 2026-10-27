import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  chapterAt,
  formatTime,
  stepOffset,
  SUBTITLE_FILE_EXTENSIONS,
  SYNC_STEP,
  SYNC_STEP_LARGE,
  type Chapter,
  type TrackOption,
} from '../../core'
import {
  QUALITY_CHOICES,
  SUBTITLE_BACKGROUNDS,
  SUBTITLE_COLORS,
  SUBTITLE_POSITIONS,
  type SubtitleBackground,
  type SubtitleColor,
  type SubtitlePosition,
  type SubtitleSize,
} from '../../platform/web/prefs'
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
  SettingsIcon,
  VolumeIcon,
} from '../icons'
import { getLanguage, t, tr } from '../../i18n'
import { offsetLabel } from '../offsetLabel'
import { PlayOnButton } from '../remote/PlayOnButton'

const iconButton =
  'relative inline-flex h-11 w-11 items-center justify-center rounded-full text-white transition duration-150 hover:bg-white/15 hover:text-[var(--color-accent)] active:scale-90'

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

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const SUBTITLE_SIZES: Array<[SubtitleSize, string]> = [
  ['small', tr('Small')],
  ['medium', tr('Medium')],
  ['large', tr('Large')],
]

const COLOR_LABELS: Record<SubtitleColor, string> = { white: tr('White'), yellow: tr('Yellow'), cyan: tr('Cyan') }
const BACKGROUND_LABELS: Record<SubtitleBackground, string> = { shadow: tr('Shadow'), box: tr('Dark box'), none: tr('None') }
const POSITION_LABELS: Record<SubtitlePosition, string> = { low: tr('Low'), high: tr('Higher') }

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
  /** Present when there is a next episode: adds a skip button. */
  nextEpisode?: { label: string; onPlay: () => void }
  /** Chapter markers on the timeline, and a list in the settings menu. */
  chapters: Chapter[]
  /** Small pictures of the moment you point at on the timeline, when the server has made them. */
  trickplay?: TrickplayPreview | null
  /** Present when the browser can float the video in its own window. */
  pictureInPicture?: { active: boolean; onToggle: () => void }
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

  return (
    <>
      <div
        className={`absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/85 via-black/35 to-transparent pb-12 pl-[max(1rem,var(--safe-x))] pr-[max(1rem,var(--safe-x))] pt-[max(1rem,var(--safe-top))] transition-opacity duration-200 ${hidden}`}
      >
        <IconButton label={t('Back')} onClick={p.onBack}>
          <BackIcon />
        </IconButton>
        <h2 className="truncate text-lg font-semibold tracking-tight text-white">{p.title}</h2>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 space-y-0.5 bg-gradient-to-t from-black via-black/65 to-transparent pb-[max(1rem,var(--safe-bottom))] pl-[max(1rem,var(--safe-x))] pr-[max(1rem,var(--safe-x))] pt-16 transition-opacity duration-200 ${hidden}`}
      >
        <SeekBar
          currentTime={p.currentTime}
          duration={p.duration}
          bufferedEnd={p.bufferedEnd}
          chapters={p.chapters}
          trickplay={p.trickplay}
          onSeek={p.onSeek}
        />
        <div className="flex flex-wrap items-center gap-0.5 sm:gap-1">
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
          <IconButton label={p.muted || p.volume === 0 ? t('Unmute') : t('Mute')} onClick={p.onToggleMute}>
            {p.muted || p.volume === 0 ? <MuteIcon /> : <VolumeIcon />}
          </IconButton>
          <input
            type="range"
            aria-label={t('Volume')}
            className="hidden w-24 accent-[var(--color-accent)] sm:block"
            min={0}
            max={1}
            step={0.05}
            value={p.muted ? 0 : p.volume}
            onChange={(e) => p.onVolume(Number(e.target.value))}
          />
          <span className="ml-2 text-sm font-medium tabular-nums text-neutral-100" aria-label={t('Playback position')}>
            {formatTime(p.currentTime)} / {formatTime(p.duration)}
          </span>
          {endsAt && <span className="ml-3 hidden text-sm text-neutral-400 md:inline">{t('Ends at {time}', { time: endsAt })}</span>}

          <div className="ml-auto flex items-center gap-1">
            {p.speed !== 1 && <span className="text-sm font-semibold text-[var(--color-accent)]">{p.speed}×</span>}
            <PlayOnButton current up className={iconButton} onOpenChange={p.onMenuOpenChange} />
            <SettingsMenu {...p} />
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

function Radio({
  name,
  label,
  checked,
  onChange,
}: {
  name: string
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-200 transition hover:bg-white/10 has-[:checked]:bg-[var(--color-accent)]/15 has-[:checked]:text-white">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 shrink-0 accent-[var(--color-accent)]" />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  )
}

/** A row of choices as one rounded control, with the one in use filled in. Radio buttons underneath, so the keyboard and screen readers work as usual. */
function Segmented<T extends string | number>({
  name,
  label,
  options,
  value,
  onChange,
  columns,
}: {
  name: string
  label: string
  options: Array<[T, string]>
  value: T
  onChange: (value: T) => void
  /** Lay the choices out in a grid of this many columns instead of one row. */
  columns?: number
}) {
  return (
    <fieldset className={columns ? 'px-2.5 py-1' : 'flex items-center gap-3 px-2.5 py-1'}>
      <legend className="sr-only">{label}</legend>
      <span aria-hidden="true" className={`text-xs text-neutral-400 ${columns ? 'mb-1 block' : 'w-[4.75rem] shrink-0'}`}>
        {label}
      </span>
      <div
        className={`${columns ? 'grid gap-1' : 'flex flex-1 gap-0.5 rounded-full bg-white/[.06] p-0.5'}`}
        style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      >
        {options.map(([option, text]) => (
          <label key={String(option)} className="relative min-w-0 flex-1 cursor-pointer">
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span
              className={`pointer-events-none block whitespace-nowrap rounded-full px-1.5 py-1.5 text-center text-xs font-medium text-neutral-300 transition hover:text-white peer-checked:bg-[var(--color-accent-strong)] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-white pointer-coarse:py-2.5 ${columns ? 'bg-white/[.06]' : ''}`}
            >
              {t(text)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function SettingsMenu(p: ControlsProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const { onMenuOpenChange } = p
  useEffect(() => {
    onMenuOpenChange(open)
    return () => onMenuOpenChange(false)
  }, [open, onMenuOpenChange])

  const hasAudio = p.audioTracks.length > 1
  const fileInput = useRef<HTMLInputElement>(null)
  // The sync controls matter once there are words on screen.
  const showingSubtitles = p.subtitleIndex !== null || !!p.localSubtitle

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={iconButton}
        aria-label={t('Audio, subtitles and speed')}
        title={t('Audio, subtitles and speed')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SettingsIcon />
        {p.subtitleIndex !== null && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('Playback settings')}
          className="absolute bottom-12 right-0 max-h-[70vh] w-80 max-w-[calc(100vw-1.5rem)] space-y-3 overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-black/85 p-3 shadow-[0_24px_70px_-10px_rgba(0,0,0,0.9)] backdrop-blur-2xl [&>fieldset+fieldset]:border-t [&>fieldset+fieldset]:border-white/10 [&>fieldset+fieldset]:pt-3"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        >
          {hasAudio && (
            <fieldset>
              <legend className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Audio')}</legend>
              {p.audioTracks.map((t) => (
                <Radio key={t.index} name="audio" label={t.label} checked={t.index === p.audioIndex} onChange={() => p.onAudio(t.index)} />
              ))}
            </fieldset>
          )}
          <fieldset>
            <legend className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Quality')}</legend>
            {QUALITY_CHOICES.map((mbps) => (
              <Radio
                key={mbps}
                name="quality"
                label={mbps === 0 ? t('Original quality') : t('Up to {mbps} Mbps', { mbps })}
                checked={mbps === p.quality}
                onChange={() => p.onQuality(mbps)}
              />
            ))}
            <p role="status" aria-label={t('How this is playing')} className="px-2 pt-1.5 text-xs leading-relaxed text-neutral-400">
              {p.playback.method === 'direct' ? t('Playing the file as it is: nothing is converted.') : t('The server is converting this video.')}
              {p.playback.reasons.map((reason) => (
                <span key={reason} className="block text-neutral-500">
                  · {t(reason)}
                </span>
              ))}
            </p>
          </fieldset>
          <fieldset>
            <legend className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Subtitles')}</legend>
            <Radio name="subtitles" label={t('Off')} checked={p.subtitleIndex === null && !p.localSubtitle} onChange={() => p.onSubtitle(null)} />
            {p.subtitleTracks.map((t) => (
              <Radio key={t.index} name="subtitles" label={t.label} checked={!p.localSubtitle && t.index === p.subtitleIndex} onChange={() => p.onSubtitle(t.index)} />
            ))}
            {p.localSubtitle && <Radio name="subtitles" label={t('File: {localSubtitle}', { localSubtitle: p.localSubtitle })} checked onChange={() => undefined} />}
            <input
              ref={fileInput}
              type="file"
              accept={SUBTITLE_FILE_EXTENSIONS.join(',')}
              className="sr-only"
              aria-label={t('Subtitle file')}
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) p.onSubtitleFile(file)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--color-accent)] transition hover:bg-white/10"
              onClick={() => fileInput.current?.click()}
            >
              {t('Load a subtitle file (.srt, .vtt)…')}
            </button>
            {p.onFindSubtitles && (
              <button
                type="button"
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--color-accent)] transition hover:bg-white/10"
                onClick={() => {
                  setOpen(false)
                  p.onFindSubtitles?.()
                }}
              >
                {t('Search online…')}
              </button>
            )}
            {p.subtitleStatus !== 'idle' && (
              <p role="status" className="px-2 pt-1 text-xs text-neutral-400">
                {p.subtitleStatus === 'loading' ? t('Loading subtitles…') : t('Could not load these subtitles.')}
              </p>
            )}
            {p.subtitleFileError && (
              <p role="alert" className="px-2 pt-1 text-xs text-red-300">
                {p.subtitleFileError}
              </p>
            )}
          </fieldset>
          {showingSubtitles && (
            <fieldset>
              <legend className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Subtitle sync')}</legend>
              <p className="px-2 pb-1 text-xs text-neutral-500">{t('If the words come too early, press +; too late, press −. Keys: Z / X (Shift for bigger steps).')}</p>
              <div className="flex items-center gap-1 px-1">
                {[-SYNC_STEP_LARGE, -SYNC_STEP].map((step) => (
                  <button key={step} type="button" className="btn flex-1 px-2 py-1.5" aria-label={t('Show subtitles {seconds} seconds earlier', { seconds: Math.abs(step) })} onClick={() => p.onSubtitleOffset(stepOffset(p.subtitleOffset, step))}>
                    −{Math.abs(step)}
                  </button>
                ))}
                <output aria-label={t('Subtitle sync')} className="min-w-16 px-1 text-center text-xs tabular-nums text-neutral-200">
                  {p.subtitleOffset === 0 ? '0.0 s' : `${p.subtitleOffset > 0 ? '+' : '−'}${Math.abs(p.subtitleOffset).toFixed(1)} s`}
                </output>
                {[SYNC_STEP, SYNC_STEP_LARGE].map((step) => (
                  <button key={step} type="button" className="btn flex-1 px-2 py-1.5" aria-label={t('Show subtitles {step} seconds later', { step })} onClick={() => p.onSubtitleOffset(stepOffset(p.subtitleOffset, step))}>
                    +{step}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between px-2 pt-1.5">
                <span className="text-xs text-neutral-400">{offsetLabel(p.subtitleOffset)}</span>
                <button type="button" className="text-xs text-[var(--color-accent)] hover:underline disabled:opacity-40 disabled:no-underline" disabled={p.subtitleOffset === 0} onClick={() => p.onSubtitleOffset(0)}>
                  {t('Reset')}
                </button>
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Subtitle look')}</legend>
            <Segmented name="subtitle-size" label={t('Size')} options={SUBTITLE_SIZES} value={p.subtitleStyle.size} onChange={(size) => p.onSubtitleStyle({ size })} />
            <Segmented
              name="subtitle-color"
              label={t('Color')}
              options={SUBTITLE_COLORS.map((c): [SubtitleColor, string] => [c, COLOR_LABELS[c]])}
              value={p.subtitleStyle.color}
              onChange={(color) => p.onSubtitleStyle({ color })}
            />
            <Segmented
              name="subtitle-background"
              label={t('Background')}
              options={SUBTITLE_BACKGROUNDS.map((b): [SubtitleBackground, string] => [b, BACKGROUND_LABELS[b]])}
              value={p.subtitleStyle.background}
              onChange={(background) => p.onSubtitleStyle({ background })}
            />
            <Segmented
              name="subtitle-position"
              label={t('Position')}
              options={SUBTITLE_POSITIONS.map((q): [SubtitlePosition, string] => [q, POSITION_LABELS[q]])}
              value={p.subtitleStyle.position}
              onChange={(position) => p.onSubtitleStyle({ position })}
            />
          </fieldset>
          <fieldset>
            <legend className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Speed')}</legend>
            <Segmented
              name="speed"
              label={t('Playback speed')}
              columns={3}
              options={SPEEDS.map((v): [number, string] => [v, v === 1 ? tr('Normal') : `${v}×`])}
              value={p.speed}
              onChange={p.onSpeed}
            />
          </fieldset>
          {p.chapters.length > 0 && (
            <fieldset>
              <legend className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('Chapters')}</legend>
              {p.chapters.map((c, i) => (
                <button
                  key={`${c.startSeconds}-${i}`}
                  type="button"
                  onClick={() => p.onSeek(c.startSeconds)}
                  aria-current={chapterAt(p.chapters, p.currentTime) === c ? 'true' : undefined}
                  className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm text-neutral-200 transition hover:bg-white/10 aria-[current=true]:bg-[var(--color-accent)]/15 aria-[current=true]:text-white"
                >
                  <span className="min-w-0 break-words">{c.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-neutral-500">{formatTime(c.startSeconds)}</span>
                </button>
              ))}
            </fieldset>
          )}
          {p.cinemaMode && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-200 transition hover:bg-white/10">
              <input
                type="checkbox"
                checked={p.cinemaMode.enabled}
                onChange={(e) => p.cinemaMode?.onChange(e.target.checked)}
                className="shrink-0 accent-[var(--color-accent)]"
              />
              {t('Cinema mode')}
            </label>
          )}
          {p.autoplayNext && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-200 transition hover:bg-white/10">
              <input
                type="checkbox"
                checked={p.autoplayNext.enabled}
                onChange={(e) => p.autoplayNext?.onChange(e.target.checked)}
                className="shrink-0 accent-[var(--color-accent)]"
              />
              {t('Play the next episode automatically')}
            </label>
          )}
        </div>
      )}
    </div>
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
  currentTime,
  duration,
  bufferedEnd,
  chapters,
  trickplay,
  onSeek,
}: {
  currentTime: number
  duration: number
  bufferedEnd: number
  chapters: Chapter[]
  trickplay?: TrickplayPreview | null
  onSeek: (seconds: number) => void
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
    }
  }

  return (
    <div
      className="group relative h-6"
      onPointerMove={(e) => {
        if (!enabled) return
        const rect = e.currentTarget.getBoundingClientRect()
        setBarWidth(rect.width)
        const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        setHover({ x: e.clientX - rect.left, seconds: fraction * duration })
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20 transition-all group-hover:h-1.5">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufferedPct}%` }} />
        {duration > 0 &&
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
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[var(--color-accent-strong)] to-[var(--color-accent)] shadow-[0_0_12px_var(--glow)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-white shadow-[0_0_14px_var(--glow)] ring-2 ring-[var(--color-accent)] transition group-hover:scale-100 group-focus-within:scale-100"
        style={{ left: `${pct}%` }}
      />
      {hover && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full mb-1.5 flex -translate-x-1/2 flex-col items-center gap-1"
          style={{ left: Math.min(Math.max(hover.x, previewWidth(trickplay) / 2 + 4), Math.max(0, barWidth - previewWidth(trickplay) / 2 - 4)) }}
        >
          <TrickplayThumb trickplay={trickplay} seconds={hover.seconds} />
          <span className="rounded-md border border-white/10 bg-black/85 px-2 py-0.5 text-xs font-medium tabular-nums text-white">
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
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  )
}
