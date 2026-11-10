import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../../core'
import type { ChannelSource } from '../../../core/modules'
import { fetchTiles, LibraryPicker, withoutCopies, type Tile } from './LibraryPicker'

const mocks = vi.hoisted(() => ({ getTitlePage: vi.fn(), getCollectionPage: vi.fn() }))

vi.mock('../../../core', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../core')>()), getTitlePage: mocks.getTitlePage, getCollectionPage: mocks.getCollectionPage }))
vi.mock('../../../core/modules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../core/modules')>()),
  channelSuggestions: async () => ({ genres: ['Action', 'Comedy'], collections: [] }),
}))
vi.mock('../ModulesProvider', () => ({ useModulesClient: () => ({ client: {} }) }))

const session = { serverUrl: 'http://jf.test', userId: 'u', userName: 'U', accessToken: 'tok' } as unknown as Session

const movie = (id: string, name: string, year: number) => ({ id, name, year, imageTag: `tag-${id}`, resumeTicks: 0, played: false, favorite: false })

function Harness({ initial = [] as ChannelSource[], seen }: { initial?: ChannelSource[]; seen: (next: ChannelSource[]) => void }) {
  const [sources, setSources] = useState<ChannelSource[]>(initial)
  return (
    <LibraryPicker
      session={session}
      sources={sources}
      onChange={(next) => {
        setSources(next)
        seen(next)
      }}
      onClose={() => undefined}
    />
  )
}

beforeEach(() => {
  mocks.getTitlePage.mockReset().mockImplementation(async (_s, kind: string, opts: { genre?: string; search?: string; startIndex: number }) => {
    const all = [movie('a', 'Die Hard', 1988), movie('b', 'Speed', 1994), movie('b2', 'Speed', 1994), movie('c', 'Heat', 1995)]
    const movies = opts.genre === 'Comedy' ? [movie('d', 'Airplane!', 1980)] : all
    return { movies: kind === 'series' ? [] : movies.slice(opts.startIndex), total: movies.length }
  })
  mocks.getCollectionPage.mockReset().mockResolvedValue({ items: [{ id: 'box1', name: 'Die Hard Collection', favorite: false }], total: 1 })
})
afterEach(() => cleanup())

describe('withoutCopies', () => {
  const tile = (id: string, name: string, year: number): Tile => ({ id, name, year, itemType: 'Movie' })

  it('keeps the first copy of a title that is in the library twice, and every collection', () => {
    const tiles = [tile('1', 'Speed', 1994), tile('2', 'SPEED', 1994), tile('3', 'Speed', 2004), { id: 'b1', name: 'Speed', itemType: 'BoxSet' as const }, { id: 'b2', name: 'Speed', itemType: 'BoxSet' as const }]
    expect(withoutCopies(tiles).map((x) => x.id)).toEqual(['1', '3', 'b1', 'b2'])
  })

  it('also drops what an earlier page already showed', () => {
    expect(withoutCopies([tile('2', 'Speed', 1994), tile('3', 'Heat', 1995)], new Set(['speed|1994'])).map((x) => x.id)).toEqual(['3'])
  })
})

describe('fetchTiles', () => {
  it('asks the library for the kind, genre, name and order, and shapes the answer as posters', async () => {
    const page = await fetchTiles(session, { kind: 'series', genre: 'Drama', sort: 'rating', search: 'bad' }, 48)
    expect(mocks.getTitlePage).toHaveBeenCalledWith(session, 'series', expect.objectContaining({ startIndex: 48, genre: 'Drama', search: 'bad', sort: 'rating' }))
    expect(page.tiles).toEqual([])
    const films = await fetchTiles(session, { kind: 'movie', genre: '', sort: 'title', search: '' }, 0)
    expect(mocks.getTitlePage).toHaveBeenLastCalledWith(session, 'movie', expect.not.objectContaining({ genre: expect.anything() }))
    expect(films.tiles[0]).toEqual({ id: 'a', name: 'Die Hard', year: 1988, imageTag: 'tag-a', itemType: 'Movie' })
  })

  it('reads collections by name or by date added', async () => {
    await fetchTiles(session, { kind: 'collection', genre: '', sort: 'added', search: 'die' }, 0)
    expect(mocks.getCollectionPage).toHaveBeenCalledWith(session, expect.objectContaining({ sort: 'added', search: 'die' }))
    const boxes = await fetchTiles(session, { kind: 'collection', genre: '', sort: 'title', search: '' }, 0)
    expect(mocks.getCollectionPage).toHaveBeenLastCalledWith(session, expect.objectContaining({ sort: 'name' }))
    expect(boxes.tiles).toEqual([{ id: 'box1', name: 'Die Hard Collection', itemType: 'BoxSet' }])
  })
})

