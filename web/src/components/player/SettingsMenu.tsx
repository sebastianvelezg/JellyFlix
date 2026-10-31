import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  chapterAt,
  formatTime,
  stepOffset,
  SUBTITLE_FILE_EXTENSIONS,
  SYNC_STEP,
  SYNC_STEP_LARGE,
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
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, SettingsIcon } from '../icons'
import { t, tr } from '../../i18n'
import { offsetLabel } from '../offsetLabel'
import type { ControlsProps } from './Controls'

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const SUBTITLE_SIZES: Array<[SubtitleSize, string]> = [
  ['small', tr('Small')],
  ['medium', tr('Medium')],
  ['large', tr('Large')],
]

const COLOR_LABELS: Record<SubtitleColor, string> = { white: tr('White'), yellow: tr('Yellow'), cyan: tr('Cyan') }
const BACKGROUND_LABELS: Record<SubtitleBackground, string> = { shadow: tr('Shadow'), box: tr('Dark box'), none: tr('None') }
const POSITION_LABELS: Record<SubtitlePosition, string> = { low: tr('Low'), high: tr('Higher') }

/** The menu opens on its list; each row opens one page of choices, with a way back at the top. */
type View = 'main' | 'audio' | 'subtitles' | 'second' | 'look' | 'quality' | 'speed' | 'chapters'

const ROW =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-neutral-100 transition-colors duration-150 hover:bg-white/[.08] focus-visible:bg-white/[.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)] pointer-coarse:py-3.5'
const LEGEND = 'sr-only'

/** A row of the list: what it is, what it is set to now, and an arrow to its page. */
function NavRow({ label, value, onClick, rowId }: { label: string; value?: string; onClick: () => void; rowId: View }) {
  return (
    <button type="button" className={ROW} data-row={rowId} onClick={onClick}>
      <span className="shrink-0">{label}</span>
      <span className="ml-auto min-w-0 truncate text-neutral-400">{value}</span>
      <span className="shrink-0 text-neutral-500">
        <ChevronRightIcon />
      </span>
    </button>
  )
}

/** One choice of a page. A radio button underneath, so the keyboard and screen readers work as usual. */
function Option({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`${ROW} relative cursor-pointer has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-[var(--color-accent)]`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      <span className="min-w-0 flex-1 break-words peer-checked:font-medium">{label}</span>
      <span className={`shrink-0 text-[var(--color-accent)] ${checked ? '' : 'invisible'}`}>
        <CheckIcon />
      </span>
    </label>
  )
}

