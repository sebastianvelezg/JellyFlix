#!/usr/bin/env node
/**
 * Creates Retro TV channels from a file (channels.json), through the modules container of your Jellyflix.
 *
 *   node tools/channels/import-channels.mjs --jellyfin https://your-jellyfin.example --modules https://your-jellyflix.example/modules
 *   node tools/channels/import-channels.mjs ... --apply          (does it for real; without it nothing is changed)
 *   node tools/channels/import-channels.mjs ... --undo tools/channels/import-log-XXXX.json
 *
 * - By default it is a DRY RUN: it asks the container what each channel would show (how many titles, which ones have no length) and
 *   says what it would create or change. Nothing is written until you add --apply.
 * - A channel whose name already exists is not created again: with "merge": true in the file the titles it lacks are added to it (its
 *   number, colour and settings stay as they are); without it, it is skipped.
 * - With --apply a log (import-log-DATE.json) is written. --undo with that log deletes what was created and puts back what was changed.
 * - You sign in with an administrator of your Jellyfin, in the terminal (the password is not shown, or set JELLYFIN_USER and
 *   JELLYFIN_PASSWORD). The sign-in is closed when the script ends. Nothing is written to Jellyfin: only to the container.
 *
 * Needs Node 20 or newer, and no packages.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const apply = args.includes('--apply')
const undoFile = flag('--undo')
const file = resolve(args.find((a) => a.endsWith('.json') && a !== undoFile) ?? join(here, 'channels.json'))
const jellyfin = flag('--jellyfin') ?? process.env.JELLYFIN_URL
const modulesUrl = flag('--modules') ?? process.env.MODULES_URL
if (!jellyfin || !modulesUrl) {
  console.error('Usage: node tools/channels/import-channels.mjs --jellyfin https://your-jellyfin --modules https://your-jellyflix/modules [channels.json] [--apply | --undo log.json]')
  process.exit(1)
}
const base = (u) => new URL(u.includes('://') ? u : `https://${u}`).href.replace(/\/+$/, '')
const JF = base(jellyfin)
const MOD = base(modulesUrl)

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

const IDENTITY = 'MediaBrowser Client="Jellyflix channel tools", Device="Import", DeviceId="jellyflix-channel-tools", Version="1"'
let token = ''

async function request(root, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${root}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: token ? `${IDENTITY}, Token="${token}"` : IDENTITY },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // Not JSON (a page from a proxy, for instance).
  }
  if (!res.ok) {
    const error = new Error(`${data?.error ?? text.slice(0, 120) ?? res.statusText} (${method} ${path.split('?')[0]} answered ${res.status})`)
    error.status = res.status
    throw error
  }
  return data
}
const mod = (path, options) => request(MOD, path, options)

/** Compares names the way a person does: no capitals, accents or punctuation. */
const key = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const PALETTE = ['#4d8dff', '#e5484d', '#30a46c', '#f5a524', '#8e4ec6', '#12a594', '#e93d82', '#0091ff']
const pad = (s, n) => String(s).padEnd(n)

async function main() {
  const user = process.env.JELLYFIN_USER ?? (await ask('Jellyfin user (an administrator): '))
  const password = process.env.JELLYFIN_PASSWORD ?? (await ask('Password (not shown): ', true))
  const auth = await request(JF, '/Users/AuthenticateByName', { method: 'POST', body: { Username: user, Pw: password } })
  token = auth.AccessToken
  console.log(`Signed in as ${auth.User.Name}.`)
  try {
    const manifest = await mod('/v1/manifest')
    if (!manifest.user?.isAdmin) throw new Error('That account is not an administrator of Jellyfin, which is needed to make channels.')
    if (!manifest.modules?.some((m) => m.id === 'channels' && m.state === 'ready')) throw new Error('The channels module is not on in the modules container.')
    console.log(`Container ${manifest.version} answers.`)
    if (undoFile) return await undo(resolve(undoFile))
    await run()
  } finally {
    await request(JF, '/Sessions/Logout', { method: 'POST' }).catch(() => undefined)
  }
}

