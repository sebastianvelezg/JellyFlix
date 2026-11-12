import { useEffect, useState, type FormEvent } from 'react'
import { toStoredSession, type Session } from '../../core'
import { canAddProfile, isValidProfilePin, profileKey, profileSignedIn, profileWithPin, type ProfileBook } from '../../core'
import { addAccount, PROFILES_CHANGED, profilesChanged, switchAccount } from '../../platform/web/profileEvents'
import { canLockWithPin, lockFor, readProfiles, writeProfiles } from '../../platform/web/profiles'
import { webSessionStore } from '../../platform/web/storage'
import { t } from '../../i18n'
import { Card, Toggle } from '../SettingsParts'

/**
 * Settings for the accounts kept on this browser: switch to another, add one, ask who is watching when the app opens, and a PIN for the
 * account in use. An account is only kept here when it asked to stay signed in; this card can do that for the one in use.
 */
export function AccountsCard({ session }: { session: Session }) {
  const [book, setBook] = useState<ProfileBook>(readProfiles)
  const [settingPin, setSettingPin] = useState(false)
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const reread = () => setBook(readProfiles())
    window.addEventListener(PROFILES_CHANGED, reread)
    return () => window.removeEventListener(PROFILES_CHANGED, reread)
  }, [])

  const save = (next: ProfileBook) => {
    writeProfiles(next)
    setBook(next)
    profilesChanged()
  }
  const here = book.profiles.find((p) => profileKey(p) === profileKey(session))

  async function keepHere() {
    webSessionStore.persistent = true
    await webSessionStore.save(toStoredSession(session))
    save(profileSignedIn(book, toStoredSession(session), Date.now()))
  }

  async function submitPin(event: FormEvent) {
    event.preventDefault()
    if (!isValidProfilePin(pin)) return setError(t('Choose a PIN of 4 to 6 digits.'))
    if (pin !== again) return setError(t('The two PINs are different. Choose it again.'))
    save(profileWithPin(book, session, await lockFor(pin)))
    setSettingPin(false)
    setPin('')
    setAgain('')
    setError(null)
  }

  return (
    <Card title={t('Accounts on this device')} description={t('Several people can keep their account here and choose who is watching when the app opens.')}>
      {!here ? (
        <div className="space-y-2">
          <p className="text-sm text-neutral-300">{t('This account is not kept on this device: it ends when you close the tab.')}</p>
          {canAddProfile(book) ? (
            <button type="button" className="btn" onClick={() => void keepHere()}>
              {t('Keep this account on this device')}
            </button>
          ) : (
            <p className="text-xs text-neutral-500">{t('This browser already keeps {count} accounts. Remove one to add another.', { count: book.profiles.length })}</p>
          )}
        </div>
      ) : (
        <>
          <Toggle
            label={t('Ask who is watching when the app opens')}
            hint={t('Only when two or more accounts are kept.')}
            checked={book.ask}
            onChange={(ask) => save({ ...book, ask })}
          />
          {canLockWithPin() ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-neutral-100">{t('PIN for this account')}</p>
              <p className="text-xs text-neutral-500">{t('The PIN decides who may open this account on this browser. It does not change what the account may watch.')}</p>
              {settingPin ? (
                <form onSubmit={(e) => void submitPin(e)} className="flex flex-wrap items-end gap-2">
                  <label className="text-sm text-neutral-300">
                    {t('New PIN')}
                    <input className="field mt-1 w-32" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
                  </label>
                  <label className="text-sm text-neutral-300">
                    {t('Type it again')}
                    <input className="field mt-1 w-32" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} />
                  </label>
                  <button type="submit" className="btn-primary">
                    {t('Save PIN')}
                  </button>
                  <button type="button" className="btn" onClick={() => setSettingPin(false)}>
                    {t('Cancel')}
                  </button>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn" onClick={() => setSettingPin(true)}>
                    {here.pin ? t('Change PIN') : t('Set a PIN')}
                  </button>
                  {here.pin && (
                    <button type="button" className="btn" onClick={() => save(profileWithPin(book, session, null))}>
                      {t('Remove PIN')}
                    </button>
                  )}
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-300">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-neutral-500">{t('A PIN needs a secure address (https:// or localhost).')}</p>
          )}
        </>
      )}
      {here && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={switchAccount}>
            {t('Switch account')}
          </button>
          <button type="button" className="btn" onClick={addAccount} disabled={!canAddProfile(book)}>
            {t('Add an account')}
          </button>
        </div>
      )}
    </Card>
  )
}
