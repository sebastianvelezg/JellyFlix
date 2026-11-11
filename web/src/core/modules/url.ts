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
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true
  // IPv6: this device (::1), a unique local address (fc00::/7, what a home router hands out) or a link-local one (fe80::/10).
  if (host.startsWith('[')) return host === '[::1]' || /^\[f[cd][0-9a-f]{2}:/.test(host) || /^\[fe[89ab][0-9a-f]:/.test(host)
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  // 100.64.0.0/10 is the range Tailscale (and carrier-grade NAT) uses; 169.254.0.0/16 is link-local.
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
}

/**
 * What to do with an address that came in a LINK (`?modules=`). The app sends the person's Jellyfin session token to the modules
 * container, so a link must not be able to point it at somebody else's server:
 * - `trusted`: this same site, or the host of the person's Jellyfin server (the address a Match QR code carries);
 * - `ask`: another address inside their network. Somebody else on the same network (a guest Wi-Fi, a shared flat) could have sent
 *   the link, so the person is asked first;
 * - `refused`: anything else, which only whoever hosts the app can set (`config.js`).
 */
export function modulesLinkTrust(address: string, pageHost: string, jellyfinUrl: string | null | undefined): 'trusted' | 'ask' | 'refused' {
  if (address.startsWith('/')) return 'trusted'
  const host = hostOf(address)
  if (!host) return 'refused'
  if (host === pageHost.toLowerCase()) return 'trusted'
  if (jellyfinUrl && host === hostOf(jellyfinUrl)) return 'trusted'
  return isLocalHost(host) ? 'ask' : 'refused'
}

/** Whether an address may be used at all (one in the local network once the person said yes to it). */
export function isTrustedModulesAddress(address: string, pageHost: string, jellyfinUrl: string | null | undefined): boolean {
  return modulesLinkTrust(address, pageHost, jellyfinUrl) !== 'refused'
}
