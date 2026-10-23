import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromeLikeCapabilities as capabilities } from '../test/fixtures'
import { startMockJellyfin, type MockServer } from '../test/mock/mockJellyfin'
import App from './App'
import { clearSwr } from './components/useSwr'
import { connect, negotiatePlayback, PlaybackSession } from './core'

let mock: MockServer
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 70 })
})
afterAll(() => mock.close())
beforeEach(() => {
  history.replaceState(null, '', '#/movies')
})
afterEach(() => {
  clearSwr() // what the app remembered about one test's server must not leak into the next
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

async function signIn(url: string, user = 'tester', password = 'secret', keep = false) {
  const ui = userEvent.setup()
  render(<App />)
  const server = await screen.findByLabelText('Server URL')
  await ui.clear(server)
  await ui.type(server, url)
  await ui.type(screen.getByLabelText('Username'), user)
  await ui.type(screen.getByLabelText('Password'), password)
  if (keep) await ui.click(screen.getByLabelText(/Keep me signed in/))
  await ui.click(screen.getByRole('button', { name: 'Connect' }))
  return ui
}

/** A card in the main grid (rows above it, like the genre rows, can show the same movie). */
const card = async (name: RegExp) => within(await screen.findByRole('region', { name: 'All movies' })).findByRole('button', { name })
/** The main grid (the "Recently added" row above it can show some of the same movies). */
const grid = () => within(screen.getByRole('region', { name: 'All movies' }))

describe('connection screen', () => {
  it('shows a clear error for bad credentials and stays on the form', async () => {
    await signIn(mock.url, 'tester', 'wrong')
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password.')
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  })

  it('shows a clear error for a malformed address without calling the network', async () => {
    const before = mock.requests.length
    await signIn('ftp://nope')
    expect(await screen.findByRole('alert')).toHaveTextContent(/http:\/\/ or https:\/\//)
    expect(mock.requests.length).toBe(before)
  })

  it('shows a clear error when the server is unreachable', async () => {
    await signIn('127.0.0.1:1')
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the server/)
  })

  it('shows a loading state while connecting', async () => {
    await signIn(mock.url)
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()
    await screen.findByRole('button', { name: 'Sign out' })
  })
})

describe('browsing', () => {
  it('lists movies with year, pages on demand, remembers the session across a reload, and signs out cleanly', async () => {
    const ui = await signIn(`${mock.url}/`)
    await screen.findByRole('button', { name: 'Sign out' })

    await card(/Open Test Movie 001 \(2001\)/)
    const first = await grid().findByRole('button', { name: /Open Test Movie 001 \(2001\)/ })
    expect(within(first).getByText('Test Movie 001')).toBeInTheDocument()
    expect(await screen.findByText('60 of 70 movies')).toBeInTheDocument()
    expect(grid().queryByRole('button', { name: /Test Movie 061/ })).not.toBeInTheDocument()

    await ui.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await grid().findByRole('button', { name: /Open Test Movie 070/ })).toBeInTheDocument()

    // Posters are plain image requests without credentials in the URL.
    const imgs = [...document.querySelectorAll('img')]
    expect(imgs.some((i) => /\/Items\/m0001\/Images\/Primary\?.*tag=tag1/.test(i.getAttribute('src') ?? ''))).toBe(true)
    expect(imgs.every((i) => !/token|ApiKey|api_key/i.test(i.getAttribute('src') ?? ''))).toBe(true)

    // A reload (new App instance, same tab) resumes the session without asking again.
    cleanup()
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Server URL')).not.toBeInTheDocument()

    const token = [...mock.tokens].at(-1) as string
    expect(sessionStorage.getItem('jellyflix.session')).toContain(token) // only the tab-lifetime store
    expect(localStorage.getItem('jellyflix.session')).toBeNull()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByLabelText('Server URL')).toBeInTheDocument()
    await waitFor(() => expect(mock.tokens.has(token)).toBe(false))
    expect(sessionStorage.getItem('jellyflix.session')).toBeNull()
    expect(localStorage.getItem('jellyflix.session')).toBeNull()
    expect(document.body.textContent).not.toContain(token)
    expect(localStorage.getItem('jellyflix.serverUrl')).toBe(mock.url)
  })

  it('features the newest movie that has a backdrop in a banner with Play and More info', async () => {
    const ui = await signIn(mock.url)
    const banner = within(await screen.findByRole('region', { name: 'Featured' }))
    // Movie 070 is the newest but has no backdrop (the mock gives them to odd-numbered movies only).
    expect(await banner.findByRole('heading', { name: 'Test Movie 069' })).toBeInTheDocument()
    expect(await banner.findByText(/Overview of test movie 69/)).toBeInTheDocument()
    expect(banner.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    await ui.click(banner.getByRole('button', { name: 'More info' }))
    expect(location.hash).toBe('#/movie/m0069')
  })

  it('lets you step through the featured titles with the dots and arrows', async () => {
    const ui = await signIn(mock.url)
    const banner = within(await screen.findByRole('region', { name: 'Featured' }))
    expect(await banner.findByRole('heading', { name: 'Test Movie 069' })).toBeInTheDocument()
    const dots = banner.getAllByRole('button', { name: /^Featured title/ })
    expect(dots).toHaveLength(8) // the two newest plus six picked from the whole library
    expect(dots[0]).toHaveAttribute('aria-current', 'true')

    await ui.click(banner.getByRole('button', { name: 'Next featured title' }))
    expect(banner.queryByRole('heading', { name: 'Test Movie 069' })).not.toBeInTheDocument()
    expect(await banner.findByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(banner.getAllByRole('button', { name: /^Featured title/ })[1]).toHaveAttribute('aria-current', 'true')

    await ui.click(banner.getByRole('button', { name: 'Previous featured title' }))
    expect(await banner.findByRole('heading', { name: 'Test Movie 069' })).toBeInTheDocument()
    await ui.click(banner.getByRole('button', { name: 'Previous featured title' })) // wraps around to the last one
    expect(banner.getAllByRole('button', { name: /^Featured title/ })[7]).toHaveAttribute('aria-current', 'true')
  })

  it('shows "Top rated in ..." rows for a few genres, and "See all" filters the library to that genre', async () => {
    const ui = await signIn(mock.url)
    await screen.findByRole('region', { name: 'Featured' })
    const rows = await screen.findAllByRole('region', { name: /^Top rated in / })
    expect(rows).toHaveLength(3)
    const genre = /^Top rated in (.+)$/.exec(rows[0]?.getAttribute('aria-label') ?? '')?.[1] as string
    expect(['Action', 'Drama', 'Comedy']).toContain(genre)
    // Ordered by rating, best first (the mock rates movie n as (n*7)%10 + 0.5).
    expect(within(rows[0] as HTMLElement).getAllByRole('button', { name: /^Open Test Movie/ }).length).toBeGreaterThanOrEqual(5)
    expect(mock.requests.filter((r) => r.path === '/Items' && r.queryAll.genres?.[0] === genre && r.queryAll.sortBy?.[0] === 'CommunityRating').length).toBeGreaterThan(0)

    await ui.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'See all' }))
    expect(await screen.findByRole('combobox', { name: 'Genre' })).toHaveValue(genre)
    expect(screen.queryByRole('region', { name: 'Featured' })).not.toBeInTheDocument() // rows give way to the filtered grid
  })

  it('"Keep me signed in" stores the session in localStorage instead', async () => {
    await signIn(mock.url, 'tester', 'secret', true)
    await screen.findByRole('button', { name: 'Sign out' })
    expect(localStorage.getItem('jellyflix.session')).toContain('token-')
    expect(sessionStorage.getItem('jellyflix.session')).toBeNull()
    expect(localStorage.getItem('jellyflix.keepSignedIn')).toBe('1')
    // The password is never stored anywhere.
    expect(JSON.stringify([localStorage.getItem('jellyflix.session'), localStorage.getItem('jellyflix.keepSignedIn')])).not.toContain('secret')
  })

  it('returns to the sign-in form with an explanation when the saved session was revoked', async () => {
    await signIn(mock.url)
    await screen.findByRole('button', { name: 'Sign out' })
    const token = [...mock.tokens].at(-1) as string
    mock.tokens.delete(token)
    cleanup()
    render(<App />)
    expect(await screen.findByLabelText('Server URL')).toBeInTheDocument()
    expect(sessionStorage.getItem('jellyflix.session')).toBeNull()
  })

  it('shows an explanation if the token is rejected while using the app', async () => {
    await signIn(mock.url)
    await screen.findByRole('button', { name: 'Sign out' })
    await card(/Open Test Movie 001 /)
    mock.tokens.clear() // revoked server-side while the app is open
    await userEvent.setup().click(screen.getByRole('button', { name: /Open Test Movie 002/ }))
    expect(await screen.findByText(/session expired/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Server URL')).toBeInTheDocument()
  })

  it('searches by title, shows the result count, and clears back to the home page', async () => {
    const ui = await signIn(mock.url)
    await card(/Open Test Movie 001 /)

    await ui.type(screen.getByRole('searchbox', { name: 'Search' }), 'Movie 06')
    expect(await screen.findByRole('heading', { name: /Results for/ })).toBeInTheDocument()
    expect(await screen.findByText('10 movies found')).toBeInTheDocument()
    expect(location.hash).toBe('#/search/Movie%2006')
    expect(await screen.findByRole('button', { name: /Open Test Movie 060/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Open Test Movie 001 /, hidden: true })[0]).not.toBeVisible()

    await ui.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Results for/ })).not.toBeInTheDocument())
    // With more than one library, clearing a search goes to the main page.
    expect(location.hash).toBe('#/')
    expect(await screen.findByRole('region', { name: 'Latest movies' })).toBeVisible()
  })

  it('says so when a search has no results', async () => {
    const ui = await signIn(mock.url)
    await card(/Open Test Movie 001 /)
    await ui.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzzz{Enter}')
    expect(await screen.findByText(/No movies match/)).toBeInTheDocument()
  })

  it('sorts, filters by genre and by favorites using server-side queries, and can reset', async () => {
    const ui = await signIn(mock.url)
    await card(/Open Test Movie 001 /)

    await ui.selectOptions(screen.getByLabelText('Sort by'), 'added')
    await waitFor(() => {
      const last = mock.requests.filter((r) => r.path === '/Items' && r.queryAll.sortBy?.[0] === 'DateCreated').at(-1)
      expect(last?.queryAll.sortOrder).toEqual(['Descending'])
    })
    expect(await grid().findByRole('button', { name: /Open Test Movie 070/ })).toBeInTheDocument() // newest first

    await ui.selectOptions(await screen.findByLabelText('Genre'), 'Action')
    await waitFor(() => expect(mock.requests.some((r) => r.queryAll.genres?.[0] === 'Action')).toBe(true))

    await ui.click(screen.getByRole('button', { name: 'Reset' }))
    expect(await card(/Open Test Movie 001 /)).toBeInTheDocument()
    expect(screen.getByLabelText('Sort by')).toHaveValue('title')
    expect(JSON.parse(localStorage.getItem('jellyflix.browse') ?? '{}')).toMatchObject({ sort: 'title', filter: 'all' })
  })

  it('shows "Continue watching" for partially watched movies and resumes them', async () => {
    // Watch movie 5 for 12 s, in another "device".
    const other = await connect(mock.url, 'tester', 'secret')
    const plan = await negotiatePlayback(other, 'm0005', { capabilities })
    const s = new PlaybackSession(other, plan, 12)
    s.playing(12, { paused: false, muted: false, volume: 1 })
    await s.stop({ paused: true, muted: false, volume: 1 })

    await signIn(mock.url)
    const row = await screen.findByRole('region', { name: 'Continue watching' })
    expect(within(row).getByRole('button', { name: 'Resume Test Movie 005' })).toBeInTheDocument()
    expect(within(row).getByText(/left/)).toBeInTheDocument()
    mock.resume.delete('m0005')
  })

  it('shows an empty state when the account has no movie library', async () => {
    const empty = await startMockJellyfin({ noMovieLibrary: true })
    try {
      await signIn(empty.url)
      // Its only library is the (empty) TV one, so the app starts there instead of on an empty movies page.
      await waitFor(() => expect(location.hash).toBe('#/series'))
      expect(await screen.findByText(/Nothing in “Shows” yet/)).toBeInTheDocument()
    } finally {
      await empty.close()
    }
  })

  it('shows an empty state for a library without movies', async () => {
    const none = await startMockJellyfin({ movieCount: 0 })
    try {
      await signIn(none.url)
      expect(await screen.findByText(/No movies in/)).toBeInTheDocument()
    } finally {
      await none.close()
    }
  })
})

