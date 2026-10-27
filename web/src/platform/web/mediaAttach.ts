import { withApiKey, type PlaybackPlan } from '../../core'

export interface AttachOptions {
  video: HTMLMediaElement
  plan: PlaybackPlan
  /** Session access token. Used as `ApiKey` only where a header is impossible (`<video src>`). */
  token: string
  /** Value for the Authorization header (hls.js requests). */
  authorization: string
  startSeconds: number
  /** Start playing as soon as the stream is ready (default). False only loads it (a song prepared ahead of time). */
  autoplay?: boolean
  /** Called once when playback cannot continue and automatic recovery gave up. */
  onFatal: (message: string) => void
}

export interface Attached {
  /** Stops loading and releases the element. Safe to call at any time, any number of times. */
  destroy: () => void
  /** True when the loader (hls.js) reports and recovers from errors itself. */
  readonly handlesErrors: boolean
}

function describeHlsFailure(network: boolean, status?: number): string {
  if (status === 401 || status === 403) return 'The server rejected the stream request. Your session may have expired; sign out and sign in again.'
  if (status === 404) return 'The server could not find the video stream.'
  return network ? 'The connection to the server was lost while streaming.' : 'The video stream could not be decoded.'
}

function seekOnceReady(video: HTMLMediaElement, seconds: number) {
  if (seconds <= 0) return
  const apply = () => {
    video.currentTime = seconds
  }
  if (video.readyState >= 1) apply()
  else video.addEventListener('loadedmetadata', apply, { once: true })
}

/**
 * Connects a playback plan to a <video> element and starts playing.
 *
 * - direct / progressive: plain `src`. A media element cannot send an Authorization
 *   header, so the session token goes in the query string (as Jellyfin's own web client does).
 * - HLS with MSE: hls.js, which fetches the playlist and segments with XHR, so we send the
 *   token in an Authorization header instead and keep it out of URLs.
 * - HLS natively (Safari): plain `src`, token in the query string.
 *
 * This function is synchronous on purpose: React may run an effect, clean it up and run it
 * again before an async attach would finish, and a late teardown must never touch a newer
 * attachment on the same element. hls.js itself is loaded lazily inside.
 */
export function attachMedia(opts: AttachOptions): Attached {
  const { video, plan, token, authorization, startSeconds, onFatal } = opts
  const autoplay = opts.autoplay !== false
  let destroyed = false
  let teardown: (() => void) | null = null
  let usingHlsJs = false

  const play = () => {
    if (autoplay && !destroyed) void video.play().catch(() => undefined)
  }

  const attachNative = () => {
    video.src = withApiKey(plan.url, token)
    seekOnceReady(video, startSeconds)
    teardown = () => {
      video.removeAttribute('src')
      video.load()
    }
    play()
  }

  async function attachHls() {
    const { default: Hls } = await import('hls.js')
    if (destroyed) return
    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) attachNative()
      else onFatal('This browser cannot play the stream format the server chose (HLS).')
      return
    }

    usingHlsJs = true
    const origin = new URL(plan.url).origin
    const hls = new Hls({
      startPosition: startSeconds > 0 ? startSeconds : -1,
      xhrSetup: (xhr, url) => {
        // Only ever send the token to the Jellyfin server itself.
        if (new URL(url, plan.url).origin === origin) xhr.setRequestHeader('Authorization', authorization)
      },
    })
    teardown = () => {
      hls.destroy()
      video.removeAttribute('src')
      video.load()
    }

    let networkRetries = 0
    let mediaRetries = 0
    hls.on(Hls.Events.MANIFEST_PARSED, play)
    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      networkRetries = 0
      mediaRetries = 0
    })
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || destroyed) return
      const status = data.response?.code
      // 4xx (other than timeouts/throttling) will not fix itself, and a failed playlist
      // cannot be recovered by startLoad(), so those fail right away instead of spinning.
      const permanent = status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429
      const playlistFailed =
        data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
        data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
        data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !permanent && !playlistFailed && networkRetries < 3) {
        networkRetries += 1
        hls.startLoad()
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
        mediaRetries += 1
        hls.recoverMediaError()
      } else {
        hls.destroy()
        onFatal(describeHlsFailure(data.type === Hls.ErrorTypes.NETWORK_ERROR, status))
      }
    })
    hls.loadSource(plan.url)
    hls.attachMedia(video)
  }

  if (plan.protocol === 'hls') {
    void attachHls().catch(() => {
      if (!destroyed) onFatal('The video player component could not be loaded.')
    })
  } else {
    attachNative()
  }

  return {
    get handlesErrors() {
      return usingHlsJs
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      teardown?.()
      teardown = null
    },
  }
}
