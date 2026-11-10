import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../../core'
import { ModulesProvider, useModules } from '../ModulesProvider'
import { SeerrPage } from './SeerrPage'

const manifest = { api: 1, version: '0.1.0', serverTime: 1, user: { id: 'u', name: 'U', isAdmin: false }, modules: [{ id: 'seerr', state: 'ready' }], serviceKey: false }
const session = { serverUrl: 'http://jf.test', userId: 'u', userName: 'U', accessToken: 'tok' } as unknown as Session

interface Fake {
  me: unknown
  posted: unknown[]
  failNext: { status: number; error: string } | null
  detailStatus: string
}

let fake: Fake

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function install() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    const path = url.pathname
    if (path === '/v1/manifest') return json(manifest)
    if (path === '/v1/seerr/me') return json(fake.me)
    if (path === '/v1/seerr/search') {
      return json({
        page: 1,
        totalPages: 2,
        results: [
          { mediaType: 'movie', id: 603, title: 'The Matrix', year: 1999, status: 'available', jellyfinId: 'jf-matrix-0001', posterPath: '/matrix.jpg' },
          { mediaType: 'tv', id: 1396, title: 'Breaking Bad', year: 2008, status: 'partial' },
          { mediaType: 'movie', id: 604, title: 'Reloaded', year: 2003, status: 'none' },
        ],
      })
    }
    if (path === '/v1/seerr/title/movie/603') return json({ mediaType: 'movie', id: 603, title: 'The Matrix', year: 1999, status: 'available', jellyfinId: 'jf-matrix-0001', overview: 'A hacker.' })
    if (path === '/v1/seerr/title/tv/1396') {
      return json({
        mediaType: 'tv',
        id: 1396,
        title: 'Breaking Bad',
        year: 2008,
        status: 'partial',
        overview: 'A teacher.',
        seasons: [
          { number: 1, name: 'Season 1', episodes: 7, status: 'available' },
          { number: 2, name: 'Season 2', episodes: 13, status: 'none' },
          { number: 3, name: 'Season 3', episodes: 13, status: 'none' },
        ],
      })
    }
    if (path === '/v1/seerr/title/movie/604') return json({ mediaType: 'movie', id: 604, title: 'Reloaded', year: 2003, status: fake.detailStatus, overview: 'More.' })
    if (path === '/v1/seerr/requests' && init?.method === 'POST') {
      if (fake.failNext) {
        const failing = fake.failNext
        fake.failNext = null
        return json({ error: failing.error }, failing.status)
      }
      fake.posted.push(JSON.parse(String(init.body)))
      fake.detailStatus = 'pending'
      return json({ requestId: 1, status: 'pending' })
    }
    if (path === '/v1/seerr/requests') {
      return json({ page: 1, totalPages: 1, results: [{ id: 5, mediaType: 'movie', mediaId: 604, title: 'Reloaded', status: 'pending', mediaStatus: 'pending', createdAt: '2026-11-10T10:00:00.000Z' }] })
    }
    return json({ error: 'nope' }, 404)
  })
}

/** The app only draws a module's page once the container answered; so does this. */
function WhenReady({ children }: { children: ReactNode }) {
  return useModules().state.status === 'ready' ? <>{children}</> : null
}

function show(go = vi.fn(), initialQuery?: string) {
  window.JELLYFLIX_CONFIG = { modulesUrl: 'http://modules.test:8097' }
  render(
    <ModulesProvider token="tok">
      <WhenReady>
        <SeerrPage session={session} go={go} {...(initialQuery ? { initialQuery } : {})} />
      </WhenReady>
    </ModulesProvider>,
  )
  return go
}

beforeEach(() => {
  fake = {
    me: { canRequest: { movie: true, tv: true }, quota: { movie: { limit: 5, days: 7, used: 1, remaining: 4, restricted: false } } },
    posted: [],
    failNext: null,
    detailStatus: 'none',
  }
  install()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete window.JELLYFLIX_CONFIG
})

async function search() {
  fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'matrix' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByRole('list', { name: 'Results' })
}

