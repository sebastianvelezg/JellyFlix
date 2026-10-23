import { announceRemoteControl, KEEP_ALIVE, parseRemoteMessage, remoteSocketUrl, type RemoteMessage, type Session } from '../../core'

const RECONNECT_MS = [1000, 2000, 4000, 8000, 15_000, 30_000]
const DEFAULT_KEEP_ALIVE_MS = 30_000

/**
 * Keeps this browser listening on the server's socket, so other devices can send it "play this" and "pause". It reconnects by itself
 * (a phone that was in a pocket, a server that restarted) and announces itself as controllable each time it connects.
 *
 * Several tabs signed in as the same session would all act on every command, so only one of them (the one that holds a lock named after
 * the session) listens; the others take over when it closes.
 */
export class RemoteSocket {
  private socket: WebSocket | null = null
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null
  private stopped = true
  private release: (() => void) | null = null
  /** True while this tab is the one that listens. */
  private leader = false

  constructor(
    private readonly session: Session,
    private readonly onMessage: (message: RemoteMessage) => void,
    private readonly options: { createSocket?: (url: string) => WebSocket; onConnectionChange?: (connected: boolean) => void } = {},
  ) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks) {
      this.leader = true
      this.open()
      return
    }
    void locks
      .request(`jellyflix-remote-${this.session.deviceId}`, async () => {
        if (this.stopped) return
        this.leader = true
        this.open()
        // The lock is held for as long as this tab listens.
        await new Promise<void>((resolve) => {
          this.release = resolve
        })
      })
      .catch(() => undefined)
  }

  stop(): void {
    this.stopped = true
    this.leader = false
    this.release?.()
    this.release = null
    this.close()
    this.options.onConnectionChange?.(false)
  }

  /** Connects again now, if the socket is down (the tab came back, the network came back). */
  nudge(): void {
    if (this.stopped || !this.leader) return
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.open()
  }

  private close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
    this.reconnectTimer = null
    this.keepAliveTimer = null
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = null
      // Closing a socket that is still connecting reports an error; nobody is interested in it any more.
      socket.onerror = () => undefined
      if (socket.readyState <= WebSocket.OPEN) socket.close()
    }
  }

  private open(): void {
    if (this.stopped) return
    this.close()
    let socket: WebSocket
    try {
      socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(remoteSocketUrl(this.session))
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.onopen = () => {
      this.attempt = 0
      this.options.onConnectionChange?.(true)
      void announceRemoteControl(this.session).catch(() => undefined)
      this.startKeepAlive(DEFAULT_KEEP_ALIVE_MS)
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const message = parseRemoteMessage(event.data)
      if (!message) return
      if (message.kind === 'keepAlive') {
        // The server says how long it will wait; answer well within that.
        this.startKeepAlive(Math.max(5, message.seconds / 2) * 1000)
        this.send(KEEP_ALIVE)
        return
      }
      this.onMessage(message)
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.options.onConnectionChange?.(false)
      this.scheduleReconnect()
    }
    socket.onerror = () => undefined
  }

  private send(text: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(text)
  }

  private startKeepAlive(ms: number): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = setInterval(() => this.send(KEEP_ALIVE), ms)
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    const wait = RECONNECT_MS[Math.min(this.attempt, RECONNECT_MS.length - 1)] as number
    this.attempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, wait)
  }
}
