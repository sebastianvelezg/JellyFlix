import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Movie, Session } from '../core'
import { BooksHero } from './BooksHome'

afterEach(cleanup)

const session = { serverUrl: 'http://jellyfin.local:8096', userId: 'u1' } as Session
const book = (id: string, name: string, extra: Partial<Movie> = {}): Movie => ({ id, name, year: 2018, book: 'book', format: 'epub', played: false, favorite: false, resumeTicks: 0, ...extra }) as Movie

describe('BooksHero', () => {
  it('shows the book you are in the middle of, how far you are, and goes on with it', async () => {
    const onPlay = vi.fn()
    const reading = [book('b1', 'Dune', { resumeTicks: 42_000, runtimeTicks: 100_000 })]
    render(<BooksHero session={session} reading={reading} recent={[book('b2', 'Foundation')]} onPlay={onPlay} onOpen={() => undefined} />)
    expect(screen.getByRole('heading', { name: 'Dune' })).toBeInTheDocument()
    expect(screen.getByText('42% read')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue reading' }))
    expect(onPlay).toHaveBeenCalledWith(reading[0])
  })

  it('with nothing in progress it shows the newest book not finished yet, and offers to read it or see its page', async () => {
    const onOpen = vi.fn()
    const recent = [book('b2', 'Foundation', { played: true }), book('b3', 'Hyperion')]
    render(<BooksHero session={session} reading={[]} recent={recent} onPlay={() => undefined} onOpen={onOpen} />)
    expect(screen.getByRole('heading', { name: 'Hyperion' })).toBeInTheDocument()
    expect(screen.queryByText(/% read/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(onOpen).toHaveBeenCalledWith(recent[1])
  })

  it('offers to listen to an audiobook, and shows nothing when there are no books', () => {
    const { container, rerender } = render(<BooksHero session={session} reading={[]} recent={[book('b4', 'Dracula', { book: 'audiobook' })]} onPlay={() => undefined} onOpen={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument()
    rerender(<BooksHero session={session} reading={[]} recent={[]} onPlay={() => undefined} onOpen={() => undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
