import { unpack } from './zip'

export interface ComicPage {
  /** The file's name inside the archive. */
  name: string
  bytes: Uint8Array
  mime: string
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
}

/** The pictures of a comic archive (CBZ) in reading order: by file name, numbers compared as numbers ("2" before "10"). */
export function openComic(data: ArrayBuffer): ComicPage[] {
  const files = unpack(data)
  const pages: ComicPage[] = []
  for (const [name, bytes] of files) {
    const base = name.split('/').pop() ?? name
    if (name.startsWith('__MACOSX/') || base.startsWith('.') || bytes.length === 0) continue
    const mime = IMAGE_TYPES[(base.split('.').pop() ?? '').toLowerCase()]
    if (mime) pages.push({ name, bytes, mime })
  }
  pages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  if (pages.length === 0) throw new Error('This comic has no pages that can be shown.')
  return pages
}
