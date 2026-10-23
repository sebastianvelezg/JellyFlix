// @vitest-environment node
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream'
import { describe, expect, it } from 'vitest'
import { audioLabel, languageName, pickAudio, pickSubtitle, subtitleLabel, uniqueLabels } from './tracks'

const s = (o: Partial<MediaStream>): MediaStream => o as MediaStream

describe('languageName', () => {
  it('maps ISO codes and ignores unknown ones', () => {
    expect(languageName('eng')).toBe('English')
    expect(languageName('spa')).toBe('Spanish')
    expect(languageName('fra')).toBe('French')
    expect(languageName('und')).toBeUndefined()
    expect(languageName(undefined)).toBeUndefined()
    expect(languageName('zzzz-not-a-language')).toBeUndefined()
  })
})

describe('subtitleLabel', () => {
  it.each([
    [{ Language: 'eng', DisplayTitle: 'Forced - English - Default - MOV_TEXT' }, 'English (Forced)'],
    [{ Language: 'eng', DisplayTitle: 'English [ForcedNarrative] - MOV_TEXT' }, 'English (Forced narrative)'],
    [{ Language: 'eng', DisplayTitle: 'English - MOV_TEXT' }, 'English'],
    [{ Language: 'eng', DisplayTitle: 'SDH - English - MOV_TEXT' }, 'English (SDH)'],
    [{ Language: 'fra', DisplayTitle: 'Canadian - French - MOV_TEXT' }, 'French (Canadian)'],
    [{ Language: 'spa', DisplayTitle: 'Spanish - SUBRIP' }, 'Spanish'],
    [{ DisplayTitle: 'Undefined - SUBRIP' }, 'Subtitles'],
    [{ Language: 'eng', DisplayTitle: 'English - SUBRIP', IsForced: true }, 'English (Forced)'],
    [{ Language: 'eng', DisplayTitle: 'English - SUBRIP', IsHearingImpaired: true }, 'English (SDH)'],
    [{ DisplayTitle: 'Commentary - ASS' }, 'Commentary'],
    [{}, 'Subtitles'],
    // Titles that repeat the language, as written by a real server.
    [{ Language: 'eng', DisplayTitle: 'English [SDH] - SUBRIP' }, 'English (SDH)'],
    [{ Language: 'eng', DisplayTitle: 'English Forced - SUBRIP' }, 'English (Forced)'],
    [{ Language: 'spa', DisplayTitle: 'Spanish (Latin America) - SUBRIP' }, 'Spanish (Latin America)'],
    [{ Language: 'spa', DisplayTitle: 'Spanish (Latin America) Forced - Default - SUBRIP' }, 'Spanish (Latin America, Forced)'],
  ])('%j → %s', (stream, label) => {
    expect(subtitleLabel(s(stream))).toBe(label)
  })
})

describe('audioLabel', () => {
  it('shows language, codec and layout', () => {
    expect(audioLabel(s({ Language: 'eng', DisplayTitle: 'English - AAC - 5.1 - Default' }))).toBe('English · AAC 5.1')
    expect(audioLabel(s({ Language: 'spa', DisplayTitle: 'Spanish - AC3 - Stereo' }))).toBe('Spanish · AC3 Stereo')
    expect(audioLabel(s({ DisplayTitle: 'Undefined - AAC - Stereo' }))).toBe('Audio · AAC Stereo')
    expect(audioLabel(s({ DisplayTitle: 'English - AAC' }))).toBe('English · AAC')
    expect(audioLabel(s({}))).toBe('Audio')
    expect(audioLabel(s({ Language: 'eng', DisplayTitle: 'English - Dolby Digital+ - 5.1' }))).toBe('English · Dolby Digital+ 5.1')
    expect(audioLabel(s({ Language: 'spa', DisplayTitle: 'Spanish (Latin America) - Dolby Digital - 5.1 - Default' }))).toBe(
      'Spanish (Latin America) · Dolby Digital 5.1',
    )
  })
})

describe('uniqueLabels', () => {
  it('numbers duplicates', () => {
    expect(uniqueLabels([{ label: 'English' }, { label: 'French' }, { label: 'English' }, { label: 'English' }]).map((t) => t.label)).toEqual([
      'English',
      'French',
      'English 2',
      'English 3',
    ])
  })
})

describe('pickSubtitle', () => {
  const tracks = [
    { index: 2, language: 'eng', label: 'English (Forced)' },
    { index: 3, language: 'eng', label: 'English' },
    { index: 4, language: 'eng', label: 'English (SDH)' },
    { index: 5, language: 'fra', label: 'French (Canadian)' },
  ]
  it('prefers the regular track in the preferred language', () => {
    expect(pickSubtitle(tracks, 'eng')).toBe(3)
    expect(pickSubtitle(tracks, 'fra')).toBe(5)
  })
  it('falls back to SDH, then forced, and to none without a match or preference', () => {
    expect(pickSubtitle(tracks.filter((t) => t.index !== 3), 'eng')).toBe(4)
    expect(pickSubtitle([tracks[0] as (typeof tracks)[number]], 'eng')).toBe(2)
    expect(pickSubtitle(tracks, 'deu')).toBeNull()
    expect(pickSubtitle(tracks, null)).toBeNull()
    expect(pickSubtitle(tracks, undefined)).toBeNull()
    expect(pickSubtitle([], 'eng')).toBeNull()
  })
})

describe('pickAudio', () => {
  const tracks = [
    { index: 1, language: 'eng' },
    { index: 2, language: 'jpn' },
  ]
  it('finds the track in the preferred language, and leaves the choice to the server otherwise', () => {
    expect(pickAudio(tracks, 'jpn')).toBe(2)
    expect(pickAudio(tracks, 'eng')).toBe(1)
    expect(pickAudio(tracks, 'deu')).toBeUndefined()
    expect(pickAudio(tracks, null)).toBeUndefined()
    expect(pickAudio([], 'jpn')).toBeUndefined()
  })
})
