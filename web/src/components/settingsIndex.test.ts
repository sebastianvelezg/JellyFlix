// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalize, searchSettings, SETTINGS_INDEX, type SettingEntry } from './settingsIndex'

const entries: SettingEntry[] = [
  { tab: 'general', label: 'Language', keywords: 'idioma' },
  { tab: 'appearance', label: 'Poster size', keywords: 'cards' },
  { tab: 'playback', label: 'Subtitle size' },
  { tab: 'playback', label: 'Player', keywords: 'skip intro' },
]
const tabs = { general: 'General', appearance: 'Appearance', playback: 'Playback', devices: 'Devices', plugins: 'Plugins', about: 'About' }
const find = (q: string) =>
  searchSettings(q, entries, (e) => e.label, (t) => tabs[t]).map((e) => e.label)

describe('searchSettings', () => {
  it('finds a setting by part of its name, ignoring case and accents', () => {
    expect(find('POSTER')).toEqual(['Poster size'])
    expect(normalize('Subtítulos')).toBe('subtitulos')
  })

  it('wants every word, in the name, the tab or the keywords', () => {
    expect(find('size')).toEqual(['Poster size', 'Subtitle size'])
    expect(find('size playback')).toEqual(['Subtitle size'])
    expect(find('skip')).toEqual(['Player'])
    expect(find('idioma')).toEqual(['Language'])
  })

  it('puts a name that starts with the words first', () => {
    expect(find('p')).toEqual(['Poster size', 'Player', 'Subtitle size'])
  })

  it('answers nothing for nothing, or for what is not there', () => {
    expect(find('   ')).toEqual([])
    expect(find('zzz')).toEqual([])
  })
})

describe('the index', () => {
  it('has no setting twice', () => {
    const keys = SETTINGS_INDEX.map((e) => `${e.tab}:${e.label}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
