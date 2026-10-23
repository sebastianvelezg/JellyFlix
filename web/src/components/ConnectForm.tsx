import { useEffect, useState, type FormEvent } from 'react'
import type { QuickConnectRequest, Session } from '../core'
import { readKeepSignedIn, writeKeepSignedIn } from '../platform/web/storage'
import { readRememberedServerUrl, rememberServerUrl } from '../platform/web/browser'
import { LogoMark, Wordmark } from './icons'
import { t } from '../i18n'

/** How the form asks for a code (Quick Connect) instead of a password. Left out where it is not offered. */
export interface QuickConnectActions {
  start: (serverUrl: string) => Promise<QuickConnectRequest>
  approved: (request: QuickConnectRequest) => Promise<boolean>
  complete: (request: QuickConnectRequest) => Promise<Session>
}

const POLL_MS = 2000
const CODE_LIFETIME_MS = 10 * 60_000

export function ConnectForm({
  onConnect,
  onConnected,
  quickConnect,
  notice,
}: {
  onConnect: (serverUrl: string, username: string, password: string) => Promise<Session>
  onConnected: (session: Session, keepSignedIn: boolean) => void
  quickConnect?: QuickConnectActions
  /** A message from the app, e.g. "Your session expired". */
  notice?: string | null
}) {
  const [serverUrl, setServerUrl] = useState(readRememberedServerUrl)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(readKeepSignedIn)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A code waiting to be typed on a signed-in device (Quick Connect).
  const [request, setRequest] = useState<QuickConnectRequest | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const session = await onConnect(serverUrl, username, password)
      rememberServerUrl(session.serverUrl)
      writeKeepSignedIn(keep)
      onConnected(session, keep)
    } catch (e) {
      setError(t(e instanceof Error ? e.message : 'Could not connect.'))
      setBusy(false)
    }
  }

  async function startCode() {
    if (!quickConnect || busy) return
    setBusy(true)
    setError(null)
    try {
      setRequest(await quickConnect.start(serverUrl))
    } catch (e) {
      setError(t(e instanceof Error ? e.message : 'Could not connect.'))
    } finally {
      setBusy(false)
    }
  }

  // While a code is showing, ask every two seconds whether it was approved, and give up after ten minutes.
  useEffect(() => {
    if (!request || !quickConnect) return
    let stopped = false
    let checking = false
    const check = async () => {
      if (checking || stopped) return
      checking = true
      try {
        if (!(await quickConnect.approved(request)) || stopped) return
        stopped = true
        const session = await quickConnect.complete(request)
        rememberServerUrl(session.serverUrl)
        writeKeepSignedIn(keep)
        onConnected(session, keep)
      } catch (e) {
        stopped = true
        setRequest(null)
        setError(t(e instanceof Error ? e.message : 'Could not connect.'))
      } finally {
        checking = false
      }
    }
    const timer = window.setInterval(() => void check(), POLL_MS)
    const expiry = window.setTimeout(() => {
      stopped = true
      setRequest(null)
      setError(t('The code expired. Ask for a new one.'))
    }, CODE_LIFETIME_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.clearTimeout(expiry)
    }
    // The form's other fields do not matter while a code is showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      {/* Backdrop: a faint grid and two slow blue glows on pure black. */}
      <div aria-hidden="true" className="grid-bg absolute inset-0 -z-10" />
      <div
        aria-hidden="true"
        className="absolute -left-40 -top-40 -z-10 h-[34rem] w-[34rem] rounded-full bg-[var(--color-accent-deep)]/25 blur-[120px]"
        style={{ animation: 'drift 18s ease-in-out infinite' }}
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-52 -right-32 -z-10 h-[30rem] w-[30rem] rounded-full bg-[var(--color-cyan)]/10 blur-[120px]"
        style={{ animation: 'drift 24s ease-in-out infinite reverse' }}
      />

      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 pt-[calc(2.5rem+var(--safe-top))] pb-10">
        <div className="rise mb-8 flex flex-col items-center text-center">
          <span className="mb-1">
            <LogoMark size={96} />
          </span>
          <h1>
            <Wordmark height={40} />
          </h1>
          <p className="mt-2 text-sm text-neutral-400">
            {t('Sign in to your Jellyfin server to browse and watch your movies.')}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rise rise-2 space-y-4 rounded-3xl border border-white/10 bg-white/[.035] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl"
          noValidate
        >
          {notice && (
            <p role="status" className="alert-info">
              {notice}
            </p>
          )}

          <div>
            <label
              htmlFor="server-url"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-neutral-400"
            >
              {t('Server URL')}
            </label>
            <input
              id="server-url"
              className="field"
              type="text"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={t('http://192.168.x.x:8096')}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={busy || request !== null}
            />
          </div>

          {request ? (
            <div role="status" className="space-y-3 text-center" aria-live="polite">
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">{t('Enter this code in Jellyfin')}</p>
              <p className="font-mono text-5xl font-extrabold tracking-[0.2em] text-[var(--color-accent)]" aria-label={request.code.split('').join(' ')}>
                {request.code}
              </p>
              <p className="text-sm text-neutral-400">
                {t('On your phone or computer, open Jellyfin, choose Quick Connect in your user menu and type the code. This page continues by itself.')}
              </p>
              <button type="button" className="btn w-full" onClick={() => setRequest(null)}>
                {t('Cancel')}
              </button>
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="username"
                  className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-neutral-400"
                >
                  {t('Username')}
                </label>
                <input
                  id="username"
                  className="field"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-neutral-400"
                >
                  {t('Password')}
                </label>
                <input
                  id="password"
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
            </>
          )}

          <label className="flex items-start gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              checked={keep}
              onChange={(e) => setKeep(e.target.checked)}
              disabled={busy}
            />
            <span>
              {t('Keep me signed in on this device')}
              <span className="block text-xs text-neutral-500">
                {t('Off: you stay signed in across reloads until you close the tab. On: until you sign out.')}
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="alert-error">
              {error}
            </p>
          )}

          {!request && (
            <>
              <button type="submit" disabled={busy} className="btn-primary w-full py-3 text-base">
                {busy ? t('Connecting…') : t('Connect')}
              </button>
              {quickConnect && (
                <button type="button" disabled={busy || !serverUrl.trim()} className="btn w-full py-3" onClick={() => void startCode()}>
                  {t('Sign in with a code')}
                </button>
              )}
            </>
          )}
        </form>

        <p className="rise rise-3 mt-5 text-center text-xs leading-relaxed text-neutral-500">
          {t('Your password is sent only to the server above and is never stored. Only a revocable session token is kept (see the README for details).')}
        </p>
      </main>
    </div>
  )
}