describe('movie page', () => {
  it('shows details, toggles favorite and watched on the server, and goes back', async () => {
    const ui = await signIn(mock.url)
    await ui.click(await card(/Open Test Movie 003 /))

    expect(await screen.findByRole('heading', { name: 'Test Movie 003', level: 1 })).toBeInTheDocument()
    expect(location.hash).toBe('#/movie/m0003')
    expect(screen.getByText(/Overview of test movie 3/)).toBeInTheDocument()
    expect(screen.getByText('Tagline 3')).toBeInTheDocument()
    // The featured banner on the (hidden) home page shows the same rating, so look inside the movie page.
    expect(within(screen.getByRole('article', { name: 'Test Movie 003' })).getByText('PG-13')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Play$/ })).toBeInTheDocument()
    expect(screen.getByText('Dee Director')).toBeInTheDocument()
    expect(screen.getByText('Ada Actor')).toBeInTheDocument()
    expect(screen.getByText(/1080p · H264/i)).toBeInTheDocument()
    expect(screen.getAllByText(/English · AAC Stereo/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Plays as/)).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'More like this' })).toBeInTheDocument()

    const favorite = screen.getByRole('button', { name: /Add to favorites/ })
    await ui.click(favorite)
    await waitFor(() => expect(mock.user.favorites.has('m0003')).toBe(true))
    expect(await screen.findByRole('button', { name: /^Favorite$/ })).toHaveAttribute('aria-pressed', 'true')

    await ui.click(screen.getByRole('button', { name: /Mark watched/ }))
    await waitFor(() => expect(mock.user.played.has('m0003')).toBe(true))
    expect(await screen.findByRole('button', { name: /^Watched$/ })).toHaveAttribute('aria-pressed', 'true')

    await ui.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(location.hash).toBe('#/movies'))
    // The card in the grid reflects the change without reloading the list.
    const cardAfter = await grid().findByRole('button', { name: /Open Test Movie 003 / })
    expect(within(cardAfter).getByTitle('Watched')).toBeInTheDocument()
    // ...and the new favorite shows up in the Favorites row.
    const favorites = await screen.findByRole('region', { name: 'Your favorites' })
    expect(within(favorites).getByRole('button', { name: /Open Test Movie 003 / })).toBeInTheDocument()
    mock.user.favorites.clear()
    mock.user.played.clear()
  })

  it('opens a cast member to see their other movies, and Back returns to the movie', async () => {
    const ui = await signIn(mock.url)
    await ui.click(await card(/Open Test Movie 003 /))
    await ui.click(await screen.findByRole('button', { name: 'Movies with Ada Actor' }))
    expect(await screen.findByRole('heading', { name: 'Ada Actor', level: 1 })).toBeInTheDocument()
    expect(location.hash).toBe('#/person/p1?name=Ada%20Actor')
    expect(await screen.findByText('70 movies')).toBeInTheDocument()
    await ui.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Test Movie 003', level: 1 })).toBeInTheDocument()
  })

  it('"Surprise me" opens a random movie', async () => {
    const ui = await signIn(mock.url)
    await card(/Open Test Movie 001 /)
    await ui.click(screen.getByRole('button', { name: /Surprise me/ }))
    await waitFor(() => expect(location.hash).toMatch(/^#\/movie\/m\d{4}$/))
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('offers Resume and Start over for a partially watched movie', async () => {
    mock.resume.set('m0004', 90 * 10_000_000)
    const ui = await signIn(mock.url)
    await ui.click(await card(/Open Test Movie 004 /))
    expect(await screen.findByRole('button', { name: 'Resume from 1:30' })).toBeInTheDocument()
    await ui.click(screen.getByRole('button', { name: 'Start over' }))
    expect(location.hash).toBe('#/play/m0004?start=0')
    mock.resume.delete('m0004')
  })

  it('shows an error with retry when the movie cannot be loaded', async () => {
    history.replaceState(null, '', '#/movie/m9999')
    await signIn(mock.url)
    expect(await screen.findByText(/Could not load this movie/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('series and anime', () => {
  let shows: MockServer
  beforeAll(async () => {
    shows = await startMockJellyfin({ movieCount: 10, seriesCount: 3, animeCount: 2 })
  })
  afterAll(() => shows.close())

  const seriesGrid = async () => within(await screen.findByRole('region', { name: 'All series' }))
  const onTheSeriesPage = async (name: string) => within(await screen.findByRole('article', { name }))

  /** Watches an episode to (near) its end, or to `seconds`, as another device would. */
  async function watch(id: string, seconds: number) {
    const other = await connect(shows.url, 'tester', 'secret')
    const plan = await negotiatePlayback(other, id, { capabilities })
    const playback = new PlaybackSession(other, plan, seconds)
    playback.playing(seconds, { paused: false, muted: false, volume: 1 })
    await playback.stop({ paused: true, muted: false, volume: 1 })
  }

  it('offers Movies, Series and Anime tabs, and each opens its own library', async () => {
    const ui = await signIn(shows.url)
    const tabs = (await screen.findAllByRole('navigation', { name: 'Sections' }))[0] as HTMLElement
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Home', 'Movies', 'Series', 'Anime'])

    await ui.click(within(tabs).getByRole('button', { name: 'Series' }))
    expect(location.hash).toBe('#/series')
    expect(await (await seriesGrid()).findByRole('button', { name: /Open Test Show 001 \(2011\)/ })).toBeInTheDocument()
    expect((await seriesGrid()).queryByRole('button', { name: /Anime/ })).not.toBeInTheDocument()
    expect(await screen.findByText('3 of 3 series')).toBeInTheDocument()

    await ui.click(within(tabs).getByRole('button', { name: 'Anime' }))
    expect(location.hash).toBe('#/anime')
    expect(await (await seriesGrid()).findByRole('button', { name: /Open Test Anime 002/ })).toBeInTheDocument()
    expect(await screen.findByText('2 of 2 series')).toBeInTheDocument()

    await ui.click(within(tabs).getByRole('button', { name: 'Movies' }))
    expect(location.hash).toBe('#/movies')
  })

  it('shows an empty library kindly while Jellyfin is still scanning it', async () => {
    const empty = await startMockJellyfin({ movieCount: 3, seriesCount: 0 })
    try {
      history.replaceState(null, '', '#/series')
      await signIn(empty.url)
      expect(await screen.findByText(/Nothing in “Shows” yet/)).toBeInTheDocument()
      expect(screen.getByText(/still scanning/)).toBeInTheDocument()
    } finally {
      await empty.close()
    }
  })

  it('starts on the series page when the account has no movie library', async () => {
    const noMovies = await startMockJellyfin({ noMovieLibrary: true, seriesCount: 2 })
    try {
      await signIn(noMovies.url)
      await waitFor(() => expect(location.hash).toBe('#/series'))
      expect(await (await seriesGrid()).findByRole('button', { name: /Open Test Show 001/ })).toBeInTheDocument()
    } finally {
      await noMovies.close()
    }
  })

  it('opens a series with seasons and episodes, plays the first episode, and marks episodes watched', async () => {
    history.replaceState(null, '', '#/series')
    const ui = await signIn(shows.url)
    await ui.click(await (await seriesGrid()).findByRole('button', { name: /Open Test Show 001/ }))
    expect(location.hash).toBe('#/show/s0001')

    const page = await onTheSeriesPage('Test Show 001')
    expect(await page.findByRole('heading', { name: 'Test Show 001', level: 1 })).toBeInTheDocument()
    expect(page.getByText(/Overview of Test Show 001/)).toBeInTheDocument()
    expect(page.getByText('2 seasons')).toBeInTheDocument()
    expect(await page.findByRole('button', { name: 'Play S1 E1' })).toBeEnabled()

    // Season 1 first, then season 2 from its tab.
    expect(await page.findByRole('button', { name: 'Play S1 E2 Episode Title 1-2' })).toBeInTheDocument()
    expect(page.getByText('Overview of episode 1x2.')).toBeInTheDocument()
    await ui.click(page.getByRole('tab', { name: 'Season 2' }))
    expect(await page.findByRole('button', { name: 'Play S2 E3 Episode Title 2-3' })).toBeInTheDocument()
    expect(page.queryByRole('button', { name: /Episode Title 1-2/ })).not.toBeInTheDocument()

    // One episode.
    await ui.click(page.getByRole('button', { name: 'Mark as watched: S2 E1 Episode Title 2-1' }))
    await waitFor(() => expect(shows.user.played.has('s0001-ep-2-1')).toBe(true))
    expect(await page.findByRole('button', { name: 'Mark as unwatched: S2 E1 Episode Title 2-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await ui.click(page.getByRole('button', { name: 'Mark as unwatched: S2 E1 Episode Title 2-1' }))
    await waitFor(() => expect(shows.user.played.has('s0001-ep-2-1')).toBe(false))

    // A whole season, and the view stays on that season.
    await ui.click(page.getByRole('button', { name: 'Mark season watched' }))
    await waitFor(() =>
      expect(['s0001-ep-2-1', 's0001-ep-2-2', 's0001-ep-2-3'].every((id) => shows.user.played.has(id))).toBe(true),
    )
    expect(await page.findByRole('button', { name: 'Mark season unwatched' })).toBeInTheDocument()
    expect(page.getByRole('tab', { name: 'Season 2' })).toHaveAttribute('aria-selected', 'true')
    for (const id of ['s0001-ep-2-1', 's0001-ep-2-2', 's0001-ep-2-3']) shows.user.played.delete(id)

    await ui.click(page.getByRole('button', { name: 'Play S1 E1' }))
    expect(location.hash).toBe('#/play/s0001-ep-1-1')
  })

  it('offers "Find intros" for a season to an administrator whose server has Intro Skipper', async () => {
    history.replaceState(null, '', '#/show/s0001')
    const ui = await signIn(shows.url)
    const page = await onTheSeriesPage('Test Show 001')
    await ui.click(await page.findByRole('button', { name: 'Find intros' }))
    expect(await page.findByRole('button', { name: 'Looking for intros…' })).toBeDisabled()
    expect(shows.taskLog.at(-1)).toMatch(/^scan /)
  })

  it('marks a whole series watched and favourite', async () => {
    history.replaceState(null, '', '#/show/s0002')
    const ui = await signIn(shows.url)
    const page = await onTheSeriesPage('Test Show 002')
    await ui.click(await page.findByRole('button', { name: /Mark watched/ }))
    await waitFor(() => expect(episodeIds('s0002').every((id) => shows.user.played.has(id))).toBe(true))
    expect(await page.findByRole('button', { name: /^Watched$/ })).toHaveAttribute('aria-pressed', 'true')
    await ui.click(page.getByRole('button', { name: /^Watched$/ }))
    await waitFor(() => expect(episodeIds('s0002').some((id) => shows.user.played.has(id))).toBe(false))
    await ui.click(page.getByRole('button', { name: /Add to favorites/ }))
    await waitFor(() => expect(shows.user.favorites.has('s0002')).toBe(true))
    shows.user.favorites.delete('s0002')
  })

  it('shows "Continue watching" and "Next up" for the series you are following', async () => {
    await watch('a0001-ep-1-1', 29) // finished: the next episode is up next
    await watch('a0002-ep-1-2', 12) // half-watched
    history.replaceState(null, '', '#/anime')
    const ui = await signIn(shows.url)
    const resume = await screen.findByRole('region', { name: 'Continue watching' })
    expect(within(resume).getByRole('button', { name: 'Resume Test Anime 002 S1 E2' })).toBeInTheDocument()
    const upNext = await screen.findByRole('region', { name: 'Next up' })
    expect(within(upNext).getByRole('button', { name: 'Play Test Anime 001 S1 E2' })).toBeInTheDocument()
    expect(within(upNext).getByText(/Up next/)).toBeInTheDocument()

    // The series page's Play button picks up where you were.
    await ui.click(await (await seriesGrid()).findByRole('button', { name: /Open Test Anime 002/ }))
    expect(await (await onTheSeriesPage('Test Anime 002')).findByRole('button', { name: 'Resume S1 E2' })).toBeInTheDocument()
  })

  it('finds series and episodes by search', async () => {
    const ui = await signIn(shows.url)
    await ui.type(await screen.findByRole('searchbox', { name: 'Search' }), 'Show 00')
    const found = await screen.findByRole('region', { name: 'Series' })
    expect(await within(found).findByText('3 series found')).toBeInTheDocument()
    await ui.click(within(found).getByRole('button', { name: /Open Test Show 002/ }))
    expect(location.hash).toBe('#/show/s0002')

    await ui.clear(screen.getByRole('searchbox', { name: 'Search' }))
    await ui.type(screen.getByRole('searchbox', { name: 'Search' }), 'Title 2-3')
    await screen.findByRole('heading', { name: /Results for/ })
    const episodes = await screen.findByRole('region', { name: 'Episodes' })
    expect(await within(episodes).findAllByRole('button', { name: /Episode Title 2-3/ })).toHaveLength(5)
    expect(screen.queryByRole('region', { name: 'Movies' })).not.toBeInTheDocument()
  })
})

/** Ids of every episode in a mock series (2 seasons x 3 episodes). */
function episodeIds(show: string): string[] {
  return [1, 2].flatMap((season) => [1, 2, 3].map((episode) => `${show}-ep-${season}-${episode}`))
}

describe('settings', () => {
  it('shows the account, saves playback and banner choices, forgets remembered series choices, and signs out', async () => {
    localStorage.setItem('jellyflix.series', JSON.stringify({ s1: { audioLanguage: 'jpn' }, s2: { subtitleLanguage: 'eng' } }))
    localStorage.setItem('jellyflix.player', JSON.stringify({ subtitleLanguage: 'eng' }))
    const ui = await signIn(mock.url)
    await ui.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(location.hash).toBe('#/settings')

    const account = within(await screen.findByRole('region', { name: 'Account' }))
    expect(account.getByText('tester')).toBeInTheDocument()
    expect(account.getByText(/Mock Jellyfin/)).toBeInTheDocument()

    // The page is in tabs: General (account, interface, install), Appearance, Playback, Devices, Plugins and About.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['General', 'Appearance', 'Playback', 'Devices', 'Plugins', 'About'])
    await ui.click(screen.getByRole('tab', { name: 'Playback' }))
    const playback = within(screen.getByRole('region', { name: 'Playback' }))
    const autoplay = playback.getByRole('switch', { name: /Play the next episode automatically/ })
    expect(autoplay).toBeChecked()
    await ui.click(autoplay)
    expect(JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').autoplayNext).toBe(false)
    await ui.selectOptions(playback.getByLabelText('Subtitle size'), 'large')
    expect(JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').subtitleSize).toBe('large')
    expect(playback.getByText('English')).toBeInTheDocument()
    await ui.click(playback.getByRole('button', { name: 'Turn off' }))
    expect(JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').subtitleLanguage).toBeNull()

    await ui.click(screen.getByRole('tab', { name: 'General' }))
    const banner = screen.getByRole('switch', { name: /Rotate the featured banner/ })
    await ui.click(banner)
    expect(JSON.parse(localStorage.getItem('jellyflix.ui') ?? '{}').autoRotateBanner).toBe(false)

    await ui.click(screen.getByRole('tab', { name: 'About' }))
    const saved = within(screen.getByRole('region', { name: 'Saved on this device' }))
    expect(saved.getByText(/remembered for 2 series/)).toBeInTheDocument()
    await ui.click(saved.getByRole('button', { name: 'Forget them' }))
    expect(localStorage.getItem('jellyflix.series')).toBeNull()
    expect(saved.getByText(/remembered for 0 series/)).toBeInTheDocument()

    await ui.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('region', { name: 'All movies' })).toBeInTheDocument()
    await ui.click(screen.getByRole('button', { name: 'Settings' }))
    await ui.click(within(await screen.findByRole('region', { name: 'Account' })).getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByLabelText('Server URL')).toBeInTheDocument()
  })
})

describe('music', () => {
  let songs: MockServer
  beforeAll(async () => {
    songs = await startMockJellyfin({ movieCount: 3, musicArtists: 3 })
  })
  afterAll(() => songs.close())

  const player = () => screen.findByRole('region', { name: 'Music player' })
  const onPage = async (name: string) => within(await screen.findByRole('article', { name }))
  async function openMusic(ui: Awaited<ReturnType<typeof signIn>>) {
    const tabs = (await screen.findAllByRole('navigation', { name: 'Sections' }))[0] as HTMLElement
    await ui.click(within(tabs).getByRole('button', { name: 'Music' }))
    expect(location.hash).toBe('#/music')
  }

  it('adds a Music tab, with a home of albums, playlists and discoveries', async () => {
    const ui = await signIn(songs.url)
    const tabs = (await screen.findAllByRole('navigation', { name: 'Sections' }))[0] as HTMLElement
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Home', 'Movies', 'Series', 'Music'])
    await openMusic(ui)
    const added = await screen.findByRole('region', { name: 'Recently added' })
    expect(within(added).getByRole('button', { name: 'Open album Album 003-2' })).toBeInTheDocument()
    const playlists = await screen.findByRole('region', { name: 'Your playlists' })
    expect(within(playlists).getByRole('button', { name: 'Open playlist Road trip' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Discover' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Shuffle all/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Music player' })).not.toBeInTheDocument() // nothing queued yet
  })

  it('opens an album, plays a song with the rest of the album queued, and the player bar follows you around', async () => {
    history.replaceState(null, '', '#/music')
    const ui = await signIn(songs.url)
    const recent = await screen.findByRole('region', { name: 'Recently added' })
    await ui.click(await within(recent).findByRole('button', { name: 'Open album Album 002-1' }))
    expect(location.hash).toBe('#/album/al0002-1')
    const album = await onPage('Album 002-1')
    expect(await album.findByRole('heading', { name: 'Album 002-1', level: 1 })).toBeInTheDocument()
    expect(album.getByRole('button', { name: 'Test Artist 002' })).toBeInTheDocument()
    expect(await album.findByText(/4 songs · 2m/)).toBeInTheDocument()

    await ui.click(await album.findByRole('button', { name: 'Play Song 1.2 by Test Artist 002' }))
    const bar = within(await player())
    expect(bar.getByText('Song 1.2')).toBeInTheDocument()

    // The bar stays when moving to other pages, and next moves down the album.
    await ui.click(album.getByRole('button', { name: 'Back' }))
    expect(location.hash).toBe('#/music')
    const stillThere = within(await player())
    await ui.click(stillThere.getByRole('button', { name: 'Next song' }))
    expect(stillThere.getByText('Song 1.3')).toBeInTheDocument()
    await ui.click(stillThere.getByRole('button', { name: 'Previous song' }))
    expect(stillThere.getByText('Song 1.2')).toBeInTheDocument() // no time has passed in the song, so it goes back one

    await ui.click(stillThere.getByRole('button', { name: 'Close the music player' }))
    expect(screen.queryByRole('region', { name: 'Music player' })).not.toBeInTheDocument()
  })

  it('shows the queue in the full-screen player, and lets you add, jump, remove and clear', async () => {
    history.replaceState(null, '', '#/album/al0001-1')
    const ui = await signIn(songs.url)
    const album = await onPage('Album 001-1')
    await ui.click(await album.findByRole('button', { name: 'Play Song 1.1 by Test Artist 001' }))
    await ui.click(album.getByRole('button', { name: 'Add Song 1.4 to the queue' }))
    await ui.click(album.getByRole('button', { name: 'Play Song 1.3 next' }))

    await ui.click(within(await player()).getByRole('button', { name: 'Queue' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Now playing' }))
    const queue = within(sheet.getByRole('complementary', { name: 'Queue' }))
    const titles = () => queue.getAllByRole('button', { name: /^Play / }).map((b) => b.getAttribute('aria-label'))
    // Song 1.1 is playing; the rest of the album follows, with 1.3 added right after the playing song and 1.4 at the end.
    expect(titles()).toEqual([
      'Play Song 1.3 by Test Artist 001',
      'Play Song 1.2 by Test Artist 001',
      'Play Song 1.3 by Test Artist 001',
      'Play Song 1.4 by Test Artist 001',
      'Play Song 1.4 by Test Artist 001',
    ])
    await ui.click(queue.getByRole('button', { name: 'Remove Song 1.2 from the queue' }))
    expect(titles()).toHaveLength(4)
    await ui.click(queue.getAllByRole('button', { name: 'Play Song 1.4 by Test Artist 001' })[0] as HTMLElement)
    expect(sheet.getAllByText('Song 1.4').length).toBeGreaterThan(0)

    await ui.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Now playing' })).not.toBeInTheDocument()
  })

  it('opens the words from the player bar, large and in the middle, and goes back to the player', async () => {
    history.replaceState(null, '', '#/album/al0001-1')
    const ui = await signIn(songs.url)
    const album = await onPage('Album 001-1')
    await ui.click(await album.findByRole('button', { name: 'Play Song 1.1 by Test Artist 001' }))

    await ui.click(within(await player()).getByRole('button', { name: 'Lyrics' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Now playing' }))
    // The words are in their own view, not a tab beside the queue; the queue is not on screen.
    const words = sheet.getByRole('region', { name: 'Lyrics' })
    expect(await within(words).findByText('First line')).toBeInTheDocument()
    expect(sheet.queryByRole('tab')).not.toBeInTheDocument()
    expect(sheet.queryByRole('complementary', { name: 'Queue' })).not.toBeInTheDocument()
    // The player is still there, small, under the words.
    expect(sheet.getByRole('button', { name: 'Next song' })).toBeInTheDocument()

    // The tools are along the bottom, with the words; the top only has Close.
    expect(sheet.getByRole('button', { name: 'Lyrics' })).toHaveAttribute('aria-pressed', 'true')
    await ui.click(sheet.getByRole('button', { name: 'Lyrics' }))
    expect(sheet.queryByRole('region', { name: 'Lyrics' })).not.toBeInTheDocument()
    expect(sheet.getByRole('button', { name: 'Close the full-screen player' })).toBeInTheDocument()

    // The queue can be shown and put away; the song stays in the middle.
    expect(sheet.queryByRole('complementary', { name: 'Queue' })).not.toBeInTheDocument()
    await ui.click(sheet.getByRole('button', { name: 'Queue' }))
    expect(sheet.getByRole('complementary', { name: 'Queue' })).toBeInTheDocument()
    await ui.click(sheet.getByRole('button', { name: 'Queue' }))
    expect(sheet.queryByRole('complementary', { name: 'Queue' })).not.toBeInTheDocument()
  })

  it('browses all albums, artists, songs and playlists', async () => {
    history.replaceState(null, '', '#/music/albums')
    const ui = await signIn(songs.url)
    const albums = within(await screen.findByRole('region', { name: 'All albums' }))
    expect(await albums.findByRole('button', { name: 'Open album Album 001-1' })).toBeInTheDocument()
    expect(await screen.findByText('6 of 6 albums')).toBeInTheDocument()
    await ui.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'added')
    await waitFor(() =>
      expect(albums.getAllByRole('button', { name: /^Open album/ })[0]).toHaveAccessibleName('Open album Album 003-2'),
    )

    await ui.click(screen.getByRole('button', { name: 'Artists' }))
    expect(location.hash).toBe('#/music/artists')
    const artists = within(await screen.findByRole('region', { name: 'All artists' }))
    expect(await artists.findByRole('button', { name: 'Open artist Test Artist 002' })).toBeInTheDocument()
    await ui.type(screen.getByRole('searchbox', { name: 'Search artists' }), '003')
    await waitFor(() => expect(artists.queryByRole('button', { name: 'Open artist Test Artist 002' })).not.toBeInTheDocument())
    expect(await artists.findByRole('button', { name: 'Open artist Test Artist 003' })).toBeInTheDocument()

    await ui.click(screen.getByRole('button', { name: 'Songs' }))
    const songsList = within(await screen.findByRole('region', { name: 'All songs' }))
    expect(await screen.findByText('24 of 24 songs')).toBeInTheDocument()
    await ui.click(await songsList.findByRole('button', { name: 'Play Song 1.1 by Test Artist 001' }))
    expect(within(await player()).getByText('Song 1.1')).toBeInTheDocument()

    await ui.click(screen.getByRole('button', { name: 'Playlists' }))
    await ui.click(await screen.findByRole('button', { name: 'Open playlist Road trip' }))
    const playlist = await onPage('Road trip')
    expect(await playlist.findByText(/5 songs/)).toBeInTheDocument()
    expect(await playlist.findAllByRole('button', { name: /^Play Song .* by / })).toHaveLength(5)
  })

  it('opens an artist with their albums and plays all of their songs', async () => {
    history.replaceState(null, '', '#/artist/ar0002')
    const ui = await signIn(songs.url)
    const artist = await onPage('Test Artist 002')
    expect(await artist.findByText(/Biography of Test Artist 002/)).toBeInTheDocument()
    const albums = within(await artist.findByRole('region', { name: 'Albums' }))
    expect(albums.getAllByRole('button', { name: /^Open album/ })).toHaveLength(2)
    await waitFor(() => expect(artist.getByRole('button', { name: 'Play' })).toBeEnabled())
    await ui.click(artist.getByRole('button', { name: 'Play' }))
    expect(within(await player()).getByText(/Song \d\.\d/)).toBeInTheDocument()
  })

  it('hearts a song and saves it on the server', async () => {
    history.replaceState(null, '', '#/album/al0003-1')
    const ui = await signIn(songs.url)
    const album = await onPage('Album 003-1')
    await ui.click(await album.findByRole('button', { name: 'Add to favorites: Song 1.2' }))
    await waitFor(() => expect(songs.user.favorites.has('tr0003-1-2')).toBe(true))
    expect(await album.findByRole('button', { name: 'Remove from favorites: Song 1.2' })).toHaveAttribute('aria-pressed', 'true')
    songs.user.favorites.delete('tr0003-1-2')
  })

  it('finds albums, artists and songs by search', async () => {
    const ui = await signIn(songs.url)
    await ui.type(await screen.findByRole('searchbox', { name: 'Search' }), 'Album 002')
    const found = await screen.findByRole('region', { name: 'Albums' })
    expect(within(found).getAllByRole('button', { name: /^Open album/ })).toHaveLength(2)

    await ui.clear(screen.getByRole('searchbox', { name: 'Search' }))
    await ui.type(screen.getByRole('searchbox', { name: 'Search' }), 'Artist 003')
    const artists = await screen.findByRole('region', { name: 'Artists' })
    expect(within(artists).getByRole('button', { name: 'Open artist Test Artist 003' })).toBeInTheDocument()

    await ui.clear(screen.getByRole('searchbox', { name: 'Search' }))
    await ui.type(screen.getByRole('searchbox', { name: 'Search' }), 'Song 2.2')
    const tracks = await screen.findByRole('region', { name: 'Songs' })
    expect(await within(tracks).findAllByRole('button', { name: /^Play Song 2\.2 by/ })).toHaveLength(3)
  })
})

describe('main page and collections', () => {
  let everything: MockServer
  beforeAll(async () => {
    everything = await startMockJellyfin({ movieCount: 12, seriesCount: 3, animeCount: 2, musicArtists: 2, collections: 3 })
  })
  afterAll(() => everything.close())

  /** Watches something to `seconds`, as another device would. */
  async function watch(id: string, seconds: number) {
    const other = await connect(everything.url, 'tester', 'secret')
    const plan = await negotiatePlayback(other, id, { capabilities })
    const playback = new PlaybackSession(other, plan, seconds)
    playback.playing(seconds, { paused: false, muted: false, volume: 1 })
    await playback.stop({ paused: true, muted: false, volume: 1 })
  }

  it('opens on a main page with a banner of movies and series and rows from every library', async () => {
    history.replaceState(null, '', '#/')
    await signIn(everything.url)
    const banner = await screen.findByRole('region', { name: 'Featured' })
    expect(banner).toBeVisible()
    // Both movies and series are featured.
    const dots = within(banner).getAllByRole('button', { name: /^Featured title/ })
    expect(dots.length).toBeGreaterThan(3)
    expect(dots.some((d) => /Test Movie/.test(d.getAttribute('aria-label') ?? ''))).toBe(true)
    expect(dots.some((d) => /Test (Show|Anime)/.test(d.getAttribute('aria-label') ?? ''))).toBe(true)

    expect(await screen.findByRole('region', { name: 'Latest movies' })).toBeVisible()
    expect(await screen.findByRole('region', { name: 'New series' })).toBeVisible()
    expect(await screen.findByRole('region', { name: 'New anime' })).toBeVisible()
    expect(await screen.findByRole('region', { name: 'New in music' })).toBeVisible()
    expect(await screen.findByRole('region', { name: 'Collections' })).toBeVisible()
    const tabs = (await screen.findAllByRole('navigation', { name: 'Sections' }))[0] as HTMLElement
    expect(within(tabs).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    // Movies are still one tab away.
    expect(screen.queryByRole('region', { name: 'All movies' })).not.toBeInTheDocument()
  })

  it('goes back to the main page from the logo', async () => {
    history.replaceState(null, '', '#/movies')
    const ui = await signIn(everything.url)
    await screen.findByRole('region', { name: 'All movies' })
    await ui.click(screen.getAllByRole('button', { name: /Jellyflix/ })[0] as HTMLElement)
    await waitFor(() => expect(location.hash).toBe('#/'))
    expect(await screen.findByRole('region', { name: 'Discover' })).toBeVisible()
  })

  it('shows movies and episodes you left half-way in one Continue watching row', async () => {
    await watch('m0004', 12)
    await watch('a0001-ep-1-2', 14)
    history.replaceState(null, '', '#/')
    await signIn(everything.url)
    const row = await screen.findByRole('region', { name: 'Continue watching' })
    expect(await within(row).findByRole('button', { name: /^Resume Test Movie 004/ })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /^Resume Test Anime 001 S1 E2/ })).toBeInTheDocument()
    // The banner and the suggestions come first; Continue watching is the next thing down.
    const discover = await screen.findByRole('region', { name: 'Discover' }) // (the random picks are asked for last)
    expect(discover.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    everything.user.resume.clear()
    everything.user.lastPlayed.length = 0
  })

  it('suggests something random to watch or listen to, and lets you ask for another', async () => {
    history.replaceState(null, '', '#/')
    const ui = await signIn(everything.url)
    const discover = await screen.findByRole('region', { name: 'Discover' })

    const movie = await within(discover).findByRole('article', { name: 'Random movie' })
    expect(await within(movie).findByRole('heading', { level: 3 })).toHaveTextContent(/Test Movie/)
    expect(within(movie).getByRole('button', { name: /Play/ })).toBeInTheDocument()

    const series = await within(discover).findByRole('article', { name: 'Random series' })
    expect(await within(series).findByText(/Never watched/)).toBeInTheDocument()

    const music = await within(discover).findByRole('article', { name: 'Random music' })
    expect(await within(music).findByRole('button', { name: 'Play album' })).toBeInTheDocument()
    expect(within(music).getByRole('button', { name: 'Shuffle songs' })).toBeInTheDocument()

    // Another pick asks the server again.
    const picks = () => everything.requests.filter((r) => r.query.sortBy === 'Random' && r.query.includeItemTypes === 'Movie').length
    const before = picks()
    await ui.click(within(movie).getByRole('button', { name: 'Another random movie' }))
    await waitFor(() => expect(picks()).toBeGreaterThan(before))
  })

  it('starts the random series from its first episode', async () => {
    history.replaceState(null, '', '#/')
    const ui = await signIn(everything.url)
    const series = await screen.findByRole('article', { name: 'Random series' })
    await ui.click(await within(series).findByRole('button', { name: 'Start from the beginning' }))
    await waitFor(() => expect(location.hash).toMatch(/^#\/play\/[sa]\d{4}-ep-1-1$/))
  })

  it('plays the random music pick through the player bar', async () => {
    history.replaceState(null, '', '#/')
    const ui = await signIn(everything.url)
    const music = await screen.findByRole('article', { name: 'Random music' })
    await ui.click(await within(music).findByRole('button', { name: 'Play album' }))
    expect(await screen.findByRole('region', { name: 'Music player' })).toBeInTheDocument()
  })

  it('lists collections on the movies page and on their own page, and opens one to play from it', async () => {
    history.replaceState(null, '', '#/movies')
    const ui = await signIn(everything.url)
    const row = await screen.findByRole('region', { name: 'Collections' })
    expect(within(row).getAllByRole('button', { name: /^Open collection/ })).toHaveLength(3)
    await ui.click(within(row).getByRole('button', { name: /See all/ }))
    await waitFor(() => expect(location.hash).toBe('#/collections'))

    expect(await screen.findByRole('heading', { name: 'Collections', level: 1 })).toBeVisible()
    await ui.type(screen.getByRole('searchbox', { name: 'Search collections' }), 'collection 002')
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Open collection/ })).toHaveLength(1))

    await ui.click(screen.getByRole('button', { name: 'Open collection Test Collection 002' }))
    await waitFor(() => expect(location.hash).toBe('#/collection/bx0002'))
    const page = await screen.findByRole('article', { name: 'Test Collection 002' })
    expect(await within(page).findByText('3 titles')).toBeInTheDocument()
    expect(within(page).getByText(/The films of Test Collection 002/)).toBeInTheDocument()
    const inside = within(await within(page).findByRole('region', { name: 'In this collection' }))
    expect(await inside.findByRole('button', { name: /Open Test Movie 004/ })).toBeInTheDocument()
    expect(inside.getAllByRole('button', { name: /^Open Test Movie/ })).toHaveLength(3)

    await ui.click(within(page).getByRole('button', { name: /^Play$/ }))
    await waitFor(() => expect(location.hash).toMatch(/^#\/play\/m000[456]$/))
  })

  it('marks a collection as a favorite on the server', async () => {
    history.replaceState(null, '', '#/collection/bx0003')
    const ui = await signIn(everything.url)
    const page = await screen.findByRole('article', { name: 'Test Collection 003' })
    await ui.click(await within(page).findByRole('button', { name: 'Add to favorites' }))
    await waitFor(() => expect(everything.user.favorites.has('bx0003')).toBe(true))
    expect(await within(page).findByRole('button', { name: 'Favorite' })).toHaveAttribute('aria-pressed', 'true')
    everything.user.favorites.delete('bx0003')
  })

  it('finds collections by search', async () => {
    history.replaceState(null, '', '#/movies')
    const ui = await signIn(everything.url)
    await ui.type(await screen.findByRole('searchbox', { name: 'Search' }), 'collection 001')
    const found = await screen.findByRole('region', { name: 'Collections' })
    expect(within(found).getByRole('button', { name: 'Open collection Test Collection 001' })).toBeInTheDocument()
  })
})