/** An on/off setting: a switch you can also reach with the keyboard (a checkbox underneath). */
function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`${ROW} relative cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-[var(--color-accent)]`}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      <span className="min-w-0 flex-1">{label}</span>
      <span
        aria-hidden="true"
        className="relative h-5 w-9 shrink-0 rounded-full bg-white/20 transition-colors duration-200 peer-checked:bg-[var(--color-accent-strong)] after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-200 peer-checked:after:translate-x-4"
      />
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
    <fieldset className="px-3 py-2">
      <legend className="sr-only">{label}</legend>
      <span aria-hidden="true" className="mb-1.5 block text-xs font-medium text-neutral-400">
        {label}
      </span>
      <div
        className={columns ? 'grid gap-1' : 'flex gap-0.5 rounded-full bg-white/[.07] p-0.5'}
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
              className={`pointer-events-none block whitespace-nowrap rounded-full px-2 py-1.5 text-center text-xs font-medium text-neutral-300 transition-colors duration-150 hover:text-white peer-checked:bg-white peer-checked:text-black peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent)] pointer-coarse:py-2.5 ${columns ? 'bg-white/[.07]' : ''}`}
            >
              {t(text)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** The button with the cog, and the menu it opens: audio, subtitles, quality, speed and the few switches, one page at a time. */
export function SettingsMenu(p: ControlsProps & { iconButton: string }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('main')
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // The row the page was opened from, so that going back puts the focus where it was.
  const lastRow = useRef<View>('main')

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

  // Moving to another page moves the focus with it: to the way back on a page, to the row that was opened on the list.
  useEffect(() => {
    if (!open || !menu.current) return
    const target =
      view === 'main'
        ? menu.current.querySelector<HTMLElement>(`[data-row="${lastRow.current}"]`)
        : menu.current.querySelector<HTMLElement>('[data-back]')
    target?.focus({ preventScroll: true })
  }, [view, open])

  const go = (next: View) => {
    if (next !== 'main') lastRow.current = next
    setView(next)
  }
  const toggle = () => {
    setView('main')
    lastRow.current = 'main'
    setOpen((v) => !v)
  }

  const hasAudio = p.audioTracks.length > 1
  // The sync controls matter once there are words on screen.
  const showingSubtitles = p.subtitleIndex !== null || !!p.localSubtitle
  const audioNow = p.audioTracks.find((track) => track.index === p.audioIndex)?.label
  const subtitleNow = p.localSubtitle
    ? p.localSubtitle
    : p.subtitleIndex !== null
      ? p.subtitleTracks.find((track) => track.index === p.subtitleIndex)?.label
      : t('Off')
  // A second line of subtitles goes under a first one that is a track of the file (not a file loaded from the device).
  const canSecond = !!p.onSecondSubtitle && p.subtitleIndex !== null && !p.localSubtitle && p.subtitleTracks.length > 1
  const secondNow = p.secondSubtitleIndex != null ? p.subtitleTracks.find((track) => track.index === p.secondSubtitleIndex)?.label : t('Off')
  const qualityNow = p.quality === 0 ? t('Original quality') : t('Up to {mbps} Mbps', { mbps: p.quality })
  const speedNow = p.speed === 1 ? t('Normal') : `${p.speed}×`
  const lookNow = `${t(SUBTITLE_SIZES.find(([size]) => size === p.subtitleStyle.size)?.[1] ?? '')} · ${t(COLOR_LABELS[p.subtitleStyle.color])}`
  const chapter = chapterAt(p.chapters, p.currentTime)

  const page = (title: string, body: ReactNode) => (
    <>
      <div className="mb-1 flex items-center gap-1 border-b border-white/10 px-1 pb-2">
        <button
          type="button"
          data-back
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          aria-label={t('Back to settings')}
          title={t('Back to settings')}
          onClick={() => go('main')}
        >
          <ChevronLeftIcon />
        </button>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {body}
    </>
  )

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={p.iconButton}
        aria-label={t('Audio, subtitles and speed')}
        title={t('Audio, subtitles and speed')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className={`transition-transform duration-300 ${open ? 'rotate-45' : ''}`}>
          <SettingsIcon />
        </span>
        {p.subtitleIndex !== null && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          ref={menu}
          role="dialog"
          aria-label={t('Playback settings')}
          className="absolute bottom-14 right-0 max-h-[min(34rem,70vh)] w-[19.5rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-[var(--color-surface)]/95 p-1.5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        >
          {view === 'main' && (
            <>
              {hasAudio && <NavRow rowId="audio" label={t('Audio')} value={audioNow} onClick={() => go('audio')} />}
              <NavRow rowId="subtitles" label={t('Subtitles')} value={subtitleNow} onClick={() => go('subtitles')} />
              {canSecond && <NavRow rowId="second" label={t('Second subtitle')} value={secondNow} onClick={() => go('second')} />}
              <NavRow rowId="quality" label={t('Quality')} value={qualityNow} onClick={() => go('quality')} />
              <NavRow rowId="speed" label={t('Speed')} value={speedNow} onClick={() => go('speed')} />
              <NavRow rowId="look" label={t('Subtitle look')} value={lookNow} onClick={() => go('look')} />
              {p.chapters.length > 0 && <NavRow rowId="chapters" label={t('Chapters')} value={chapter?.name} onClick={() => go('chapters')} />}
              {(p.repeatQueue || p.cinemaMode || p.autoplayNext) && (
                <div className="mt-1.5 border-t border-white/10 pt-1.5">
                  {p.autoplayNext && <Switch label={t('Play the next episode automatically')} checked={p.autoplayNext.enabled} onChange={p.autoplayNext.onChange} />}
                  {p.repeatQueue && <Switch label={t('Repeat the list')} checked={p.repeatQueue.enabled} onChange={p.repeatQueue.onChange} />}
                  {p.cinemaMode && <Switch label={t('Cinema mode')} checked={p.cinemaMode.enabled} onChange={p.cinemaMode.onChange} />}
                </div>
              )}
            </>
          )}

          {view === 'audio' &&
            page(
              t('Audio'),
              <fieldset>
                <legend className={LEGEND}>{t('Audio')}</legend>
                {p.audioTracks.map((track) => (
                  <Option key={track.index} name="audio" label={track.label} checked={track.index === p.audioIndex} onChange={() => p.onAudio(track.index)} />
                ))}
              </fieldset>,
            )}

          {view === 'quality' &&
            page(
              t('Quality'),
              <fieldset>
                <legend className={LEGEND}>{t('Quality')}</legend>
                {QUALITY_CHOICES.map((mbps) => (
                  <Option
                    key={mbps}
                    name="quality"
                    label={mbps === 0 ? t('Original quality') : t('Up to {mbps} Mbps', { mbps })}
                    checked={mbps === p.quality}
                    onChange={() => p.onQuality(mbps)}
                  />
                ))}
                <p role="status" aria-label={t('How this is playing')} className="mt-1 border-t border-white/10 px-3 pb-1.5 pt-2.5 text-xs leading-relaxed text-neutral-400">
                  {p.playback.method === 'direct' ? t('Playing the file as it is: nothing is converted.') : t('The server is converting this video.')}
                  {p.playback.reasons.map((reason) => (
                    <span key={reason} className="block text-neutral-500">
                      · {t(reason)}
                    </span>
                  ))}
                </p>
              </fieldset>,
            )}

          {view === 'second' &&
            page(
              t('Second subtitle'),
              <fieldset>
                <legend className={LEGEND}>{t('Second subtitle')}</legend>
                <Option name="second-subtitle" label={t('Off')} checked={p.secondSubtitleIndex == null} onChange={() => p.onSecondSubtitle?.(null)} />
                {p.subtitleTracks
                  .filter((track) => track.index !== p.subtitleIndex)
                  .map((track) => (
                    <Option key={track.index} name="second-subtitle" label={track.label} checked={track.index === p.secondSubtitleIndex} onChange={() => p.onSecondSubtitle?.(track.index)} />
                  ))}
                <p className="mt-1 border-t border-white/10 px-3 pb-1.5 pt-2.5 text-xs leading-relaxed text-neutral-400">
                  {t('Shown above the first one, a little smaller and in another colour.')}
                </p>
              </fieldset>,
            )}

          {view === 'subtitles' &&
            page(
              t('Subtitles'),
              <>
                <fieldset>
                  <legend className={LEGEND}>{t('Subtitles')}</legend>
                  <Option name="subtitles" label={t('Off')} checked={p.subtitleIndex === null && !p.localSubtitle} onChange={() => p.onSubtitle(null)} />
                  {p.subtitleTracks.map((track) => (
                    <Option key={track.index} name="subtitles" label={track.label} checked={!p.localSubtitle && track.index === p.subtitleIndex} onChange={() => p.onSubtitle(track.index)} />
                  ))}
                  {p.localSubtitle && <Option name="subtitles" label={t('File: {localSubtitle}', { localSubtitle: p.localSubtitle })} checked onChange={() => undefined} />}
                </fieldset>
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
                <div className="mt-1 border-t border-white/10 pt-1">
                  <button type="button" className={`${ROW} text-[var(--color-accent)]`} onClick={() => fileInput.current?.click()}>
                    {t('Load a subtitle file (.srt, .vtt)…')}
                  </button>
                  {p.onFindSubtitles && (
                    <button
                      type="button"
                      className={`${ROW} text-[var(--color-accent)]`}
                      onClick={() => {
                        setOpen(false)
                        p.onFindSubtitles?.()
                      }}
                    >
                      {t('Search online…')}
                    </button>
                  )}
                </div>
                {p.subtitleStatus !== 'idle' && (
                  <p role="status" className="px-3 pt-1 text-xs text-neutral-400">
                    {p.subtitleStatus === 'loading' ? t('Loading subtitles…') : t('Could not load these subtitles.')}
                  </p>
                )}
                {p.subtitleFileError && (
                  <p role="alert" className="px-3 pt-1 text-xs text-red-300">
                    {p.subtitleFileError}
                  </p>
                )}
                {showingSubtitles && (
                  <fieldset className="mt-1 border-t border-white/10 px-3 pb-1.5 pt-3">
                    <legend className="sr-only">{t('Subtitle sync')}</legend>
                    <p aria-hidden="true" className="mb-1 text-xs font-medium text-neutral-400">
                      {t('Subtitle sync')}
                    </p>
                    <div className="flex items-center gap-1">
                      {[-SYNC_STEP_LARGE, -SYNC_STEP].map((step) => (
                        <button key={step} type="button" className="btn flex-1 px-2 py-1.5" aria-label={t('Show subtitles {seconds} seconds earlier', { seconds: Math.abs(step) })} onClick={() => p.onSubtitleOffset(stepOffset(p.subtitleOffset, step))}>
                          −{Math.abs(step)}
                        </button>
                      ))}
                      <output aria-label={t('Subtitle sync')} className="min-w-14 px-1 text-center text-xs tabular-nums text-neutral-100">
                        {p.subtitleOffset === 0 ? '0.0 s' : `${p.subtitleOffset > 0 ? '+' : '−'}${Math.abs(p.subtitleOffset).toFixed(1)} s`}
                      </output>
                      {[SYNC_STEP, SYNC_STEP_LARGE].map((step) => (
                        <button key={step} type="button" className="btn flex-1 px-2 py-1.5" aria-label={t('Show subtitles {step} seconds later', { step })} onClick={() => p.onSubtitleOffset(stepOffset(p.subtitleOffset, step))}>
                          +{step}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-1.5">
                      <span className="text-xs text-neutral-400">{offsetLabel(p.subtitleOffset)}</span>
                      <button type="button" className="text-xs text-[var(--color-accent)] hover:underline disabled:opacity-40 disabled:no-underline" disabled={p.subtitleOffset === 0} onClick={() => p.onSubtitleOffset(0)}>
                        {t('Reset')}
                      </button>
                    </div>
                    <p className="pt-2 text-xs text-neutral-500">{t('If the words come too early, press +; too late, press −. Keys: Z / X (Shift for bigger steps).')}</p>
                  </fieldset>
                )}
              </>,
            )}

          {view === 'look' &&
            page(
              t('Subtitle look'),
              <>
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
              </>,
            )}

          {view === 'speed' &&
            page(
              t('Speed'),
              <fieldset>
                <legend className={LEGEND}>{t('Playback speed')}</legend>
                {SPEEDS.map((v) => (
                  <Option key={v} name="speed" label={v === 1 ? t('Normal') : `${v}×`} checked={p.speed === v} onChange={() => p.onSpeed(v)} />
                ))}
              </fieldset>,
            )}

          {view === 'chapters' &&
            page(
              t('Chapters'),
              <div role="group" aria-label={t('Chapters')}>
                {p.chapters.map((c, i) => (
                  <button
                    key={`${c.startSeconds}-${i}`}
                    type="button"
                    onClick={() => p.onSeek(c.startSeconds)}
                    aria-current={chapter === c ? 'true' : undefined}
                    className={`${ROW} justify-between aria-[current=true]:bg-[var(--color-accent)]/15 aria-[current=true]:text-white`}
                  >
                    <span className="min-w-0 break-words">{c.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-neutral-400">{formatTime(c.startSeconds)}</span>
                  </button>
                ))}
              </div>,
            )}
        </div>
      )}
    </div>
  )
}
