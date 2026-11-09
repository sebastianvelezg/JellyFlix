/**
 * Translations. The text in the code is the English text itself, and `t('Continue watching')` returns it unchanged
 * for English or looks it up in the dictionary of the chosen language. A missing translation therefore shows English,
 * never a blank or a key. Placeholders are written `{name}` and filled from the second argument:
 * `t('Open {title}', { title })`. A test checks that every text used in the code has a Spanish entry.
 *
 * English is the text in the code, so it needs no dictionary. Every other language is a file of its own (about 60 kB compressed
 * each) that is only downloaded when that language is the one in use; see [setLanguage].
 */
export type Language = 'en' | 'es' | 'pt' | 'fr' | 'de'
export type LanguageChoice = 'auto' | Language

/** The languages of the interface, each named in itself. */
export const LANGUAGES: Array<[Language, string]> = [
  ['en', 'English'],
  ['es', 'Español'],
  ['pt', 'Português'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
]

type Texts = Record<string, string>
type Patterns = Array<[RegExp, string]>

const dictionaries: Record<Language, Texts> = { en: {}, es: {}, pt: {}, fr: {}, de: {} }
const patterns: Record<Language, Patterns> = { en: [], es: [], pt: [], fr: [], de: [] }
/** How each language's texts are fetched (the dynamic import makes the bundler put each in a file of its own). */
const loaders: Record<Language, () => Promise<{ texts: Texts; patterns: Patterns }>> = {
  en: async () => ({ texts: {}, patterns: [] }),
  es: async () => import('./es').then((m) => ({ texts: m.es, patterns: m.esPatterns })),
  pt: async () => import('./pt').then((m) => ({ texts: m.pt, patterns: m.ptPatterns })),
  fr: async () => import('./fr').then((m) => ({ texts: m.fr, patterns: m.frPatterns })),
  de: async () => import('./de').then((m) => ({ texts: m.de, patterns: m.dePatterns })),
}
const loaded = new Set<Language>(['en'])

let current: Language = 'en'
/** The language asked for last, so a slow download of an earlier choice does not win over a later one. */
let wanted: Language = 'en'
const listeners = new Set<() => void>()

export function getLanguage(): Language {
  return current
}

/**
 * Switches the texts to `language`. A dictionary is fetched the first time it is needed, so the promise resolves when the
 * switch has happened (at once when the texts are already here). A download that fails leaves the language as it was.
 */
export async function setLanguage(language: Language): Promise<void> {
  wanted = language
  if (!loaded.has(language)) {
    try {
      const found = await loaders[language]()
      dictionaries[language] = found.texts
      patterns[language] = found.patterns
      loaded.add(language)
    } catch {
      return
    }
  }
  if (wanted !== language || language === current) return
  current = language
  for (const listener of listeners) listener()
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** "auto" follows the browser's preferred languages (the first one we have texts for), else what was chosen. */
export function resolveLanguage(choice: LanguageChoice, preferred: readonly string[]): Language {
  if (choice !== 'auto') return choice
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    const known = LANGUAGES.find(([code]) => code === base)
    if (known) return known[0]
  }
  return 'en'
}

/** A message with numbers or names in it (an error code, a song title) that has a pattern instead of a fixed entry. */
function matchPattern(text: string): string | undefined {
  for (const [pattern, template] of patterns[current]) {
    const match = pattern.exec(text)
    if (match) return template.replace(/\$(\d)/g, (_, i: string) => match[Number(i)] ?? '')
  }
  return undefined
}

/** The text in the current language, with `{name}` placeholders filled in. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const translated = dictionaries[current][text] ?? matchPattern(text) ?? text
  return vars ? translated.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : translated
}

/**
 * Marks a text that is defined outside a component (a list of labels, say) so it is found and translated: the code
 * keeps the English text and passes it through `t()` where it is shown. It returns the text unchanged.
 */
export function tr(text: string): string {
  return text
}