describe('SeerrPage', () => {
  it('searches and shows each title with where it stands', async () => {
    show()
    await search()
    const list = screen.getByRole('list', { name: 'Results' })
    expect(within(list).getByRole('button', { name: /^The Matrix Movie 1999 In your library$/ })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: /^Breaking Bad Series 2008 Partly in your library$/ })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: /^Reloaded Movie 2003 Not in your library$/ })).toBeInTheDocument()
    // The poster comes from TMDb, without saying where it is asked from.
    const img = list.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w342/matrix.jpg')
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('asks for a movie and shows that it was asked for', async () => {
    show()
    await search()
    fireEvent.click(screen.getByRole('button', { name: /^Reloaded Movie 2003 Not in your library$/ }))
    expect(await screen.findByText('Requests left: 4 of 5 every 7 days.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Request this movie' }))
    await waitFor(() => expect(fake.posted).toEqual([{ mediaType: 'movie', mediaId: 604 }]))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Request this movie' })).not.toBeInTheDocument())
    expect(screen.getAllByText('Waiting for approval').length).toBeGreaterThan(0)
  })

  it('asks for the seasons of a series that are not there yet, and only those chosen', async () => {
    show()
    await search()
    fireEvent.click(screen.getByRole('button', { name: /^Breaking Bad Series 2008 Partly in your library$/ }))
    const one = await screen.findByRole('checkbox', { name: /Season 1/ })
    const two = screen.getByRole('checkbox', { name: /Season 2/ })
    const three = screen.getByRole('checkbox', { name: /Season 3/ })
    // What is already in the library cannot be asked for again; what is missing is ticked.
    expect(one).toBeDisabled()
    expect(two).toBeChecked()
    expect(three).toBeChecked()
    fireEvent.click(two)
    fireEvent.click(screen.getByRole('button', { name: 'Request the chosen seasons' }))
    await waitFor(() => expect(fake.posted).toEqual([{ mediaType: 'tv', mediaId: 1396, seasons: [3] }]))
  })

  it('opens a title that is in the library in Jellyflix', async () => {
    const go = show()
    await search()
    fireEvent.click(screen.getByRole('button', { name: /^The Matrix Movie 1999 In your library$/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open in Jellyflix' }))
    expect(go).toHaveBeenCalledWith({ page: 'movie', id: 'jf-matrix-0001' })
  })

  it('says what went wrong when Seerr refuses, in words of the person', async () => {
    show()
    await search()
    fireEvent.click(screen.getByRole('button', { name: /^Reloaded Movie 2003 Not in your library$/ }))
    const button = await screen.findByRole('button', { name: 'Request this movie' })
    fake.failNext = { status: 409, error: 'That has already been requested.' }
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('That has already been requested.')
  })

  it('does not offer to request what the account may not', async () => {
    fake.me = { canRequest: { movie: false, tv: true }, quota: {} }
    show()
    await search()
    fireEvent.click(screen.getByRole('button', { name: /^Reloaded Movie 2003 Not in your library$/ }))
    expect(await screen.findByText('Your Seerr account may not request this kind of title.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request this movie' })).toBeDisabled()
  })

  it('starts with the search that was handed over, already made', async () => {
    show(vi.fn(), 'matrix reloaded')
    const list = await screen.findByRole('list', { name: 'Results' })
    expect(within(list).getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('searchbox')).toHaveValue('matrix reloaded')
  })

  it('shows why a handed-over search failed, with the page still usable', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname
      if (path === '/v1/manifest') return json(manifest)
      if (path === '/v1/seerr/me') return json(fake.me)
      return json({ error: 'Seerr did not answer.' }, 502)
    })
    show(vi.fn(), 'matrix')
    expect(await screen.findByRole('alert')).toHaveTextContent('Seerr did not answer.')
    expect(screen.getByRole('searchbox')).toHaveValue('matrix')
  })

  it('lists my requests', async () => {
    show()
    fireEvent.click(await screen.findByRole('tab', { name: 'My requests' }))
    expect((await screen.findAllByText('Reloaded')).length).toBeGreaterThan(0)
    // The request and the title are both "waiting for approval": it is said once, not twice.
    expect(screen.getAllByText('Waiting for approval')).toHaveLength(1)
  })

  it('puts the name on a plain tile when a picture cannot be loaded', async () => {
    show()
    await search()
    const list = screen.getByRole('list', { name: 'Results' })
    const img = list.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img as HTMLImageElement)
    expect(list.querySelector('img')).toBeNull()
  })

  it('says so, with a way to try again, when this account is not in Seerr', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname
      if (path === '/v1/manifest') return json(manifest)
      return json({ error: 'Your Jellyfin account is not in Seerr yet. Ask an administrator to import you.' }, 403)
    })
    show()
    expect(await screen.findByText(/not in Seerr yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
