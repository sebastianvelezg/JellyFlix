import { useCallback, useMemo, useState } from 'react'
import {
  applyPolicyFields,
  createUser,
  diffPolicy,
  getAdminUsers,
  getLibraries,
  getParentalRatingOptions,
  getUserPolicy,
  isLastAdmin,
  MIN_PASSWORD,
  newUserProblems,
  policyFieldsOf,
  policyProblems,
  savePolicy,
  setUserPassword,
  type AdminUser,
  type LibraryInfo,
  type ParentalRatingOption,
  type PolicyFields,
  type Session,
} from '../../core'
import { t } from '../../i18n'
import { Card, Toggle } from '../SettingsParts'
import { StateMessage } from '../StateMessage'
import { showToast } from '../toast'
import { useAsync } from '../useAsync'
import { adminErrorText, ConfirmBox, when } from './parts'

/** Accounts: who exists, what each may do (with a review before saving), new accounts and new passwords. */
export function UsersAdmin({ session }: { session: Session }) {
  const load = useCallback(async () => {
    const [users, libraries, ratings] = await Promise.all([getAdminUsers(session), getLibraries(session).catch(() => [] as LibraryInfo[]), getParentalRatingOptions(session).catch(() => [] as ParentalRatingOption[])])
    return { users, libraries, ratings }
  }, [session])
  const { state, retry } = useAsync(load)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  if (state.status === 'loading') return <p role="status" className="text-sm text-neutral-400">{t('Loading…')}</p>
  if (state.status === 'error') return <StateMessage kind="error" size="section" message={state.message}><button type="button" className="btn" onClick={retry}>{t('Try again')}</button></StateMessage>
  const { users, libraries, ratings } = state.data

  return (
    <div className="space-y-5">
      <Card title={t('Accounts')} description={t('Who can sign in to this server. Accounts are not deleted from here: disable one to stop it.')}>
        <ul aria-label={t('Accounts')} className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">
                    {u.name} {u.id === session.userId && <span className="text-xs font-normal text-neutral-400">{t('(you)')}</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {u.isAdmin && <span className="chip-accent">{t('Administrator')}</span>}
                    {u.isDisabled && <span className="chip border-red-400/40 text-red-300">{t('Disabled')}</span>}
                    {u.lastActivity && <span className="text-xs text-neutral-500">{t('Last seen {when}', { when: when(u.lastActivity.getTime()) })}</span>}
                  </div>
                </div>
                <button type="button" className="btn" aria-expanded={editing === u.id} aria-label={editing === u.id ? t('Close {name}', { name: u.name }) : t('Edit the account {name}', { name: u.name })} onClick={() => setEditing(editing === u.id ? null : u.id)}>
                  {editing === u.id ? t('Close') : t('Edit')}
                </button>
              </div>
              {editing === u.id && (
                <AccountEditor
                  key={u.id}
                  session={session}
                  user={u}
                  users={users}
                  libraries={libraries}
                  ratings={ratings}
                  onSaved={() => {
                    retry()
                  }}
                />
              )}
            </li>
          ))}
        </ul>
        {creating ? (
          <NewAccount
            session={session}
            existing={users.map((u) => u.name)}
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false)
              retry()
              setEditing(id)
            }}
          />
        ) : (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            {t('New account')}
          </button>
        )}
      </Card>
    </div>
  )
}

