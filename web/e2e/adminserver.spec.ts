import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/** Administration: libraries and titles, batch changes, accounts, devices and keys, the server's health, in real Chrome against the mock. */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const everything = { movieCount: 12, seriesCount: 2, animeCount: 1, musicArtists: 1, collections: 0, adminSessions: true }

async function openAdmin(page: Page, tab?: string) {
  await page.goto('/#/admin')
  await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible()
  if (tab) await page.getByRole('tab', { name: tab, exact: true }).click()
}

test('Settings offers the administration to an administrator, and the page has four parts', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Open administration' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveText(['Library', 'Accounts', 'Devices', 'Server'])
  await expect(page.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Library' }).press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Accounts', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
})

test('an account that is not an administrator gets a sentence, no button, and the server is never asked', async ({ page }) => {
  mock = await startMock({ ...everything, admin: false })
  await signIn(page, mock, { start: '/' })
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'Open administration' })).toHaveCount(0)
  await page.goto('/#/admin')
  await expect(page.getByText('Only administrators of this server can use these tools.')).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  const asked = mock.requests.map((r) => r.path)
  expect(asked.some((p) => /^\/(Library\/|Users$|Devices|Auth\/Keys|System\/(Info$|ActivityLog))/.test(p))).toBe(false)
  expect(mock.adminLog).toEqual([])
})

test('libraries: they are listed with their folders, and a scan can be started for one or for all', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await openAdmin(page)
  const libs = page.getByRole('list', { name: 'Libraries' })
  await expect(libs.getByRole('listitem')).toHaveCount(4)
  await expect(libs.getByRole('listitem').first()).toContainText('Movies')
  await expect(libs.getByRole('listitem').first()).toContainText('/media/movies')

  await page.getByRole('button', { name: 'Scan Movies' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'The server is scanning Movies.' })).toBeVisible()
  expect(mock.adminLog).toContain('refresh lib-movies Default metadata=false images=false')
  await page.getByRole('button', { name: 'Scan all libraries' }).click()
  await expect.poll(() => mock.adminLog).toContain('scan all')
})

test('titles: the ones the server could not recognise, a batch with a preview and a report, and delete with the name typed', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await openAdmin(page)
  const titles = page.getByRole('region', { name: 'Titles' })

  await titles.getByLabel('Only titles the server could not recognise').check()
  const list = titles.getByRole('list', { name: 'Titles' })
  await expect(list.getByRole('listitem')).toHaveCount(3)
  await expect(list.getByRole('listitem').first()).toContainText('Test Movie 004')
  await expect(list.getByRole('listitem').first()).toContainText('/media/movies/Test Movie 004')
  await expect(list.getByRole('listitem').first()).toContainText('Not recognised')

  // A batch: two titles, a tag. The preview names them, and nothing is written until "Start".
  await list.getByRole('checkbox', { name: 'Select Test Movie 004' }).check()
  await list.getByRole('checkbox', { name: 'Select Test Movie 008' }).check()
  const batch = page.getByRole('region', { name: 'Change the chosen titles' })
  await expect(batch).toContainText('2 titles chosen')
  await batch.getByLabel('What to do').selectOption({ label: 'Add a tag' })
  await expect(batch.getByRole('button', { name: 'Preview' })).toBeDisabled() // no tag typed yet
  await batch.getByLabel('Tag', { exact: true }).fill('Weekend')
  await batch.getByRole('button', { name: 'Preview' }).click()
  await expect(batch.getByText('Add the tag “Weekend” for 2 titles:')).toBeVisible()
  const preview = batch.getByRole('list', { name: 'Titles that will change' })
  await expect(preview.getByRole('listitem')).toHaveText(['Test Movie 004', 'Test Movie 008'])
  expect(mock.adminLog).toEqual([])
  await batch.getByRole('button', { name: 'Cancel' }).click() // back, nothing happened
  expect(mock.adminLog).toEqual([])
  await batch.getByRole('button', { name: 'Preview' }).click()
  await batch.getByRole('button', { name: 'Start' }).click()
  await expect(batch.getByText('2 done, 0 left as they were, 0 failed.')).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('update'))).toEqual(['update m0004', 'update m0008'])
  const sent = mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/m0004').at(-1)?.body as { Tags: string[]; People?: unknown }
  expect(sent.Tags).toEqual(['Classic', 'Weekend']) // what it had stays
  expect(sent.People).toBeDefined()
  await batch.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('region', { name: 'Change the chosen titles' })).toHaveCount(0)

  // Again the same: nothing to do for either, and it says so.
  await list.getByRole('checkbox', { name: 'Select Test Movie 004' }).check()
  await batch.getByLabel('What to do').selectOption({ label: 'Add a tag' })
  await batch.getByLabel('Tag', { exact: true }).fill('weekend')
  await batch.getByRole('button', { name: 'Preview' }).click()
  await batch.getByRole('button', { name: 'Start' }).click()
  await expect(batch.getByText('0 done, 1 left as they were, 0 failed.')).toBeVisible()
  await expect(batch.getByRole('list', { name: 'Titles that were not changed' })).toContainText('Already as asked.')
  await batch.getByRole('button', { name: 'Close' }).click()

  // Delete: the button waits for the name.
  await list.getByRole('button', { name: 'Delete Test Movie 012' }).click()
  const confirm = list.getByRole('group')
  await expect(confirm.getByText(/It disappears for everybody/)).toBeVisible()
  await expect(confirm.getByRole('button', { name: 'Type the name first' })).toBeVisible()
  await confirm.getByRole('button', { name: 'Type the name first' }).click()
  expect(mock.adminLog.filter((l) => l.startsWith('delete-title'))).toEqual([])
  await confirm.getByLabel('Type the name of the title to confirm').fill('test movie 012')
  await confirm.getByRole('button', { name: 'Delete for good' }).click()
  await expect.poll(() => mock.adminLog.filter((l) => l.startsWith('delete-title'))).toEqual(['delete-title m0012'])
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list).not.toContainText('Test Movie 012')
})

