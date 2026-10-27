import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { MockServer } from '../test/mock/mockJellyfin'
import { clickSeekAt, openSettings, player, signIn, startMock, video, waitPlaying } from './helpers'

/**
 * Music videos by folder and played one after the other, in real Chrome against the mock server. Its library has 7 videos: Folder 0001
 * holds 1-4, Folder 0002 holds 5 and 6 and a folder "Nested" with 7.
 */
let mock: MockServer
test.afterEach(async () => {
  await mock?.close()
})

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const views = (page: Page) => page.getByRole('navigation', { name: 'Music video views' })
const options = { movieCount: 3, musicVideos: 7, musicVideoFolders: 2 }

/** Plays the video to its end (the test videos last 30 seconds): it ends, or, when another one follows, that one takes over. */
async function finish(page: Page) {
  const before = page.url()
  await clickSeekAt(page, 0.97)
  await expect.poll(async () => page.url() !== before || (await video(page).evaluate((v: HTMLVideoElement) => v.ended)), { timeout: 15_000 }).toBe(true)
}

/** Jumps to a few seconds before the end, where the countdown to the next video begins. */
async function nearEnd(page: Page) {
  await clickSeekAt(page, 0.85)
}

const playing = (page: Page, title: string) => page.getByRole('region', { name: `Playing ${title}` })

