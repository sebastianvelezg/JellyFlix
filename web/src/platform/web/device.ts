/**
 * The name this browser gives itself to Jellyfin: what other devices see in their "Play on…" list and what the server's dashboard shows.
 * "iPhone (app)" for the installed app, "Windows · Chrome" for a tab.
 */
export function describeDevice(
  nav: { userAgent: string; maxTouchPoints?: number } = navigator,
  standalone: boolean = isInstalledApp(),
): string {
  const ua = nav.userAgent
  const touch = (nav.maxTouchPoints ?? 0) > 1

  let platform = 'Web'
  if (/iPhone/.test(ua)) platform = 'iPhone'
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) platform = 'iPad'
  else if (/Android/.test(ua)) platform = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
  else if (/Windows/.test(ua)) platform = 'Windows'
  else if (/CrOS/.test(ua)) platform = 'Chromebook'
  else if (/Macintosh|Mac OS X/.test(ua)) platform = 'Mac'
  else if (/Linux|X11/.test(ua)) platform = 'Linux'

  if (standalone) return `${platform} (app)`

  let browser = ''
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\//.test(ua)) browser = 'Opera'
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox'
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua)) browser = 'Safari'
  return browser ? `${platform} · ${browser}` : platform
}

/** True when the page runs as an installed app (a PWA on the home screen or desktop) rather than in a browser tab. */
export function isInstalledApp(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}
