import { useEffect, useState } from 'react'
import { saveFile } from '../../platform/web/saveFile'
import { t } from '../../i18n'
import { ReaderShell } from './ReaderShell'

/**
 * A PDF is shown by the browser's own viewer (zoom, search, print and pages come with it). Browsers that cannot show a PDF inside a page
 * (most phones) are offered the file instead.
 */
export function PdfReader({ data, title, onExit }: { data: ArrayBuffer; title: string; onExit: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const made = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
    // Set on the next frame: if this effect is undone at once (the page is closed, or React checks it twice), the address never shows.
    const frame = requestAnimationFrame(() => setUrl(made))
    return () => {
      cancelAnimationFrame(frame)
      URL.revokeObjectURL(made)
    }
  }, [data])
  const canShow = typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false

  return (
    <ReaderShell title={title} onExit={onExit}>
      {canShow ? (
        url && <iframe title={title} src={url} className="h-full w-full border-0 bg-white" />
      ) : (
        <div className="m-6 max-w-xl space-y-4">
          <p className="text-neutral-200">{t('This browser cannot show a PDF inside a page. Save it and open it with your PDF viewer.')}</p>
          <button type="button" className="btn-primary" onClick={() => saveFile(new Blob([data], { type: 'application/pdf' }), `${title}.pdf`)}>
            {t('Download')}
          </button>
        </div>
      )}
    </ReaderShell>
  )
}
