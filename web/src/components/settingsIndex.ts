import { tr } from '../i18n'

export type SettingsTab = 'general' | 'appearance' | 'playback' | 'devices' | 'plugins' | 'about'

/** One thing that can be changed in Settings: the words it has on screen, and the tab it is in. */
export interface SettingEntry {
  tab: SettingsTab
  /** Exactly the text the setting shows (in English; it is translated with the rest of the page). */
  label: string
  /** Other words someone might type to look for it. */
  keywords?: string
  /** Only an administrator sees it. */
  admin?: boolean
}

export const SETTINGS_INDEX: SettingEntry[] = [
  { tab: 'general', label: tr('Account'), keywords: 'user name server address sign out log out' },
  { tab: 'general', label: tr('Rotate the featured banner'), keywords: 'home slideshow carousel' },
  { tab: 'general', label: tr('Your stats'), keywords: 'statistics history watched' },
  { tab: 'general', label: tr('Administration'), keywords: 'admin libraries users devices server', admin: true },
  { tab: 'general', label: tr('Keyboard shortcuts'), keywords: 'keys hotkeys' },
  { tab: 'general', label: tr('Language'), keywords: 'english spanish idioma' },
  { tab: 'general', label: tr('Kids mode'), keywords: 'children parental controls pin age rating block' },
  { tab: 'general', label: tr('Install'), keywords: 'app home screen pwa' },
  { tab: 'appearance', label: tr('Theme'), keywords: 'dark colours' },
  { tab: 'appearance', label: tr('Background'), keywords: 'black charcoal midnight canvas' },
  { tab: 'appearance', label: tr('Accent colour'), keywords: 'color blue' },
  { tab: 'appearance', label: tr('Poster size'), keywords: 'cards big small' },
  { tab: 'appearance', label: tr('Interface size'), keywords: 'text zoom bigger smaller' },
  { tab: 'appearance', label: tr('Space between rows'), keywords: 'density compact' },
  { tab: 'appearance', label: tr('Featured banner height'), keywords: 'hero' },
  { tab: 'appearance', label: tr('Menu buttons'), keywords: 'navigation icons names' },
  { tab: 'appearance', label: tr('Top menu'), keywords: 'tabs order navigation' },
  { tab: 'appearance', label: tr('Home page'), keywords: 'rows order hide' },
  { tab: 'appearance', label: tr('Cards'), keywords: 'posters continue watching next up' },
  { tab: 'appearance', label: tr('Titles under the posters'), keywords: 'names captions text' },
  { tab: 'appearance', label: tr('Pressing a card of Continue watching and Next up'), keywords: 'play open click' },
  { tab: 'appearance', label: tr('Next up looks back'), keywords: 'days old series' },
  { tab: 'playback', label: tr('Play the next episode automatically'), keywords: 'autoplay binge' },
  { tab: 'playback', label: tr('Countdown before the next title'), keywords: 'autoplay seconds' },
  { tab: 'playback', label: tr('Cinema mode'), keywords: 'fade black' },
  { tab: 'playback', label: tr('Subtitle size'), keywords: 'text captions' },
  { tab: 'playback', label: tr('Maximum quality'), keywords: 'bitrate mbps data' },
  { tab: 'playback', label: tr('Player'), keywords: 'seek bar chapter skip intro credits recap sound convert' },
  { tab: 'playback', label: tr('Chapter marks on the seek bar'), keywords: 'timeline' },
  { tab: 'playback', label: tr('Pause while dragging the seek bar'), keywords: 'scrub' },
  { tab: 'playback', label: tr('Skip intros'), keywords: 'opening' },
  { tab: 'playback', label: tr('Skip credits'), keywords: 'outro ending' },
  { tab: 'playback', label: tr('Have the server convert this sound'), keywords: 'audio dolby ac3 flac silent receiver' },
  { tab: 'playback', label: tr('Gapless playback'), keywords: 'music songs' },
  { tab: 'playback', label: tr('Crossfade between songs'), keywords: 'music fade' },
  { tab: 'devices', label: tr('Devices'), keywords: 'tv code quick connect sign in' },
  { tab: 'about', label: tr('Set up again'), keywords: 'first run wizard questions welcome' },
  { tab: 'about', label: tr('Saved on this device'), keywords: 'forget remembered audio subtitle series' },
  { tab: 'about', label: tr('About'), keywords: 'version open source' },
]

/** Lower case, without accents, so "idioma" finds "Idioma" and "subtitulos" finds "Subtítulos". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * The settings that match what was typed, best first: every word typed has to be in the name, the tab or the keywords.
 * A name that starts with the words ranks above one that has them further in, and that above one only the keywords have.
 */
export function searchSettings(
  query: string,
  entries: readonly SettingEntry[],
  label: (entry: SettingEntry) => string,
  tabName: (tab: SettingsTab) => string,
  limit = 8,
): SettingEntry[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const scored: Array<{ entry: SettingEntry; score: number; order: number }> = []
  entries.forEach((entry, order) => {
    const name = normalize(label(entry))
    const haystack = `${name} ${normalize(tabName(entry.tab))} ${normalize(entry.keywords ?? '')}`
    if (!words.every((word) => haystack.includes(word))) return
    const inName = words.every((word) => name.includes(word))
    const score = name.startsWith(words.join(' ')) ? 3 : words.every((word) => name.split(/\s+/).some((part) => part.startsWith(word))) ? 2 : inName ? 1 : 0
    scored.push({ entry, score, order })
  })
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.entry)
}
