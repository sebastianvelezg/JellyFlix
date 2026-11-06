import type { MatchFilters, MatchLength } from '../../../core/modules'
import { t } from '../../../i18n'
import { showToast } from '../../toast'

const SCREENS_KEY = 'jellyflix.match.screens'

/** The rooms this device started as a screen (it shows the code and plays the winner). Only this device knows: a phone of the same person does not. */
export function screenRooms(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(SCREENS_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveScreens(ids: string[]): void {
  try {
    localStorage.setItem(SCREENS_KEY, JSON.stringify(ids.slice(0, 20)))
  } catch {
    // Without it the device simply plays like any other.
  }
}

export const markScreen = (id: string): void => saveScreens([id, ...screenRooms().filter((x) => x !== id)])
export const unmarkScreen = (id: string): void => saveScreens(screenRooms().filter((x) => x !== id))

/** Tells the person something happened in the room: a message in the app, and (when the page is hidden and they allowed it) a notification. */
export function announce(message: string): void {
  showToast({ message, duration: 5000 })
  try {
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(message, { tag: 'jellyflix-match' })
    navigator.vibrate?.(120)
  } catch {
    // A notification is a nicety.
  }
}

export const lengthLabel = (length: MatchLength): string => (length === 'short' ? t('Under 90 minutes') : length === 'medium' ? t('90 to 120 minutes') : t('Over 2 hours'))

/** What the cards are limited to, in words. */
export function filterWords(filters: MatchFilters): string[] {
  return [
    filters.genre,
    filters.decade ? t('{decade}s', { decade: filters.decade }) : undefined,
    filters.length ? lengthLabel(filters.length) : undefined,
    filters.series ? t('Series included') : undefined,
  ].filter((x): x is string => !!x)
}
