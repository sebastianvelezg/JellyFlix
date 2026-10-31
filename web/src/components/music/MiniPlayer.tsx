import { useEffect, useState } from 'react'
import { coverUrl, currentTrack, upcoming, type Session } from '../../core'
import { CloseIcon, LyricsIcon, QueueIcon, VisualizerIcon } from '../icons'
import { Img } from '../Img'
import { Seeker, Transport, VolumeControl } from './controls'
import { useMusic, useMusicState } from './MusicProvider'
import { Subtext } from '../Subtext'
import { Cover } from './parts'
import { lockPageScroll } from '../../platform/web/scrollLock'
import { PlayOnButton } from '../remote/PlayOnButton'
import { LyricsPanel } from './Lyrics'
import { Visualizer } from './Visualizer'
import { readPlayerPrefs } from '../../platform/web/prefs'
import { useAppearance } from '../../platform/web/appearance'
import { useCoverPalette } from '../../platform/web/coverPalette'
import type { CoverPalette } from '../../theme/coverColors'
import { themeVariables, type ThemeChoice } from '../../theme/themes'
import { getLanguage, t } from '../../i18n'

/**
 * The bar at the bottom of every page while there is music queued: what is playing, the transport
 * controls, volume, and a way into the full-screen player. It stays when you move between pages.
 */