test('titles: search by name, show more, and open the editor from a row', async ({ page }) => {
  mock = await startMock({ ...everything, movieCount: 60 })
  await signIn(page, mock, { start: '/' })
  await page.waitForLoadState('networkidle')
  const mark = mock.requests.length
  await openAdmin(page)
  const titles = page.getByRole('region', { name: 'Titles' })
  await expect(titles.getByText('Showing 50 of 60 titles')).toBeVisible() // the 60 movies (series are another choice)
  await titles.getByRole('button', { name: 'Show more' }).click()
  await expect(titles.getByText('Showing 60 of 60 titles')).toBeVisible()
  await titles.getByRole('radio', { name: 'Series' }).check()
  await expect(titles.getByText('Showing 3 of 3 titles')).toBeVisible()
  await titles.getByRole('radio', { name: 'Movies', exact: true }).check()
  await titles.getByLabel('Name', { exact: true }).fill('movie 031')
  await titles.getByRole('button', { name: 'Find' }).click()
  await expect(titles.getByRole('list', { name: 'Titles' }).getByRole('listitem')).toHaveCount(1)
  await titles.getByRole('button', { name: 'Edit Test Movie 031' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit Test Movie 031' })).toBeVisible()
  // One kind of title per request: asking for movies and series together took 24 s on a real library.
  const asked = mock.requests.slice(mark).filter((r) => r.path === '/Items').map((r) => r.queryAll.includeItemTypes?.join(','))
  expect(asked.length).toBeGreaterThan(2)
  expect(asked.filter((types) => types?.includes('Movie') && types.includes('Series'))).toEqual([])
})

test('accounts: change what one may do after a review, protect yourself and the last administrator, ask for the name to make an administrator', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await openAdmin(page, 'Accounts')
  const accounts = page.getByRole('list', { name: 'Accounts' })
  await expect(accounts.getByRole('listitem')).toHaveCount(2)
  await expect(accounts).toContainText('tester')
  await expect(accounts).toContainText('(you)')

  await page.getByRole('button', { name: 'Edit the account guest' }).click()
  const form = page.getByRole('form', { name: 'What guest may do' })
  await form.getByRole('switch', { name: 'Account disabled' }).check()
  await form.getByLabel('Highest parental rating').selectOption({ label: 'PG' })
  await form.getByRole('switch', { name: 'May have videos converted' }).uncheck()
  await form.getByRole('button', { name: 'Review changes' }).click()
  const review = form.getByRole('list', { name: 'Changes to save' })
  await expect(review.getByRole('listitem')).toHaveCount(3)
  await expect(review).toContainText('Account disabled')
  await expect(review).toContainText('PG')
  expect(mock.adminLog).toEqual([]) // nothing written yet
  await form.getByRole('button', { name: 'Save these allowances' }).click()
  await expect.poll(() => mock.adminLog).toContain('policy user2')
  expect(mock.accounts.get('user2')?.policy).toMatchObject({ IsDisabled: true, MaxParentalRating: 5, EnableVideoPlaybackTranscoding: false })
  await expect(accounts.getByRole('listitem').first()).toContainText('Disabled')

  // Promoting: the name has to be typed, or nothing is saved.
  const again = page.getByRole('form', { name: 'What guest may do' })
  await again.getByRole('switch', { name: 'Administrator' }).check()
  await again.getByRole('button', { name: 'Review changes' }).click()
  await again.getByRole('button', { name: 'Save these allowances' }).click()
  await expect(again.getByText('Type the name first')).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('policy'))).toHaveLength(1)
  await again.getByLabel('An administrator can do everything. Type the account name to confirm.').fill('guest')
  await again.getByRole('button', { name: 'Save these allowances' }).click()
  await expect.poll(() => mock.adminLog.filter((l) => l.startsWith('policy')).length).toBe(2)
  expect(mock.accounts.get('user2')?.policy).toMatchObject({ IsAdministrator: true })

  // Yourself: you cannot stop being an administrator or disable the account you are using.
  await page.getByRole('button', { name: 'Close guest' }).click() // close it
  await page.getByRole('button', { name: 'Edit the account tester' }).click()
  const own = page.getByRole('form', { name: 'What tester may do' })
  await own.getByRole('switch', { name: 'Account disabled' }).check()
  await expect(own.getByRole('alert')).toContainText('You cannot disable the account you are signed in with.')
  await expect(own.getByRole('button', { name: 'Review changes' })).toBeDisabled()
  await own.getByRole('switch', { name: 'Account disabled' }).uncheck()
  await own.getByRole('switch', { name: 'Administrator' }).uncheck()
  await expect(own.getByRole('alert')).toContainText('You cannot stop being an administrator from your own account')
  await expect(own.getByRole('button', { name: 'Review changes' })).toBeDisabled()
})

