import { lazy, Suspense, useRef, useState, type KeyboardEvent } from 'react'
import type { Session } from '../../core'
import { t, tr } from '../../i18n'
import { BackIcon } from '../icons'
import { StateMessage } from '../StateMessage'
import { useAdminStatus } from './editorEvents'

const LibraryAdmin = lazy(() => import('./LibraryAdmin').then((m) => ({ default: m.LibraryAdmin })))
const UsersAdmin = lazy(() => import('./UsersAdmin').then((m) => ({ default: m.UsersAdmin })))
const DevicesAdmin = lazy(() => import('./DevicesAdmin').then((m) => ({ default: m.DevicesAdmin })))
const ServerAdmin = lazy(() => import('./ServerAdmin').then((m) => ({ default: m.ServerAdmin })))

type Tab = 'library' | 'users' | 'devices' | 'server'
const TABS: Tab[] = ['library', 'users', 'devices', 'server']
const TAB_LABEL: Record<Tab, string> = { library: tr('Library'), users: tr('Accounts'), devices: tr('Devices'), server: tr('Server') }

/**
 * Day-to-day administration in one place: libraries and titles, accounts, devices and keys, and the server's health and
 * activity. Only for administrators: anyone else sees a sentence, and nothing is asked of the server.
 */
export function AdminPage({ session, onBack }: { session: Session; onBack: () => void }) {
  const status = useAdminStatus(session)
  const [tab, setTab] = useState<Tab>('library')
  const buttons = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const at = TABS.indexOf(tab)
    const next = TABS[e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (at + step + TABS.length) % TABS.length] as Tab
    setTab(next)
    buttons.current[next]?.focus()
  }

  return (
    <div className="mx-auto max-w-3xl pt-8">
      <button type="button" className="btn mb-5" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>
      <h1 className="mb-1 text-3xl font-bold tracking-tight sm:text-4xl">{t('Administration')}</h1>
      <p className="mb-6 text-sm text-neutral-400">{t('These tools change your server for everybody who uses it. The server decides what an account may do; every change asks first.')}</p>

      {status === 'checking' && (
        <p role="status" className="text-sm text-neutral-400">
          {t('Loading…')}
        </p>
      )}
      {status === 'no' && (
        <StateMessage kind="empty" size="section" message={t('Only administrators of this server can use these tools.')}>
          <button type="button" className="btn" onClick={onBack}>
            {t('Back')}
          </button>
        </StateMessage>
      )}
      {status === 'yes' && (
        <>
          <div role="tablist" aria-label={t('Administration')} className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1">
            {TABS.map((id) => (
              <button
                key={id}
                ref={(el) => {
                  buttons.current[id] = el
                }}
                type="button"
                role="tab"
                id={`admin-tab-${id}`}
                aria-selected={tab === id}
                aria-controls="admin-panel"
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={onKey}
                className={`tab shrink-0`}
              >
                {t(TAB_LABEL[id])}
              </button>
            ))}
          </div>
          <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
            <Suspense
              fallback={
                <p role="status" className="text-sm text-neutral-400">
                  {t('Loading…')}
                </p>
              }
            >
              {tab === 'library' && <LibraryAdmin session={session} />}
              {tab === 'users' && <UsersAdmin session={session} />}
              {tab === 'devices' && <DevicesAdmin session={session} />}
              {tab === 'server' && <ServerAdmin session={session} />}
            </Suspense>
          </div>
        </>
      )}
    </div>
  )
}