export function MiniPlayer({
  session,
  onOpenAlbum,
  onOpenArtist,
  hidden = false,
}: {
  session: Session
  onOpenAlbum: (albumId: string) => void
  onOpenArtist: (artistId: string) => void
  /** A video is playing in the bar at the bottom of the page: it has that place, and the music (paused) waits behind it. */
  hidden?: boolean
}) {
  const music = useMusic()
  const { queue, error, status } = useMusicState()
  const [open, setOpen] = useState(false)
  // What the full-screen player shows: the player alone, the player with the queue beside it (the queue alone on a narrow screen), or the words.
  const [panel, setPanel] = useState<Panel>('player')
  // Whether the queue was shown on a wide screen the last time, so that hiding it is remembered while the app is open.
  const [wideQueue, setWideQueue] = useState(true)
  const track = queue ? currentTrack(queue) : undefined
  // The full-screen player is only there while there is a song. If the music goes away while it is open (another device took it over,
  // the queue was emptied), it closes with it instead of staying "open" and holding the page still.
  if (open && !track) setOpen(false)
  const fullScreen = open && !!track

  // The full-screen player closes with Escape, and the page behind it stops scrolling.
  useEffect(() => {
    if (!fullScreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const release = lockPageScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [fullScreen])

  if (!queue || !track || hidden) return null

  const openArtist = (id: string) => {
    setOpen(false)
    onOpenArtist(id)
  }
  const openAlbum = (id: string) => {
    setOpen(false)
    onOpenAlbum(id)
  }
  // Where "back from the words" goes, and what a plain open shows: the queue beside the player on a wide screen, unless it was hidden.
  const home: Panel = isWide() && wideQueue ? 'queue' : 'player'
  const changePanel = (next: Panel) => {
    setPanel(next)
    if (next !== 'lyrics' && isWide()) setWideQueue(next === 'queue')
  }

  return (
    <>
      <section
        aria-label={t('Music player')}
        className="fixed inset-x-0 bottom-[var(--nav-h)] z-40 border-t border-white/[.08] bg-[var(--color-surface)]/90 shadow-[0_-14px_36px_-14px_rgba(0,0,0,0.75)] backdrop-blur-2xl pb-[var(--bottom-inset)]"
      >
        <div className="gutter-x flex items-center gap-3 py-2.5 sm:gap-6">
          <button
            type="button"
            onClick={() => {
              setPanel(home)
              setOpen(true)
            }}
            aria-label={t('Open the full-screen player: {title} by {artist}', {
              title: track.name,
              artist: track.artist,
            })}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] sm:w-1/4 sm:flex-none"
          >
            <Cover session={session} item={track} width={96} className="w-12 shrink-0 !rounded-lg" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-white">{track.name}</span>
              <Subtext
                className={`block truncate text-xs ${status === 'error' ? 'text-red-300' : 'text-neutral-400'}`}
                text={status === 'error' && error ? t(error) : status === 'loading' ? t('Loading…') : track.artist}
              />
            </span>
          </button>
          {/* What the second line says is drawn, not text, so say it to screen readers here. */}
          <p role="status" className="sr-only">
            {status === 'error' && error ? t(error) : status === 'loading' ? t('Loading…') : ''}
          </p>

          <div className="flex shrink-0 flex-col items-center gap-0.5 sm:flex-1">
            <Transport />
            <Seeker className="hidden w-full max-w-xl sm:flex" />
          </div>

          <div className="hidden w-1/4 items-center justify-end gap-1 sm:flex">
            <VolumeControl className="hidden lg:flex" />
            <PlayOnButton
              current
              up
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-300 transition hover:bg-white/10 hover:text-white pointer-coarse:h-11 pointer-coarse:w-11"
            />
            <button
              type="button"
              aria-label={t('Queue')}
              title={t('Queue')}
              onClick={() => {
                setPanel('queue')
                setOpen(true)
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-300 transition hover:bg-white/10 hover:text-white pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <QueueIcon />
            </button>
            <button
              type="button"
              aria-label={t('Lyrics')}
              title={t('Lyrics')}
              onClick={() => {
                setPanel('lyrics')
                setOpen(true)
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-300 transition hover:bg-white/10 hover:text-white pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <LyricsIcon />
            </button>
            <button
              type="button"
              aria-label={t('Close the music player')}
              title={t('Close')}
              onClick={() => music.clear()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        {/* On a phone the timeline is a thin line along the top of the bar. */}
        <Seeker showTimes={false} className="absolute inset-x-0 -top-2.5 h-5 sm:hidden" />
      </section>

      {open && (
        <NowPlaying
          session={session}
          panel={panel}
          onPanel={changePanel}
          backTo={home}
          onClose={() => setOpen(false)}
          onOpenAlbum={openAlbum}
          onOpenArtist={openArtist}
        />
      )}
    </>
  )
}

type Panel = 'player' | 'queue' | 'lyrics'

/** The accent colours of the page, made from the cover's main colour (readable on the chosen canvas like any accent), for one screen. */
function coverTheme(canvas: string, palette: CoverPalette): React.CSSProperties {
  const vars = themeVariables({ canvas: canvas as ThemeChoice['canvas'], accent: palette.primary })
  const accent: Record<string, string> = { '--glow': 'color-mix(in srgb, var(--color-accent-strong) 30%, transparent)' }
  for (const name of ACCENT_VARIABLES) accent[name] = vars[name] as string
  return accent as React.CSSProperties
}

const ACCENT_VARIABLES = [
  '--color-accent',
  '--color-accent-strong',
  '--color-accent-deep',
  '--color-accent-top',
  '--color-accent-top-hover',
  '--color-accent-deep-hover',
  '--color-accent-ink',
  '--color-cyan',
]

/** The wide layout (queue beside the player) starts here, as in the stylesheet's `lg`. */
function isWide(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches === true
}

const TOOL =
  'inline-flex shrink-0 h-10 w-10 items-center justify-center rounded-full text-neutral-300 transition hover:bg-white/10 hover:text-white aria-pressed:bg-white/15 aria-pressed:text-white pointer-coarse:h-11 pointer-coarse:w-11'

function NowPlaying({
  session,
  panel,
  onPanel,
  backTo,
  onClose,
  onOpenAlbum,
  onOpenArtist,
}: {
  session: Session
  panel: Panel
  onPanel: (panel: Panel) => void
  /** What the words give way to when they are put away. */
  backTo: Panel
  onClose: () => void
  onOpenAlbum: (albumId: string) => void
  onOpenArtist: (artistId: string) => void
}) {
  const music = useMusic()
  const { queue, error } = useMusicState()
  // Bars that move with the sound, over the cover (remembered on this device).
  const [visual, setVisual] = useState(() => readPlayerPrefs().visualizer)
  useEffect(() => {
    // Opening the full-screen player with the bars on makes sure the sound is being read.
    if (visual) void music.setVisualizer(true)
  }, [music, visual])
  // The colours of the cover of the song: they tint the blur behind it, the bars, the glow and the accent of this screen, so each song
  // has its own look (a cover with no colour of its own, or one the page cannot read, keeps the accent chosen in Appearance).
  const coverSrc = queue ? coverUrl(session.serverUrl, currentTrack(queue) ?? { id: '' }, 300) : null
  const palette = useCoverPalette(coverSrc)
  const { theme } = useAppearance()
  if (!queue) return null
  const track = currentTrack(queue)
  if (!track) return null
  const next = upcoming(queue)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('Now playing')}
      data-cover-colors={palette ? `${palette.primary} ${palette.secondary}` : undefined}
      style={palette ? coverTheme(theme.canvas, palette) : undefined}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--color-bg)]"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40 blur-3xl">
        <Img session={session} src={coverSrc} className="h-full w-full scale-125 object-cover" fallback={null} />
      </div>
      {/* Two soft pools of the cover's colours, which fade into the ones of the next song. */}
      <div aria-hidden="true" data-testid="cover-glow" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -left-[15%] -top-[20%] h-[75%] w-[65%] rounded-full blur-[120px] transition-[background-color,opacity] duration-1000"
          style={{ backgroundColor: palette?.primary, opacity: palette ? 0.5 : 0 }}
        />
        <div
          className="absolute -bottom-[25%] -right-[15%] h-[75%] w-[65%] rounded-full blur-[120px] transition-[background-color,opacity] duration-1000"
          style={{ backgroundColor: palette?.secondary, opacity: palette ? 0.38 : 0 }}
        />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--color-bg)]/30 via-[var(--color-bg)]/55 to-[var(--color-bg)]"
      />

      <header className="gutter-x relative flex items-center justify-between pb-4 pt-[calc(1rem+var(--safe-top))]">
        <button type="button" onClick={onClose} className="btn" aria-label={t('Close the full-screen player')}>
          {t('Close')}
        </button>
      </header>

      {panel === 'lyrics' ? (
        <>
          <section aria-label={t('Lyrics')} className="relative flex min-h-0 flex-1 flex-col">
            <LyricsPanel key={track.id} session={session} trackId={track.id} large />
          </section>
          {/* The song under its words: what is playing and the controls, with the same tools as the bar of every other page. */}
          <footer className="gutter-x relative pb-[calc(1rem+var(--safe-bottom))] pt-2">
            <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 lg:flex-row lg:gap-6">
              <div className="flex w-full min-w-0 items-center gap-3 lg:w-1/4">
                <Cover session={session} item={track} width={96} className="w-12 shrink-0 !rounded-lg" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">{track.name}</span>
                  <Subtext className="block truncate text-xs text-neutral-400" text={track.artist} />
                </span>
              </div>
              <div className="flex w-full flex-1 flex-col items-center gap-1">
                <Transport />
                <Seeker className="w-full max-w-xl" />
              </div>
              <div className="flex w-full items-center justify-center gap-1 lg:w-1/3 lg:justify-end">
                <Tools panel={panel} onPanel={onPanel} backTo={backTo} />
              </div>
            </div>
          </footer>
        </>
      ) : (
        <>
          <div
            className={`gutter-x relative grid min-h-0 flex-1 gap-8 pb-4 ${panel === 'queue' ? 'lg:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}
          >
            <section
              className={`${panel === 'queue' ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col items-center justify-center gap-6 short:flex-row short:gap-10`}
            >
              <div className="relative w-full max-w-[min(26rem,55vh)] short:w-[min(15rem,62vh)] short:shrink-0">
                <Cover
                  session={session}
                  item={track}
                  width={600}
                  eager
                  className={`w-full shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] transition-opacity duration-300 ${visual ? 'opacity-35' : ''}`}
                />
                {visual && <Visualizer colors={palette} className="absolute inset-0 h-full w-full p-4" />}
              </div>
              <div className="flex w-full max-w-md flex-col items-center gap-6 short:gap-3">
                <div className="w-full text-center">
                  <h2 className="truncate text-2xl font-bold tracking-tight text-white">{track.name}</h2>
                  <p className="mt-1 truncate text-neutral-300">
                    {track.artistId ? (
                      <button
                        type="button"
                        className="hover:text-white hover:underline"
                        onClick={() => onOpenArtist(track.artistId as string)}
                      >
                        {track.artist}
                      </button>
                    ) : (
                      track.artist
                    )}
                    {track.album && (
                      <>
                        {' · '}
                        {track.albumId ? (
                          <button
                            type="button"
                            className="hover:text-white hover:underline"
                            onClick={() => onOpenAlbum(track.albumId as string)}
                          >
                            {track.album}
                          </button>
                        ) : (
                          track.album
                        )}
                      </>
                    )}
                  </p>
                  {error && (
                    <p role="alert" className="mt-2 text-sm text-red-300">
                      {t(error)}
                    </p>
                  )}
                </div>
                <Seeker className="w-full" />
                <Transport size="large" />
                <VolumeControl className="lg:hidden" />
              </div>
            </section>

            {panel === 'queue' && (
              <aside aria-label={t('Queue')} className="flex min-h-0 flex-col">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="px-1 text-sm font-semibold text-white">{t('Up next')}</h3>
                  <button type="button" className="btn-ghost" onClick={() => music.clear()}>
                    {t('Clear queue')}
                  </button>
                </div>
                {next.length === 0 ? (
                  <p className="text-sm text-neutral-400">
                    {queue.repeat === 'off'
                      ? t('Nothing after this song. Add songs from any album or playlist.')
                      : t('Nothing after this song.')}
                  </p>
                ) : (
                  <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                    {next.map((item, i) => {
                      const index = queue.index + 1 + i
                      return (
                        <li
                          key={item.key}
                          className="group flex items-center gap-2 rounded-xl p-1.5 hover:bg-white/[.06]"
                        >
                          <button
                            type="button"
                            onClick={() => music.jumpTo(index)}
                            aria-label={t('Play {title} by {artist}', {
                              title: item.track.name,
                              artist: item.track.artist,
                            })}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                          >
                            <Cover
                              session={session}
                              item={item.track}
                              width={96}
                              className="w-10 shrink-0 !rounded-lg"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-neutral-100">{item.track.name}</span>
                              <Subtext className="block truncate text-xs text-neutral-500" text={item.track.artist} />
                            </span>
                          </button>
                          <span className="flex items-center sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                            <button
                              type="button"
                              disabled={i === 0}
                              onClick={() => music.move(index, index - 1)}
                              aria-label={t('Move {row} up', {
                                row: item.track.name,
                              })}
                              title={t('Move up')}
                              className="rounded-full p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="16"
                                height="16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                                focusable="false"
                              >
                                <path d="m6 15 6-6 6 6" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              disabled={i === next.length - 1}
                              onClick={() => music.move(index, index + 1)}
                              aria-label={t('Move {row} down', {
                                row: item.track.name,
                              })}
                              title={t('Move down')}
                              className="rounded-full p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="16"
                                height="16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                                focusable="false"
                              >
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </button>
                          </span>
                          <button
                            type="button"
                            onClick={() => music.remove(index)}
                            aria-label={t('Remove {title} from the queue', {
                              title: item.track.name,
                            })}
                            title={t('Remove')}
                            className="rounded-full p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                          >
                            <CloseIcon />
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </aside>
            )}
          </div>
          <footer className="gutter-x relative flex items-center justify-end gap-1 pb-[calc(1rem+var(--safe-bottom))] pt-1">
            <Tools
              panel={panel}
              onPanel={onPanel}
              backTo={backTo}
              visualizer={{
                on: visual,
                toggle: () => {
                  const on = !visual
                  setVisual(on)
                  void music.setVisualizer(on)
                },
              }}
            />
          </footer>
        </>
      )}
    </div>
  )
}

/** Sleep timer, "Play on…", the words and the queue: along the bottom of the full-screen player, like the bar of the other pages. */
function Tools({
  panel,
  onPanel,
  backTo,
  visualizer,
}: {
  panel: Panel
  onPanel: (panel: Panel) => void
  backTo: Panel
  /** The bars over the cover (offered where the cover is). */
  visualizer?: { on: boolean; toggle: () => void }
}) {
  return (
    <>
      <SleepTimer />
      <PlayOnButton current up className={TOOL} />
      {visualizer && (
        <button type="button" className={TOOL} aria-label={t('Visualizer')} title={t('Visualizer')} aria-pressed={visualizer.on} onClick={visualizer.toggle}>
          <VisualizerIcon />
        </button>
      )}
      <button
        type="button"
        className={TOOL}
        aria-label={t('Lyrics')}
        title={t('Lyrics')}
        aria-pressed={panel === 'lyrics'}
        onClick={() => onPanel(panel === 'lyrics' ? backTo : 'lyrics')}
      >
        <LyricsIcon />
      </button>
      <button
        type="button"
        className={TOOL}
        aria-label={t('Queue')}
        title={t('Queue')}
        aria-pressed={panel === 'queue'}
        onClick={() => onPanel(panel === 'queue' ? 'player' : 'queue')}
      >
        <QueueIcon />
      </button>
    </>
  )
}

const SLEEP_MINUTES = [15, 30, 45, 60] as const

/** "Sleep timer": pauses the music after a while, or when the song that is playing ends. */
function SleepTimer() {
  const music = useMusic()
  const { sleep } = useMusicState()
  const value = sleep === null ? 'off' : sleep.kind === 'track' ? 'track' : 'active'
  const pausesAt =
    sleep?.kind === 'minutes'
      ? new Date(sleep.endsAt).toLocaleTimeString(getLanguage(), {
          hour: 'numeric',
          minute: '2-digit',
        })
      : ''
  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-300">
      <span className="sr-only">{t('Sleep timer')}</span>
      <select
        className="select max-w-[6.5rem] sm:max-w-none"
        aria-label={t('Sleep timer')}
        value={value}
        onChange={(e) => {
          const choice = e.target.value
          if (choice === 'off') music.cancelSleep()
          else if (choice === 'track') music.sleepAfterTrack()
          else if (choice !== 'active') music.sleepIn(Number(choice))
        }}
      >
        <option value="off">{t('Sleep timer: off')}</option>
        {SLEEP_MINUTES.map((m) => (
          <option key={m} value={m}>
            {t('Pause in {minutes} min', { minutes: m })}
          </option>
        ))}
        <option value="track">{t('Pause after this song')}</option>
        {value === 'active' && (
          <option value="active" disabled>
            {t('Pausing at {time}', { time: pausesAt })}
          </option>
        )}
      </select>
    </label>
  )
}
