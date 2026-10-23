// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import type { Session } from './jellyfin'
import { controlDevice, getRemoteDevices, playOnDevice, seekDevice, type RemoteDevice } from './remote'

let mock: MockServer
beforeAll(async () => {
  mock = await startMockJellyfin()
})
afterAll(() => mock.close())

async function tvOf(session: Session): Promise<RemoteDevice> {
  const tv = (await getRemoteDevices(session)).find((d) => d.id === 'tv-session')
  if (!tv) throw new Error('the TV is not listed')
  return tv
}

describe('remote control', () => {
  it('lists only devices that can be controlled, never this browser', async () => {
    const session = await connect(mock.url, 'tester', 'secret')
    const devices = await getRemoteDevices(session)
    expect(devices.map((d) => d.name)).toEqual(['Living room TV'])
    expect((await tvOf(session)).nowPlaying).toBeNull()
  })

  it('plays a title on the TV, then pauses, resumes, seeks and stops it', async () => {
    const session = await connect(mock.url, 'tester', 'secret')
    mock.remoteLog.length = 0
    await playOnDevice(session, 'tv-session', 'm0001', 90)
    expect((await tvOf(session)).nowPlaying).toMatchObject({ itemId: 'm0001', positionSeconds: 90, paused: false })

    await controlDevice(session, 'tv-session', 'pause')
    expect((await tvOf(session)).nowPlaying?.paused).toBe(true)

    await controlDevice(session, 'tv-session', 'resume')
    await seekDevice(session, 'tv-session', 300)
    expect((await tvOf(session)).nowPlaying).toMatchObject({ paused: false, positionSeconds: 300 })

    await controlDevice(session, 'tv-session', 'stop')
    expect((await tvOf(session)).nowPlaying).toBeNull()
    expect(mock.remoteLog).toEqual([
      'tv-session play m0001 from 900000000',
      'tv-session Pause',
      'tv-session Unpause',
      'tv-session Seek 3000000000',
      'tv-session Stop',
    ])
  })

  it('lets the device resume by itself when no start position is given', async () => {
    const session = await connect(mock.url, 'tester', 'secret')
    mock.remoteLog.length = 0
    await playOnDevice(session, 'tv-session', 'm0002')
    expect(mock.remoteLog).toEqual(['tv-session play m0002 from 0'])
  })
})