test('accounts: a new account needs a good password typed twice, and no password is kept anywhere', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await openAdmin(page, 'Accounts')
  await page.getByRole('button', { name: 'New account', exact: true }).click()
  const form = page.getByRole('form', { name: 'New account' })
  await form.getByLabel('Name', { exact: true }).fill('Ana')
  await form.getByLabel('Password', { exact: true }).fill('short')
  await form.getByLabel('Password again').fill('short')
  await form.getByRole('button', { name: 'Make the account' }).click()
  await expect(form.getByRole('alert')).toContainText('The password needs at least 8 characters.')
  await form.getByLabel('Password', { exact: true }).fill('a-long-secret-1')
  await form.getByLabel('Password again').fill('a-long-secret-2')
  await form.getByRole('button', { name: 'Make the account' }).click()
  await expect(form.getByRole('alert')).toContainText('The two passwords are not the same.')
  expect(mock.adminLog).toEqual([])
  await form.getByLabel('Name', { exact: true }).fill('guest')
  await form.getByLabel('Password again').fill('a-long-secret-1')
  await form.getByRole('button', { name: 'Make the account' }).click()
  await expect(form.getByRole('alert')).toContainText('There is already an account with that name.')
  await form.getByLabel('Name', { exact: true }).fill('Ana')
  await form.getByRole('button', { name: 'Make the account' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Made the account Ana.' })).toBeVisible()
  expect(mock.adminLog).toContain('create-user Ana')
  expect(mock.adminLog.join(' ')).not.toContain('a-long-secret')
  // It opens its allowances, as a plain account.
  const ana = page.getByRole('form', { name: 'What Ana may do' })
  await expect(ana.getByRole('switch', { name: 'Administrator' })).not.toBeChecked()
  // The password is not left in the page or in the browser's storage.
  const html = await page.content()
  expect(html).not.toContain('a-long-secret')
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain('a-long-secret')

  await page.getByRole('button', { name: 'Set a new password…' }).click()
  const pw = page.getByRole('form', { name: 'New password for Ana' })
  await pw.getByLabel('New password', { exact: true }).fill('another-secret-9')
  await pw.getByLabel('Password again').fill('another-secret-9')
  await pw.getByRole('button', { name: 'Change the password' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Changed the password of Ana.' })).toBeVisible()
  expect(mock.adminLog.some((l) => l.startsWith('password user'))).toBe(true)
  expect(mock.adminLog.join(' ')).not.toContain('another-secret')
})

test('devices: who is connected and what the server converts, a message, stopping playback, signing a device out, revoking a key', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await openAdmin(page, 'Devices')
  const now = page.getByRole('list', { name: 'Connected now' })
  const kitchen = now.getByRole('listitem').filter({ hasText: 'Kitchen tablet' })
  await expect(kitchen).toContainText('guest')
  await expect(kitchen).toContainText('Playing: Test Movie 002')
  await expect(kitchen).toContainText('The server is converting this video.')
  await expect(kitchen).toContainText('The file is above your quality limit')
  // This very browser cannot be messaged or stopped from here.
  await expect(now.getByRole('listitem').filter({ hasText: '(this device)' }).getByRole('button')).toHaveCount(0)

  await kitchen.getByRole('button', { name: 'Send a message to Kitchen tablet' }).click()
  await kitchen.getByLabel('Message for Kitchen tablet').fill('Dinner is ready')
  await kitchen.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => mock.adminLog).toContain('message kitchen-session Dinner is ready')

  await kitchen.getByRole('button', { name: 'Stop playback on Kitchen tablet' }).click()
  await expect(kitchen.getByText(/The person watching will be interrupted/)).toBeVisible()
  expect(mock.remoteLog).not.toContain('kitchen-session Stop')
  await kitchen.getByRole('button', { name: 'Stop it' }).click()
  await expect.poll(() => mock.remoteLog).toContain('kitchen-session Stop')
  await expect(kitchen).not.toContainText('Playing: Test Movie 002')

  // Devices: the access token the server sends is never on the page.
  const devices = page.getByRole('list', { name: 'Devices' })
  await expect(devices).toContainText('Old phone')
  expect(await page.content()).not.toContain('secret-token')
  await expect(devices.getByRole('listitem').filter({ hasText: '(this device)' }).getByRole('button')).toHaveCount(0)
  await devices.getByRole('button', { name: 'Sign out Old phone' }).click()
  await expect(devices.getByText(/It stops working until someone signs in on it again/)).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('remove-device'))).toEqual([])
  await devices.getByRole('button', { name: 'Sign it out' }).click()
  await expect.poll(() => mock.adminLog).toContain('remove-device dev-phone')
  await expect(devices).not.toContainText('Old phone')

  // Keys: only the end of each one is shown.
  const keys = page.getByRole('list', { name: 'API keys' })
  await expect(keys.getByRole('listitem')).toHaveCount(2)
  await expect(keys).toContainText('…ab12')
  expect(await page.content()).not.toContain('apikey-0123456789')
  await keys.getByRole('button', { name: /^Revoke the key of Old script ending cd34/ }).click()
  expect(mock.adminLog.filter((l) => l.startsWith('revoke-key'))).toEqual([])
  await keys.getByRole('button', { name: 'Revoke it' }).click()
  await expect.poll(() => mock.adminLog).toContain('revoke-key cd34')
  await expect(keys.getByRole('listitem')).toHaveCount(1)
})

