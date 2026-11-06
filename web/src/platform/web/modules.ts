import { isTrustedModulesAddress, normalizeModulesUrl } from '../../core/modules/url'

const KEY = 'jellyflix.modulesUrl'
const SERVER_URL_KEY = 'jellyflix.serverUrl'

/** Whether an address from a link or from this device's storage is one a link may name (see isTrustedModulesAddress). */
function mayUse(address: string | null): address is string {
  if (!address) return false
  let jellyfinAddress: string | null = null
  try {
    jellyfinAddress = localStorage.getItem(SERVER_URL_KEY)
  } catch {
    // Without storage there is no remembered server to compare with.
  }
  return isTrustedModulesAddress(address, window.location.hostname, jellyfinAddress)
}

/**
 * Where the modules container is, if there is one: the address the person who hosts this app set (`config.js`), or one remembered on
 * this device. Opening the app once with `?modules=http://host:8097` remembers that address here (only an address of this site, of the
 * person's own Jellyfin server or of their own network: a link must not be able to send the session token to a stranger's server);
 * `?modules=off` forgets it.
 * Nothing is looked for anywhere else, and with no address the app never contacts any modules container.
 */
export function readModulesUrl(): string | null {
  try {
    const asked = new URLSearchParams(window.location.search).get('modules')
    if (asked !== null) {
      if (/^(off|none|no)$/i.test(asked.trim())) localStorage.removeItem(KEY)
      else {
        // A link cannot make the app send the session token to just any address.
        const url = normalizeModulesUrl(asked)
        // (An address, never a credential: it is only kept if a link may name it.)
        if (mayUse(url)) localStorage.setItem(KEY, url)
      }
    }
    const remembered = normalizeModulesUrl(localStorage.getItem(KEY))
    if (mayUse(remembered)) return remembered
  } catch {
    // Storage may be blocked; the hosted address below still counts.
  }
  const hosted = window.JELLYFLIX_CONFIG?.modulesUrl
  return normalizeModulesUrl(typeof hosted === 'string' ? hosted : '')
}

export function forgetModulesUrl(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to forget.
  }
}
