import { useEffect, useState } from 'react'
import { downloadBookFile, getMovieDetails, readableFormat, type ReadableFormat, type Session } from '../../core'
import { t } from '../../i18n'
import { ComicReader } from './ComicReader'
import { EpubReader } from './EpubReader'
import { PdfReader } from './PdfReader'
import { ReadProgress, ReaderShell } from './ReaderShell'

type Stage =
  | { status: 'loading'; fraction: number | null }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ArrayBuffer; format: ReadableFormat; title: string }

/**
 * The reader for one book: it fetches the book's file from the server, then hands it to the viewer for its format (EPUB, PDF or comic).
 * The file stays in this browser tab's memory; nothing is sent anywhere else.
 */
export function BookReader({ session, id, onExit }: { session: Session; id: string; onExit: () => void }) {
  const [stage, setStage] = useState<Stage>({ status: 'loading', fraction: 0 })

  useEffect(() => {
    const abort = new AbortController()
    void (async () => {
      try {
        const book = await getMovieDetails(session, id)
        const format = readableFormat(book.format)
        if (!format) throw new Error('Jellyflix cannot open this kind of file yet. Download it from the book page.')
        const data = await downloadBookFile(session, id, (fraction) => setStage({ status: 'loading', fraction }), abort.signal)
        setStage({ status: 'ready', data, format, title: book.name })
      } catch (e) {
        if (abort.signal.aborted) return
        setStage({ status: 'error', message: e instanceof Error ? e.message : 'The book could not be loaded.' })
      }
    })()
    return () => abort.abort()
  }, [session, id])

  if (stage.status === 'loading') {
    return (
      <ReaderShell title={t('Opening…')} onExit={onExit}>
        <div role="status" className="m-6 max-w-md space-y-3 text-neutral-300">
          <p>{stage.fraction === null ? t('Downloading the book…') : t('Downloading the book… {percent}%', { percent: Math.round(stage.fraction * 100) })}</p>
          {stage.fraction !== null && <ReadProgress percent={stage.fraction * 100} />}
        </div>
      </ReaderShell>
    )
  }
  if (stage.status === 'error') {
    return (
      <ReaderShell title={t('Book')} onExit={onExit}>
        <p role="alert" className="alert-error m-6 max-w-xl">
          {t(stage.message)}
        </p>
      </ReaderShell>
    )
  }
  if (stage.format === 'epub') return <EpubReader data={stage.data} bookId={id} title={stage.title} onExit={onExit} />
  if (stage.format === 'cbz') return <ComicReader data={stage.data} bookId={id} title={stage.title} onExit={onExit} />
  return <PdfReader data={stage.data} bookId={id} title={stage.title} onExit={onExit} />
}