test('server: the summary, a task started on request, and the activity log by pages', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await openAdmin(page, 'Server')
  const health = page.getByRole('region', { name: 'The server' })
  await expect(health).toContainText('Mock Jellyfin')
  await expect(health).toContainText('12.2.0')
  await expect(health.getByRole('list', { name: 'Notices' })).toContainText('A newer version of the server is available')
  await expect(health.getByText('Tasks that failed last time').locator('xpath=following-sibling::dd')).toHaveText('0')

  const tasks = page.getByRole('region', { name: 'Scheduled tasks' })
  await expect(tasks.getByRole('region', { name: 'Library' })).toContainText('Scan Media Library')
  await tasks.getByRole('button', { name: 'Run now: Scan Media Library' }).click()
  await expect.poll(() => mock.taskLog).toContain('start t-scan')
  await expect(tasks.getByRole('button', { name: 'Stop Scan Media Library' })).toBeVisible()
  await tasks.getByRole('button', { name: 'Stop Scan Media Library' }).click()
  await expect.poll(() => mock.taskLog).toContain('stop t-scan')

  const log = page.getByRole('region', { name: 'Activity' })
  await expect(log.getByRole('list', { name: 'Activity' }).getByRole('listitem')).toHaveCount(30)
  await expect(log.getByRole('list', { name: 'Activity' }).getByRole('listitem').first()).toContainText('Warning')
  await log.getByRole('button', { name: 'Show 15 more' }).click()
  await expect(log.getByRole('list', { name: 'Activity' }).getByRole('listitem')).toHaveCount(45)
  await expect(log.getByRole('button', { name: /Show .* more/ })).toHaveCount(0)
})