test('folders: the library lists its folders, a folder opens with a way back, and the nested one is inside it', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Music videos' }).click()
  await views(page).getByRole('button', { name: 'Folders' }).click()

  const list = page.getByRole('list', { name: 'Folders and videos' })
  await expect(list.getByRole('button', { name: /^Open folder / })).toHaveText([/Folder 0001/, /Folder 0002/])
  await list.getByRole('button', { name: 'Open folder Folder 0002' }).click()
  await expect(page).toHaveURL(/#\/folder\/mvf0002$/)
  await expect(page.getByRole('heading', { name: 'Folder 0002', level: 1 })).toBeVisible()
  // Its folder first, then its two videos.
  const inside = page.getByRole('list', { name: 'Folders and videos' })
  await expect(inside.getByRole('button', { name: 'Open folder Nested' })).toBeVisible()
  await expect(inside.getByRole('button', { name: /^Open Test Music Video 00[56]/ })).toHaveCount(2)
  await expect(page.getByRole('navigation', { name: 'Where this folder is' })).toContainText('Music videos')

  await inside.getByRole('button', { name: 'Open folder Nested' }).click()
  await expect(page).toHaveURL(/#\/folder\/mvf0099$/)
  const trail = page.getByRole('navigation', { name: 'Where this folder is' })
  await expect(trail).toContainText('Folder 0002')
  await expect(page.getByRole('button', { name: /^Open Test Music Video 007/ })).toBeVisible()
  // Up through the trail, and back to the library's folders.
  await trail.getByRole('button', { name: 'Folder 0002' }).click()
  await expect(page).toHaveURL(/#\/folder\/mvf0002$/)
  await page.getByRole('navigation', { name: 'Where this folder is' }).getByRole('button', { name: 'Music videos' }).click()
  await expect(page).toHaveURL(/#\/musicvideos$/)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
})

test('play folder: the videos follow each other, with a short countdown, and the last one stops (unless repeating)', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await page.goto('/#/folder/mvf0001')
  await page.getByRole('button', { name: 'Play folder', exact: true }).click()
  await expect(page).toHaveURL(/#\/play\/mv0001\?folder=mvf0001$/)
  await waitPlaying(page)

  await nearEnd(page)
  const upNext = page.getByRole('status', { name: 'Up next' })
  await expect(upNext).toContainText('Test Music Video 002')
  // The countdown runs over the last 3 seconds of the video, which is still playing, and the next one follows at once.
  await expect(upNext).toContainText(/Starting in [123]s/)
  expect(await video(page).evaluate((v: HTMLVideoElement) => v.ended)).toBe(false)
  await expect(playing(page, 'Test Music Video 002')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/#\/play\/mv0002\?start=0&folder=mvf0001$/) // still inside the folder, from its start
  await waitPlaying(page)

  // The last video of the folder has nothing after it...
  await page.goto('/#/play/mv0004?folder=mvf0001')
  await waitPlaying(page)
  await finish(page)
  await expect(page.getByRole('status', { name: 'Up next' })).toHaveCount(0)

  // ...until the list is set to repeat: then the first one follows it.
  await page.goto('/#/')
  await page.goto('/#/play/mv0004?start=0&folder=mvf0001')
  await waitPlaying(page)
  const settings = await openSettings(page)
  await settings.getByLabel('Repeat the list').check()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').repeatQueue)).toBe(true)
  await page.keyboard.press('Escape')
  await nearEnd(page)
  await expect(page.getByRole('status', { name: 'Up next' })).toContainText('Test Music Video 001')
  await expect(playing(page, 'Test Music Video 001')).toBeVisible({ timeout: 15_000 })
})

test('play folder: everything below it plays, folders first (the nested one before the videos beside it)', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await page.goto('/#/folder/mvf0002')
  await page.getByRole('button', { name: 'Play folder', exact: true }).click()
  await expect(page).toHaveURL(/#\/play\/mv0007\?folder=mvf0002$/)
  await waitPlaying(page)
  await nearEnd(page)
  await expect(page.getByRole('status', { name: 'Up next' })).toContainText('Test Music Video 005')
})

test('a folder card plays that folder without opening it, and shuffle keeps one random order all the way', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Music videos' }).click()
  await views(page).getByRole('button', { name: 'Folders' }).click()
  const list = page.getByRole('list', { name: 'Folders and videos' })
  await list.getByRole('button', { name: 'Play folder Folder 0001' }).click({ force: true })
  await expect(page).toHaveURL(/#\/play\/mv0001\?folder=mvf0001$/)

  // The whole library, shuffled: the seed stays in the address and every video plays once before the end.
  await page.goto('/#/musicvideos')
  await page.getByRole('button', { name: 'Shuffle', exact: true }).click()
  await expect(page).toHaveURL(/#\/play\/mv\d{4}\?library=lib-musicvideos&shuffle=[0-9a-z]{8}$/)
  const seed = /shuffle=([0-9a-z]{8})/.exec(page.url())?.[1] as string
  const seen: string[] = []
  for (let i = 0; i < 3; i += 1) {
    await waitPlaying(page)
    seen.push(/#\/play\/(mv\d{4})/.exec(page.url())?.[1] as string)
    await finish(page)
    await expect.poll(() => /#\/play\/(mv\d{4})/.exec(page.url())?.[1], { timeout: 15_000 }).not.toBe(seen[i])
    expect(page.url()).toContain(`shuffle=${seed}`)
  }
  expect(new Set(seen).size).toBe(3) // no video twice in a row of the queue
})

test('a video played on its own goes on with the others of its folder', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await page.goto('/#/folder/mvf0002')
  await page.getByRole('button', { name: /^Open Test Music Video 005/ }).click({ position: { x: 12, y: 12 } })
  await page.getByRole('button', { name: /^(Play|Resume from .*)$/ }).click()
  await expect(player(page)).toBeVisible()
  await waitPlaying(page)
  await nearEnd(page)
  await expect(page.getByRole('status', { name: 'Up next' })).toContainText('Test Music Video 006')
  await expect(playing(page, 'Test Music Video 006')).toBeVisible({ timeout: 15_000 })
  await waitPlaying(page)
  await finish(page)
  // 007 is in the nested folder, so it is not a sibling.
  await expect(page.getByRole('status', { name: 'Up next' })).toHaveCount(0)
})

test('a playlist of music videos can be shuffled (and the section has no Playlists view)', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  await tabs(page).getByRole('button', { name: 'Music videos' }).click()
  await expect(views(page).getByRole('button')).toHaveText(['Suggestions', 'Folders'])

  // Make a playlist from the card menu of two videos.
  const more = (n: string) =>
    page.getByRole('region', { name: 'All music videos' }).getByRole('button', { name: `More options for Test Music Video ${n}` })
  await more('001').click({ force: true })
  await page.getByRole('menuitem', { name: 'Add to a playlist…' }).click()
  const picker = page.getByRole('dialog', { name: 'Add to a playlist' })
  await picker.getByLabel('New playlist name').fill('Mix tape')
  await picker.getByRole('button', { name: 'Create' }).click()
  await expect(picker).toBeHidden()
  await more('002').click({ force: true })
  await page.getByRole('menuitem', { name: 'Add to a playlist…' }).click()
  await picker.getByRole('button', { name: /^Mix tape/ }).click()
  await expect(picker).toBeHidden()

  await page.goto('/#/lists')
  await page.getByRole('button', { name: 'Open playlist Mix tape' }).click()
  await page.getByRole('button', { name: 'Shuffle', exact: true }).click()
  await expect(page).toHaveURL(/#\/play\/mv000[12]\?list=vp\d+&shuffle=[0-9a-z]{8}$/)
  await waitPlaying(page)
})

test('the next video keeps the screen as it was: a window stays a window, full screen stays full screen until Back', async ({ page }) => {
  mock = await startMock(options)
  await signIn(page, mock)
  const full = () => page.evaluate(() => !!document.fullscreenElement)
  await page.goto('/#/folder/mvf0001')
  await page.getByRole('button', { name: 'Play folder', exact: true }).click()
  await waitPlaying(page)

  // Not in full screen: the next one is not either.
  await nearEnd(page)
  await expect(playing(page, 'Test Music Video 002')).toBeVisible({ timeout: 15_000 })
  await waitPlaying(page)
  expect(await full()).toBe(false)

  // In full screen: the next one goes on in it.
  await page.mouse.move(400, 400)
  await player(page).getByRole('button', { name: 'Fullscreen' }).click()
  await expect.poll(full).toBe(true)
  await nearEnd(page)
  await expect(playing(page, 'Test Music Video 003')).toBeVisible({ timeout: 15_000 })
  await waitPlaying(page)
  expect(await full()).toBe(true)
  await page.mouse.move(420, 420)
  await expect(player(page).getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()

  // Leaving the player leaves full screen (the video goes on in the bar).
  await player(page).getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('region', { name: /^Video mini player/ })).toBeVisible()
  await expect.poll(full).toBe(false)
})