function NewAccount({ session, existing, onCancel, onCreated }: { session: Session; existing: string[]; onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const problems = newUserProblems(name, password, again, existing)

  return (
    <form
      className="space-y-3 rounded-2xl border border-white/10 p-4"
      aria-label={t('New account')}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (problems.length > 0) return
        setBusy(true)
        setError(null)
        createUser(session, name, password)
          .then((id) => {
            showToast({ message: t('Made the account {name}. It can play, but it is not an administrator.', { name: name.trim() }) })
            setPassword('')
            setAgain('')
            onCreated(id)
          })
          .catch((err: unknown) => setError(adminErrorText(err)))
          .finally(() => setBusy(false))
      }}
    >
      <h3 className="text-sm font-semibold text-white">{t('New account')}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="new-name" className="mb-1 block text-sm font-medium text-neutral-100">
            {t('Name')}
          </label>
          <input id="new-name" className="field" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="new-pass" className="mb-1 block text-sm font-medium text-neutral-100">
            {t('Password')}
          </label>
          <input id="new-pass" className="field" type={shown ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor="new-pass2" className="mb-1 block text-sm font-medium text-neutral-100">
            {t('Password again')}
          </label>
          <input id="new-pass2" className="field" type={shown ? 'text' : 'password'} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
        <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={shown} onChange={(e) => setShown(e.target.checked)} />
        {t('Show the passwords')}
      </label>
      <p className="text-xs text-neutral-500">{t('At least {count} characters. It is sent to your server only, and is not kept in this browser.', { count: MIN_PASSWORD })}</p>
      {tried && problems.length > 0 && (
        <ul role="alert" className="alert-error list-disc space-y-0.5 pl-6">
          {problems.map((p) => (
            <li key={p}>{t(p)}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {t('Make the account')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  )
}

function AccountEditor({
  session,
  user,
  users,
  libraries,
  ratings,
  onSaved,
}: {
  session: Session
  user: AdminUser
  users: AdminUser[]
  libraries: LibraryInfo[]
  ratings: ParentalRatingOption[]
  onSaved: () => void
}) {
  const load = useCallback(() => getUserPolicy(session, user.id), [session, user.id])
  const { state, retry } = useAsync(load)
  if (state.status === 'loading') return <p role="status" className="mt-3 text-sm text-neutral-400">{t('Loading…')}</p>
  if (state.status === 'error')
    return (
      <p role="alert" className="alert-error mt-3">
        {state.message}{' '}
        <button type="button" className="underline" onClick={retry}>
          {t('Try again')}
        </button>
      </p>
    )
  return (
    <div className="mt-4 space-y-5 border-t border-white/10 pt-4">
      <PolicyForm
        session={session}
        user={user}
        users={users}
        libraries={libraries}
        ratings={ratings}
        policy={state.data}
        onSaved={() => {
          retry()
          onSaved()
        }}
      />
      <PasswordForm session={session} user={user} />
    </div>
  )
}

function PolicyForm({
  session,
  user,
  users,
  libraries,
  ratings,
  policy,
  onSaved,
}: {
  session: Session
  user: AdminUser
  users: AdminUser[]
  libraries: LibraryInfo[]
  ratings: ParentalRatingOption[]
  policy: Awaited<ReturnType<typeof getUserPolicy>>
  onSaved: () => void
}) {
  const was = useMemo(() => policyFieldsOf(policy), [policy])
  const [draft, setDraft] = useState<PolicyFields>(was)
  const [reviewing, setReviewing] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const names = useMemo(
    () => ({ libraries: Object.fromEntries(libraries.map((l) => [l.id, l.name])), ratings: Object.fromEntries(ratings.map((r) => [String(r.value), r.name])) }),
    [libraries, ratings],
  )
  const changes = useMemo(() => diffPolicy(was, draft, names), [was, draft, names])
  const problems = policyProblems(draft, was, { isSelf: user.id === session.userId, isLastAdmin: isLastAdmin(users, user) })
  // Making someone an administrator gives them everything: ask for the name.
  const promoting = !was.isAdmin && draft.isAdmin
  const confirmed = !promoting || typed.trim().toLowerCase() === user.name.toLowerCase()
  const set = <K extends keyof PolicyFields>(key: K, value: PolicyFields[K]) => {
    setReviewing(false)
    setDraft({ ...draft, [key]: value })
  }
  const dangerous = user.id === session.userId

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await savePolicy(session, user.id, applyPolicyFields(policy, draft))
      showToast({ message: t('Saved what {name} may do.', { name: user.name }) })
      setReviewing(false)
      onSaved()
    } catch (e) {
      setError(adminErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-4"
      aria-label={t('What {name} may do', { name: user.name })}
      onSubmit={(e) => {
        e.preventDefault()
        if (changes.length > 0 && problems.length === 0) setReviewing(true)
      }}
    >
      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Account')}</legend>
        <Toggle label={t('Account disabled')} hint={t('A disabled account cannot sign in, and is signed out.')} checked={draft.isDisabled} onChange={(v) => set('isDisabled', v)} />
        <Toggle label={t('Administrator')} hint={t('Can change everything on the server, including these allowances.')} checked={draft.isAdmin} onChange={(v) => set('isAdmin', v)} />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Libraries')}</legend>
        <Toggle label={t('All libraries')} checked={draft.allFolders} onChange={(v) => set('allFolders', v)} />
        {!draft.allFolders && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {libraries.map((l) => (
              <label key={l.id} className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-neutral-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-accent)]"
                  checked={draft.folders.includes(l.id)}
                  onChange={(e) => set('folders', e.target.checked ? [...draft.folders, l.id] : draft.folders.filter((f) => f !== l.id))}
                />
                {l.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Playing')}</legend>
        <Toggle label={t('May play media')} checked={draft.mediaPlayback} onChange={(v) => set('mediaPlayback', v)} />
        <Toggle label={t('May have videos converted')} hint={t('The server converts a video that a device cannot play. It uses the server\'s processor or graphics card.')} checked={draft.videoTranscoding} onChange={(v) => set('videoTranscoding', v)} />
        <Toggle label={t('May have audio converted')} checked={draft.audioTranscoding} onChange={(v) => set('audioTranscoding', v)} />
        <Toggle label={t('May have the container changed (remux)')} checked={draft.remuxing} onChange={(v) => set('remuxing', v)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`rating-${user.id}`} className="mb-1 block text-sm font-medium text-neutral-100">
              {t('Highest parental rating')}
            </label>
            <select id={`rating-${user.id}`} className="select w-full" value={draft.maxRating} onChange={(e) => set('maxRating', e.target.value)}>
              <option value="">{t('No limit')}</option>
              {ratings.map((r) => (
                <option key={r.value} value={String(r.value)}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`sessions-${user.id}`} className="mb-1 block text-sm font-medium text-neutral-100">
              {t('Sessions at once')}
            </label>
            <input id={`sessions-${user.id}`} className="field" inputMode="numeric" value={draft.maxSessions} onChange={(e) => set('maxSessions', e.target.value)} />
            <p className="mt-1 text-xs text-neutral-500">{t('0 for no limit.')}</p>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Other')}</legend>
        <Toggle label={t('May connect from outside the home network')} checked={draft.remoteAccess} onChange={(v) => set('remoteAccess', v)} />
        <Toggle label={t('May download files')} checked={draft.downloading} onChange={(v) => set('downloading', v)} />
        <Toggle label={t('May delete titles')} hint={t('On a real server this can delete files from the disk.')} checked={draft.contentDeletion} onChange={(v) => set('contentDeletion', v)} />
      </fieldset>

      {problems.length > 0 && (
        <ul role="alert" className="alert-error list-disc space-y-0.5 pl-6">
          {problems.map((p) => (
            <li key={p}>{t(p)}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}

      {reviewing ? (
        <ConfirmBox confirmLabel={t('Save these allowances')} onConfirm={() => confirmed && void save()} onCancel={() => setReviewing(false)} busy={busy} danger={promoting || dangerous}>
          <p className="mb-2 font-medium">{t('This will change for {name}:', { name: user.name })}</p>
          <ul aria-label={t('Changes to save')} className="space-y-1.5">
            {changes.map((c) => (
              <li key={c.key} className="grid gap-x-3 sm:grid-cols-[14rem_1fr]">
                <span className="text-neutral-400">{t(c.label)}</span>
                <span className="min-w-0 break-words">
                  <span className="text-neutral-500 line-through">{c.before ? t(c.before) : t('(empty)')}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> {t('now')} </span>
                  <span className="font-medium text-white">{c.after ? t(c.after) : t('(empty)')}</span>
                </span>
              </li>
            ))}
          </ul>
          {promoting && (
            <div className="mt-3">
              <label htmlFor={`promote-${user.id}`} className="block text-sm font-medium">
                {t('An administrator can do everything. Type the account name to confirm.')}
              </label>
              <input id={`promote-${user.id}`} className="field mt-1" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
              {!confirmed && <p className="mt-1 text-xs text-amber-200">{t('Type the name first')}</p>}
            </div>
          )}
        </ConfirmBox>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={changes.length === 0 || problems.length > 0}>
            {t('Review changes')}
          </button>
          <button type="button" className="btn" disabled={changes.length === 0} onClick={() => setDraft(was)}>
            {t('Undo my changes')}
          </button>
          <span className="text-xs text-neutral-500" aria-live="polite">
            {changes.length === 0 ? t('Nothing changed yet.') : t('{count} changes ready to review.', { count: changes.length })}
          </span>
        </div>
      )}
    </form>
  )
}

function PasswordForm({ session, user }: { session: Session; user: AdminUser }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problems = newUserProblems('x', password, again, [])
  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {t('Set a new password…')}
      </button>
    )
  return (
    <form
      className="space-y-3 rounded-2xl border border-white/10 p-4"
      aria-label={t('New password for {name}', { name: user.name })}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (problems.length > 0) return
        setBusy(true)
        setError(null)
        setUserPassword(session, user.id, password)
          .then(() => {
            showToast({ message: t('Changed the password of {name}.', { name: user.name }) })
            setPassword('')
            setAgain('')
            setOpen(false)
          })
          .catch((err: unknown) => setError(adminErrorText(err)))
          .finally(() => setBusy(false))
      }}
    >
      <h3 className="text-sm font-semibold text-white">{t('New password for {name}', { name: user.name })}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`pw-${user.id}`} className="mb-1 block text-sm font-medium text-neutral-100">
            {t('New password')}
          </label>
          <input id={`pw-${user.id}`} className="field" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`pw2-${user.id}`} className="mb-1 block text-sm font-medium text-neutral-100">
            {t('Password again')}
          </label>
          <input id={`pw2-${user.id}`} className="field" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
      </div>
      {password !== '' && problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-6 text-xs text-amber-200" aria-live="polite">
          {problems.map((p) => (
            <li key={p}>{t(p)}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy || problems.length > 0}>
          {t('Change the password')}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setPassword('')
            setAgain('')
            setOpen(false)
          }}
        >
          {t('Cancel')}
        </button>
      </div>
    </form>
  )
}
