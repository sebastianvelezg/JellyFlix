import { afterEach, describe, expect, it } from 'vitest'
import { MAX_SETTINGS_CHARS } from '../../core'
import { readAppearance, writeAppearance } from './appearance'
import { readBrowsePrefs, readPlayerPrefs, readUiPrefs, writeUiPrefs } from './prefs'
import { applySettings, exportSettings, parseSettings } from './settingsBackup'

afterEach(() => localStorage.clear())

describe('settings backup', () => {
  it('exports only the preferences of this app', () => {
    writeAppearance({ posterSize: 'large', density: 'compact' })
    localStorage.setItem('jellyflix.ui', JSON.stringify({ language: 'es' }))
    localStorage.setItem('jellyflix.player', '{broken')
    localStorage.setItem('jellyflix.session', JSON.stringify({ token: 'secret-token', serverUrl: 'http://jellyfin.local' }))
    localStorage.setItem('something.else', JSON.stringify({ a: 1 }))
    const file = exportSettings(new Date('2026-10-22T10:00:00Z'))
    expect(file).toMatchObject({ app: 'jellyflix', version: 1, exportedAt: '2026-10-22T10:00:00.000Z' })
    expect(Object.keys(file.settings).sort()).toEqual(['jellyflix.appearance', 'jellyflix.ui'])
    // Nothing about the account, the server or a password gets in.
    expect(JSON.stringify(file)).not.toMatch(/secret-token|jellyfin\.local|session/)
  })

  it('reads back what it exported, in another browser', () => {
    writeAppearance({ posterSize: 'large', uiSize: 'small', theme: { canvas: 'pine', accent: '#aabbcc' } })
    const text = JSON.stringify(exportSettings())
    localStorage.clear()
    const parsed = parseSettings(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(applySettings(parsed.settings)).toBe(1)
    expect(readAppearance()).toMatchObject({ posterSize: 'large', uiSize: 'small', theme: { canvas: 'pine', accent: '#aabbcc' } })
  })

  it('refuses what is not a settings file, or is too big', () => {
    expect(parseSettings('nope')).toMatchObject({ ok: false })
    expect(parseSettings('[]')).toMatchObject({ ok: false })
    expect(parseSettings(JSON.stringify({ app: 'other', version: 1, settings: {} }))).toMatchObject({ ok: false })
    expect(parseSettings(JSON.stringify({ app: 'jellyflix', version: 2, settings: {} }))).toMatchObject({ ok: false })
    expect(parseSettings(JSON.stringify({ app: 'jellyflix', version: 1, settings: {} }))).toMatchObject({ ok: false, error: 'That file has no settings in it.' })
    expect(parseSettings('x'.repeat(MAX_SETTINGS_CHARS + 1))).toMatchObject({ ok: false })
  })

  it('ignores keys that are not preferences, and cleans up the look it takes in', () => {
    const parsed = parseSettings(
      JSON.stringify({
        app: 'jellyflix',
        version: 1,
        settings: {
          'jellyflix.session': { token: 'stolen' },
          'jellyflix.appearance': { theme: { canvas: 'nope', accent: 'url(javascript:1)' }, posterSize: 'huge' },
          'jellyflix.ui': ['not', 'an', 'object'],
        },
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(Object.keys(parsed.settings)).toEqual(['jellyflix.appearance'])
    applySettings(parsed.settings)
    expect(localStorage.getItem('jellyflix.session')).toBeNull()
    expect(readAppearance()).toMatchObject({ theme: { canvas: 'black', accent: 'ocean' }, posterSize: 'comfortable' })
  })
  it('cleans up the player, interface and library choices too, so a file edited by hand cannot break them', () => {
    writeUiPrefs({ lastChannel: { id: 'c1', name: 'News' }, lastRetroChannel: 'retro1' })
    const parsed = parseSettings(
      JSON.stringify({
        app: 'jellyflix',
        version: 1,
        settings: {
          'jellyflix.player': { volume: 'loud', muted: 'yes', subtitleSize: 'giant', autoplayCountdown: 7, skipActions: { intro: 'auto', recap: 'explode' }, subtitleLanguage: 42, maxBitrateMbps: 10, __proto__: { polluted: true } },
          'jellyflix.ui': { language: 'xx', autoRotateBanner: false, lastChannel: { id: 'evil', name: 'x' }, lastRetroChannel: 'evil' },
          'jellyflix.browse': { sort: 'drop table', filter: 'watched', libraryId: '"><img>', advanced: { decade: 1995 } },
        },
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    applySettings(parsed.settings)
    const player = readPlayerPrefs()
    expect(player).toMatchObject({ volume: 1, muted: false, subtitleSize: 'medium', autoplayCountdown: 8, subtitleLanguage: null, maxBitrateMbps: 10 })
    expect(player.skipActions).toEqual({ intro: 'auto', recap: 'ask', outro: 'ask', preview: 'ask' })
    expect(JSON.parse(localStorage.getItem('jellyflix.player') ?? '{}').polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(readUiPrefs()).toMatchObject({ language: 'auto', autoRotateBanner: false, lastChannel: null, lastRetroChannel: null })
    expect(readBrowsePrefs()).toEqual({ sort: 'title', filter: 'watched', advanced: {} })
  })
})
