// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import { audiobookStart, audiobookTrack, bookKindLabel, downloadBookFile, getBooks, readableFormat } from './books'
import type { Session } from './jellyfin'
import { getContinueWatching, getLibrarySections, getTitlePage, toMovie } from './library'
import { getMovieDetails } from './details'

describe('what the reader can open', () => {
  it('knows EPUB, PDF and comic archives, in any case, and nothing else', () => {
    expect(readableFormat('epub')).toBe('epub')
    expect(readableFormat('PDF')).toBe('pdf')
    expect(readableFormat('cbz')).toBe('cbz')
    expect(readableFormat('zip')).toBe('cbz')
    expect(readableFormat('mobi')).toBeNull()
    expect(readableFormat('cbr')).toBeNull()
    expect(readableFormat(undefined)).toBeNull()
  })

  it('maps a book and an audiobook, with their format and author', () => {
    const book = toMovie({ Id: 'b', Name: 'B', Type: 'Book', Container: 'epub', ProductionYear: 2001 } as never)
    expect(book).toMatchObject({ book: 'book', format: 'epub' })
    expect(bookKindLabel(book as never)).toBe('EPUB')
    // Without a container the format comes from the file name.
    expect(toMovie({ Id: 'b', Name: 'B', Type: 'Book', Path: '/media/books/B.CBZ' } as never)?.format).toBe('cbz')
    const audio = toMovie({ Id: 'a', Name: 'A', Type: 'AudioBook', Artists: ['Someone'], RunTimeTicks: 600_000_000 } as never)
    expect(audio).toMatchObject({ book: 'audiobook', author: 'Someone' })
    expect(bookKindLabel(audio as never)).toBe('Audiobook')
    expect(toMovie({ Id: 'm', Name: 'M', Type: 'Movie', Container: 'mkv' } as never)?.book).toBeUndefined()
  })

  it('makes an audiobook an item of the music queue that starts where it was left', () => {
    const audio = toMovie({
      Id: 'a',
      Name: 'A',
      Type: 'AudioBook',
      Artists: ['Someone'],
      RunTimeTicks: 600_000_000,
      ImageTags: { Primary: 'tag' },
      UserData: { PlaybackPositionTicks: 300_000_000 },
    } as never)
    expect(audiobookTrack(audio as never)).toMatchObject({ id: 'a', name: 'A', artist: 'Someone', runtimeTicks: 600_000_000, imageTag: 'tag' })
    expect(audiobookStart(audio as never)).toBe(30)
  })
})

describe('books against a mock Jellyfin server', () => {
  let mock: MockServer
  let denied: MockServer
  let session: Session
  let refused: Session
  beforeAll(async () => {
    mock = await startMockJellyfin({ movieCount: 2, books: 4, audiobooks: 2 })
    denied = await startMockJellyfin({ movieCount: 2, books: 1, noDownload: true })
    session = await connect(mock.url, 'tester', 'secret')
    refused = await connect(denied.url, 'tester', 'secret')
  })
  afterAll(async () => {
    await mock.close()
    await denied.close()
  })

  it('sorts a Books library into its own section and lists books and audiobooks together', async () => {
    const sections = await getLibrarySections(session)
    expect(sections.books).toEqual([{ id: 'lib-books', name: 'Books' }])
    const page = await getTitlePage(session, 'book', { libraryId: 'lib-books', startIndex: 0 })
    expect(page.total).toBe(6)
    expect(page.movies.filter((m) => m.book === 'audiobook')).toHaveLength(2)
    expect(page.movies.find((m) => m.id === 'bk0003')).toMatchObject({ format: 'cbz' })
  })

  it('reads the author of a book from its credits, and finds books by their ids in the order asked', async () => {
    expect((await getMovieDetails(session, 'bk0001')).authors).toEqual(['Test Author 2'])
    expect((await getBooks(session, ['bk0002', 'bk0001', 'bk9999'])).map((b) => b.id)).toEqual(['bk0002', 'bk0001'])
  })

  it('keeps "continue" of audiobooks apart from the movies', async () => {
    mock.user.resume.set('ab0002', 10 * 10_000_000)
    mock.user.lastPlayed.push('ab0002')
    expect((await getContinueWatching(session, 12, 'book')).map((m) => m.id)).toEqual(['ab0002'])
    expect(await getContinueWatching(session)).toEqual([])
  })

  it('downloads the file with the session\'s credentials and says how far it got', async () => {
    const steps: Array<number | null> = []
    const data = await downloadBookFile(session, 'bk0002', (fraction) => steps.push(fraction))
    expect(new TextDecoder().decode(new Uint8Array(data).subarray(0, 5))).toBe('%PDF-')
    expect(steps.at(-1)).toBe(1)
    expect(mock.requests.find((r) => r.path === '/Items/bk0002/Download')).toMatchObject({ auth: 'header' })
  })

  it('explains a refused or missing download in plain words', async () => {
    await expect(downloadBookFile(refused, 'bk0001')).rejects.toThrow('not allowed to download')
    await expect(downloadBookFile(session, 'bk0099')).rejects.toThrow('no longer on the server')
  })
})
