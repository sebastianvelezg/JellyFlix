import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream'

/** Codec names Jellyfin appends to display titles; useful to a developer, noise to a viewer. */
const SUBTITLE_CODEC = /^(mov_text|subrip|srt|ass|ssa|webvtt|vtt|pgssub|pgs|hdmv_pgs_subtitle|dvdsub|dvd_subtitle|dvbsub|dvb_subtitle)$/i

const AUDIO_CODEC = /^(aac|ac3|eac3|e-ac-3|dts|dts-hd|truehd|flac|mp3|mp2|opus|vorbis|pcm|alac|wma)(?![a-z0-9])/i

const NO_LANGUAGE = new Set(['und', 'undefined', 'unknown', 'zxx', 'mis', 'mul', ''])

let names: Intl.DisplayNames | null | undefined

/** "eng" → "English" (undefined when unknown or Intl.DisplayNames is unavailable). */
export function languageName(code?: string | null): string | undefined {
  if (!code || NO_LANGUAGE.has(code.toLowerCase())) return undefined
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['en'], { type: 'language' })
    } catch {
      names = null
    }
  }
  try {
    const name = names?.of(code)
    return name && name.toLowerCase() !== code.toLowerCase() ? name : undefined
  } catch {
    return undefined
  }
}

/** "ForcedNarrative" → "Forced narrative": some files carry tags written as one CamelCase word. */
function humanizeTag(tag: string): string {
  if (!/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(tag)) return tag
  const words = tag.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ')
  return [words[0], ...words.slice(1).map((w) => w.toLowerCase())].join(' ')
}

function parts(stream: MediaStream): string[] {
  return (stream.DisplayTitle ?? '')
    .split(' - ')
    .map((p) => p.trim())
    .filter((p) => p && !/^default$/i.test(p) && !/^(und|undefined|unknown)$/i.test(p))
}

/**
 * Splits a display title into the words that qualify the language itself ("Latin America" from
 * "Spanish (Latin America)", "SDH" from "English [SDH]", "Forced" from "English Forced") and the
 * remaining parts (codec, channel layout, other tags).
 */
function split(stream: MediaStream, lang: string | undefined): { tags: string[]; rest: string[] } {
  const tags: string[] = []
  const rest: string[] = []
  for (const part of parts(stream)) {
    if (lang && part.toLowerCase().startsWith(lang.toLowerCase())) {
      // What follows the language name: an optional "(region)" or "[tag]", then any plain words.
      const m = /^\s*(?:\(([^)]*)\)|\[([^\]]*)\])?\s*(.*)$/.exec(part.slice(lang.length))
      for (const t of [m?.[1], m?.[2], m?.[3]]) if (t?.trim()) tags.push(humanizeTag(t.trim()))
    } else {
      rest.push(part)
    }
  }
  return { tags, rest }
}

const withTags = (base: string, tags: string[]) => (tags.length ? `${base} (${tags.join(', ')})` : base)

/**
 * Human label for a subtitle track: "English", "English (SDH)", "French (Canadian)", "English (Forced)".
 * Built from the language plus whatever qualifiers Jellyfin put in the display title.
 */
export function subtitleLabel(stream: MediaStream, fallback = 'Subtitles'): string {
  const lang = languageName(stream.Language)
  const { tags, rest } = split(stream, lang)
  const extra = [...tags, ...rest.filter((p) => !SUBTITLE_CODEC.test(p))]
  if (stream.IsForced && !extra.some((p) => /forced/i.test(p))) extra.push('Forced')
  if (stream.IsHearingImpaired && !extra.some((p) => /sdh|hearing/i.test(p))) extra.push('SDH')
  // Without a known language the display title's own wording (e.g. "English") is the name.
  const base = lang ?? extra.shift() ?? fallback
  return withTags(base, extra)
}

/** Label for an audio track: "English · AAC 5.1" (language, then codec and layout). */
export function audioLabel(stream: MediaStream, fallback = 'Audio'): string {
  const lang = languageName(stream.Language)
  const { tags, rest } = split(stream, lang)
  // Without a language code, the display title may still lead with a language word ("English - AAC").
  const base = lang ?? (rest[0] && !AUDIO_CODEC.test(rest[0]) ? (rest.shift() as string) : fallback)
  const name = withTags(base, tags)
  return rest.length ? `${name} · ${rest.join(' ')}` : name
}

/** Makes duplicate labels distinct ("English", "English 2") so a menu is never ambiguous. */
export function uniqueLabels<T extends { label: string }>(tracks: T[]): T[] {
  const seen = new Map<string, number>()
  return tracks.map((t) => {
    const n = (seen.get(t.label) ?? 0) + 1
    seen.set(t.label, n)
    return n === 1 ? t : { ...t, label: `${t.label} ${n}` }
  })
}

/**
 * Which subtitle track to turn on automatically: the one in the viewer's preferred language,
 * choosing a regular track over forced-only or SDH ones. `null` = none (no preference, or no match).
 */
export function pickSubtitle(
  tracks: Array<{ index: number; language?: string; label: string }>,
  preferredLanguage: string | null | undefined,
): number | null {
  if (!preferredLanguage) return null
  const matches = tracks.filter((t) => t.language === preferredLanguage)
  const regular = matches.find((t) => !/forced|sdh/i.test(t.label))
  const notForced = matches.find((t) => !/forced/i.test(t.label))
  return (regular ?? notForced ?? matches[0])?.index ?? null
}

/**
 * Which audio track to start with when the viewer has a preferred language (e.g. Japanese for an
 * anime they watched before). `undefined` = keep whatever the server picked.
 */
export function pickAudio(
  tracks: Array<{ index: number; language?: string }>,
  preferredLanguage: string | null | undefined,
): number | undefined {
  if (!preferredLanguage) return undefined
  return tracks.find((t) => t.language === preferredLanguage)?.index
}
