import { useCallback, useEffect, useRef, useState } from 'react'
import { currentLyricIndex, findTimedLyrics, getLyrics, type Lyrics, type Session } from '../../core'
import { useAsync } from '../useAsync'
import { useMusic, useMusicPosition } from './MusicProvider'
import { t } from '../../i18n'

/**
 * The words of the song on now. Timed lyrics follow the music with the line being sung large and white (and scrolled into view),
 * and a line can be pressed to jump the song to it; lyrics without times are a plain scrollable text, with a button that asks the
 * server's lyrics plugin for a timed version. Shows a short note when the server has none. Render with `key={trackId}`.
 * `large` is the full-width reading view: centred, bigger type, no scroll bar.
 */
export function LyricsPanel({
  session,
  trackId,
  large = false,
}: {
  session: Session
  trackId: string
  large?: boolean
}) {
  const load = useCallback(() => getLyrics(session, trackId), [session, trackId])
  const { state } = useAsync(load)
  // Timed lyrics found and saved from here replace the plain ones that were shown.
  const [found, setFound] = useState<Lyrics | null>(null)

  const note = large ? 'self-center py-10 text-center text-lg text-neutral-300' : 'text-sm text-neutral-400'
  if (state.status === 'loading') return <p className={note}>{t('Loading…')}</p>
  if (state.status === 'error') return <p className={note}>{t('Could not load the lyrics.')}</p>
  if (!state.data) return <p className={note}>{t('No lyrics for this song.')}</p>
  const lyrics = found ?? state.data
  return lyrics.synced ? (
    <Timed lyrics={lyrics} large={large} />
  ) : (
    <Plain session={session} trackId={trackId} lyrics={lyrics} onFound={setFound} large={large} />
  )
}

type FindState = 'idle' | 'searching' | 'none' | 'denied' | 'error'

const SCROLL_BOX =
  'min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]'
/** The large view scrolls with the wheel or the finger, without a bar in the middle of the screen. */
const NO_BAR = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
/** Lines fade out towards the top and bottom edge of the large view. */
const FADE = '[mask-image:linear-gradient(to_bottom,transparent,black_12%,black_88%,transparent)]'
/** The column the large view reads in: the box around it takes the whole width, so the scrolling is the screen's, not the column's. */
const COLUMN = 'mx-auto w-full max-w-3xl px-4'

function Plain({
  session,
  trackId,
  lyrics,
  onFound,
  large,
}: {
  session: Session
  trackId: string
  lyrics: Lyrics
  onFound: (l: Lyrics) => void
  large: boolean
}) {
  const [status, setStatus] = useState<FindState>('idle')
  async function find() {
    setStatus('searching')
    try {
      const timed = await findTimedLyrics(session, trackId)
      if (timed) onFound(timed)
      else setStatus('none')
    } catch (e) {
      setStatus((e as { response?: { status?: number } }).response?.status === 403 ? 'denied' : 'error')
    }
  }
  const note =
    status === 'none'
      ? t('No timed lyrics were found for this song.')
      : status === 'denied'
        ? t('Only a server administrator can save lyrics.')
        : status === 'error'
          ? t('Could not look for timed lyrics.')
          : null
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div tabIndex={0} aria-label={t('Lyrics')} className={`${SCROLL_BOX} ${large ? `${NO_BAR} ${FADE}` : 'pr-2'}`}>
        <div className={large ? `${COLUMN} py-8 text-center` : ''}>
          {lyrics.lines.map((line, i) => (
            <p
              key={i}
              className={`min-h-[1.5em] leading-relaxed text-neutral-200 ${large ? 'text-xl sm:text-2xl' : 'text-base'}`}
            >
              {line.text}
            </p>
          ))}
        </div>
      </div>
      <div
        className={`flex flex-wrap items-center gap-3 text-sm text-neutral-400 ${large ? 'justify-center px-4' : 'border-t border-white/10 pt-3'}`}
      >
        <span>{t('These lyrics are not timed, so they cannot follow the song.')}</span>
        <button type="button" className="btn" disabled={status === 'searching'} onClick={() => void find()}>
          {status === 'searching' ? t('Searching…') : t('Find timed lyrics')}
        </button>
        {note && (
          <span role="status" className="text-neutral-300">
            {note}
          </span>
        )}
      </div>
    </div>
  )
}

function Timed({ lyrics, large }: { lyrics: Lyrics; large: boolean }) {
  const music = useMusic()
  const position = useMusicPosition()
  const current = currentLyricIndex(lyrics, position)
  const box = useRef<HTMLDivElement>(null)

  // Keep the line being sung a little below the top of the panel, without moving the whole page.
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('[aria-current="true"]')
    const parent = box.current
    if (!el || !parent) return
    // (Not every environment can scroll an element, e.g. the test DOM.)
    if ('scrollTo' in parent)
      parent.scrollTo({
        top: Math.max(0, el.offsetTop - parent.clientHeight / (large ? 2.4 : 3)),
        behavior: 'smooth',
      })
  }, [current, large])

  // Pressing a line takes the song there, and plays it if it was paused.
  const jumpTo = (seconds: number) => {
    music.seek(seconds)
    music.resume()
  }

  return (
    <div
      ref={box}
      tabIndex={0}
      aria-label={t('Lyrics')}
      className={`relative ${SCROLL_BOX} ${large ? `${NO_BAR} ${FADE}` : 'pr-2'}`}
    >
      <div className={large ? `${COLUMN} pb-[40vh] pt-[22vh] text-center` : ''}>
        {lyrics.lines.map((line, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            aria-current={i === current ? 'true' : undefined}
            disabled={line.start === null}
            title={line.start === null ? undefined : t('Go to this line')}
            onClick={() => line.start !== null && jumpTo(line.start)}
            className={`block w-full cursor-pointer rounded-lg leading-snug transition-all duration-300 hover:text-white disabled:cursor-default ${large ? 'px-2 py-2 text-center' : 'py-1 text-left'} ${
              i === current
                ? `${large ? 'text-3xl sm:text-4xl' : 'text-2xl'} font-bold text-white`
                : `${large ? 'text-xl sm:text-2xl' : 'text-lg'} text-neutral-500`
            }`}
          >
            {line.text.trim() === '' ? '♪' : line.text}
          </button>
        ))}
      </div>
    </div>
  )
}
