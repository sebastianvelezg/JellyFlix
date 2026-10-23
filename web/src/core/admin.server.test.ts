// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import {
  applyFields,
  applyIdentity,
  canAdminister,
  deletePicture,
  diffFields,
  downloadPicture,
  getEditableItem,
  getPictureChoices,
  getPictures,
  refreshItem,
  saveItem,
  searchIdentity,
  uploadPicture,
} from './admin'
import { connect } from './auth'
import type { Session } from './jellyfin'

let mock: MockServer
let admin: Session
let guestMock: MockServer
let guest: Session
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 5, seriesCount: 1 })
  admin = await connect(mock.url, 'tester', 'secret')
  guestMock = await startMockJellyfin({ movieCount: 5, admin: false })
  guest = await connect(guestMock.url, 'tester', 'secret')
})
afterAll(async () => {
  await mock.close()
  await guestMock.close()
})

describe('who may use the tools', () => {
  it('asks the server nothing more after signing in, which already found it out', async () => {
    const asked = () => mock.requests.filter((r) => r.path === '/Users/Me').length
    const before = asked()
    expect(await canAdminister(admin)).toBe(true)
    await canAdminister(admin)
    expect(await canAdminister(guest)).toBe(false)
    expect(asked()).toBe(before)
  })

  it('asks once for a session that was resumed from storage, and shares the answer', async () => {
    const asked = () => mock.requests.filter((r) => r.path === '/Users/Me').length
    const resumed = { ...admin } as Session // (a new session object, as after a reload: nothing is known yet)
    const before = asked()
    expect(await Promise.all([canAdminister(resumed), canAdminister(resumed)])).toEqual([true, true])
    expect(asked()).toBe(before + 1)
  })

  it('counts a failed question as "no"', async () => {
    const broken = { ...admin, api: { ...admin.api, basePath: 'http://127.0.0.1:1' } } as unknown as Session
    expect(await canAdminister(broken)).toBe(false)
  })
})

describe('editing the details of a title', () => {
  it('reads the title, sends the whole item back with only the changed fields, and reads the new details', async () => {
    const { dto, fields, parentalRatings } = await getEditableItem(admin, 'm0001')
    expect(fields.name).toBe('Test Movie 001')
    expect(parentalRatings).toContain('PG-13')
    const after = { ...fields, name: 'A Better Title', overview: 'New text.', genres: ['Drama', 'Mystery'], tags: ['Favourite'], lockedFields: ['Overview' as const] }
    expect(diffFields(fields, after).map((c) => c.key)).toEqual(['name', 'overview', 'genres', 'tags', 'lockedFields'])
    await saveItem(admin, 'm0001', applyFields(dto, after))

    expect(mock.adminLog).toContain('update m0001')
    const sent = mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/m0001').at(-1)?.body as Record<string, unknown>
    expect(sent).toMatchObject({ Id: 'm0001', Name: 'A Better Title', Genres: ['Drama', 'Mystery'], LockedFields: ['Overview'] })
    expect(sent.People).toBeDefined() // the rest of the item went back untouched
    const again = await getEditableItem(admin, 'm0001')
    expect(again.fields).toMatchObject({ name: 'A Better Title', overview: 'New text.', genres: ['Drama', 'Mystery'], tags: ['Favourite'], lockedFields: ['Overview'] })
  })

  it('is refused for an account that is not an administrator', async () => {
    const { dto, fields } = await getEditableItem(admin, 'm0002')
    await expect(saveItem(guest, 'm0002', applyFields(dto, { ...fields, name: 'Sneaky' }))).rejects.toMatchObject({ response: { status: 403 } })
    expect(guestMock.adminLog).toEqual([])
  })
})

