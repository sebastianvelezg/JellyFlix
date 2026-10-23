import { StateMessage } from './StateMessage'
import { useCallback, useEffect, useState } from 'react'
import {
  audiobookStart,
  backdropImageUrl,
  bookCoverUrl,
  bookKindLabel,
  downloadBookFile,
  formatRuntime,
  formatTime,
  getMovieDetails,
  readableFormat,
  ticksToSeconds,
  type Movie,
  type MovieDetails,
  type Session,
} from '../core'
import { BOOK_FINISHED_PERCENT, readBookProgress } from '../platform/web/prefs'
import { saveFile } from '../platform/web/saveFile'
import { useReloadOnEdit } from './admin/editorEvents'
import { BookIcon, CheckIcon, DownloadIcon, HeadphonesIcon, HeartIcon, RestartIcon } from './icons'
import { DetailsSkeleton, TitleHero } from './TitleParts'
import { formatBytes } from './format'
import { detailsKey, useSwr } from './useSwr'
import { useToggles } from './useToggles'
import { t } from '../i18n'

/**
 * The page of a book or an audiobook: its cover and description, and what you can do with it: read it here (an EPUB, a PDF or a comic),
 * listen to it (an audiobook, with the music player), or download the file.
 */
export function BookPage({
  session,
  id,
  onRead,
  onListen,
  onBack,
  onChanged,
}: {
  session: Session
  id: string
  onRead: (book: Movie) => void
  onListen: (book: Movie, startSeconds: number) => void
  onBack: () => void
  onChanged: (book: Movie) => void
}) {
  const load = useCallback(() => getMovieDetails(session, id), [session, id])
  const { state, retry, update } = useSwr(detailsKey(session, id), load, { fresh: 0 })
  useReloadOnEdit(retry)

  if (state.status === 'loading') return <DetailsSkeleton onBack={onBack} />
  if (state.status === 'error') {
    return (
      <StateMessage kind="error" message={t('Could not load this book: {message}', { message: state.message })}>
        <button type="button" className="btn" onClick={retry}>
          {t('Try again')}
        </button>
        <button type="button" className="btn" onClick={onBack}>
          {t('Back')}
        </button>
      </StateMessage>
    )
  }
  return (
    <BookContent
      session={session}
      book={state.data}
      onRead={onRead}
      onListen={onListen}
      onBack={onBack}
      onChange={(next) => {
        update(() => next)
        onChanged(next)
      }}
    />
  )
}

type Saving = { status: 'idle' } | { status: 'busy'; fraction: number | null } | { status: 'error'; message: string }

