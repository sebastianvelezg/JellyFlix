import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PeopleIcon } from '../icons'
import { useSyncPlay } from './SyncPlayProvider'
import { t } from '../../i18n'

/** The header button for watching together: it shows when this device is in a group, and opens the dialog to make, join or leave one. */
export function TogetherButton({ userName }: { userName: string }) {
  const sync = useSyncPlay()
  const [open, setOpen] = useState(false)
  if (!sync) return null
  const inGroup = !!sync.group
  return (
    <>
      <button
        type="button"
        className={`relative flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/10 pointer-coarse:h-11 pointer-coarse:w-11 ${inGroup ? 'text-[var(--color-accent)]' : 'text-neutral-300'}`}
        aria-label={inGroup ? t('Watching together: {group}', { group: sync.group?.name ?? '' }) : t('Watch together')}
        title={inGroup ? t('Watching together: {group}', { group: sync.group?.name ?? '' }) : t('Watch together')}
        onClick={() => setOpen(true)}
      >
        <PeopleIcon />
        {inGroup && <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[var(--color-accent)] ring-2 ring-[var(--color-bg)]" />}
      </button>
      <TogetherDialog open={open} onClose={() => setOpen(false)} userName={userName} />
    </>
  )
}

/** Native `<dialog>`: it traps the focus, closes with Esc and gives the focus back. */
function TogetherDialog({ open, onClose, userName }: { open: boolean; onClose: () => void; userName: string }) {
  const sync = useSyncPlay()
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = sync?.refreshGroups

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) {
      setError(null)
      el.showModal()
    }
    if (!open && el.open) el.close()
  }, [open])

  // Looking at the groups is looking for them now.
  const inGroup = !!sync?.group
  useEffect(() => {
    if (!open || inGroup || !refresh) return
    refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : t('Could not reach the group. Try again.')))
  }, [open, inGroup, refresh])

  if (!sync) return null

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not reach the group. Try again.'))
    } finally {
      setBusy(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(() => sync.create(name.trim() || t('Group of {user}', { user: userName })))
  }
  const group = sync.group

  return (
    <dialog
      ref={dialog}
      aria-label={t('Watch together')}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-white/10 bg-[var(--color-surface-2)] p-0 text-neutral-100 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close()
      }}
    >
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-white">{group ? t('Watching together') : t('Watch together')}</h2>
          <button type="button" className="btn-ghost -mr-2 -mt-1 px-2" aria-label={t('Close')} onClick={() => dialog.current?.close()}>
            ✕
          </button>
        </div>

        {group ? (
          <>
            <div className="space-y-1">
              <p className="text-base font-semibold text-neutral-100">{group.name}</p>
              <p className="text-sm text-neutral-400">{t('In the group: {names}', { names: group.participants.join(', ') || userName })}</p>
            </div>
            <p className="text-sm text-neutral-300">{t('Press Play on any title and it starts for everyone in the group, together. Pause and seek are shared too.')}</p>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(sync.leave)}>
              {t('Leave the group')}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-300">{t('Watch a title at the same time as someone else, each on their own device. Start a group, or join one that is open.')}</p>
            <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor="together-name" className="mb-1 block text-xs font-medium text-neutral-400">
                  {t('Group name')}
                </label>
                <input id="together-name" className="field" autoComplete="off" maxLength={60} placeholder={t('Group of {user}', { user: userName })} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <button type="submit" className="btn-primary" disabled={busy}>
                {t('Start a group')}
              </button>
            </form>
            <div>
              <h3 className="mb-2 text-sm font-medium text-neutral-100">{t('Groups you can join')}</h3>
              {sync.groups === null ? (
                error ? null : (
                  <p role="status" className="text-sm text-neutral-400">
                    {t('Looking for groups…')}
                  </p>
                )
              ) : sync.groups.length === 0 ? (
                <p className="text-sm text-neutral-400">{t('No open groups. Start one and ask someone to join.')}</p>
              ) : (
                <ul className="space-y-2">
                  {sync.groups.map((g) => (
                    <li key={g.id} className="flex items-center gap-3 rounded-xl bg-white/[.05] px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-neutral-100">{g.name}</span>
                        <span className="block truncate text-xs text-neutral-400">{g.participants.join(', ')}</span>
                      </span>
                      <button type="button" className="btn" disabled={busy} aria-label={t('Join {group}', { group: g.name })} onClick={() => void run(() => sync.join(g.id))}>
                        {t('Join')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="alert-error">
            {error}
          </p>
        )}
      </div>
    </dialog>
  )
}
