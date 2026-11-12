import { useEffect, useState, type FormEvent } from 'react'
import { profilesByRecent, canAddProfile, isValidProfilePin, profileRightPin, pinWaitLeft, profileWrongPin, type Profile, type ProfileBook } from '../../core'
import { pinMatches } from '../../platform/web/profiles'
import { t } from '../../i18n'

const initialOf = (name: string): string => (name.trim()[0] ?? '?').toUpperCase()

/**
 * "Who is watching?": the accounts saved on this browser. Choosing one opens it (asking for its PIN first when it has one); the PIN only
 * decides who may open an account here. An account can also be taken off this browser, which erases its saved sign-in from it.
 */
export function WhoIsWatching({
  book,
  onBook,
  onPick,
  onAdd,
}: {
  book: ProfileBook
  /** The book changed (a wrong PIN counted, an account taken off): keep it. */
  onBook: (book: ProfileBook) => void
  onPick: (profile: Profile) => void
  onAdd: () => void
}) {
  const [asking, setAsking] = useState<Profile | null>(null)
  const [removing, setRemoving] = useState<Profile | null>(null)

  if (asking) {
    const current = book.profiles.find((p) => p.userId === asking.userId && p.serverUrl === asking.serverUrl)
    return (
      <PinEntry
        profile={current ?? asking}
        onBook={onBook}
        book={book}
        onRight={() => onPick(current ?? asking)}
        onCancel={() => setAsking(null)}
      />
    )
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center gap-8 px-4 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-white">{t('Who is watching?')}</h1>
      <ul className="flex flex-wrap justify-center gap-5" aria-label={t('Accounts on this device')}>
        {profilesByRecent(book).map((p) => (
          <li key={`${p.serverUrl}|${p.userId}`} className="w-32">
            <button
              type="button"
              onClick={() => (p.pin ? setAsking(p) : onPick(p))}
              className="group flex w-full flex-col items-center gap-2 rounded-2xl p-3 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <span
                aria-hidden="true"
                className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-deep)] text-3xl font-semibold text-[var(--color-accent-ink)] ring-1 ring-white/20 transition group-hover:scale-105"
              >
                {initialOf(p.userName)}
              </span>
              <span className="w-full truncate text-sm font-medium text-white">{p.userName}</span>
              <span className="w-full truncate text-xs text-neutral-500">{p.pin ? t('Locked with a PIN') : p.serverName}</span>
            </button>
            <button type="button" className="btn-ghost mt-1 !px-2 !py-1 text-xs text-neutral-400" onClick={() => setRemoving(p)} aria-label={t('Remove {name} from this device', { name: p.userName })}>
              {t('Remove')}
            </button>
          </li>
        ))}
      </ul>
      {removing && (
        <section role="alertdialog" aria-label={t('Remove {name} from this device?', { name: removing.userName })} className="glass max-w-md space-y-3 rounded-2xl p-5">
          <p className="text-sm text-neutral-200">{t('Remove {name} from this device?', { name: removing.userName })}</p>
          <p className="text-xs text-neutral-400">{t('Its saved sign-in and PIN are erased from this browser. Nothing is deleted on your server.')}</p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                onBook({ ...book, profiles: book.profiles.filter((p) => p !== removing) })
                setRemoving(null)
              }}
            >
              {t('Remove')}
            </button>
            <button type="button" className="btn" onClick={() => setRemoving(null)} autoFocus>
              {t('Cancel')}
            </button>
          </div>
        </section>
      )}
      <div className="flex flex-col items-center gap-2">
        {canAddProfile(book) ? (
          <button type="button" className="btn" onClick={onAdd}>
            {t('Add an account')}
          </button>
        ) : (
          <p className="text-sm text-neutral-400">{t('This browser already keeps {count} accounts. Remove one to add another.', { count: book.profiles.length })}</p>
        )}
      </div>
    </main>
  )
}

function PinEntry({ profile, book, onBook, onRight, onCancel }: { profile: Profile; book: ProfileBook; onBook: (book: ProfileBook) => void; onRight: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const wait = pinWaitLeft(profile, now)
  // While a wait runs, the seconds left are shown.
  useEffect(() => {
    if (wait <= 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [wait])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (wait > 0 || !profile.pin || !isValidProfilePin(pin)) return
    const time = Date.now()
    if (await pinMatches(pin, profile.pin)) {
      onBook(profileRightPin(book, profile, time))
      onRight()
      return
    }
    onBook(profileWrongPin(book, profile, time))
    setNow(time)
    setPin('')
    setMessage(t('That PIN is not right.'))
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-5 px-4 text-center">
      <h1 className="text-2xl font-bold text-white">{t('PIN for {name}', { name: profile.userName })}</h1>
      <form onSubmit={(e) => void submit(e)} className="w-full space-y-3">
        <label className="block text-sm text-neutral-300">
          <span className="sr-only">{t('PIN')}</span>
          <input
            className="field text-center text-2xl tracking-[0.5em]"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            aria-label={t('PIN')}
          />
        </label>
        {wait > 0 ? (
          <p role="status" className="text-sm text-amber-300">
            {t('Too many wrong tries. Try again in {seconds} s.', { seconds: wait })}
          </p>
        ) : (
          message && (
            <p role="alert" className="text-sm text-red-300">
              {message}
            </p>
          )
        )}
        <div className="flex justify-center gap-2">
          <button type="submit" className="btn-primary" disabled={wait > 0 || !isValidProfilePin(pin)}>
            {t('Open')}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            {t('Back')}
          </button>
        </div>
      </form>
    </main>
  )
}
