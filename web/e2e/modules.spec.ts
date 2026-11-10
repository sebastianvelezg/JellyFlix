import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer as createSocketServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { MockServer } from '../test/mock/mockJellyfin'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fakeSeerr, REQUEST, SEERR_KEY, type FakeSeerr } from '../../modules/server/test/fakeSeerr.ts'
import { signIn, startMock, waitPlaying } from './helpers'

/**
 * The optional modules container, against the real container code (started as a child process) and the mock Jellyfin server.
 * The first tests are the promise: without a container, or with one that is not answering, the app is the app without modules.
 */
let mock: MockServer
let container: ChildProcess | undefined
let dataDir = ''
test.afterEach(async () => {
  await mock?.close()
  // (On Windows the database file stays locked until the process has really ended.)
  if (container && container.exitCode === null) await new Promise<void>((done) => { container?.once('exit', () => done()); container?.kill() })
  container = undefined
  if (dataDir) rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  dataDir = ''
})

const freePort = () =>
  new Promise<number>((resolvePort, reject) => {
    const server = createSocketServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolvePort(port))
    })
  })

/** Starts the modules container (the real code) against the mock server; returns its address. */
async function startContainer(jellyfinUrl: string, extraEnv: Record<string, string> = {}): Promise<string> {
  const port = await freePort()
  dataDir = mkdtempSync(join(tmpdir(), 'jellyflix-modules-'))
  container = spawn(process.execPath, [resolve(import.meta.dirname, '..', '..', 'modules', 'server', 'src', 'main.ts')], {
    env: { ...process.env, JELLYFIN_URL: jellyfinUrl, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', NODE_OPTIONS: '--disable-warning=ExperimentalWarning', ...extraEnv },
    stdio: 'ignore',
  })
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 50; i += 1) {
    try {
      if ((await fetch(`${url}/v1/health`)).ok) return url
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('The modules container did not start.')
}

const withModulesAt = (page: Page, url: string) => page.addInitScript((u) => localStorage.setItem('jellyflix.modulesUrl', u), url)
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })

