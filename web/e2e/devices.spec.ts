import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { signIn, startMock, video, waitPlaying } from './helpers'

/**
 * "Play on…" between two browsers signed in to the same account: a computer and a phone (an iPhone-sized window that says it is
 * one). Real Chrome decodes real media; the mock server routes the commands over its socket the way Jellyfin does. This proves the
 * client's behaviour, not compatibility with a real Jellyfin server, and not iOS's own rules about starting sound without a tap.
 */
let mock: MockServer
let phoneContext: BrowserContext | undefined
test.afterEach(async () => {
  await phoneContext?.close()
  phoneContext = undefined
  await mock?.close()
})

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

async function twoDevices(browser: Browser, page: Page, options: Parameters<typeof startMock>[0] = {}) {
  mock = await startMock({ movieCount: 4, musicArtists: 2, ...options })
  await signIn(page, mock, { start: '/' })
  phoneContext = await browser.newContext({ viewport: { width: 390, height: 800 }, userAgent: IPHONE, hasTouch: true })
  const phone = await phoneContext.newPage()
  await signIn(phone, mock, { start: '/' })
  // Each one is listed as controllable once its socket is open.
  await expect.poll(() => mock.connectedDevices().length).toBe(2)
  return phone
}

/** The phone looks for devices again, as it does when it comes back to the front. */
const lookAgain = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

const audioPlaying = (page: Page) =>
  page.waitForFunction(() => {
    const a = document.querySelector<HTMLAudioElement>('[data-testid=music-audio]')
    return !!a && !a.paused && a.currentTime > 0.3 && a.readyState >= 3
  })
const videoPaused = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.paused)

test('a movie playing on the computer can be sent to the phone, which carries on from the same place', async ({ browser, page }) => {
  const phone = await twoDevices(browser, page)
  await page.goto('/#/movies')
  await page.getByRole('region', { name: 'All movies' }).getByRole('button', { name: /Open Test Movie 001/ }).click()
  await page.getByRole('button', { name: /^(Play|Resume from .*)$/ }).click()
  await waitPlaying(page, 2)

  await page.mouse.move(500, 300)
  await page.getByRole('region', { name: /^Playing / }).getByRole('button', { name: 'Play on…' }).click()
  await page.getByRole('menuitem', { name: /iPhone/ }).click()

  // It stops on the computer (the page goes back to the movie) and plays on the phone from about where it was.
  await expect(video(page)).toBeHidden()
  await expect(phone).toHaveURL(/#\/play\/m0001\?start=\d+/)
  await expect(video(phone)).toBeVisible()
  const start = Number(/start=(\d+)/.exec(phone.url())?.[1])
  expect(start).toBeGreaterThanOrEqual(2)
  await waitPlaying(phone, start)
})

test('the phone shows what the computer is playing and can pause, resume and take it over', async ({ browser, page }) => {
  const phone = await twoDevices(browser, page)
  await page.goto('/#/movies')
  await page.getByRole('region', { name: 'All movies' }).getByRole('button', { name: /Open Test Movie 002/ }).click()
  await page.getByRole('button', { name: /^(Play|Resume from .*)$/ }).click()
  await waitPlaying(page, 1)

  await lookAgain(phone)
  await phone.getByRole('button', { name: /^On .*: Test Movie 002/ }).click()
  const remote = phone.getByRole('region', { name: /^Playing on / })
  await expect(remote).toContainText('Test Movie 002')

  await remote.getByRole('button', { name: 'Pause' }).click()
  await expect.poll(() => videoPaused(page)).toBe(true)
  await remote.getByRole('button', { name: 'Resume' }).click()
  await expect.poll(() => videoPaused(page)).toBe(false)

  // "Play here" moves it: the computer stops, the phone plays.
  await remote.getByRole('button', { name: 'Play here' }).click()
  await expect(video(page)).toBeHidden()
  await expect(phone).toHaveURL(/#\/play\/m0002/)
  await waitPlaying(phone, 0.5)
})

test('music started on the computer can be controlled from the phone and moved to it', async ({ browser, page }) => {
  const phone = await twoDevices(browser, page)
  await page.getByRole('article', { name: 'Random music' }).getByRole('button', { name: 'Play album' }).click()
  await audioPlaying(page)

  await lookAgain(phone)
  await phone.getByRole('button', { name: /^On .*: / }).click()
  const remote = phone.getByRole('region', { name: /^Playing on / })
  await remote.getByRole('button', { name: 'Pause' }).click()
  await expect.poll(() => page.getByTestId('music-audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await remote.getByRole('button', { name: 'Resume' }).click()
  await audioPlaying(page)

  // From the computer's own player bar, hand the music to the phone.
  await page.getByRole('region', { name: 'Music player' }).getByRole('button', { name: 'Play on…' }).click()
  await page.getByRole('menuitem', { name: /iPhone/ }).click()
  await audioPlaying(phone)
  await expect.poll(() => page.getByTestId('music-audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await expect(page.getByRole('region', { name: 'Music player' })).toBeHidden()
})

test('a message another device sends is shown', async ({ page }) => {
  mock = await startMock({ movieCount: 3 })
  await signIn(page, mock, { start: '/#/movies' })
  await expect.poll(() => mock.connectedDevices().length).toBe(1)
  const message = { MessageType: 'GeneralCommand', Data: { Name: 'DisplayMessage', Arguments: { Header: 'Hi', Text: 'Dinner is ready' } } }
  expect(mock.push(mock.connectedDevices()[0] as string, message)).toBe(true)
  await expect(page.getByRole('status').filter({ hasText: 'Hi: Dinner is ready' })).toBeVisible()
})

test('sending the music away from the full-screen player leaves the page scrollable', async ({ browser, page }) => {
  const phone = await twoDevices(browser, page)
  await phone.getByRole('article', { name: 'Random music' }).getByRole('button', { name: 'Play album' }).click()
  await audioPlaying(phone)
  await phone.getByRole('button', { name: /Open the full-screen player/ }).click()
  const nowPlaying = phone.getByRole('dialog', { name: 'Now playing' })
  await expect(nowPlaying).toBeVisible()
  // While it is open the page behind it is held still.
  expect(await phone.evaluate(() => document.body.style.overflow)).toBe('hidden')

  await nowPlaying.getByRole('button', { name: 'Play on…' }).click()
  await phone.getByRole('menuitem').filter({ hasNotText: 'Living room TV' }).click()
  await audioPlaying(page)
  await expect(nowPlaying).toBeHidden()

  // The music is gone from the phone, and so is the hold on the page: it scrolls again.
  await expect.poll(() => phone.evaluate(() => document.body.style.overflow)).toBe('')
  await phone.evaluate(() => window.scrollTo(0, 300))
  expect(await phone.evaluate(() => window.scrollY)).toBeGreaterThan(0)
})
