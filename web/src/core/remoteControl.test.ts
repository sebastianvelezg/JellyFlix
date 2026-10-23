// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deviceKindOf } from './remote'
import { parseRemoteMessage, remoteSocketUrl } from './remoteControl'

const message = (MessageType: string, Data?: unknown) => JSON.stringify({ MessageType, Data })

describe('parseRemoteMessage', () => {
  it('reads a play message: the titles, where to start and in which order', () => {
    expect(parseRemoteMessage(message('Play', { ItemIds: ['a', 'b', 'c'], PlayCommand: 'PlayNow', StartIndex: 1, StartPositionTicks: 125 * 10_000_000 }))).toEqual({
      kind: 'play',
      itemIds: ['a', 'b', 'c'],
      startIndex: 1,
      startSeconds: 125,
      mode: 'now',
    })
  })

  it('knows "play next" and "add to the queue", and keeps the start index inside the list', () => {
    expect(parseRemoteMessage(message('Play', { ItemIds: ['a'], PlayCommand: 'PlayNext', StartIndex: 9 }))).toMatchObject({ mode: 'next', startIndex: 0, startSeconds: 0 })
    expect(parseRemoteMessage(message('Play', { ItemIds: ['a', 'b'], PlayCommand: 'PlayLast' }))).toMatchObject({ mode: 'last' })
  })

  it('ignores a play message with nothing to play', () => {
    expect(parseRemoteMessage(message('Play', { ItemIds: [] }))).toBeNull()
    expect(parseRemoteMessage(message('Play', {}))).toBeNull()
  })

  it.each([
    ['Pause', 'pause'],
    ['Unpause', 'resume'],
    ['PlayPause', 'toggle'],
    ['Stop', 'stop'],
    ['NextTrack', 'next'],
    ['PreviousTrack', 'previous'],
    ['Seek', 'seek'],
    ['Rewind', 'rewind'],
    ['FastForward', 'forward'],
  ])('maps the %s command', (name, command) => {
    expect(parseRemoteMessage(message('Playstate', { Command: name, SeekPositionTicks: 600_000_000 }))).toEqual({
      kind: 'playstate',
      command,
      seekSeconds: 60,
    })
  })

  it('reads volume (0 to 100 becomes 0 to 1), mute, and a message to show', () => {
    expect(parseRemoteMessage(message('GeneralCommand', { Name: 'SetVolume', Arguments: { Volume: '35' } }))).toEqual({ kind: 'volume', level: 0.35 })
    expect(parseRemoteMessage(message('GeneralCommand', { Name: 'SetVolume', Arguments: { Volume: '250' } }))).toEqual({ kind: 'volume', level: 1 })
    expect(parseRemoteMessage(message('GeneralCommand', { Name: 'Mute' }))).toEqual({ kind: 'mute', mute: true })
    expect(parseRemoteMessage(message('GeneralCommand', { Name: 'Unmute' }))).toEqual({ kind: 'mute', mute: false })
    expect(parseRemoteMessage(message('GeneralCommand', { Name: 'ToggleMute' }))).toEqual({ kind: 'mute', mute: 'toggle' })
    expect(parseRemoteMessage(message('GeneralCommand', { Name: 'DisplayMessage', Arguments: { Header: 'Hi', Text: 'Dinner is ready' } }))).toEqual({
      kind: 'message',
      header: 'Hi',
      text: 'Dinner is ready',
    })
  })

  it('reads how often the server wants to hear from this device', () => {
    expect(parseRemoteMessage(message('ForceKeepAlive', 60))).toEqual({ kind: 'keepAlive', seconds: 60 })
  })

  it('ignores what it does not know or cannot read', () => {
    expect(parseRemoteMessage(message('Sessions', []))).toBeNull()
    expect(parseRemoteMessage(message('GeneralCommand', { Name: 'GoHome' }))).toBeNull()
    expect(parseRemoteMessage(message('Playstate', { Command: 'Dance' }))).toBeNull()
    expect(parseRemoteMessage('not json')).toBeNull()
  })
})

describe('remoteSocketUrl', () => {
  const session = { accessToken: 'tok en', deviceId: 'dev/1' }
  it('uses ws for http and wss for https, and keeps a base path', () => {
    expect(remoteSocketUrl({ ...session, serverUrl: 'http://host:8096' })).toBe('ws://host:8096/socket?ApiKey=tok%20en&deviceId=dev%2F1')
    expect(remoteSocketUrl({ ...session, serverUrl: 'https://media.example.com' })).toBe('wss://media.example.com/socket?ApiKey=tok%20en&deviceId=dev%2F1')
    expect(remoteSocketUrl({ ...session, serverUrl: 'http://host:8096/jellyfin' })).toBe('ws://host:8096/jellyfin/socket?ApiKey=tok%20en&deviceId=dev%2F1')
  })
})

describe('deviceKindOf', () => {
  it('picks the icon from the app and the name', () => {
    expect(deviceKindOf('Jellyflix TV', 'Living room TV')).toBe('tv')
    expect(deviceKindOf('Jellyfin Android TV', 'SHIELD')).toBe('tv')
    expect(deviceKindOf('Jellyflix Web', 'iPhone (app)')).toBe('phone')
    expect(deviceKindOf('Jellyflix Web', 'Android phone · Chrome')).toBe('phone')
    expect(deviceKindOf('Jellyflix Web', 'Windows · Chrome')).toBe('computer')
    expect(deviceKindOf('', '')).toBe('computer')
  })
})
