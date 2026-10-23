// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import type { Session } from './jellyfin'
import {
  addToPlaylist,
  addToWatchLater,
  createVideoPlaylist,
  deletePlaylist,
  getPlaylistEntries,
  getVideoPlaylist,
  getVideoPlaylists,
  moveInPlaylist,
  removeFromPlaylist,
  renamePlaylist,
} from './playlists'
import { getPlaylists } from './music'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 10, musicArtists: 1 })
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())

describe('video playlists against the server', () => {
  it('creates a playlist with titles in it, and lists it apart from the playlists of songs', async () => {
    expect(await getVideoPlaylists(session)).toEqual([])
    const id = await createVideoPlaylist(session, '  Weekend ', ['m0001', 'm0002'])
    const lists = await getVideoPlaylists(session)
    expect(lists).toMatchObject([{ id, name: 'Weekend', itemCount: 2 }])
    // The request asked only for playlists of videos, and songs' playlists did not mix in.
    const asked = [...mock.requests].reverse().find((r) => r.path === '/Items' && r.query.includeItemTypes === 'Playlist')
    expect(asked?.query.mediaTypes).toBe('Video')
    expect((await getPlaylists(session)).map((p) => p.id)).not.toContain(id)
    expect(await getVideoPlaylist(session, id)).toMatchObject({ id, name: 'Weekend' })
  })

  it('adds, moves, removes and renames', async () => {
    const id = await createVideoPlaylist(session, 'Order')
    await addToPlaylist(session, id, ['m0001', 'm0002', 'm0003'])
    await addToPlaylist(session, id, ['m0009'], 0)
    let entries = await getPlaylistEntries(session, id)
    expect(entries.map((e) => e.item.id)).toEqual(['m0009', 'm0001', 'm0002', 'm0003'])
    expect(new Set(entries.map((e) => e.entryId)).size).toBe(4)

    await moveInPlaylist(session, id, entries[3]?.entryId as string, 0)
    entries = await getPlaylistEntries(session, id)
    expect(entries.map((e) => e.item.id)).toEqual(['m0003', 'm0009', 'm0001', 'm0002'])

    await removeFromPlaylist(session, id, [entries[1]?.entryId as string])
    expect((await getPlaylistEntries(session, id)).map((e) => e.item.id)).toEqual(['m0003', 'm0001', 'm0002'])

    await renamePlaylist(session, id, ' Better order ')
    expect((await getVideoPlaylist(session, id)).name).toBe('Better order')
    await expect(renamePlaylist(session, id, '   ')).rejects.toThrow('name')
    await expect(createVideoPlaylist(session, '')).rejects.toThrow('name')
  })

  it('deletes a playlist', async () => {
    const id = await createVideoPlaylist(session, 'Temporary')
    await deletePlaylist(session, id)
    expect((await getVideoPlaylists(session)).map((p) => p.id)).not.toContain(id)
  })

  it('makes "Watch later" the first time, adds to it after, and never twice', async () => {
    const first = await addToWatchLater(session, 'm0004', 'Watch later')
    expect(first).toMatchObject({ created: true, already: false })
    const second = await addToWatchLater(session, 'm0005', 'Ver más tarde')
    expect(second).toMatchObject({ playlistId: first.playlistId, created: false, already: false })
    const again = await addToWatchLater(session, 'm0004', 'Watch later')
    expect(again).toMatchObject({ playlistId: first.playlistId, already: true })
    expect((await getPlaylistEntries(session, first.playlistId)).map((e) => e.item.id)).toEqual(['m0004', 'm0005'])
  })
})
