import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import { toMovies, type Movie } from './library'
import type { Session } from './jellyfin'
import type { Track } from './music'
import { ticksToSeconds } from './ticks'
import { itemImageUrl } from './images'

/** What the reader can show: an EPUB, a PDF (the browser's own viewer) and a comic archive. Other formats can be downloaded. */
export type ReadableFormat = 'epub' | 'pdf' | 'cbz'

const FORMAT_NAMES: Record<string, ReadableFormat> = { epub: 'epub', pdf: 'pdf', cbz: 'cbz', zip: 'cbz' }

/** The reader for a book's format, or null when there is none (Mobi, comic archives in RAR form, text files...). */
export function readableFormat(format: string | undefined): ReadableFormat | null {
  return (format && FORMAT_NAMES[format.toLowerCase()]) || null
}

/** "EPUB", "PDF", "Audiobook": what a card or a page calls a book. */
export function bookKindLabel(book: Pick<Movie, 'book' | 'format'>): string {
  return book.book === 'audiobook' ? 'Audiobook' : (book.format ?? 'Book').toUpperCase()
}

/** An audiobook as an item of the music player's queue: one long "song" that remembers where you stopped. */
export function audiobookTrack(book: Movie): Track {
  return {
    id: book.id,
    name: book.name,
    artist: book.author ?? '',
    album: '',
    runtimeTicks: book.runtimeTicks,
    imageTag: book.imageTag,
    favorite: book.favorite,
    playCount: book.played ? 1 : 0,
  }
}

/** Where to start an audiobook: the place saved on the server, in seconds (0 for none). */
export function audiobookStart(book: Pick<Movie, 'resumeTicks'>): number {
  return ticksToSeconds(book.resumeTicks)
}

/** The cover of a book, at the size asked for. */
export function bookCoverUrl(serverUrl: string, book: Pick<Movie, 'id' | 'imageTag'>, width = 450): string | null {
  return book.imageTag ? itemImageUrl(serverUrl, book.id, 'Primary', { tag: book.imageTag, width }) : null
}

/** Books and audiobooks by their ids (the ones the reader remembers), in the order asked for; those the server no longer has are left out. */
export async function getBooks(session: Session, ids: string[]): Promise<Movie[]> {
  if (ids.length === 0) return []
  const { data } = await getLibraryApi(session.api).getItems({
    userId: session.userId,
    ids,
    enableUserData: true,
    enableImages: true,
    imageTypeLimit: 1,
  })
  const found = toMovies(data.Items)
  return ids.flatMap((id) => found.filter((b) => b.id === id))
}

const DOWNLOAD_ERRORS: Record<number, string> = {
  401: 'Your session expired. Please sign in again.',
  403: 'Your account is not allowed to download files. Ask the server administrator to allow it.',
  404: 'That file is no longer on the server.',
}

/**
 * The book's own file, as the server holds it. `onProgress` gets how much has arrived (0 to 1, or null when the server does not say
 * how big the file is). The file stays in memory: it is for reading or for saving, never sent anywhere else.
 */
export async function downloadBookFile(session: Session, id: string, onProgress?: (fraction: number | null) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  let response: Response
  try {
    response = await fetch(`${session.serverUrl}/Items/${encodeURIComponent(id)}/Download`, {
      headers: { Authorization: session.api.authorizationHeader },
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new Error('Could not reach the server to get the file.', { cause: e })
  }
  if (!response.ok) throw new Error(DOWNLOAD_ERRORS[response.status] ?? `The server reported an error (HTTP ${response.status}).`)
  const total = Number(response.headers.get('Content-Length'))
  if (!response.body) return response.arrayBuffer()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress?.(total > 0 ? Math.min(1, received / total) : null)
  }
  const whole = new Uint8Array(received)
  let at = 0
  for (const chunk of chunks) {
    whole.set(chunk, at)
    at += chunk.length
  }
  return whole.buffer
}
