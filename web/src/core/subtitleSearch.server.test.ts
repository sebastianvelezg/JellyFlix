// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { chromeLikeCapabilities as caps } from '../../test/fixtures'
import { connect } from './auth'
import type { Session } from './jellyfin'
import { negotiatePlayback } from './playback'
import {
  defaultSearchLanguage,
  downloadRemoteSubtitle,
  newSubtitleIndex,
  searchRemoteSubtitles,
  sortRemoteSubtitles,
  subtitleSearchProblem,
  type RemoteSubtitle,
} from './subtitleSearch'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 3 })
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

describe('subtitles from the internet', () => {
  it('searches in a language and puts the file match first, machine translations last', async () => {
    const found = await searchRemoteSubtitles(session, 'm0001', 'spa')
    expect(found.map((s) => s.id)).toEqual(['os-exact', 'os-popular', 'os-machine'])
    expect(found[0]).toMatchObject({
      provider: 'Open Subtitles',
      language: 'spa',
      format: 'srt',
      exactMatch: true,
      hearingImpaired: true,
    })
    expect(found[2]?.machineTranslated).toBe(true)
    expect(mock.adminLog).toContain('subtitle-search m0001 spa')
  })

  it('can ask for exact matches only, and finds nothing for an unknown language', async () => {
    await searchRemoteSubtitles(session, 'm0001', 'eng', { exactOnly: true })
    expect(mock.adminLog).toContain('subtitle-search m0001 eng exact')
    expect(await searchRemoteSubtitles(session, 'm0001', 'zzz')).toEqual([])
  })

  it('saves one, and the video then has one more subtitle track to pick', async () => {
    const before = (await negotiatePlayback(session, 'm0002', { capabilities: caps })).subtitleTracks.map(
      (t) => t.index,
    )
    await downloadRemoteSubtitle(session, 'm0002', 'os-exact')
    expect(mock.adminLog).toContain('subtitle-download m0002 os-exact')
    const after = await negotiatePlayback(session, 'm0002', { capabilities: caps })
    expect(after.subtitleTracks.length).toBe(before.length + 1)
    const added = newSubtitleIndex(
      before,
      after.subtitleTracks.map((t) => t.index),
    )
    expect(after.subtitleTracks.find((t) => t.index === added)?.language).toBe('spa')
  })
})

describe('subtitle search helpers', () => {
  const sub = (patch: Partial<RemoteSubtitle>): RemoteSubtitle => ({
    id: 'x',
    name: '',
    provider: '',
    language: 'eng',
    format: 'srt',
    author: '',
    comment: '',
    downloads: null,
    rating: null,
    exactMatch: false,
    hearingImpaired: false,
    forced: false,
    machineTranslated: false,
    ...patch,
  })

  it('sorts without changing the list it was given', () => {
    const list = [sub({ id: 'a', downloads: 5 }), sub({ id: 'b', downloads: 500 }), sub({ id: 'c', exactMatch: true })]
    expect(sortRemoteSubtitles(list).map((s) => s.id)).toEqual(['c', 'b', 'a'])
    expect(list.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('starts with the language chosen last, else the viewer own', () => {
    expect(defaultSearchLanguage('fra', 'en')).toBe('fra')
    expect(defaultSearchLanguage(null, 'es')).toBe('spa')
    expect(defaultSearchLanguage('xyz', 'en')).toBe('eng')
  })

  it('finds the track a download added', () => {
    expect(newSubtitleIndex([3], [3, 4])).toBe(4)
    expect(newSubtitleIndex([3], [3])).toBeNull()
  })

  it('explains a refusal and a missing plugin', () => {
    expect(subtitleSearchProblem({ response: { status: 403 } })).toMatch(/may not/)
    expect(subtitleSearchProblem({ response: { status: 404 } })).toMatch(/no subtitle plugin/)
    expect(subtitleSearchProblem(new Error('boom'))).toMatch(/Try again/)
  })
})

describe('a server without the plugin', () => {
  it('answers 404', async () => {
    const bare = await startMockJellyfin({ movieCount: 1, noSubtitlePlugin: true })
    try {
      const s = await connect(bare.url, 'tester', 'secret')
      await expect(searchRemoteSubtitles(s, 'm0001', 'eng')).rejects.toMatchObject({ response: { status: 404 } })
    } finally {
      await bare.close()
    }
  })
})
