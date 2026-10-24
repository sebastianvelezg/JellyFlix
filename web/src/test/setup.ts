import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { vi } from 'vitest'
import WebSocket from 'ws'

// Node 25 ships experimental global `localStorage`/`sessionStorage` that shadows jsdom's and has no methods
// unless started with --localstorage-file. Tests get a plain in-memory Storage instead.
class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }
}

// A slow machine (a shared CI runner) needs more than the default second for a page to appear after a click.
configure({ asyncUtilTimeout: 5000 })

vi.stubGlobal('localStorage', new MemoryStorage())
vi.stubGlobal('sessionStorage', new MemoryStorage())

// jsdom has no media playback: its play/pause/load do nothing useful (play even returns undefined).
// These stand-ins let components that start a stream run; real playback is covered by the Chrome tests.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = () => Promise.resolve()
  HTMLMediaElement.prototype.pause = () => undefined
  HTMLMediaElement.prototype.load = () => undefined
}

// jsdom's WebSocket sits on Node's undici, which refuses the Event class jsdom installs, so a socket opened by a component would crash the
// run. The `ws` package is a plain WebSocket that works with the in-process mock server.
vi.stubGlobal('WebSocket', WebSocket)
