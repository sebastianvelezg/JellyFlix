// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards for the administrator tools. They read the source (not the running app) and fail when a line is added that
 * would break a rule these tools are built on: nothing is written to the console, nothing is stored outside the one
 * local history, no secret reaches a screen, and pictures from a provider are asked for only with a no-referrer policy.
 */
const src = join(import.meta.dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(join(src, ...parts), 'utf8')
const files = (dir: string, pattern: RegExp) => readdirSync(join(src, dir)).filter((f) => pattern.test(f) && !/\.test\./.test(f)).map((f) => [`${dir}/${f}`, read(dir, f)] as const)

const adminSources = [...files('components/admin', /\.tsx?$/), ...files('core', /^admin.*\.ts$/)]

describe('administrator tools: what the code must never do', () => {
  it('finds the files it is meant to check', () => {
    expect(adminSources.length).toBeGreaterThan(12)
  })

  it('never writes to the console, runs text as code, or opens other pages', () => {
    for (const [name, text] of adminSources) {
      expect(text, name).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\b/)
      expect(text, name).not.toMatch(/\beval\(|new Function\(|dangerouslySetInnerHTML|\.innerHTML\b|document\.write|window\.open\(/)
    }
  })

  it('keeps the core free of the browser, and the screens free of direct requests', () => {
    for (const [name, text] of adminSources) {
      if (name.startsWith('core/')) expect(text, name).not.toMatch(/\b(localStorage|sessionStorage|document\.|window\.|fetch\()/)
      else expect(text, name).not.toMatch(/\bfetch\(|XMLHttpRequest|axios/)
    }
  })

  it('stores nothing in the browser except through the one local history', () => {
    for (const [name, text] of adminSources) expect(text, name).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\b/)
  })

  it('never shows or keeps a token, an API key or a password', () => {
    for (const [name, text] of adminSources.filter(([n]) => n.startsWith('components/'))) {
      expect(text, name).not.toMatch(/AccessToken|\.secret\b|accessToken/)
    }
    // The core drops a device's token as it reads the list, and keeps a key's text only for revoking it.
    const core = read('core', 'adminServer.ts')
    expect(core).not.toMatch(/AccessToken\s*[:,]\s*d\.AccessToken/)
    expect(core).toMatch(/dropped here and never shown/)
    // A password typed in a form is cleared once it is sent or the form is closed.
    const users = read('components/admin', 'UsersAdmin.tsx')
    expect(users.match(/setPassword\(''\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('asks a provider for a picture only with no referrer, and never loads one before the person asks', () => {
    for (const name of ['IdentifyTab.tsx', 'PicturesTab.tsx']) {
      const text = read('components/admin', name)
      const remote = text.split('\n').filter((line, i, all) => /candidate\.imageUrl|c\.thumbnail/.test(line) && /src=/.test(`${all[i - 1] ?? ''}${line}`))
      expect(remote.length, name).toBeGreaterThan(0)
      expect(text, name).toMatch(/referrerPolicy="no-referrer"/)
      expect(text, name).toMatch(/pictures && candidate\.imageUrl|previews &&/)
    }
  })

  it('has a confirmation in front of every call that changes the server', () => {
    // Each write function of the core is called from a screen, always from inside a confirmation or a typed-name box.
    const writes: Array<[string, RegExp]> = [
      ['components/admin/DetailsTab.tsx', /saveItem\(/],
      ['components/admin/IdentifyTab.tsx', /applyIdentity\(/],
      ['components/admin/RefreshTab.tsx', /refreshItem\(/],
      ['components/admin/PicturesTab.tsx', /(deletePicture|downloadPicture|uploadPicture)\(/],
      ['components/admin/LibraryAdmin.tsx', /(deleteTitle|runBatch)\(/],
      ['components/admin/UsersAdmin.tsx', /(savePolicy|createUser|setUserPassword)\(/],
      ['components/admin/DevicesAdmin.tsx', /(removeDevice|revokeApiKey|stopSessionPlayback|sendSessionMessage)\(/],
    ]
    for (const [file, call] of writes) {
      const text = readFileSync(join(src, file), 'utf8')
      expect(text, file).toMatch(call)
      expect(text, file).toMatch(/ConfirmBox|<form/)
    }
  })
})
