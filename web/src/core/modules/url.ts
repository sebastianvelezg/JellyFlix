/**
 * The address of the modules container as the person (or the host) wrote it: "http://host:8097", or a path on this same site such as
 * "/modules" (the web image can pass it on). Anything else, and an empty value, means "there is none".
 * (In a file of its own so the app can read the setting without loading the rest of the modules client.)
 */
export function normalizeModulesUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().replace(/\/+$/, '')
  if (!value) return null
  if (/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s?#]*)?$/i.test(value)) return value
  if (/^\/[A-Za-z0-9._~/-]*$/.test(value) && !value.startsWith('//')) return value
  return null
}

const hostOf = (address: string): string | null => {
  try {
    return new URL(address).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** An address inside a home or office network (or this very device): somewhere a stranger's website cannot have put a listener. */
function isLocalHost(host: string): boolean {
  if (host === 'localhost' || host === '[::1]' || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/**
 * Whether an address that came in a LINK (`?modules=`) may be used. The app sends the person's Jellyfin session token to the modules
 * container, so a link must not be able to point it at somebody else's server. A link may name this same site's host, the host of the
 * person's Jellyfin server, or an address inside their own network; any other address has to be set by whoever hosts the app (`config.js`).
 */
export function isTrustedModulesAddress(address: string, pageHost: string, jellyfinUrl: string | null | undefined): boolean {
  if (address.startsWith('/')) return true
  const host = hostOf(address)
  if (!host) return false
  if (host === pageHost.toLowerCase()) return true
  if (jellyfinUrl && host === hostOf(jellyfinUrl)) return true
  return isLocalHost(host)
}
