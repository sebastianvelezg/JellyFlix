import { expect, test, type Browser, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { clickSeekAt, playMovie, signIn, startMock, waitPlaying } from './helpers'

/**
 * Phase 3 against the mock server: Live TV categories, the strip of channels and the way back to the last channel. As in the other
 * specs this proves the client's behaviour, not compatibility with a real Jellyfin server or tuner.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const category = (page: Page, name: string) => page.getByRole('group', { name: 'Category' }).getByRole('button', { name, exact: true })

async function openLiveTv(page: Page) {
  await tabs(page).getByRole('button', { name: 'Live TV' }).click()
  await expect(page).toHaveURL(/#\/livetv$/)
}

test('live tv: the channels can be narrowed to movies, series, sports, news or kids, and the choice is kept', async ({ page }) => {
  mock = await startMock({ movieCount: 3, liveTv: 10 })
  await signIn(page, mock)
  await openLiveTv(page)
  await expect(page.getByRole('button', { name: /^Watch \d+ ·/ })).toHaveCount(10)

  await category(page, 'Sports').click()
  await expect(category(page, 'Sports')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Watch 3 · Test Channel 03' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Watch 8 · Test Channel 08' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Watch \d+ ·/ })).toHaveCount(2)

  await category(page, 'Kids').click()
  await expect(page.getByRole('button', { name: /^Watch \d+ ·/ })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Watch 5 · Test Channel 05' })).toBeVisible()

  // Favourites are a category too.
  await page.getByRole('button', { name: 'Add 5 · Test Channel 05 to favorites' }).click()
  await category(page, 'Favorites').click()
  await expect(page.getByRole('button', { name: /^Watch \d+ ·/ })).toHaveCount(1)

  // The page opens on the category it was left on.
  await category(page, 'News').click()
  await expect(page.getByRole('button', { name: 'Watch 4 · Test Channel 04' })).toBeVisible()
  await page.reload()
  await openLiveTv(page)
  await expect(category(page, 'News')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /^Watch \d+ ·/ })).toHaveCount(2)
})

test('live tv: a kind with no channels says so, and "All" brings everything back', async ({ page }) => {
  mock = await startMock({ movieCount: 3, liveTv: 3 })
  await signIn(page, mock)
  await openLiveTv(page)
  await category(page, 'Kids').click()
  await expect(page.getByText('No channels in this category.')).toBeVisible()
  await category(page, 'All').click()
  await expect(page.getByRole('button', { name: /^Watch \d+ ·/ })).toHaveCount(3)
})

test('live tv: the strip of channels in the player changes channel, and the arrows stay inside the category', async ({ page }) => {
  mock = await startMock({ movieCount: 3, liveTv: 10 })
  await signIn(page, mock)
  await openLiveTv(page)
  await page.getByRole('button', { name: 'Watch 1 · Test Channel 01' }).click()
  await expect(page).toHaveURL(/#\/live\/ch0001$/)
  await waitPlaying(page)
  const strip = page.getByRole('list', { name: 'Change channel' })
  await expect(strip.getByRole('button')).toHaveCount(10)
  await expect(strip.getByRole('button', { name: 'Watch 1 · Test Channel 01' })).toHaveAttribute('aria-current', 'true')
  await strip.getByRole('button', { name: 'Watch 7 · Test Channel 07' }).click()
  await expect(page).toHaveURL(/#\/live\/ch0007$/)
  await waitPlaying(page)
  await expect(page.getByRole('list', { name: 'Change channel' }).getByRole('button', { name: 'Watch 7 · Test Channel 07' })).toHaveAttribute('aria-current', 'true')

  // Back to the list, narrowed to sports: the player now goes from sports to sports.
  await page.keyboard.press('Escape')
  await category(page, 'Sports').click()
  await page.getByRole('button', { name: 'Watch 3 · Test Channel 03' }).click()
  await expect(page).toHaveURL(/#\/live\/ch0003$/)
  await waitPlaying(page)
  await expect(page.getByRole('list', { name: 'Change channel' }).getByRole('button')).toHaveCount(2)
  await page.keyboard.press('ArrowDown')
  await expect(page).toHaveURL(/#\/live\/ch0008$/)
  await waitPlaying(page)
  await page.keyboard.press('ArrowDown')
  await expect(page).toHaveURL(/#\/live\/ch0003$/)
})

test('live tv: the last channel is one click away, and the guide opens on it', async ({ page }) => {
  mock = await startMock({ movieCount: 3, liveTv: 6 })
  await signIn(page, mock)
  await openLiveTv(page)
  // Nothing watched yet: no button.
  await expect(page.getByRole('button', { name: /^Last watched/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Watch 4 · Test Channel 04' }).click()
  await waitPlaying(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Live TV', level: 1 })).toBeVisible()

  const last = page.getByRole('button', { name: 'Last watched: Test Channel 04' })
  await expect(last).toBeVisible()
  // The guide lists the last channel first, marked.
  await page.getByRole('button', { name: 'Guide', exact: true }).click()
  await expect(page.getByRole('list', { name: /^Test Channel/ }).first()).toHaveAccessibleName('Test Channel 04')
  await expect(page.getByText('Last', { exact: true })).toBeVisible()

  // It is remembered across a reload, and the button plays it.
  await page.reload()
  await openLiveTv(page)
  await page.getByRole('button', { name: 'Last watched: Test Channel 04' }).click()
  await expect(page).toHaveURL(/#\/live\/ch0004$/)
})

// ---- watching together (SyncPlay) ----------------------------------------------------------------------------------

const togetherButton = (page: Page) => page.getByRole('button', { name: /^(Watch together|Watching together: )/ })
const togetherDialog = (page: Page) => page.getByRole('dialog', { name: 'Watch together' })

/** A second browser signed in as the same account, which is another device for the server. */
async function secondDevice(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  return { page, close: () => context.close() }
}

async function startGroup(page: Page, name: string) {
  await togetherButton(page).click()
  await togetherDialog(page).getByLabel('Group name').fill(name)
  await togetherDialog(page).getByRole('button', { name: 'Start a group' }).click()
  await expect(togetherDialog(page).getByText(name, { exact: true })).toBeVisible()
  await togetherDialog(page).getByRole('button', { name: 'Close' }).click()
}

async function joinGroup(page: Page, name: string) {
  await togetherButton(page).click()
  await togetherDialog(page).getByRole('button', { name: `Join ${name}` }).click()
  await expect(togetherDialog(page).getByRole('button', { name: 'Leave the group' })).toBeVisible()
  await togetherDialog(page).getByRole('button', { name: 'Close' }).click()
}

const position = (page: Page) => page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.currentTime)
const isPaused = (page: Page) => page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.paused)