test('a refusal from the server is explained in words', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  await openAdmin(page, 'Devices')
  await expect(page.getByRole('list', { name: 'Devices' })).toBeVisible()
  mock.options.admin = false // the account lost its rights in the meantime
  await page.getByRole('list', { name: 'Devices' }).getByRole('button', { name: 'Sign out Old phone' }).click()
  await page.getByRole('button', { name: 'Sign it out' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'not an administrator on this server' })).toBeVisible()
  expect(mock.adminLog.filter((l) => l.startsWith('remove-device'))).toEqual([])
})

test('every administration tab passes the automatic accessibility checks, with confirmations open', async ({ page }) => {
  mock = await startMock(everything)
  await signIn(page, mock, { start: '/' })
  const problems: string[] = []
  const check = async (label: string) => {
    await page.waitForLoadState('networkidle')
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    for (const v of results.violations) problems.push(`${label}: ${v.impact} ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 140)}`)
  }
  await openAdmin(page)
  await expect(page.getByRole('list', { name: 'Libraries' })).toBeVisible()
  const titles = page.getByRole('region', { name: 'Titles' })
  await titles.getByRole('checkbox', { name: 'Select Test Movie 001' }).check()
  await page.getByRole('region', { name: 'Change the chosen titles' }).getByRole('button', { name: 'Preview' }).click()
  await titles.getByRole('button', { name: 'Delete Test Movie 002' }).click()
  await check('library with batch preview and delete')

  await page.getByRole('tab', { name: 'Accounts', exact: true }).click()
  await page.getByRole('button', { name: 'Edit the account guest' }).click()
  const form = page.getByRole('form', { name: 'What guest may do' })
  await form.getByRole('switch', { name: 'Administrator' }).check()
  await form.getByRole('button', { name: 'Review changes' }).click()
  await page.getByRole('button', { name: 'New account', exact: true }).click()
  await check('accounts with review and new account')

  await page.getByRole('tab', { name: 'Devices', exact: true }).click()
  await expect(page.getByRole('list', { name: 'API keys' })).toBeVisible()
  await page.getByRole('list', { name: 'Devices' }).getByRole('button', { name: 'Sign out Old phone' }).click()
  await check('devices with confirmation')

  await page.getByRole('tab', { name: 'Server', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Activity' }).getByRole('list', { name: 'Activity' })).toBeVisible()
  await check('server')
  expect(problems).toEqual([])
})
