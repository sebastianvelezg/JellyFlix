import { isTrustedModulesAddress, modulesLinkTrust, normalizeModulesUrl } from '../../core/modules/url'

const KEY = 'jellyflix.modulesUrl'
const SERVER_URL_KEY = 'jellyflix.serverUrl'

function jellyfinAddress(): string | null {
  try {
    return localStorage.getItem(SERVER_URL_KEY)
  } catch {
    // Without storage there is no remembered server to compare with.
    return null
  }
}

/** Whether an address from this device's storage may be used (see isTrustedModulesAddress). */
function mayUse(address: string | null): address is string {
  return !!address && isTrustedModulesAddress(address, window.location.hostname, jellyfinAddress())
}

/** An address from a link the person said no to, in this page load: they are not asked again until the page is opened again. */
let declined: string | null = null

/** The address a link names, normalized, or null when the link names none (or says `off`). */
function linkAddress(): string | null {
  const asked = new URLSearchParams(window.location.search).get('modules')
  return asked === null || /^(off|none|no)$/i.test(asked.trim()) ? null : normalizeModulesUrl(asked)
}

function remembered(): string | null {
  try {
    return normalizeModulesUrl(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

/**
 * Where the modules container is, if there is one: the address the person who hosts this app set (`config.js`), or one remembered on
 * this device. Opening the app once with `?modules=http://host:8097` remembers that address here (at once for an address of this site
 * or of the person's own Jellyfin server; after they say yes for another address of their own network, see {@link pendingModulesUrl};
 * never for any other address: a link must not be able to send the session token to a stranger's server). `?modules=off` forgets it.
 * Nothing is looked for anywhere else, and with no address the app never contacts any modules container.
 */
export function readModulesUrl(): string | null {
  try {
    const asked = new URLSearchParams(window.location.search).get('modules')
    if (asked !== null) {
      if (/^(off|none|no)$/i.test(asked.trim())) localStorage.removeItem(KEY)
      else {
        const url = normalizeModulesUrl(asked)
        // (An address, never a credential: it is only kept if a link may name it without asking.)
        if (url && modulesLinkTrust(url, window.location.hostname, jellyfinAddress()) === 'trusted') localStorage.setItem(KEY, url)
      }
    }
    const saved = remembered()
    if (mayUse(saved)) return saved
  } catch {
    // Storage may be blocked; the hosted address below still counts.
  }
  const hosted = window.JELLYFLIX_CONFIG?.modulesUrl
  return normalizeModulesUrl(typeof hosted === 'string' ? hosted : '')
}

/**
 * An address in the link this page was opened with that needs the person's yes before the token is sent there: another address of
 * their own network, not the one already in use. Null when there is nothing to ask.
 */
export function pendingModulesUrl(): string | null {
  const url = linkAddress()
  if (!url || url === declined || url === remembered()) return null
  return modulesLinkTrust(url, window.location.hostname, jellyfinAddress()) === 'ask' ? url : null
}

/** The person said yes: the address is remembered and used from now on. */
export function acceptModulesUrl(url: string): void {
  try {
    localStorage.setItem(KEY, url)
  } catch {
    // Storage blocked: nothing can be remembered.
  }
}

/** The person said no: nothing changes, and they are not asked again in this page load. */
export function declineModulesUrl(url: string): void {
  declined = url
}

export function forgetModulesUrl(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to forget.
  }
}