test('together: a group can be started and joined, and the others hear about it', async ({ page, browser }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  const other = await secondDevice(browser)
  try {
    await signIn(other.page, mock)
    await togetherButton(page).click()
    await expect(togetherDialog(page).getByText('No open groups. Start one and ask someone to join.')).toBeVisible()
    await togetherDialog(page).getByRole('button', { name: 'Close' }).click()

    await startGroup(page, 'Movie night')
    await expect(page.getByRole('button', { name: 'Watching together: Movie night' })).toBeVisible()

    await joinGroup(other.page, 'Movie night')
    await expect(page.getByRole('status').filter({ hasText: 'tester joined the group.' })).toBeVisible()
    await togetherButton(page).click()
    await expect(togetherDialog(page).getByText('In the group: tester, tester')).toBeVisible()
    await togetherDialog(page).getByRole('button', { name: 'Close' }).click()

    // Leaving takes the button back to its quiet state, and the others are told.
    await togetherButton(other.page).click()
    await togetherDialog(other.page).getByRole('button', { name: 'Leave the group' }).click()
    await expect(togetherDialog(other.page).getByRole('button', { name: 'Start a group' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'tester left the group.' })).toBeVisible()
  } finally {
    await other.close()
  }
})

test('together: a title starts for the whole group at once, by the server clock, and pause and seek are shared', async ({ page, browser }) => {
  // The server's clock is a minute and a half ahead: a client that ignored it would wait that long to start.
  mock = await startMock({ movieCount: 3, syncSkewMs: 90_000 })
  await signIn(page, mock)
  const other = await secondDevice(browser)
  try {
    await signIn(other.page, mock)
    await startGroup(page, 'Movie night')
    await joinGroup(other.page, 'Movie night')

    // Play on one device: both open the title, both say they are ready, and both start.
    await playMovie(page, 1)
    await expect(other.page).toHaveURL(/#\/play\/m0001/)
    await waitPlaying(page)
    await waitPlaying(other.page)
    expect(mock.requests.filter((r) => r.path === '/SyncPlay/Ready').length).toBeGreaterThanOrEqual(2)
    expect(mock.requests.some((r) => r.path === '/SyncPlay/SetNewQueue')).toBe(true)
    expect(Math.abs((await position(page)) - (await position(other.page)))).toBeLessThan(2)

    // Pausing on one pauses both.
    await page.keyboard.press('k')
    await expect.poll(() => isPaused(other.page)).toBe(true)
    await expect.poll(() => isPaused(page)).toBe(true)

    // Playing from the other starts both again (the picture waits for the group, it does not start alone).
    await other.page.keyboard.press('k')
    await expect.poll(() => isPaused(page)).toBe(false)
    await expect.poll(() => isPaused(other.page)).toBe(false)

    // Seeking on one moves both.
    await clickSeekAt(page, 0.7)
    await expect.poll(async () => await position(other.page), { timeout: 10_000 }).toBeGreaterThan(15)
    await waitPlaying(page, 15)
    await waitPlaying(other.page, 15)
  } finally {
    await other.close()
  }
})

test('together: the group does not wait for a device that left the player, and a device without permission is told so', async ({ page, browser }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock)
  const other = await secondDevice(browser)
  try {
    await signIn(other.page, mock)
    await startGroup(page, 'Movie night')
    await joinGroup(other.page, 'Movie night')
    await playMovie(page, 1)
    await waitPlaying(page)
    await waitPlaying(other.page)

    await other.page.keyboard.press('Escape')
    await expect(other.page).not.toHaveURL(/#\/play\//)
    await expect.poll(() => mock.requests.some((r) => r.path === '/SyncPlay/SetIgnoreWait' && (r.body as { IgnoreWait?: boolean })?.IgnoreWait === true)).toBe(true)

    // Seeking waits for everyone who is watching, and that is now only this device: it carries on by itself.
    await clickSeekAt(page, 0.6)
    await waitPlaying(page, 10)
  } finally {
    await other.close()
  }
})

test('together: an account that may not use it is told so', async ({ page }) => {
  mock = await startMock({ movieCount: 3, syncPlayDenied: true })
  await signIn(page, mock)
  await togetherButton(page).click()
  await expect(togetherDialog(page).getByRole('alert')).toContainText('Watching together is not allowed for this account.')
})
