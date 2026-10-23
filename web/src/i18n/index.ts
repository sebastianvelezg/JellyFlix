import { es, esPatterns } from './es'

/**
 * Translations. The text in the code is the English text itself, and `t('Continue watching')` returns it unchanged
 * for English or looks it up in the dictionary of the chosen language. A missing translation therefore shows English,
 * never a blank or a key. Placeholders are written `{name}` and filled from the second argument:
 * `t('Open {title}', { title })`. A test checks that every text used in the code has a Spanish entry.
 */
export type Language = 'en' | 'es'
export type LanguageChoice = 'auto' | Language

export const LANGUAGES: Array<[Language, string]> = [
  ['en', 'English'],
  ['es', 'Español'],
]

const dictionaries: Record<Language, Record<string, string>> = { en: {}, es }
const patterns: Record<Language, Array<[RegExp, string]>> = { en: [], es: esPatterns }

let current: Language = 'en'
const listeners = new Set<() => void>()

export function getLanguage(): Language {
  return current
}

export function setLanguage(language: Language): void {
  if (language === current) return
  current = language
  for (const listener of listeners) listener()
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** "auto" follows the browser's preferred languages (Spanish if the first one we know is Spanish), else what was chosen. */
export function resolveLanguage(choice: LanguageChoice, preferred: readonly string[]): Language {
  if (choice !== 'auto') return choice
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (base === 'es') return 'es'
    if (base === 'en') return 'en'
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

/** Every text that has a Spanish translation (for the completeness test). */
export const SPANISH_KEYS: ReadonlySet<string> = new Set(Object.keys(es))