async function run() {
  const wanted = JSON.parse(await readFile(file, 'utf8'))
  const existing = await mod('/v1/channels')
  const byName = new Map(existing.map((c) => [key(c.name), c]))
  const taken = new Set(existing.map((c) => c.number))
  console.log(`\n${wanted.length} channels in ${file}; ${existing.length} already on the server.\n`)
  console.log(apply ? 'DOING IT FOR REAL.\n' : 'DRY RUN: nothing is changed (add --apply to do it).\n')

  const log = { at: new Date().toISOString(), modules: MOD, created: [], changed: [] }
  let problems = 0
  const freeNumber = (wish) => {
    let n = wish
    while (taken.has(n)) n += 1
    taken.add(n)
    return n
  }

  for (const [index, ch] of wanted.entries()) {
    const sources = ch.sources.map((s) => ({ kind: 'item', id: s.id, name: s.name, itemType: s.itemType }))
    const found = byName.get(key(ch.name))
    const label = `${pad(ch.number, 4)}${pad(ch.name, 46)}`
    try {
      if (found && !ch.merge) {
        console.log(`${label} skipped: a channel with this name already exists (number ${found.number}).`)
        continue
      }
      if (found && ch.merge) {
        const def = await mod(`/v1/channels/${found.id}`)
        const have = new Set(def.sources.filter((s) => s.kind === 'item').map((s) => s.id))
        const add = sources.filter((s) => !have.has(s.id))
        if (add.length === 0) {
          console.log(`${label} already has all its titles.`)
          continue
        }
        const next = { ...def, sources: [...def.sources, ...add] }
        const preview = await mod('/v1/channels/preview', { method: 'POST', body: toDef(next) })
        console.log(`${label} MERGE: +${add.length} titles into “${found.name}” (number ${found.number}); it would show ${preview.poolSize} titles.${warn(preview)}`)
        if (apply) {
          await mod(`/v1/channels/${found.id}`, { method: 'PUT', body: toDef(next) })
          log.changed.push({ id: found.id, before: toDef(def) })
        }
        continue
      }
      const number = freeNumber(ch.number)
      const def = {
        name: ch.name,
        number,
        color: PALETTE[index % PALETTE.length],
        sources,
        mode: 'marathon',
        order: ch.order ?? 'interleave',
        blocks: [],
        timezone: 'UTC',
        avoidRepeat: 5,
        episodesInARow: ch.episodesInARow ?? 1,
        maxMinutes: ch.maxMinutes ?? 0,
        enabled: true,
      }
      const preview = await mod('/v1/channels/preview', { method: 'POST', body: def })
      const hours = Math.round(preview.programs.reduce((t, p) => t + p.runtime, 0) / 3600)
      console.log(`${label} NEW as ${number}: ${sources.length} sources, ${preview.poolSize} titles to show (the next ${preview.programs.length} programs are ~${hours} h).${warn(preview)}`)
      if (apply) {
        const made = await mod('/v1/channels', { method: 'POST', body: def })
        log.created.push({ id: made.id, number, name: ch.name })
      }
    } catch (error) {
      problems += 1
      console.log(`${label} PROBLEM: ${error.message}`)
    }
  }

  console.log(`\n${problems} problems.`)
  if (apply) {
    const out = join(here, `import-log-${log.at.replace(/[:.]/g, '-')}.json`)
    await writeFile(out, JSON.stringify(log, null, 1), 'utf8')
    console.log(`Done: ${log.created.length} created, ${log.changed.length} changed. Log: ${out}`)
    console.log('To undo all of it: node tools/channels/import-channels.mjs ... --undo ' + out)
  } else {
    console.log('That was a dry run. If it looks right, run it again with --apply.')
  }
}

/** The part of a channel the container accepts back. */
function toDef(c) {
  const { name, number, color, sources, mode, order, blocks, timezone, avoidRepeat, episodesInARow, maxMinutes, enabled } = c
  return { name, number, color, sources, mode, order, blocks, timezone, avoidRepeat, ...(episodesInARow !== undefined ? { episodesInARow } : {}), ...(maxMinutes !== undefined ? { maxMinutes } : {}), enabled }
}

const warn = (preview) => {
  const w = preview.warnings ?? []
  return w.length ? `\n      ⚠ ${w.length} source(s) with a problem, e.g. ${w[0]}` : ''
}

async function undo(logFile) {
  const log = JSON.parse(await readFile(logFile, 'utf8'))
  console.log(`\nUndoing ${logFile}: ${log.created.length} created, ${log.changed.length} changed.\n`)
  for (const c of log.created) {
    try {
      await mod(`/v1/channels/${c.id}`, { method: 'DELETE' })
      console.log(`deleted ${c.number} ${c.name}`)
    } catch (error) {
      console.log(`could not delete ${c.number} ${c.name}: ${error.message}`)
    }
  }
  for (const c of log.changed) {
    try {
      await mod(`/v1/channels/${c.id}`, { method: 'PUT', body: c.before })
      console.log(`restored ${c.before.name}`)
    } catch (error) {
      console.log(`could not restore ${c.before.name}: ${error.message}`)
    }
  }
}

main().catch((error) => {
  console.error(`\nIt did not work: ${error.message}`)
  process.exit(1)
})
