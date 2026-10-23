import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/** The administrator's editor: details with a review, locks, history, identify, refresh and pictures, in real Chrome against the mock. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 2, animeCount: 0, musicArtists: 2, collections: 0 }
// A 1 x 1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function openEditor(page: Page, id = 'm0001', name = 'Test Movie 001') {
  await page.goto(`/#/movie/${id}`)
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Edit ${name}` })
  await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(name)
  return dialog
}

test('details: change the title and genres, review exactly what changes, save, and the page shows it', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const dialog = await openEditor(page)

  await expect(dialog.getByRole('button', { name: 'Review changes' })).toBeDisabled() // nothing changed yet
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('A Better Title')
  await dialog.getByRole('textbox', { name: 'Genres' }).fill('Drama, Mystery')
  await dialog.getByLabel('Year').fill('98')
  await expect(dialog.getByText('Use a year with four digits, such as 1999.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Review changes' })).toBeDisabled()
  await dialog.getByLabel('Year').fill('2012')

  await dialog.getByRole('button', { name: 'Review changes' }).click()
  const review = dialog.getByRole('list', { name: 'Changes to save' })
  await expect(review.getByRole('listitem')).toHaveCount(3)
  await expect(review).toContainText('Test Movie 001')
  await expect(review).toContainText('A Better Title')
  await expect(review).toContainText('Drama →') // Genres: before
  await expect(review).toContainText('Drama, Mystery')
  // Nothing was written yet.
  expect(mock.adminLog).toEqual([])

  await dialog.getByRole('button', { name: 'Save these changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved the details of A Better Title.' })).toBeVisible()
  expect(mock.adminLog).toEqual(['update m0001'])
  const sent = mock.requests.find((r) => r.method === 'POST' && r.path === '/Items/m0001')?.body as Record<string, unknown>
  expect(sent).toMatchObject({ Name: 'A Better Title', ProductionYear: 2012, Genres: ['Drama', 'Mystery'] })
  expect(sent.People).toBeDefined() // the rest of the item went back as the server gave it
  expect(sent.Id).toBe('m0001')

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'A Better Title' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Genres' })).toContainText('Mystery')
})

test('locks: keep a field from being replaced, and the whole title', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const dialog = await openEditor(page)
  await dialog.getByRole('checkbox', { name: 'Description' }).check()
  await dialog.getByRole('button', { name: 'Review changes' }).click()
  await expect(dialog.getByRole('list', { name: 'Changes to save' })).toContainText('Fields kept as they are')
  await dialog.getByRole('button', { name: 'Save these changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved the details of Test Movie 001.' })).toBeVisible()
  expect((mock.requests.find((r) => r.method === 'POST' && r.path === '/Items/m0001')?.body as { LockedFields: string[] }).LockedFields).toEqual(['Overview'])

  // The whole title: every field shows as kept and can no longer be changed one by one.
  await dialog.getByRole('switch', { name: /Keep everything about this title/ }).check()
  await expect(dialog.getByRole('checkbox', { name: 'Genres' })).toBeDisabled()
  await expect(dialog.getByRole('checkbox', { name: 'Genres' })).toBeChecked()
  await dialog.getByRole('button', { name: 'Review changes' }).click()
  await dialog.getByRole('button', { name: 'Save these changes' }).click()
  await expect.poll(() => mock.adminLog.length).toBe(2)
  expect((mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/m0001').at(-1)?.body as { LockData: boolean }).LockData).toBe(true)
})

test('history: the old details can be put back after a review, and closing with typed changes asks first', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const dialog = await openEditor(page)
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Oops')
  await dialog.getByRole('button', { name: 'Review changes' }).click()
  await dialog.getByRole('button', { name: 'Save these changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved the details of Oops.' })).toBeVisible()

  await dialog.getByRole('tab', { name: 'History' }).click()
  const entry = dialog.getByRole('list', { name: 'Changes to this title' }).locator(':scope > li')
  await expect(entry).toHaveCount(1)
  await expect(entry).toContainText('Changed title')
  await expect(entry).toContainText('Test Movie 001')
  await entry.getByRole('button', { name: /Put the old details back/ }).click()

  // Back in Details with the old title typed in: still needs the review and the confirmation.
  await expect(dialog.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Test Movie 001')
  expect(mock.adminLog).toEqual(['update m0001'])
  await dialog.getByRole('button', { name: 'Review changes' }).click()
  await dialog.getByRole('button', { name: 'Save these changes' }).click()
  await expect.poll(() => mock.adminLog.length).toBe(2)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Test Movie 001' })).toBeVisible()

  // Typed but unsaved: closing asks.
  await page.getByRole('button', { name: 'Edit Test Movie 001', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsaved')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('You typed changes that are not saved. Close anyway?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Unsaved')
  await page.keyboard.press('Escape') // Esc asks as well
  await expect(dialog.getByText('You typed changes that are not saved. Close anyway?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close and lose them' }).click()
  await expect(dialog).toBeHidden()
  expect(mock.adminLog).toHaveLength(2) // nothing more was written

  // The note is erased when you sign out.
  expect(await page.evaluate(() => localStorage.getItem('jellyflix.admin.activity'))).not.toBeNull()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  expect(await page.evaluate(() => localStorage.getItem('jellyflix.admin.activity'))).toBeNull()
})

test('identify: search the providers, no provider picture is loaded unless asked, apply one after a confirmation', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const dialog = await openEditor(page)
  await dialog.getByRole('tab', { name: 'Identify' }).click()

  await dialog.getByLabel('Name to look for').fill('The Matrix')
  await dialog.getByLabel('Year').fill('1999')
  await dialog.getByRole('button', { name: 'Search' }).click()
  const matches = dialog.getByRole('list', { name: 'Matches' })
  await expect(matches.getByRole('listitem')).toHaveCount(2)
  await expect(matches.getByRole('listitem').first()).toContainText('The Matrix')
  await expect(matches.getByRole('listitem').first()).toContainText('Tmdb 603')
  expect(mock.adminLog).toContain('search Movie The Matrix 1999')
  // Not one request to a provider's picture so far: showing them is the person's choice.
  expect(mock.requests.filter((r) => r.path.startsWith('/remote/'))).toEqual([])
  await dialog.getByRole('checkbox', { name: /Show their pictures/ }).check()
  await expect.poll(() => mock.requests.filter((r) => r.path.startsWith('/remote/Primary/')).length).toBeGreaterThan(0)

  await dialog.getByRole('button', { name: 'Use this: The Matrix', exact: true }).click()
  await expect(dialog.getByText(/Tell the server that “Test Movie 001” is really “The Matrix \(1999\)”/)).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('identify'))).toEqual([]) // asked, not done
  await dialog.getByRole('button', { name: 'Identify it as this' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Identified as The Matrix.' })).toBeVisible()
  expect(mock.adminLog).toContain('identify m0001 Tmdb=603 images=false')

  await dialog.getByRole('tab', { name: 'Details' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('The Matrix')
  // It is in the history with the old title, so it can be put back.
  await dialog.getByRole('tab', { name: 'History' }).click()
  await expect(dialog.getByRole('list', { name: 'Changes to this title' })).toContainText('Identified as The Matrix')

  // A search with no result says so.
  await dialog.getByRole('tab', { name: 'Identify' }).click()
  await dialog.getByLabel('Name to look for').fill('zzz nothing')
  await dialog.getByRole('button', { name: 'Search' }).click()
  await expect(dialog.getByText('Nothing found.')).toBeVisible()
})

test('refresh: the three kinds, and replacing everything needs a confirmation', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const dialog = await openEditor(page)
  await dialog.getByRole('tab', { name: 'Refresh' }).click()

  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click() // "Fill in what is missing" is the default
  await expect(dialog.getByRole('status').filter({ hasText: 'Asked.' })).toBeVisible()
  expect(mock.adminLog).toContain('refresh m0001 FullRefresh metadata=false images=false')

  await dialog.getByRole('radio', { name: /Replace everything/ }).check()
  await dialog.getByRole('checkbox', { name: 'Also replace its pictures' }).check()
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(dialog.getByText(/write over the details it has for “Test Movie 001”/)).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('refresh'))).toHaveLength(1) // not yet
  await dialog.getByRole('button', { name: 'Replace everything', exact: true }).click()
  await expect.poll(() => mock.adminLog.filter((l) => l.startsWith('refresh')).length).toBe(2)
  expect(mock.adminLog).toContain('refresh m0001 FullRefresh metadata=true images=true')
})

test('pictures: choose from the providers (previews only on request), upload your own with a check, and remove with a confirmation', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const dialog = await openEditor(page)
  await dialog.getByRole('tab', { name: 'Pictures' }).click()
  const backdrop = dialog.getByRole('region', { name: 'Backdrop' })
  const poster = dialog.getByRole('region', { name: 'Poster' })
  await expect(poster.getByRole('img', { name: /Current poster/ })).toBeVisible()
  await expect(poster).toContainText('600 × 900')

  // From a provider: the list is text first; pictures only after the opt-in.
  await backdrop.getByRole('button', { name: 'Choose from the providers' }).click()
  const offered = backdrop.getByRole('list', { name: 'Pictures offered' })
  await expect(offered.getByRole('listitem')).toHaveCount(3)
  await expect(offered.getByRole('listitem').first()).toContainText('1920 × 1080')
  expect(mock.requests.filter((r) => r.path.startsWith('/remote/'))).toEqual([])
  await backdrop.getByRole('checkbox', { name: /Show their pictures/ }).check()
  await expect.poll(() => mock.requests.filter((r) => r.path.startsWith('/remote/Backdrop/')).length).toBeGreaterThan(0)
  await offered.getByRole('listitem').nth(1).getByRole('button', { name: /^Use this picture from TheMovieDb/ }).click()
  await expect(backdrop.getByText(/Add this picture from TheMovieDb as a backdrop/)).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('download'))).toEqual([])
  await backdrop.getByRole('button', { name: 'Use this picture', exact: true }).click()
  await expect.poll(() => mock.adminLog.filter((l) => l.startsWith('download'))).toEqual(['download m0001 Backdrop /remote/Backdrop/2'])

  // Your own: a text file is refused before anything is sent.
  const chooser = page.waitForEvent('filechooser')
  await poster.getByRole('button', { name: 'Upload yours…' }).click()
  await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(dialog.getByRole('alert').filter({ hasText: 'Choose a JPEG, PNG or WebP picture.' })).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('upload'))).toEqual([])

  // A real picture: shown first, then sent on confirmation, as base64 text with its own type.
  const second = page.waitForEvent('filechooser')
  await poster.getByRole('button', { name: 'Upload yours…' }).click()
  await (await second).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: PNG })
  await expect(poster.getByRole('img', { name: 'Preview of poster.png' })).toBeVisible()
  await expect(poster).toContainText('1 × 1')
  await expect(poster.getByText('Replace the current poster with this picture?')).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('upload'))).toEqual([])
  await poster.getByRole('button', { name: 'Send it to the server' }).click()
  await expect.poll(() => mock.adminLog.filter((l) => l.startsWith('upload'))).toEqual([`upload m0001 Primary image/png ${PNG.length}`])
  expect(mock.requests.find((r) => r.method === 'POST' && r.path === '/Items/m0001/Images/Primary')?.auth).toBe('header')
  await expect(page.getByRole('status').filter({ hasText: 'Changed the poster' })).toBeVisible()

  // Remove asks first.
  await poster.getByRole('button', { name: 'Remove this poster' }).click()
  await expect(poster.getByText(/cannot be put back from here/)).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('delete'))).toEqual([])
  await poster.getByRole('button', { name: 'Remove it' }).click()
  await expect.poll(() => mock.adminLog.filter((l) => l.startsWith('delete'))).toEqual(['delete m0001 Primary'])
  await expect(poster.getByText('None yet.')).toBeVisible()
})

test('series, seasons, episodes, albums: the edit tools are there for an administrator, and a series can be identified', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await page.goto('/#/show/s0001')
  await expect(page.getByRole('heading', { level: 1, name: 'Test Show 001' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Test Show 001', exact: true })).toBeVisible() // the series
  await expect(page.getByRole('button', { name: 'Edit Season 1', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Edit .*Episode Title 1-1/ })).toBeVisible()

  await page.getByRole('button', { name: 'Edit Test Show 001', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Test Show 001' })
  await dialog.getByRole('tab', { name: 'Identify' }).click()
  await dialog.getByRole('button', { name: 'Search' }).click()
  await expect(dialog.getByRole('list', { name: 'Matches' }).getByRole('listitem')).toHaveCount(2)
  expect(mock.adminLog).toContain('search Series Test Show 001 2011') // the name and year it already has
  await dialog.getByRole('button', { name: 'Close' }).click()

  // An episode has no Identify tab (the providers are asked about the whole series).
  await page.getByRole('button', { name: /^Edit .*Episode Title 1-1/ }).first().click()
  const episode = page.getByRole('dialog', { name: /^Edit .*Episode Title 1-1/ })
  await expect(episode.getByRole('tab', { name: 'Details' })).toBeVisible()
  await expect(episode.getByRole('tab', { name: 'Identify' })).toHaveCount(0)
  await expect(episode.getByRole('tab', { name: 'Pictures' })).toBeVisible()

  await page.goto('/#/album/al0001-1')
  await expect(page.getByRole('article').getByRole('button', { name: /^Edit /, exact: false })).toBeVisible()
  await page.goto('/#/artist/ar0001')
  await expect(page.getByRole('article').getByRole('button', { name: /^Edit /, exact: false })).toBeVisible()

})

test('an account that is not an administrator sees no tools and the server would refuse them anyway', async ({ page }) => {
  mock = await startMock({ ...everything, admin: false })
  await signIn(page, mock, { start: '/' })
  await page.goto('/#/movie/m0001')
  await expect(page.getByRole('heading', { level: 1, name: 'Test Movie 001' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0)
  await page.goto('/#/show/s0001')
  await expect(page.getByRole('heading', { level: 1, name: 'Test Show 001' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0)
  await page.goto('/#/')
  await page.getByRole('region', { name: 'Latest movies' }).getByRole('button', { name: /^More options for/ }).first().click({ force: true })
  await expect(page.getByRole('menuitem', { name: 'Details' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Edit…' })).toHaveCount(0)
  // The editor code was never even loaded, and nothing administrative was asked.
  expect(mock.adminLog).toEqual([])
  expect(mock.requests.some((r) => /MetadataEditor|RemoteSearch|RemoteImages/.test(r.path))).toBe(false)
})

test('the card menu has "Edit…" for an administrator', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await page.getByRole('region', { name: 'Latest movies' }).getByRole('button', { name: 'More options for Test Movie 012' }).click({ force: true })
  await page.getByRole('menuitem', { name: 'Edit…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Test Movie 012' })
  await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Test Movie 012')
})

test('a refused save (the server says 403) is explained, and nothing is shown as saved', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const dialog = await openEditor(page)
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Nope')
  await dialog.getByRole('button', { name: 'Review changes' }).click()
  mock.options.admin = false // the account lost its rights in the meantime
  await dialog.getByRole('button', { name: 'Save these changes' }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: 'not an administrator on this server' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Saved the details' })).toHaveCount(0)
  await dialog.getByRole('tab', { name: 'History' }).click()
  await expect(dialog.getByText('Nothing yet.')).toBeVisible()
})

test('the editor passes the automatic accessibility checks on every tab', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const dialog = await openEditor(page)
  const problems: string[] = []
  const check = async (label: string) => {
    await page.waitForLoadState('networkidle')
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    for (const v of results.violations) problems.push(`${label}: ${v.impact} ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 140)}`)
  }
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Changed')
  await dialog.getByRole('button', { name: 'Review changes' }).click()
  await check('details with review')
  await dialog.getByRole('tab', { name: 'Identify' }).click()
  await dialog.getByRole('button', { name: 'Search' }).click()
  await expect(dialog.getByRole('list', { name: 'Matches' })).toBeVisible()
  await dialog.getByRole('button', { name: /^Use this: / }).first().click()
  await check('identify with confirmation')
  await dialog.getByRole('tab', { name: 'Pictures' }).click()
  await dialog.getByRole('region', { name: 'Backdrop' }).getByRole('button', { name: 'Choose from the providers' }).click()
  await expect(dialog.getByRole('list', { name: 'Pictures offered' })).toBeVisible()
  await check('pictures')
  await dialog.getByRole('tab', { name: 'Refresh' }).click()
  await check('refresh')
  await dialog.getByRole('tab', { name: 'History' }).click()
  await check('history')
  expect(problems).toEqual([])
})
