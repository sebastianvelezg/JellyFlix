import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

/**
 * Reading a PDF with pdf.js, drawn on canvases the reader lays out itself. The library is only fetched when a PDF is opened. Nothing
 * leaves this browser tab: the file is parsed in a worker made from the app's own files.
 */

export interface PdfOutlineEntry {
  title: string
  /** The page it goes to, 1 to the number of pages. */
  page: number
  depth: number
}

export interface PdfDrawing {
  /** Resolves when the page is drawn (also when it was cancelled); gives the height of the page as a part of its width. */
  done: Promise<number | undefined>
  cancel: () => void
}

export interface PdfDocument {
  readonly pages: number
  /** The height of a page as a part of its width (1.41 for A4). */
  ratio(n: number): Promise<number>
  /** Draws page [n] (1 to `pages`) into [canvas] so that it is [cssWidth] pixels wide on screen, sharp on dense screens. */
  draw(n: number, canvas: HTMLCanvasElement, cssWidth: number): PdfDrawing
  outline(): Promise<PdfOutlineEntry[]>
  destroy(): void
}

/** The most pixels one page may take in memory: a very large zoom is drawn a little less sharp instead. */
const MAX_CANVAS_PIXELS = 16_000_000
const MAX_OUTLINE_ENTRIES = 300

/** A drawing that was cancelled is not a failure. */
const isCancelled = (e: unknown) => e instanceof Error && e.name === 'RenderingCancelledException'

class Document implements PdfDocument {
  constructor(private readonly doc: PDFDocumentProxy) {}

  get pages(): number {
    return this.doc.numPages
  }

  async ratio(n: number): Promise<number> {
    const page = await this.doc.getPage(n)
    const view = page.getViewport({ scale: 1 })
    page.cleanup()
    return view.height / view.width
  }

  draw(n: number, canvas: HTMLCanvasElement, cssWidth: number): PdfDrawing {
    let cancelled = false
    let task: RenderTask | undefined
    let page: PDFPageProxy | undefined
    const done = (async () => {
      try {
        page = await this.doc.getPage(n)
        if (cancelled) return undefined
        const base = page.getViewport({ scale: 1 })
        const dense = Math.min(2, window.devicePixelRatio || 1)
        let scale = (cssWidth / base.width) * dense
        const pixels = base.width * scale * base.height * scale
        if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels)
        const viewport = page.getViewport({ scale })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${cssWidth}px`
        canvas.style.height = `${(cssWidth * base.height) / base.width}px`
        const context = canvas.getContext('2d')
        if (!context) return undefined
        task = page.render({ canvas, canvasContext: context, viewport })
        await task.promise
        return base.height / base.width
      } catch (e) {
        if (isCancelled(e)) return undefined
        throw e
      } finally {
        page?.cleanup()
      }
    })()
    return {
      done,
      cancel: () => {
        cancelled = true
        task?.cancel()
      },
    }
  }

  async outline(): Promise<PdfOutlineEntry[]> {
    const items = await this.doc.getOutline()
    if (!items) return []
    const out: PdfOutlineEntry[] = []
    const walk = async (list: NonNullable<typeof items>, depth: number): Promise<void> => {
      for (const item of list) {
        if (out.length >= MAX_OUTLINE_ENTRIES) return
        const page = await this.pageOf(item.dest)
        if (page !== null && item.title.trim()) out.push({ title: item.title.trim(), page, depth })
        if (depth < 2 && item.items.length > 0) await walk(item.items, depth + 1)
      }
    }
    await walk(items, 0)
    return out
  }

  /** The page a destination of the outline points to, or null when it points nowhere we can follow. */
  private async pageOf(dest: unknown): Promise<number | null> {
    try {
      const resolved = typeof dest === 'string' ? await this.doc.getDestination(dest) : (dest as unknown[] | null)
      const target = resolved?.[0]
      if (target && typeof target === 'object') return (await this.doc.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
      if (typeof target === 'number') return target + 1
    } catch {
      // A broken entry is left out.
    }
    return null
  }

  destroy(): void {
    void this.doc.destroy()
  }
}

/** Opens a PDF from its bytes. Rejects when it is not a PDF, is damaged or needs a password. */
export async function openPdf(data: ArrayBuffer): Promise<PdfDocument> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({
    // A copy: the library hands the bytes it is given over to its worker, and the reader keeps its own for the browser's viewer.
    data: new Uint8Array(data.slice(0)),
    wasmUrl: new URL('pdfjs/wasm/', document.baseURI).href,
    // Nothing a PDF carries is run: no scripts, no forms with code, no code for fonts.
    isEvalSupported: false,
    enableXfa: false,
  })
  return new Document(await task.promise)
}
