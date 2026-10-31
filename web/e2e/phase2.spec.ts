import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/**
 * The household phase: searching the settings, what the cards show and do, my rating, parental controls with a PIN
 * (Kids mode), trailers and the first-run setup. Against the mock server, like the other specs.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const grid = (page: Page) => page.getByRole('region', { name: 'All movies' })

test('settings search: finds a setting by its name, opens its tab and goes to it', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.goto('/#/settings')
  const search = page.getByRole('searchbox', { name: 'Search settings' })

  // A setting of another tab: the tab opens and the control has the focus.
  await search.fill('poster')
  await page.getByRole('list', { name: 'Matching settings' }).getByRole('button', { name: /Poster size/ }).click()
  await expect(page.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Posters' })).toBeVisible()
  await expect(search).toHaveValue('')

  // Words from the tab and from the keywords count; Enter takes the first match.
  await search.fill('skip credits')
  await search.press('Enter')
  await expect(page.getByRole('tab', { name: 'Playback' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Skip credits')).toBeFocused()

  await search.fill('zzzz')
  await expect(page.getByRole('status').filter({ hasText: 'No setting has that name.' })).toBeVisible()
})

test('settings search: every name in the list is on the page it points to', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await page.goto('/#/settings')
  const search = page.getByRole('searchbox', { name: 'Search settings' })
  const samples: Array<[string, string]> = [
    ['Rotate the featured banner', 'General'],
    ['Language', 'General'],
    ['Accent colour', 'Appearance'],
    ['Titles under the posters', 'Appearance'],
    ['Next up looks back', 'Appearance'],
    ['Play the next episode automatically', 'Playback'],
    ['Maximum quality', 'Playback'],
    ['Gapless playback', 'Playback'],
    ['Saved on this device', 'About'],
  ]
  for (const [name, tab] of samples) {
    await search.fill(name)
    await page.getByRole('list', { name: 'Matching settings' }).getByRole('button', { name: new RegExp(name) }).first().click()
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
    // The control (or its heading) is where the page scrolled to, so it is on screen.
    await expect(page.getByRole('tabpanel').getByText(name, { exact: true }).first()).toBeInViewport()
  }
})

test('cards: the titles under the posters can be turned off, and the choice is kept', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await expect(grid(page).locator('.card-text').first()).toBeVisible()
  await page.goto('/#/settings')
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('switch', { name: 'Titles under the posters' }).uncheck()
  await page.goto('/#/movies')
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 001/ })).toBeVisible()
  await expect(grid(page).locator('.card-text').first()).toBeHidden()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.appearance') ?? '{}'))
  expect(saved.titles).toBe(false)
})

test('cards: pressing Continue watching plays, or opens the page when Settings says so', async ({ page }) => {
  mock = await startMock({ movieCount: 4 })
  mock.resume.set('m0003', 12 * 10_000_000)
  mock.user.lastPlayed.push('m0003')
  await signIn(page, mock, { start: '/' })
  await page.getByRole('region', { name: 'Continue watching' }).getByRole('button', { name: /Resume Test Movie 003/ }).click()
  await expect(page).toHaveURL(/#\/play\/m0003$/)

  await page.evaluate(() => localStorage.setItem('jellyflix.appearance', JSON.stringify({ continueAction: 'open' })))
  await page.goto('/#/')
  await page.reload()
  const row = page.getByRole('region', { name: 'Continue watching' })
  await row.getByRole('button', { name: /Open Test Movie 003/ }).click()
  await expect(page).toHaveURL(/#\/movie\/m0003$/)
})

test('my rating: a thumb up or down on the title page, kept on the server, and a filter for the libraries', async ({ page }) => {
  mock = await startMock({ movieCount: 4 })
  await signIn(page, mock)
  await grid(page).getByRole('button', { name: /Open Test Movie 002/ }).click()
  const like = page.getByRole('button', { name: 'I like it' })
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => mock.user.likes.get('m0002')).toBe(true)
  // Pressing the other one changes it; pressing the one that is on takes it back.
  const dislike = page.getByRole('button', { name: 'I do not like it' })
  await dislike.click()
  await expect(dislike).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => mock.user.likes.get('m0002')).toBe(false)
  await dislike.click()
  await expect.poll(() => mock.user.likes.has('m0002')).toBe(false)
  await like.click()
  await expect.poll(() => mock.user.likes.get('m0002')).toBe(true)

  await page.goto('/#/movies')
  await page.getByLabel('Show').selectOption('liked')
  await expect(grid(page).getByRole('button', { name: /Open Test Movie/ })).toHaveCount(1)
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 002/ })).toBeVisible()
  await page.getByLabel('Show').selectOption('disliked')
  await expect(grid(page).getByRole('button', { name: /Open Test Movie/ })).toHaveCount(0)
})

async function turnOnKids(page: Page, rating = 'PG', pin = '1234') {
  await page.goto('/#/settings')
  const card = page.getByRole('region', { name: 'Kids mode' })
  await card.getByLabel('Highest rating to show').selectOption(rating)
  await card.getByLabel('PIN to leave it').fill(pin)
  await card.getByLabel('The same PIN again').fill(pin)
  // The app starts again as soon as Kids mode is on, so that nothing of the other mode stays in view.
  const reloaded = page.waitForEvent('load')
  await card.getByRole('button', { name: 'Turn on Kids mode' }).click()
  await reloaded
  // Settings shuts as soon as Kids mode is on: the round button now leaves it.
  await expect(page.getByRole('button', { name: 'Leave Kids mode' })).toBeVisible()
}

test('kids mode: only titles up to the chosen rating show, and what is shut stays shut', async ({ page }) => {
  mock = await startMock({ movieCount: 8, seriesCount: 2, ratings: true })
  await signIn(page, mock)
  await turnOnKids(page)

  // Movies 1, 4, 5 and 8 are G or PG; the PG-13 and R ones are gone from the library.
  await page.goto('/#/movies')
  const cards = grid(page).getByRole('button', { name: /Open Test Movie/ })
  await expect(cards).toHaveCount(4)
  await expect(grid(page).getByRole('button', { name: /Open Test Movie 003/ })).toHaveCount(0)
  // Opening one directly (a link, a bookmark) says it is not there.
  await page.goto('/#/movie/m0003')
  await expect(page.getByRole('alert')).toContainText('Could not load this movie')
  // The series of PG passes with its episodes; the R one does not.
  await page.goto('/#/series')
  const shows = page.getByRole('region', { name: 'All series' })
  await expect(shows.getByRole('button', { name: /Open Test Show 001/ })).toBeVisible()
  await expect(shows.getByRole('button', { name: /Open Test Show 002/ })).toHaveCount(0)
  // Its episodes list too (they follow their series).
  await shows.getByRole('button', { name: /Open Test Show 001/ }).click()
  await expect(page.getByRole('button', { name: 'Play S1 E1', exact: true })).toBeVisible()

  // Settings is shut: a link lands on the home page, and the round button asks for the PIN.
  await page.goto('/#/settings')
  await expect(page).not.toHaveURL(/settings/)
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Leave Kids mode' }).click()
  const dialog = page.getByRole('dialog', { name: 'Leave Kids mode' })
  await dialog.getByLabel('Type the PIN').fill('9999')
  await dialog.getByRole('button', { name: 'Leave' }).click()
  await expect(dialog.getByRole('alert')).toContainText('not the PIN')
  await dialog.getByLabel('Type the PIN').fill('1234')
  const reloaded = page.waitForEvent('load')
  await dialog.getByRole('button', { name: 'Leave' }).click()
  await reloaded

  // Back to everything.
  await page.goto('/#/movies')
  await expect(grid(page).getByRole('button', { name: /Open Test Movie/ })).toHaveCount(8)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
})

test('kids mode: it stays on after a reload, and wrong PINs in a row make the next try wait', async ({ page }) => {
  mock = await startMock({ movieCount: 8, ratings: true })
  await signIn(page, mock, { keep: true })
  await turnOnKids(page, 'G')
  await page.goto('/#/movies')
  await page.reload()
  await expect(grid(page).getByRole('button', { name: /Open Test Movie/ })).toHaveCount(2)

  await page.getByRole('button', { name: 'Leave Kids mode' }).click()
  const dialog = page.getByRole('dialog', { name: 'Leave Kids mode' })
  for (let i = 0; i < 5; i += 1) {
    await dialog.getByLabel('Type the PIN').fill('0000')
    await dialog.getByRole('button', { name: 'Leave' }).click()
  }
  await expect(dialog.getByRole('alert')).toContainText('Wait')
  await expect(dialog.getByLabel('Type the PIN')).toBeDisabled()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.kids') ?? '{}'))
  expect(saved.enabled).toBe(true)
  expect(saved.hash).not.toContain('1234')
})

test('kids mode: it does not turn on when the server does not say the rating of its titles', async ({ page }) => {
  mock = await startMock({ movieCount: 4 })
  await signIn(page, mock)
  await page.goto('/#/settings')
  const card = page.getByRole('region', { name: 'Kids mode' })
  await card.getByLabel('PIN to leave it').fill('1234')
  await card.getByLabel('The same PIN again').fill('1234')
  await card.getByRole('button', { name: 'Turn on Kids mode' }).click()
  await expect(card.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Leave Kids mode' })).toHaveCount(0)
})

test('trailers: one is a link that opens on its own site, several are a list, and a title with none has no button', async ({ page }) => {
  mock = await startMock({ movieCount: 4, trailers: true })
  await signIn(page, mock)
  await grid(page).getByRole('button', { name: /Open Test Movie 001/ }).click()
  const one = page.getByRole('link', { name: /^Trailer/ })
  await expect(one).toHaveAttribute('href', 'https://www.youtube.com/watch?v=trailer1a')
  await expect(one).toHaveAttribute('target', '_blank')
  await expect(one).toHaveAttribute('rel', /noopener/)

  await page.goto('/#/movie/m0002')
  await page.getByText('Trailers', { exact: true }).click()
  const links = page.getByRole('link', { name: /trailer|teaser/i })
  await expect(links).toHaveCount(2)
  await expect(links.nth(1)).toHaveAttribute('href', 'https://www.youtube.com/watch?v=trailer2b')

  // The app itself loaded nothing from YouTube.
  expect(mock.requests.some((r) => r.path.includes('youtube'))).toBe(false)
})

test('trailers: nothing is shown when the server lists none', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  await grid(page).getByRole('button', { name: /Open Test Movie 001/ }).click()
  await expect(page.getByRole('button', { name: /^Play$/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Trailer/ })).toHaveCount(0)
})

test('first-run setup: asks three things once, applies each answer at once, and can be run again from Settings', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock, { setup: true })
  const wizard = page.getByRole('dialog', { name: 'Set up Jellyflix' })
  await expect(wizard).toBeVisible()
  await expect(wizard.getByText('Step 1 of 3')).toBeVisible()

  // The language is applied as soon as it is chosen, also to the dialog itself.
  await wizard.getByLabel('Español').click()
  await expect(page.getByRole('dialog', { name: 'Configurar Jellyflix' })).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  // The look: the accent and the background are applied to the page behind.
  await page.getByLabel('Esmeralda').or(page.getByLabel('Emerald')).check()
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await page.getByLabel('Español', { exact: true }).check()
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const player = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}'))
  const ui = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.ui') ?? '{}'))
  const look = await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.appearance') ?? '{}'))
  expect(player.subtitleLanguage).toBe('spa')
  expect(ui.language).toBe('es')
  expect(look.theme.accent).toBe('emerald')

  // It does not ask again.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ajustes' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('first-run setup: skipping it is final, and a device that has been used before is not asked', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock, { setup: true })
  await page.getByRole('dialog', { name: 'Set up Jellyflix' }).getByRole('button', { name: 'Skip' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // It can be run again from Settings → About.
  await page.goto('/#/settings')
  await page.getByRole('tab', { name: 'About' }).click()
  await page.getByRole('button', { name: 'Run the setup again' }).click()
  await expect(page.getByRole('dialog', { name: 'Set up Jellyflix' })).toBeVisible()
})

test('first-run setup: a device that already has preferences saved is not asked', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await page.addInitScript(() => localStorage.setItem('jellyflix.player', JSON.stringify({ volume: 0.5 })))
  await signIn(page, mock, { setup: true })
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