function BookContent({
  session,
  book,
  onRead,
  onListen,
  onBack,
  onChange,
}: {
  session: Session
  book: MovieDetails
  onRead: (book: Movie) => void
  onListen: (book: Movie, startSeconds: number) => void
  onBack: () => void
  onChange: (book: MovieDetails) => void
}) {
  const { toggle, actionError } = useToggles(session, book, onChange)
  const [saving, setSaving] = useState<Saving>({ status: 'idle' })
  const audio = book.book === 'audiobook'
  const reader = audio ? null : readableFormat(book.format)
  const place = audio ? undefined : readBookProgress(book.id)
  const listenFrom = audio ? audiobookStart(book) : 0
  const kind = t(bookKindLabel(book))

  useEffect(() => {
    const previous = document.title
    document.title = `${book.name} · Jellyflix`
    return () => {
      document.title = previous
    }
  }, [book.name])

  const download = async () => {
    setSaving({ status: 'busy', fraction: 0 })
    try {
      const data = await downloadBookFile(session, book.id, (fraction) => setSaving({ status: 'busy', fraction }))
      const base = book.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'book'
      saveFile(new Blob([data]), `${base}${book.format ? `.${book.format}` : ''}`)
      setSaving({ status: 'idle' })
    } catch (e) {
      setSaving({ status: 'error', message: e instanceof Error ? t(e.message) : t('The download failed.') })
    }
  }

  const authors = book.authors.length > 0 ? book.authors.join(', ') : book.author
  const length = audio && book.runtimeTicks ? formatRuntime(ticksToSeconds(book.runtimeTicks)) : undefined
  const facts = [kind, book.year, length, book.media?.sizeBytes ? formatBytes(book.media.sizeBytes) : undefined].filter(Boolean)
  const backdrop = backdropImageUrl(session.serverUrl, book)

  return (
    <article className="pb-16" aria-label={book.name}>
      <TitleHero session={session} backdrop={backdrop} poster={bookCoverUrl(session.serverUrl, book)} name={book.name} onBack={onBack}>
        <h1 className="rise text-balance text-4xl font-extrabold tracking-tight text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.8)] sm:text-6xl">{book.name}</h1>
        {authors && <p className="rise rise-2 mt-2 text-lg font-medium text-neutral-200">{authors}</p>}
        <p className="rise rise-2 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral-200">
          {facts.map((fact, i) => (
            <span key={i} className={i === 0 ? 'chip-accent' : ''}>
              {fact}
            </span>
          ))}
          {book.played && <span className="chip">{audio ? t('Listened') : t('Read')}</span>}
        </p>
        {book.genres.length > 0 && (
          <ul className="rise rise-3 mt-3 flex flex-wrap gap-1.5" aria-label={t('Genres')}>
            {book.genres.map((g) => (
              <li key={g} className="chip">
                {g}
              </li>
            ))}
          </ul>
        )}

        <div className="rise rise-3 relative z-20 mt-6 flex flex-wrap items-center gap-2.5">
          {audio && (
            <>
              <button type="button" className="btn-primary px-6 py-3 text-base" onClick={() => onListen(book, listenFrom)}>
                <HeadphonesIcon />
                {listenFrom > 0 ? t('Resume from {time}', { time: formatTime(listenFrom) }) : t('Listen')}
              </button>
              {listenFrom > 0 && (
                <button type="button" className="btn py-3" onClick={() => onListen(book, 0)}>
                  <RestartIcon /> {t('Start over')}
                </button>
              )}
            </>
          )}
          {reader && (
            <button type="button" className="btn-primary px-6 py-3 text-base" onClick={() => onRead(book)}>
              <BookIcon />
              {place && place.percent > 0 && place.percent < BOOK_FINISHED_PERCENT ? t('Continue reading ({percent}%)', { percent: Math.round(place.percent) }) : t('Read')}
            </button>
          )}
          <button type="button" className="btn py-3" onClick={() => void download()} disabled={saving.status === 'busy'}>
            <DownloadIcon />
            {saving.status === 'busy'
              ? saving.fraction === null
                ? t('Downloading…')
                : t('Downloading… {percent}%', { percent: Math.round(saving.fraction * 100) })
              : t('Download')}
          </button>
          <button
            type="button"
            className={`btn py-3 ${book.played ? 'border-[var(--color-accent)]/50 text-[var(--color-accent)]' : ''}`}
            aria-pressed={book.played}
            onClick={() => void toggle('watched')}
            title={audio ? (book.played ? t('Mark as not listened') : t('Mark as listened')) : book.played ? t('Mark as not read') : t('Mark as read')}
          >
            <CheckIcon /> {book.played ? (audio ? t('Listened') : t('Read')) : audio ? t('Mark listened') : t('Mark read')}
          </button>
          <button
            type="button"
            className={`btn py-3 ${book.favorite ? 'border-rose-400/40 text-rose-400' : ''}`}
            aria-pressed={book.favorite}
            onClick={() => void toggle('favorite')}
            title={book.favorite ? t('Remove from favorites') : t('Add to favorites')}
          >
            <HeartIcon filled={book.favorite} /> {book.favorite ? t('Favorite') : t('Add to favorites')}
          </button>
        </div>

        {!audio && !reader && (
          <p className="mt-4 max-w-xl text-sm text-neutral-300">
            {t('Jellyflix cannot open {format} files yet. Download it to read it in another app.', { format: kind })}
          </p>
        )}
        {saving.status === 'error' && (
          <p role="alert" className="alert-error mt-3 max-w-xl">
            {saving.message}
          </p>
        )}
        {actionError && (
          <p role="alert" className="alert-error mt-3 max-w-xl">
            {actionError}
          </p>
        )}

        {book.overview ? (
          <p className="rise rise-4 mt-6 max-w-2xl text-pretty text-base leading-relaxed text-neutral-300">{book.overview}</p>
        ) : (
          <p className="mt-6 text-sm text-neutral-500">{t('No description available.')}</p>
        )}
      </TitleHero>
    </article>
  )
}
