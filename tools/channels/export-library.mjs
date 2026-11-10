#!/usr/bin/env node
/**
 * Reads the library of a Jellyfin server and writes it to a file (library-export.json), so channels for Retro TV can be designed
 * from what is really in it.
 *
 *   node tools/channels/export-library.mjs https://your-jellyfin.example
 *
 * - It only READS. Nothing is written to Jellyfin.
 * - It asks for the user name and the password in the terminal (the password is not shown). They are sent only to the server you
 *   gave, to sign in; the sign-in is closed when the script ends. For tests, JELLYFIN_USER and JELLYFIN_PASSWORD can be set instead.
 * - The file has titles, years, genres, lengths, ratings, studios and collections. It has no password, no token, no file paths.
 * - Sign in with an administrator to see everything; another account exports what it can see.
 *
 * Needs Node 20 or newer, and no packages.
 */
import { writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(process.argv[3] ?? join(here, 'library-export.json'))

const rawUrl = process.argv[2] ?? process.env.JELLYFIN_URL
if (!rawUrl) {
  console.error('Usage: node tools/channels/export-library.mjs https://your-jellyfin.example [output-file.json]')
  process.exit(1)
}
const server = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`).href.replace(/\/+$/, '')

/** Asks a question in the terminal; a hidden answer is not echoed. */
function ask(question, hidden = false) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    let muted = false
    const write = rl._writeToOutput?.bind(rl)
    if (hidden && write) rl._writeToOutput = (text) => (muted ? undefined : write(text))
    rl.question(question, (answer) => {
      rl.close()
      if (hidden) process.stdout.write('\n')
      done(answer)
    })
    muted = hidden
  })
}

const IDENTITY = 'MediaBrowser Client="Jellyflix channel tools", Device="Export", DeviceId="jellyflix-channel-tools", Version="1"'
let token = ''

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${server}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: token ? `${IDENTITY}, Token="${token}"` : IDENTITY },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
  })
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} answered ${res.status}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const FIELDS = 'Genres,Studios,OfficialRating,RunTimeTicks,ProductionYear,ChildCount,RecursiveItemCount'
const PAGE = 500

/** Every item of the kinds asked for, page by page (a library of thousands is fine). */
async function everything(userId, extra) {
  const items = []
  for (let start = 0; ; start += PAGE) {
    const query = new URLSearchParams({ userId, Recursive: 'true', Limit: String(PAGE), StartIndex: String(start), SortBy: 'SortName', SortOrder: 'Ascending', EnableTotalRecordCount: 'true', ...extra })
    const page = await call(`/Items?${query}`)
    items.push(...(page.Items ?? []))
    if (start + PAGE >= (page.TotalRecordCount ?? 0) || (page.Items ?? []).length === 0) return items
  }
}

const minutes = (ticks) => (ticks ? Math.round(ticks / 600_000_000) : 0)

try {
  const user = process.env.JELLYFIN_USER ?? (await ask('Jellyfin user: '))
  const password = process.env.JELLYFIN_PASSWORD ?? (await ask('Password (not shown): ', true))
  const auth = await call('/Users/AuthenticateByName', { method: 'POST', body: { Username: user, Pw: password } })
  token = auth.AccessToken
  const userId = auth.User.Id
  console.log(`Signed in as ${auth.User.Name}.`)

  try {
    // Which library each title lives in.
    const views = ((await call(`/UserViews?userId=${userId}`)).Items ?? []).filter((v) => ['movies', 'tvshows', 'homevideos', 'mixed'].includes(String(v.CollectionType ?? 'mixed').toLowerCase()) || !v.CollectionType)
    const libraryOf = new Map()
    for (const view of views) {
      for (const item of await everything(userId, { ParentId: view.Id, IncludeItemTypes: 'Movie,Series' })) libraryOf.set(item.Id, view.Name)
      console.log(`Library “${view.Name}” read.`)
    }

    const shape = (item) => ({
      id: item.Id,
      name: item.Name,
      ...(item.ProductionYear ? { year: item.ProductionYear } : {}),
      genres: item.Genres ?? [],
      ...(item.OfficialRating ? { rating: item.OfficialRating } : {}),
      // How well liked it is (0 to 10, from TMDb) and what critics gave it (0 to 100), when the server knows.
      ...(item.CommunityRating ? { score: Math.round(item.CommunityRating * 10) / 10 } : {}),
      ...(item.CriticRating ? { critics: Math.round(item.CriticRating) } : {}),
      studios: (item.Studios ?? []).map((s) => s.Name).filter(Boolean),
      ...(libraryOf.has(item.Id) ? { library: libraryOf.get(item.Id) } : {}),
    })

    const movies = (await everything(userId, { IncludeItemTypes: 'Movie', Fields: FIELDS })).map((m) => ({ ...shape(m), minutes: minutes(m.RunTimeTicks) }))
    console.log(`${movies.length} movies.`)
    const series = (await everything(userId, { IncludeItemTypes: 'Series', Fields: FIELDS })).map((s) => ({
      ...shape(s),
      seasons: s.ChildCount ?? 0,
      episodes: s.RecursiveItemCount ?? 0,
      // The length of an episode, when the server says (the length of one is enough to tell a cartoon from a drama).
      episodeMinutes: minutes(s.RunTimeTicks),
    }))
    console.log(`${series.length} series.`)

    const boxes = await everything(userId, { IncludeItemTypes: 'BoxSet' })
    const collections = []
    for (const box of boxes) {
      const members = await everything(userId, { ParentId: box.Id, IncludeItemTypes: 'Movie,Series' })
      collections.push({ id: box.Id, name: box.Name, itemIds: members.map((m) => m.Id) })
    }
    console.log(`${collections.length} collections.`)

    const info = await call('/System/Info/Public').catch(() => ({}))
    await writeFile(
      out,
      JSON.stringify({ exportedAt: new Date().toISOString(), server: info.ServerName ?? '', libraries: [...new Set(libraryOf.values())], movies, series, collections }, null, 1),
      'utf8',
    )
    console.log(`\nWritten: ${out}`)
    console.log('It holds only titles and their details (no password, no token, no file paths).')
  } finally {
    // Close the sign-in this script opened.
    await call('/Sessions/Logout', { method: 'POST' }).catch(() => undefined)
  }
} catch (error) {
  console.error(`\nIt did not work: ${error instanceof Error ? error.message : error}`)
  console.error(`(${basename(process.argv[1] ?? 'export-library.mjs')} only reads; nothing was changed on the server.)`)
  process.exit(1)
}
