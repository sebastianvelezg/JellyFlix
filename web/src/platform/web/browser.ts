import {
  completeQuickConnect,
  connect,
  fetchSubtitleVtt,
  isQuickConnectApproved,
  startQuickConnect,
  subtitleFileToVtt,
  tidyServerAddress,
  type PlaybackPlan,
  type QuickConnectRequest,
  type PlaybackSession,
  type DeviceState,
  type Session,
} from '../../core'

const SERVER_URL_KEY = 'jellyflix.serverUrl'

/** Web wrapper around core `connect` that adds the page protocol for mixed-content hints. */
export function connectFromBrowser(
  serverUrl: string,
  username: string,
  password: string,
  onUnauthorized?: () => void,
): Promise<Session> {
  return connect(serverUrl, username, password, { pageProtocol: location.protocol, onUnauthorized })
}

/** The same for Quick Connect: ask for a code, wait for it to be approved, receive a session. */
export const quickConnectFromBrowser = {
  start: (serverUrl: string) => startQuickConnect(serverUrl, { pageProtocol: location.protocol }),
  approved: (request: QuickConnectRequest) => isQuickConnectApproved(request),
  complete: (request: QuickConnectRequest, onUnauthorized?: () => void) =>
    completeQuickConnect(request, { pageProtocol: location.protocol, onUnauthorized }),
}

/**
 * Opens the connection to the server (DNS, TCP, TLS) before the first request needs it, which saves a round trip or
 * three when the server is across the internet. Harmless on a local network.
 */
export function preconnectTo(serverUrl: string): void {
  try {
    const origin = new URL(serverUrl).origin
    if (document.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = origin
    document.head.appendChild(link)
  } catch {
    // An address that is not a URL is the connection form's problem, not ours.
  }
}

/**
 * The address the server field starts with when nothing was remembered: the one the person who hosts this app set when starting it
 * (`config.js`, written at start by the Docker image or `npm run serve`), else the one baked in at build time. Never a secret.
 */
export function defaultServerUrl(): string {
  const hosted = window.JELLYFLIX_CONFIG?.serverUrl
  return tidyServerAddress((typeof hosted === 'string' && hosted) || import.meta.env.VITE_DEFAULT_SERVER_URL || '')
}

/** The last server address, remembered as a convenience. Never stores credentials or tokens. */
export function readRememberedServerUrl(): string {
  try {
    return localStorage.getItem(SERVER_URL_KEY) ?? defaultServerUrl()
  } catch {
    return defaultServerUrl()
  }
}

export function rememberServerUrl(url: string): void {
  try {
    localStorage.setItem(SERVER_URL_KEY, url)
  } catch {
    // Remembering the address is a convenience only.
  }
}

/**
 * Downloads a text subtitle as WebVTT and wraps it in a same-origin blob URL for a <track>
 * element. The caller must `URL.revokeObjectURL` the result when done.
 */
export async function loadSubtitleBlobUrl(session: Session, plan: PlaybackPlan, streamIndex: number): Promise<string> {
  const text = await fetchSubtitleVtt(session, plan, streamIndex)
  return URL.createObjectURL(new Blob([text], { type: 'text/vtt' }))
}

/** The biggest subtitle file accepted; real ones are well under a megabyte. */
const MAX_SUBTITLE_FILE_BYTES = 5 * 1024 * 1024

/**
 * Reads a subtitle file the viewer picked on their device and returns a blob URL of it as WebVTT. The file never
 * leaves the browser. Throws an `Error` whose message can be shown as is. The caller must `URL.revokeObjectURL` the result.
 */
export async function loadSubtitleFile(file: File): Promise<string> {
  if (file.size > MAX_SUBTITLE_FILE_BYTES) throw new Error('That file is too big to be a subtitle file.')
  const vtt = subtitleFileToVtt(file.name, await file.text())
  if (vtt === null) throw new Error('Only .srt and .vtt subtitle files can be loaded.')
  if (!/-->/.test(vtt)) throw new Error('No subtitles were found in that file.')
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
}

/**
 * Sends the final "stopped" report while the page is closing. An ordinary request would be cancelled
 * with the page, so this uses a `keepalive` fetch. Best effort only.
 */
export function reportStopOnPageHide(playback: PlaybackSession, device: DeviceState): void {
  const request = playback.stopRequestOnUnload(device)
  if (!request) return
  try {
    void fetch(request.url, {
      method: 'POST',
      keepalive: true,
      headers: request.headers,
      body: request.body,
    }).catch(() => undefined)
  } catch {
    // Nothing more can be done while unloading.
  }
}