async function axe(page: Page, label: string) {
  await page.waitForLoadState('networkidle')
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`), label).toEqual([])
}

test('without a modules container the app is the app without modules: no button, no page, no request to anyone but the server', async ({ page }) => {
  mock = await startMock({ movieCount: 3, seriesCount: 1 })
  const origins = new Set<string>()
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol.startsWith('http')) origins.add(url.origin)
  })
  await signIn(page, mock, { start: '/#/' })
  await page.waitForLoadState('networkidle')
  await expect(tabs(page).getByRole('button', { name: 'Modules' })).toHaveCount(0)
  // A link to the page leads to the main page.
  await page.goto('/#/modules/channels')
  await expect(page.getByRole('heading', { name: 'Retro TV' })).toHaveCount(0)
  expect([...origins].filter((o) => o !== new URL(mock.url).origin && o !== new URL(page.url()).origin)).toEqual([])
})

test('with an address that does not answer, nothing shows and the app keeps working', async ({ page }) => {
  mock = await startMock({ movieCount: 3, seriesCount: 1 })
  await withModulesAt(page, `http://127.0.0.1:${await freePort()}`)
  await signIn(page, mock, { start: '/#/' })
  await page.waitForLoadState('networkidle')
  await expect(tabs(page).getByRole('button', { name: 'Modules' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await tabs(page).getByRole('button', { name: 'Movies' }).click()
  await expect(page.getByRole('region', { name: 'All movies' })).toBeVisible()
})

test('with the container: a Modules tab, channels made in one go, and tuning in plays the title that is on', async ({ page }) => {
  mock = await startMock({ movieCount: 12 })
  await withModulesAt(page, await startContainer(mock.url))
  await signIn(page, mock, { start: '/#/' })
  await tabs(page).getByRole('button', { name: 'Modules' }).click()
  await expect(page.getByRole('heading', { name: 'Modules', level: 1 })).toBeVisible()
  await axe(page, 'modules page')

  // The channels page starts empty; an administrator sets the channels up in its own tab.
  await page.getByRole('button', { name: 'Open the channels' }).click()
  await expect(page.getByText('There are no channels on yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Set up channels' }).click()
  await page.getByRole('button', { name: 'Quick channels' }).click()
  await page.getByText('Action', { exact: true }).click()
  await page.getByText('Comedy', { exact: true }).click()
  await page.getByRole('button', { name: 'Make 2 channels' }).click()
  await expect(page.getByRole('button', { name: 'Edit channel Action' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit channel Comedy' })).toBeVisible()
  await axe(page, 'set up channels')

  // A channel that is off is not on the "On now" tab, and is again when it is turned on.
  await page.getByRole('switch', { name: 'Channel Comedy is on' }).click()
  await expect(page.getByText('The channel is off.')).toBeVisible()
  await page.getByRole('tab', { name: 'On now' }).click()
  await expect(page.getByRole('button', { name: 'Watch channel Comedy' })).toHaveCount(0)
  const watch = page.getByRole('button', { name: 'Watch channel Action' })
  await expect(watch).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0) // no set-up buttons on the cards
  await axe(page, 'channels page')
  await page.getByRole('tab', { name: 'Set up' }).click()
  await page.getByRole('switch', { name: 'Channel Comedy is on' }).click()
  await expect(page.getByText('The channel is on.')).toBeVisible()
  await page.getByRole('tab', { name: 'On now' }).click()
  await expect(page.getByRole('button', { name: 'Watch channel Comedy' })).toBeVisible()

  await watch.click()
  await waitPlaying(page)
  await expect(page).toHaveURL(/#\/channel\//)
  // A television says what is on and what comes next for a moment when you tune in.
  await expect(page.getByText('Now', { exact: true })).toBeVisible()
  const first = await page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-testid=video]')?.currentSrc ?? '')

  // The controls are one panel: what is on, the progress bar and the buttons of a channel (no ten-second jumps, no title at the top).
  const tv = page.getByRole('region', { name: /^Playing / })
  await page.mouse.move(300, 300)
  await expect(tv.getByText('LIVE')).toBeVisible()
  await expect(tv.getByRole('button', { name: 'Back 10 seconds' })).toHaveCount(0)
  await expect(tv.getByRole('slider', { name: 'Seek' })).toBeAttached()
  await expect(tv.getByRole('slider', { name: 'Volume' })).toBeAttached()
  await expect(tv.getByRole('button', { name: 'Previous program' })).toBeVisible()
  await expect(tv.getByRole('button', { name: 'Guide of this channel' })).toBeVisible()
  await axe(page, 'channel player')

  await tv.getByRole('button', { name: 'Next program' }).click()
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-testid=video]')?.currentSrc ?? '')).not.toBe(first)
  await waitPlaying(page)
  // Skipping ahead takes the viewer away from the live moment, and "Go live" brings the viewer back.
  await page.mouse.move(320, 320)
  await expect(tv.getByText(/ahead|behind/)).toBeVisible({ timeout: 5000 })
  await tv.getByRole('button', { name: 'Go live' }).click()
  await expect(tv.getByText('LIVE')).toBeVisible()
  // The previous program (or, on a channel made a moment ago that has none, the same one from its start), and starting over.
  await page.mouse.move(340, 340)
  await tv.getByRole('button', { name: 'Previous program' }).click()
  await waitPlaying(page)
  await page.mouse.move(360, 360)
  await tv.getByRole('button', { name: 'Start this program over' }).click()
  await waitPlaying(page)

  // The guide of this channel opens over the picture (it does not leave the channel); Escape closes it, and it can go to all of them.
  await page.mouse.move(380, 380)
  await tv.getByRole('button', { name: 'Guide of this channel' }).click()
  const guide = page.getByRole('dialog', { name: 'Guide of Action' })
  await expect(guide).toBeVisible()
  await expect(page).toHaveURL(/#\/channel\//)
  await expect(guide.getByText('Live', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(guide).toHaveCount(0)
  await expect(page).toHaveURL(/#\/channel\//)

  // Channel up goes to the next channel.
  await page.mouse.move(400, 400)
  await tv.getByRole('button', { name: 'Channel up' }).click()
  await expect(page).toHaveURL(/#\/channel\//)
  await expect(page.getByRole('region', { name: /^Playing / })).toBeVisible()

  // Full screen stays when the channel changes, and the arrow at the top leaves the channel and full screen together.
  await page.mouse.move(420, 420)
  await page.getByRole('region', { name: /^Playing / }).getByRole('button', { name: 'Fullscreen' }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await page.mouse.move(430, 430)
  await page.getByRole('region', { name: /^Playing / }).getByRole('button', { name: 'Channel down' }).click()
  await expect(page.getByRole('region', { name: /^Playing / })).toBeVisible()
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await page.mouse.move(440, 440)
  await page.getByRole('region', { name: /^Playing / }).getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveURL(/#\/modules\/channels$/)
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false)
})

test('Match on phones: the screen opens a lobby with a QR code, a phone joins by the link, the host starts it, the phone swipes, and the screen plays the winner and shows how it went', async ({ page, browser }) => {
  mock = await startMock({ movieCount: 20 })
  const modulesUrl = await startContainer(mock.url)
  await withModulesAt(page, modulesUrl)
  await signIn(page, mock, { start: '/#/modules/match' })

  // The first choice is how to play; the second what to watch (chips to tap).
  await expect(page.getByRole('heading', { name: 'What are we watching tonight?' })).toBeVisible()
  await axe(page, 'match start')
  await page.getByRole('button', { name: /Each on their phone/ }).click()
  await expect(page.getByRole('heading', { name: 'What do you feel like?' })).toBeVisible()
  await page.getByRole('radio', { name: 'Comedy' }).click()
  await page.getByRole('radio', { name: 'Under 90 minutes' }).click()
  await page.getByRole('radio', { name: '6', exact: true }).click()
  await axe(page, 'match setup')
  await page.getByRole('button', { name: 'Open the lobby' }).click()

  // The lobby of the screen: the QR code, nobody in yet, and no cards.
  await expect(page.getByRole('img', { name: 'QR code to join this Match' })).toBeVisible()
  await expect(page.getByText('Nobody yet. Scan the code with your phone.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Waiting for people…' })).toBeDisabled()
  await expect(page.getByRole('group', { name: /Cards to swipe/ })).toHaveCount(0)
  await axe(page, 'match lobby')
  const code = (await page.locator('section[aria-label="Invite"] .font-mono').textContent())?.trim() ?? ''
  expect(code).toHaveLength(5)

  // The phone: another browser, the link of the invitation. It joins by itself and waits for the host.
  const phoneContext = await browser.newContext()
  const phone = await phoneContext.newPage()
  await withModulesAt(phone, modulesUrl)
  await signIn(phone, mock, { start: `/#/modules/match?join=${code}` })
  await expect(phone.getByText('You are in!')).toBeVisible()
  // (The mock has one account, so this phone is also the host's: it can start the swiping too. For anybody else it says it is waiting.)
  await expect(phone.getByText('Start the swiping when everybody has joined.')).toBeVisible()
  // The screen sees who came, and the host starts the swiping.
  await expect(page.getByRole('region', { name: 'Who is in' })).toContainText('tester')
  await page.getByRole('button', { name: /Start swiping \(1 in\)/ }).click()
  await expect(page.getByRole('region', { name: 'Round 1' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'The cards of this round' }).getByRole('listitem')).toHaveCount(6)

  const deck = phone.getByRole('group', { name: /Cards to swipe/ })
  await expect(deck).toBeVisible()
  await axe(phone, 'match phone deck')
  for (let i = 0; i < 6; i += 1) {
    await phone.keyboard.press(i === 1 ? 'ArrowRight' : 'ArrowLeft')
    await phone.waitForTimeout(350)
  }
  // The phone is told where it plays; the screen has the winner, the Play button and how it went.
  await expect(phone.getByText('The screen where this Match started will play it.')).toBeVisible()
  await expect(phone.getByRole('button', { name: 'Play here' })).toHaveCount(0)
  await expect(phone.getByRole('region', { name: 'How it went' })).toBeVisible()
  await expect(page.getByText('It is a match', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('region', { name: 'How it went' })).toContainText('You agreed on 1 of 6 films')
  await axe(page, 'match winner and summary')
  await page.getByRole('button', { name: 'Play here' }).click()
  await expect(page).toHaveURL(/#\/play\//)
  await waitPlaying(page)
  await phoneContext.close()
})

test('Match on one device: choose the films, swipe here, and play the winner', async ({ page }) => {
  mock = await startMock({ movieCount: 12 })
  await withModulesAt(page, await startContainer(mock.url))
  await signIn(page, mock, { start: '/#/modules/match' })
  await page.getByRole('button', { name: /On this device/ }).click()
  await page.getByRole('radio', { name: '6', exact: true }).click()
  await page.getByRole('button', { name: 'Start swiping' }).click()
  await expect(page.getByText('Round 1')).toBeVisible()
  const deck = page.getByRole('group', { name: /Cards to swipe/ })
  await expect(deck).toBeVisible()
  // No QR code, no lobby and nobody to wait for: it is all here.
  await expect(page.getByRole('img', { name: 'QR code to join this Match' })).toHaveCount(0)
  await axe(page, 'match deck')
  // Like the third film, pass on the others, with the keyboard.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press(i === 2 ? 'ArrowRight' : 'ArrowLeft')
    await page.waitForTimeout(350)
  }
  await expect(page.getByText('It is a match', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play here' }).click()
  await expect(page).toHaveURL(/#\/play\//)
  await waitPlaying(page)
})

/** The small Seerr of the container's tests, behind a real HTTP port (what the real container talks to). */
async function serveSeerr(seerr: FakeSeerr): Promise<{ url: string; close: () => void }> {
  const server = createHttpServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]))
      void seerr.fetch(`http://seerr.test${req.url ?? '/'}`, { method: req.method ?? 'GET', headers, ...(body ? { body } : {}) }).then(async (answer) => {
        res.writeHead(answer.status, { 'content-type': 'application/json' }).end(await answer.text())
      })
    })
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() }
}

test('Seerr: search, see where each title stands, ask for a movie and for some seasons, and see my requests', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  const seerr = fakeSeerr()
  // The mock Jellyfin's account is the Seerr user 7, who may request.
  seerr.users['user1'] = { id: 7, permissions: REQUEST }
  const served = await serveSeerr(seerr)
  try {
    await page.route('https://image.tmdb.org/**', (route) => route.abort())
    const modulesUrl = await startContainer(mock.url, { JELLYFLIX_MODULES: 'seerr', SEERR_URL: served.url, SEERR_API_KEY: SEERR_KEY })
    await withModulesAt(page, modulesUrl)
    await signIn(page, mock, { start: '/#/modules' })
    await expect(page.getByRole('heading', { name: 'Modules', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Search and request' }).click()
    await expect(page.getByRole('searchbox', { name: 'Search for a movie or series' })).toBeVisible()
    await axe(page, 'seerr page')

    await page.getByRole('searchbox', { name: 'Search for a movie or series' }).fill('matrix')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const results = page.getByRole('list', { name: 'Results' })
    await expect(results.getByRole('button', { name: /^The Matrix Movie 1999 In your library$/ })).toBeVisible()
    await expect(results.getByRole('button', { name: /^The Matrix Reloaded Movie 2003 Being added$/ })).toBeVisible()
    await axe(page, 'seerr results')

    // A movie: the quota is said, and asking sends Seerr only the kind and the number.
    await results.getByRole('button', { name: /^The Matrix Reloaded Movie 2003 Being added$/ }).click()
    await expect(page.getByText('Requests left: 1 of 2 every 7 days.')).toBeVisible()
    await page.getByRole('button', { name: 'Request this movie' }).click()
    await expect.poll(() => seerr.requests.map((r) => r.body)).toEqual([{ mediaType: 'movie', mediaId: 604 }])
    await page.getByRole('button', { name: '← Results' }).click()

    // A series: the seasons that are not there are ticked, the one that is cannot be.
    await results.getByRole('button', { name: /^Breaking Bad Series 2008 Partly in your library$/ }).click()
    await expect(page.getByRole('checkbox', { name: /Season 1/ })).toBeDisabled()
    await page.getByRole('checkbox', { name: /Season 2/ }).uncheck()
    await axe(page, 'seerr series')
    await page.getByRole('button', { name: 'Request the chosen seasons' }).click()
    await expect.poll(() => seerr.requests.map((r) => r.body)).toEqual([{ mediaType: 'movie', mediaId: 604 }, { mediaType: 'tv', mediaId: 1396, seasons: [3] }])
    // Seerr was asked as the person (user 7), never as the administrator.
    expect(seerr.requests.every((r) => r.userId === 7)).toBe(true)

    await page.getByRole('tab', { name: 'My requests' }).click()
    await expect(page.getByText('Seasons 3')).toBeVisible()
    await axe(page, 'seerr requests')
  } finally {
    served.close()
  }
})

test('Seerr: what the library does not have can be looked up from its search, in a block of its own, and only when Seerr is there', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  const seerr = fakeSeerr()
  seerr.users['user1'] = { id: 7, permissions: REQUEST }
  const served = await serveSeerr(seerr)
  try {
    await page.route('https://image.tmdb.org/**', (route) => route.abort())
    const modulesUrl = await startContainer(mock.url, { JELLYFLIX_MODULES: 'seerr', SEERR_URL: served.url, SEERR_API_KEY: SEERR_KEY })
    await withModulesAt(page, modulesUrl)
    await signIn(page, mock, { start: '/#/search/matrix%20reloaded' })
    // Nothing in the library: the offer comes with the text already written, apart from the results.
    await expect(page.getByText('nothing else in your library does either', { exact: false })).toBeVisible()
    const offer = page.getByRole('region', { name: 'Not in your library?' })
    await expect(offer).toBeVisible()
    await axe(page, 'search with the Seerr offer')
    await offer.getByRole('button', { name: 'Search “matrix reloaded” in Seerr' }).click()
    // The Seerr page opens with that search already made.
    await expect(page.getByRole('searchbox', { name: 'Search for a movie or series' })).toHaveValue('matrix reloaded')
    await expect(page.getByRole('list', { name: 'Results' }).getByRole('button', { name: /^The Matrix Reloaded Movie 2003/ })).toBeVisible()
    expect(page.url()).toContain('#/modules/seerr?q=matrix%20reloaded')
    expect(seerr.calls.find((c) => c.path === '/search')?.query.query).toBe('matrix reloaded')
  } finally {
    served.close()
  }
})

test('Seerr: the search of the library has no offer without a container', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock, { start: '/#/search/zzz' })
  await expect(page.getByText('nothing else in your library does either', { exact: false })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('region', { name: 'Not in your library?' })).toHaveCount(0)
})

test('Seerr: the search of the library has no offer when the container does not have Seerr turned on', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await withModulesAt(page, await startContainer(mock.url))
  await signIn(page, mock, { start: '/#/search/zzz' })
  await expect(page.getByText('nothing else in your library does either', { exact: false })).toBeVisible()
  await expect(tabs(page).getByRole('button', { name: 'Modules' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('region', { name: 'Not in your library?' })).toHaveCount(0)
})
