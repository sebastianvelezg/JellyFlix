import { useSyncExternalStore } from 'react'
import { getLanguage, resolveLanguage, setLanguage, subscribeLanguage, type Language, type LanguageChoice } from '../i18n'
import { readUiPrefs, writeUiPrefs } from '../platform/web/prefs'

/** Applies the saved choice (or the browser's language). Resolves once the texts are in place, which is when the app can be drawn. */
export function initLanguage(): Promise<void> {
  return applyLanguage(readUiPrefs().language)
}

async function applyLanguage(choice: LanguageChoice): Promise<void> {
  const language = resolveLanguage(choice, typeof navigator === 'undefined' ? [] : navigator.languages)
  if (typeof document !== 'undefined') document.documentElement.lang = language
  await setLanguage(language)
}

/** Saves the choice and switches the interface to it (the screen follows as soon as the texts have arrived). */
export function chooseLanguage(choice: LanguageChoice): void {
  writeUiPrefs({ language: choice })
  void applyLanguage(choice)
}

/** The language in use; the component re-renders when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)
}