describe('identifying and refreshing', () => {
  it('searches the providers by name and year and applies the one chosen', async () => {
    const { dto } = await getEditableItem(admin, 'm0003')
    const found = await searchIdentity(admin, dto, { name: 'The Matrix', year: 1999 })
    expect(found.map((c) => c.name)).toEqual(['The Matrix', 'The Matrix Reloaded'])
    expect(mock.adminLog).toContain('search Movie The Matrix 1999')
    expect(await searchIdentity(admin, dto, { name: 'zzz nothing' })).toEqual([])

    await applyIdentity(admin, 'm0003', found[0]!, true)
    expect(mock.adminLog).toContain('identify m0003 Tmdb=603 images=true')
    expect((await getEditableItem(admin, 'm0003')).fields.name).toBe('The Matrix')
  })

  it('searches series with the series lookup', async () => {
    const { dto } = await getEditableItem(admin, 's0001')
    await searchIdentity(admin, dto, { name: 'Show' })
    expect(mock.adminLog).toContain('search Series Show')
  })

  it('asks for the kind of refresh that was chosen', async () => {
    await refreshItem(admin, 'm0001', 'scan')
    await refreshItem(admin, 'm0001', 'missing')
    await refreshItem(admin, 'm0001', 'all', true)
    await refreshItem(admin, 'm0001', 'all', false)
    expect(mock.adminLog.filter((l) => l.startsWith('refresh'))).toEqual([
      'refresh m0001 Default metadata=false images=false',
      'refresh m0001 FullRefresh metadata=false images=false',
      'refresh m0001 FullRefresh metadata=true images=true',
      'refresh m0001 FullRefresh metadata=true images=false',
    ])
  })

  it('is refused for an account that is not an administrator', async () => {
    await expect(refreshItem(guest, 'm0001', 'all')).rejects.toMatchObject({ response: { status: 403 } })
    expect(guestMock.adminLog).toEqual([])
  })
})

describe('pictures', () => {
  it('lists what the title has, offers pictures from the providers and downloads the one chosen', async () => {
    const before = await getPictures(admin, 'm0001')
    expect(before.map((p) => p.type)).toContain('Primary')
    const choices = await getPictureChoices(admin, 'm0001', 'Backdrop')
    expect(choices).toHaveLength(3)
    expect(choices[0]).toMatchObject({ provider: 'TheMovieDb', width: 1920, height: 1080 })
    await downloadPicture(admin, 'm0001', 'Backdrop', choices[1]!)
    expect(mock.adminLog).toContain('download m0001 Backdrop /remote/Backdrop/2')
    const after = await getPictures(admin, 'm0001')
    expect(after.find((p) => p.type === 'Backdrop')?.tag).toMatch(/^dl/)
  })

  it('sends an uploaded picture as base64 text with its own content type, with the Authorization header', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    await uploadPicture(admin, 'm0002', 'Primary', { base64: bytes.toString('base64'), contentType: 'image/png' })
    expect(mock.adminLog).toContain('upload m0002 Primary image/png 8')
    const sent = mock.requests.filter((r) => r.method === 'POST' && r.path === '/Items/m0002/Images/Primary').at(-1)
    expect(sent?.auth).toBe('header')
    expect((await getPictures(admin, 'm0002')).find((p) => p.type === 'Primary')?.tag).toMatch(/^up/)
  })

  it('removes a picture', async () => {
    await deletePicture(admin, 'm0002', 'Primary')
    expect(mock.adminLog).toContain('delete m0002 Primary')
    expect((await getPictures(admin, 'm0002')).some((p) => p.type === 'Primary')).toBe(false)
  })

  it('is refused for an account that is not an administrator', async () => {
    await expect(getPictureChoices(guest, 'm0001', 'Primary')).rejects.toMatchObject({ response: { status: 403 } })
    await expect(uploadPicture(guest, 'm0001', 'Primary', { base64: 'AAAA', contentType: 'image/png' })).rejects.toMatchObject({ response: { status: 403 } })
    await expect(deletePicture(guest, 'm0001', 'Primary')).rejects.toMatchObject({ response: { status: 403 } })
  })
})
