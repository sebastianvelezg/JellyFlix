import { getLanguage } from '../i18n'
/** Human-readable file size, e.g. "4.2 GB". */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** "8.4 Mbps" from bits per second. */
export function formatBitrate(bitsPerSecond?: number): string {
  if (!bitsPerSecond || bitsPerSecond <= 0) return ''
  return bitsPerSecond >= 1_000_000
    ? `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`
    : `${Math.round(bitsPerSecond / 1000)} kbps`
}

export function formatDate(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(getLanguage(), { year: 'numeric', month: 'long', day: 'numeric' })
}
