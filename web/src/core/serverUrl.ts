export class ServerUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerUrlError'
  }
}

/**
 * Trims the address and drops a scheme that was typed twice ("http://http://host" is a common slip when an address is pasted
 * after the field already holds "http://"). Does not validate anything; see [normalizeServerUrl].
 */
export function tidyServerAddress(input: string): string {
  return input.trim().replace(/^(?:https?:\/\/)+(?=https?:\/\/)/i, '')
}

/**
 * Turns whatever the user typed into a canonical Jellyfin base URL
 * (`scheme://host[:port][/base-path]`, no trailing slash).
 *
 * - A missing scheme defaults to `http://` (typical for LAN servers); a scheme typed twice is reduced to the last one.
 * - Only http and https are accepted; embedded credentials are rejected.
 * - Query, fragment and a pasted `/web/...` suffix are dropped.
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = tidyServerAddress(input)
  if (!trimmed) throw new ServerUrlError('Enter your Jellyfin server address.')

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  // "ftp:foo" style input; a bare "host:8096" is fine because a digit follows the colon.
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed)) {
    throw new ServerUrlError('The server address must start with http:// or https://.')
  }

  let url: URL
  try {
    url = new URL(hasScheme ? trimmed : `http://${trimmed}`)
  } catch {
    throw new ServerUrlError('That does not look like a valid server address.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ServerUrlError('The server address must start with http:// or https://.')
  }
  if (url.username || url.password) {
    throw new ServerUrlError('Do not put a username or password in the server address.')
  }
  if (!url.hostname) throw new ServerUrlError('That does not look like a valid server address.')

  const path = url.pathname.replace(/\/web(\/.*)?$/i, '').replace(/\/+$/, '')

  return `${url.origin}${path}`
}