describe('LibraryPicker', () => {
  it('shows the films as posters, one copy of each, and ticks them one by one', async () => {
    const seen = vi.fn()
    render(<Harness seen={seen} />)
    const hard = await screen.findByRole('button', { name: 'Die Hard 1988' })
    expect(screen.getAllByRole('button', { name: 'Speed 1994' })).toHaveLength(1)
    expect(hard).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('Showing 3 of 4')

    fireEvent.click(hard)
    expect(hard).toHaveAttribute('aria-pressed', 'true')
    expect(seen).toHaveBeenLastCalledWith([{ kind: 'item', id: 'a', name: 'Die Hard', itemType: 'Movie' }])
    fireEvent.click(hard)
    expect(hard).toHaveAttribute('aria-pressed', 'false')
    expect(seen).toHaveBeenLastCalledWith([])
  })

  it('picks every poster on screen at once, and clears them again', async () => {
    const seen = vi.fn()
    const keep: ChannelSource = { kind: 'item', id: 'zzz', name: 'Kept', itemType: 'Movie' }
    render(<Harness initial={[keep]} seen={seen} />)
    await screen.findByRole('button', { name: 'Heat 1995' })
    fireEvent.click(screen.getByRole('button', { name: 'Pick all shown' }))
    const ids = (seen.mock.lastCall?.[0] as ChannelSource[]).map((s) => (s.kind === 'item' ? s.id : ''))
    expect(ids).toEqual(['zzz', 'a', 'b', 'c'])
    expect(screen.getByRole('button', { name: 'Pick all shown' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Clear shown' }))
    expect(seen.mock.lastCall?.[0]).toEqual([keep])
  })

  it('narrows by genre, and offers the genre as a rule that is added once', async () => {
    const seen = vi.fn()
    render(<Harness seen={seen} />)
    await screen.findByRole('button', { name: 'Heat 1995' })
    expect(screen.queryByRole('button', { name: 'Add it as a rule' })).toBeNull()

    await screen.findByRole('option', { name: 'Comedy' })
    fireEvent.change(screen.getByLabelText('Genre'), { target: { value: 'Comedy' } })
    await screen.findByRole('button', { name: 'Airplane! 1980' })
    expect(screen.queryByRole('button', { name: 'Heat 1995' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add it as a rule' }))
    expect(seen).toHaveBeenLastCalledWith([{ kind: 'rule', name: 'Comedy', genres: ['Comedy'], types: ['Movie'] }])
    expect(screen.getByRole('button', { name: 'Rule added' })).toBeDisabled()
  })

  it('searches by name after a short pause and switches to collections', async () => {
    render(<Harness seen={vi.fn()} />)
    await screen.findByRole('button', { name: 'Heat 1995' })
    fireEvent.change(screen.getByLabelText('Filter by name'), { target: { value: 'hea' } })
    await waitFor(() => expect(mocks.getTitlePage).toHaveBeenLastCalledWith(session, 'movie', expect.objectContaining({ search: 'hea' })))

    fireEvent.click(screen.getByRole('button', { name: 'Collections' }))
    await screen.findByRole('button', { name: 'Die Hard Collection' })
    expect(screen.queryByLabelText('Genre')).toBeNull()
  })

  it('says so when the library cannot be read, and when nothing matches', async () => {
    mocks.getTitlePage.mockRejectedValueOnce(new Error('down'))
    render(<Harness seen={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the library. Try again.')

    mocks.getTitlePage.mockResolvedValueOnce({ movies: [], total: 0 })
    fireEvent.change(screen.getByLabelText('Filter by name'), { target: { value: 'zzz' } })
    expect(await screen.findByText('Nothing matches.')).toBeVisible()
  })
})
