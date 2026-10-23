import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteMessage, Session } from '../../core'
import { RemoteSocket } from './remoteSocket'

vi.mock('../../core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core')>()),
  // Announcing needs a server; here it is only counted.
  announceRemoteControl: vi.fn(async () => undefined),
}))

/** A socket the test drives by hand. */
class FakeSocket {
  static instances: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(data: unknown) {
    this.onmessage?.({ data })
  }
  drop() {
    this.readyState = 3
    this.onclose?.()
  }
}

const session = { serverUrl: 'http://host:8096', accessToken: 'tok', deviceId: 'dev' } as Session

beforeEach(() => {
  FakeSocket.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Object.assign(FakeSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function start(onMessage: (m: RemoteMessage) => void = () => undefined, changes: boolean[] = []) {
  const socket = new RemoteSocket(session, onMessage, {
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    onConnectionChange: (connected) => changes.push(connected),
  })
  socket.start()
  return socket
}

describe('RemoteSocket', () => {
  it('connects to the server\'s socket with the session', () => {
    start()
    expect(FakeSocket.instances).toHaveLength(1)
    expect(FakeSocket.instances[0]?.url).toBe('ws://host:8096/socket?ApiKey=tok&deviceId=dev')
  })

  it('hands on what it understands and drops the rest', () => {
    const received: RemoteMessage[] = []
    start((m) => received.push(m))
    const socket = FakeSocket.instances[0] as FakeSocket
    socket.open()
    socket.receive(JSON.stringify({ MessageType: 'Playstate', Data: { Command: 'Pause' } }))
    socket.receive(JSON.stringify({ MessageType: 'Sessions', Data: [] }))
    socket.receive(new ArrayBuffer(4))
    expect(received).toEqual([{ kind: 'playstate', command: 'pause', seekSeconds: 0 }])
  })

  it('answers the server\'s keep-alive request and keeps sending its own', () => {
    start()
    const socket = FakeSocket.instances[0] as FakeSocket
    socket.open()
    socket.receive(JSON.stringify({ MessageType: 'ForceKeepAlive', Data: 60 }))
    expect(socket.sent).toEqual([JSON.stringify({ MessageType: 'KeepAlive' })])
    vi.advanceTimersByTime(31_000)
    expect(socket.sent.length).toBeGreaterThanOrEqual(2)
  })

  it('reconnects by itself after the connection drops, waiting longer each time', () => {
    const changes: boolean[] = []
    start(undefined, changes)
    const first = FakeSocket.instances[0] as FakeSocket
    first.open()
    first.drop()
    expect(changes).toEqual([true, false])
    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(2)
    expect(FakeSocket.instances).toHaveLength(2)
    // This one never opens: the wait before the next try doubles.
    ;(FakeSocket.instances[1] as FakeSocket).drop()
    vi.advanceTimersByTime(1500)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(600)
    expect(FakeSocket.instances).toHaveLength(3)
  })

  it('does not reconnect once stopped, and can be nudged awake when the connection is down', () => {
    const socket = start()
    ;(FakeSocket.instances[0] as FakeSocket).open()
    ;(FakeSocket.instances[0] as FakeSocket).drop()
    socket.nudge()
    expect(FakeSocket.instances).toHaveLength(2)
    socket.stop()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(2)
  })
})
