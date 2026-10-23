/**
 * Helpers for subtitles that are out of step with the picture, and for subtitle files that did not come from the
 * server. Pure text and number handling: no DOM, no network.
 */

/** How far subtitles can be moved either way, in seconds. */
export const MAX_SUBTITLE_OFFSET = 60

/** The small and the large step of the sync buttons and keys, in seconds. */
export const SYNC_STEP = 0.1
export const SYNC_STEP_LARGE = 0.5

/**
 * The offset after moving by `delta` seconds. Positive means the subtitles appear **later** than they are written
 * (use it when they show up too early), negative **earlier**. Kept to tenths of a second and within the limit, so
 * repeated 0.1 steps do not drift (0.1 + 0.2 is not 0.3 in floating point).
 */
export function stepOffset(current: number, delta: number): number {
  const next = Math.round((current + delta) * 10) / 10
  const clamped = Math.min(MAX_SUBTITLE_OFFSET, Math.max(-MAX_SUBTITLE_OFFSET, next))
  return clamped === 0 ? 0 : clamped // never "-0"
}

/** "In sync", "+0.5 s (later)" or "−1.2 s (earlier)". */
export function describeOffset(seconds: number): string {
  if (seconds === 0) return 'In sync'
  const amount = Math.abs(seconds).toFixed(1)
  return seconds > 0 ? `+${amount} s (later)` : `−${amount} s (earlier)`
}

/** The invisible character some editors put at the start of a text file. */
const BYTE_ORDER_MARK = 0xfeff

const SRT_TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g

/** "1,5" -> ".500": SubRip allows short fractions; WebVTT wants exactly three digits. */
function vttTime(h: string, m: string, s: string, fraction: string): string {
  return `${h.padStart(2, '0')}:${m}:${s}.${fraction.padEnd(3, '0')}`
}

/**
 * Turns SubRip (.srt) text into WebVTT. Handles a byte-order mark, Windows or old Mac line endings, commas in the
 * timestamps, and index lines. Text that already is WebVTT is returned with tidy line endings.
 */
export function srtToVtt(text: string): string {
  const unmarked = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text
  const clean = unmarked.replace(/\r\n?/g, '\n').trim()
  if (/^WEBVTT/.test(clean)) return `${clean}\n`
  const blocks = clean.split(/\n{2,}/)
  const cues: string[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const timing = lines.findIndex((line) => line.includes('-->'))
    if (timing < 0) continue
    const header = (lines[timing] as string)
      .replace(SRT_TIME, (_, h: string, m: string, s: string, f: string) => vttTime(h, m, s, f))
      // SubRip may carry "X1:..." position hints after the times; WebVTT settings are different, so drop them.
      .replace(/(-->\s*\d{2}:\d{2}:\d{2}\.\d{3}).*$/, '$1')
    const body = lines.slice(timing + 1).filter((line) => line.trim() !== '')
    if (body.length === 0) continue
    cues.push([header, ...body].join('\n'))
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

/** The subtitle file formats this app can read. */
export const SUBTITLE_FILE_EXTENSIONS = ['.srt', '.vtt'] as const

/**
 * WebVTT for a subtitle file's text, chosen by its name, or null when the format is not supported (for example
 * styled `.ass`, which would lose its styling and positions).
 */
export function subtitleFileToVtt(fileName: string, text: string): string | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.srt')) return srtToVtt(text)
  if (lower.endsWith('.vtt')) return srtToVtt(text)
  return null
}
