/** Fired on `window` to leave the account in use and go to "Who is watching?" (App.tsx listens). */
export const SWITCH_ACCOUNT = 'jellyflix:switch-account'
/** Fired on `window` to go to the sign-in form to add another account (App.tsx listens). */
export const ADD_ACCOUNT = 'jellyflix:add-account'
/** Fired on `window` after the saved accounts were changed somewhere other than App.tsx, so it reads them again. */
export const PROFILES_CHANGED = 'jellyflix:profiles-changed'

export const switchAccount = (): void => void window.dispatchEvent(new Event(SWITCH_ACCOUNT))
export const addAccount = (): void => void window.dispatchEvent(new Event(ADD_ACCOUNT))
export const profilesChanged = (): void => void window.dispatchEvent(new Event(PROFILES_CHANGED))
