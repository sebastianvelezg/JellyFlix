import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock } from './helpers'

/**
 * Books against the mock server: the tab, the cards, the book page, the readers (EPUB, comic, PDF), downloading, and audiobooks in the
 * music player. As in the other specs, this proves the client's behaviour, not compatibility with a real Jellyfin server.
 * bk0001 is an EPUB, bk0002 a PDF, bk0003 a comic (CBZ), bk0004 a Mobi file; ab0001 is an audiobook.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const reader = (page: Page, title: string) => page.getByRole('region', { name: `Reading ${title}` })

async function openBook(page: Page, name: string) {
  await tabs(page).getByRole('button', { name: 'Books' }).click()
  await page.getByRole('region', { name: 'All books' }).getByRole('button', { name: new RegExp(`^Open ${name}`) }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
}

test('books: a tab with their cards (kind and year), and a page with the author', async ({ page }) => {
  mock = await startMock({ movieCount: 3, books: 4, audiobooks: 1 })
  await signIn(page, mock)
  await expect(tabs(page).getByRole('button')).toHaveText(['Home', 'Movies', 'Series', 'Books'])
  await tabs(page).getByRole('button', { name: 'Books' }).click()
  await expect(page).toHaveURL(/#\/books$/)
  const all = page.getByRole('region', { name: 'All books' })
  await expect(all.getByText('5 of 5 books')).toBeVisible()
  await expect(all.getByRole('button', { name: 'Open Test Book 001 (EPUB, 1981)' })).toBeVisible()
  await expect(all.getByRole('button', { name: 'Open Test Audiobook 001 (Audiobook, 2001)' })).toBeVisible()

  await all.getByRole('button', { name: /^Open Test Book 001/ }).click()
  await expect(page.getByRole('heading', { name: 'Test Book 001', level: 1 })).toBeVisible()
  await expect(page.getByText('Test Author 2', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Read', exact: true })).toBeVisible()
})

test('books: an EPUB opens in the reader, its page has no scripts or network, links and chapters work, and the place is remembered', async ({ page }) => {
  mock = await startMock({ movieCount: 3, books: 4 })
  await signIn(page, mock)
  const external: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) external.push(request.url())
  })
  await openBook(page, 'Test Book 001')
  await page.getByRole('button', { name: 'Read', exact: true }).click()

  const shell = reader(page, 'Test Book 001')
  await expect(shell).toBeVisible()
  await expect(page).toHaveURL(/#\/read\/bk0001$/)
  const book = page.frameLocator('iframe[title="Chapter 1"]')
  await expect(book.getByRole('heading', { name: 'Chapter 1 heading' })).toBeVisible()
  await expect(shell.getByText('Chapter 1 of 3')).toBeVisible()
  // The book cannot run a script, reach the network or show a picture from outside.
  expect(await page.title()).not.toBe('hacked')
  await expect(book.locator('img[alt="A dot"]')).toHaveAttribute('src', /^data:image\/png/)
  await expect(book.locator('img[alt="A tracker"]')).not.toHaveAttribute('src', /.+/)
  expect(external).toEqual([])

  // A link between chapters is followed; the chapter list and the buttons work.
  await book.getByRole('link', { name: 'Go to chapter two' }).click()
  await expect(page.frameLocator('iframe[title="Chapter 2"]').getByRole('heading', { name: 'Chapter 2 heading' })).toBeVisible()
  await expect(shell.getByText('Chapter 2 of 3')).toBeVisible()
  await shell.getByRole('button', { name: 'Next chapter' }).click()
  await expect(shell.getByText('Chapter 3 of 3')).toBeVisible()
  await shell.getByRole('combobox', { name: 'Chapters' }).selectOption({ label: 'Chapter One' })
  await expect(shell.getByText('Chapter 1 of 3')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(shell.getByText('Chapter 2 of 3')).toBeVisible()

  // The text size and the colours are the reader's own, and are kept.
  await shell.getByRole('button', { name: 'Larger text' }).click()
  await shell.getByRole('combobox', { name: 'Page colours' }).selectOption('sepia')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.reader') ?? '{}'))).toMatchObject({ textSize: 110, theme: 'sepia' })

  // Leaving brings you back to the book page, which offers to continue; the place is remembered.
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/#\/book\/bk0001$/)
  await expect(page.getByRole('button', { name: /^Continue reading \(\d+%\)$/ })).toBeVisible()
  await page.getByRole('button', { name: /^Continue reading/ }).click()
  await expect(reader(page, 'Test Book 001').getByText('Chapter 2 of 3')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Continue reading' }).getByRole('button', { name: /^Open Test Book 001/ })).toBeVisible()
})

test('books: a comic opens page by page, in order, with the arrow keys, and can be turned right to left', async ({ page }) => {
  mock = await startMock({ movieCount: 3, books: 4 })
  await signIn(page, mock)
  await openBook(page, 'Test Book 003')
  await page.getByRole('button', { name: 'Read', exact: true }).click()
  const shell = reader(page, 'Test Book 003')
  await expect(shell.getByText('Page 1 of 4')).toBeVisible()
  await expect(shell.locator('img')).toHaveAttribute('src', /^blob:/)
  await page.keyboard.press('ArrowRight')
  await expect(shell.getByText('Page 2 of 4')).toBeVisible()
  await shell.getByRole('button', { name: 'Right to left' }).click()
  await page.keyboard.press('ArrowRight') // now this goes back
  await expect(shell.getByText('Page 1 of 4')).toBeVisible()
  await page.keyboard.press('End')
  await expect(shell.getByText('Page 4 of 4')).toBeVisible()
  await expect(shell.getByRole('button', { name: 'Previous page' })).toBeEnabled()
  await page.keyboard.press('Escape')
  // A finished comic is opened at its first page again.
  await expect(page.getByRole('button', { name: 'Read', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Read', exact: true }).click()
  await expect(reader(page, 'Test Book 003').getByText('Page 1 of 4')).toBeVisible()
})

test('books: a PDF is read in pages of its own, with the browser viewer one click away', async ({ page }) => {
  mock = await startMock({ movieCount: 3, books: 4 })
  await signIn(page, mock)
  await openBook(page, 'Test Book 002')
  await page.getByRole('button', { name: 'Read', exact: true }).click()
  const shell = reader(page, 'Test Book 002')
  await expect(shell).toBeVisible()
  // Three pages are laid out, and the first one is drawn.
  await expect(shell.getByRole('img', { name: 'Page 1 of 3' })).toBeVisible()
  await expect(shell.getByRole('img', { name: /Page \d of 3/ })).toHaveCount(3)
  await expect(shell.locator('canvas').first()).toBeVisible()
  const pageNumber = shell.getByRole('spinbutton', { name: 'Go to page' })
  await expect(pageNumber).toHaveValue('1')
  // Turning the page scrolls to the next one, and the place is remembered.
  await shell.getByRole('button', { name: 'Next page' }).click()
  await expect(pageNumber).toHaveValue('2')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.books') ?? '{}').bk0002?.place)).toBe('2')
  // The colours of the page are the reader's choice, and are kept.
  await shell.getByLabel('Page colours').selectOption('sepia')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.reader') ?? '{}').theme)).toBe('sepia')
  await shell.getByRole('button', { name: 'Zoom in' }).click()
  await expect(shell.getByRole('button', { name: 'Fit the width' })).toHaveText('125%')
  // Leaving and coming back opens it where it was.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Continue reading/ }).click()
  await expect(reader(page, 'Test Book 002').getByRole('spinbutton', { name: 'Go to page' })).toHaveValue('2')
  // The browser's own viewer is still there for searching and printing (where the browser can show a PDF at all).
  const canShow = await page.evaluate(() => navigator.pdfViewerEnabled !== false)
  await reader(page, 'Test Book 002').getByRole('button', { name: 'Browser viewer' }).click()
  if (canShow) await expect(reader(page, 'Test Book 002').locator('iframe[src^="blob:"]')).toBeVisible()
  else await expect(reader(page, 'Test Book 002').getByRole('button', { name: 'Download' })).toBeVisible()
})

test('books: a format with no reader says so and can still be downloaded', async ({ page }) => {
  mock = await startMock({ movieCount: 3, books: 4 })
  await signIn(page, mock)
  await openBook(page, 'Test Book 004')
  await expect(page.getByRole('button', { name: 'Read', exact: true })).toHaveCount(0)
  await expect(page.getByText('Jellyflix cannot open MOBI files yet.')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  expect((await download).suggestedFilename()).toBe('Test Book 004.mobi')
  expect(mock.requests.some((r) => r.path === '/Items/bk0004/Download' && r.auth === 'header')).toBe(true)
})

test('books: an account that may not download is told so, in the reader and on the page', async ({ page }) => {
  mock = await startMock({ movieCount: 3, books: 4, noDownload: true })
  await signIn(page, mock)
  await openBook(page, 'Test Book 001')
  await page.getByRole('button', { name: 'Read', exact: true }).click()
  await expect(reader(page, 'Book').getByRole('alert')).toContainText('not allowed to download')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Download' }).click()
  await expect(page.getByRole('alert')).toContainText('not allowed to download')
})

test('books: an audiobook plays in the music player from where it was left, and reports its place', async ({ page }) => {
  mock = await startMock({ movieCount: 3, audiobooks: 2 })
  mock.user.resume.set('ab0001', 12 * 10_000_000)
  await signIn(page, mock)
  await openBook(page, 'Test Audiobook 001')
  await expect(page.getByRole('button', { name: 'Read', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /^Resume from 0:12$/ }).click()
  const bar = page.getByRole('region', { name: 'Music player' })
  await expect(bar).toContainText('Test Audiobook 001')
  await expect(bar.getByRole('button', { name: /Test Audiobook 001 by Test Author 2/ })).toBeVisible()
  await page.waitForFunction(() => {
    const a = document.querySelector<HTMLAudioElement>('[data-testid=music-audio]')
    return !!a && !a.paused && a.currentTime >= 11.5
  })
  await expect.poll(() => mock.requests.some((r) => r.path === '/Sessions/Playing' && (r.body as { ItemId?: string })?.ItemId === 'ab0001')).toBe(true)
})
