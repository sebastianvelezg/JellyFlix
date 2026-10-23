import { useSyncExternalStore } from 'react'
import { getLanguage, resolveLanguage, setLanguage, subscribeLanguage, type Language, type LanguageChoice } from '../i18n'
import { readUiPrefs, writeUiPrefs } from '../platform/web/prefs'

/** Applies the saved choice (or the browser's language) before anything is drawn. */
export function initLanguage(): void {
  applyLanguage(readUiPrefs().language)
}

function applyLanguage(choice: LanguageChoice): void {
  const language = resolveLanguage(choice, typeof navigator === 'undefined' ? [] : navigator.languages)
  setLanguage(language)
  if (typeof document !== 'undefined') document.documentElement.lang = language
}

/** Saves the choice and switches the interface to it. */
export function chooseLanguage(choice: LanguageChoice): void {
  writeUiPrefs({ language: choice })
  applyLanguage(choice)
}

/** The language in use; the component re-renders when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)
}
