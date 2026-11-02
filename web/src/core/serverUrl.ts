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
 * - A missing scheme defaults to `http://` for a home address (typical for LAN servers) and to `https://` for any other, because
 *   http would send the password and the session in clear text across the internet (see [isPrivateHost]). A scheme typed twice is
 *   reduced to the last one.
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
    if (!hasScheme && !isPrivateHost(url.hostname)) url = new URL(`https://${trimmed}`)
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

const PRIVATE_SUFFIXES = ['.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain', '.ts.net']

/**
 * Hosts that are on this network or reached through a private tunnel: "localhost", names with no dot (a router names devices like
 * that), ".local" and similar, the private IPv4 ranges (10/8, 172.16/12, 192.168/16), loopback and link-local, the 100.64/10 range
 * Tailscale uses, IPv6 loopback, unique-local and link-local, and Tailscale's own ".ts.net" names.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return false
  if (host.includes(':')) return host === '::1' || /^f[cd]/.test(host) || host.startsWith('fe80:')
  const octets = host.split('.')
  if (octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o))) {
    const [a, b] = octets.map(Number) as [number, number, number, number]
    if (octets.some((o) => Number(o) > 255)) return false
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  }
  if (!host.includes('.')) return true
  return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

/** True for an http address to a host that is not on a home or private network: its password and session would travel in clear text. */
export function isUnencryptedPublic(serverUrl: string): boolean {
  try {
    const url = new URL(serverUrl)
    return url.protocol === 'http:' && !isPrivateHost(url.hostname)
  } catch {
    return false
  }
}
