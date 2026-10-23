import { useCallback, useState } from 'react'
import {
  getAdminDevices,
  getAdminSessions,
  getApiKeys,
  MESSAGE_LIMIT,
  removeDevice,
  revokeApiKey,
  sendSessionMessage,
  stopSessionPlayback,
  transcodeReasonText,
  type AdminDevice,
  type AdminKey,
  type AdminSession,
  type Session,
} from '../../core'
import { t } from '../../i18n'
import { Card } from '../SettingsParts'
import { StateMessage } from '../StateMessage'
import { showToast } from '../toast'
import { useAsync } from '../useAsync'
import { adminErrorText, ConfirmBox, when } from './parts'

/** Who is connected and what they play, the devices that signed in, and the API keys other programs use. */
export function DevicesAdmin({ session }: { session: Session }) {
  return (
    <div className="space-y-5">
      <Sessions session={session} />
      <Devices session={session} />
      <Keys session={session} />
    </div>
  )
}

function Sessions({ session }: { session: Session }) {
  const load = useCallback(() => getAdminSessions(session), [session])
  const { state, retry } = useAsync(load)
  const [messaging, setMessaging] = useState<string | null>(null)
  const [stopping, setStopping] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <Card title={t('Connected now')} description={t('Devices that did something in the last few minutes, and what they are playing.')}>
      <div>
        <button type="button" className="btn" onClick={retry}>
          {t('Refresh the list')}
        </button>
      </div>
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      {state.status === 'loading' && <p className="text-sm text-neutral-400">{t('Loading…')}</p>}
      {state.status === 'error' && <StateMessage kind="error" size="section" message={state.message}><button type="button" className="btn" onClick={retry}>{t('Try again')}</button></StateMessage>}
      {state.status === 'ready' && state.data.length === 0 && <p className="text-sm text-neutral-400">{t('Nobody is connected.')}</p>}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul aria-label={t('Connected now')} className="space-y-2">
          {state.data.map((s) => (
            <li key={s.id} className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">
                    {s.deviceName || s.client} {s.isThisDevice && <span className="text-xs font-normal text-neutral-400">{t('(this device)')}</span>}
                  </p>
                  <p className="text-xs text-neutral-500">{[s.userName, s.client, s.lastActivity ? when(s.lastActivity.getTime()) : ''].filter(Boolean).join(' · ')}</p>
                  {s.playing && <Playing playing={s.playing} />}
                </div>
                {!s.isThisDevice && s.controllable && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn" aria-label={t('Send a message to {name}', { name: s.deviceName })} onClick={() => { setMessaging(messaging === s.id ? null : s.id); setStopping(null) }}>
                      {t('Message…')}
                    </button>
                    {s.playing && (
                      <button type="button" className="btn" aria-label={t('Stop playback on {name}', { name: s.deviceName })} onClick={() => { setStopping(stopping === s.id ? null : s.id); setMessaging(null) }}>
                        {t('Stop playback…')}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {messaging === s.id && <MessageBox session={session} target={s} onClose={() => setMessaging(null)} onError={setError} />}
              {stopping === s.id && (
                <div className="mt-3">
                  <ConfirmBox
                    confirmLabel={t('Stop it')}
                    onCancel={() => setStopping(null)}
                    onConfirm={() => {
                      setError(null)
                      stopSessionPlayback(session, s.id)
                        .then(() => {
                          showToast({ message: t('Stopped {title} on {name}.', { title: s.playing?.title ?? '', name: s.deviceName }) })
                          setStopping(null)
                          window.setTimeout(retry, 800)
                        })
                        .catch((e: unknown) => setError(adminErrorText(e)))
                    }}
                  >
                    {t('Stop “{title}” on {name}? The person watching will be interrupted.', { title: s.playing?.title ?? '', name: s.deviceName })}
                  </ConfirmBox>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Playing({ playing }: { playing: NonNullable<AdminSession['playing']> }) {
  return (
    <div className="mt-1.5 text-sm text-neutral-200">
      <p>
        {playing.paused ? t('Paused: {title}', { title: playing.title }) : t('Playing: {title}', { title: playing.title })}
      </p>
      {playing.method === 'converted' ? (
        <p className="text-xs text-amber-200">
          {t('The server is converting this video.')}
          {playing.reasons.length > 0 && ` ${playing.reasons.map((r) => t(transcodeReasonText(r))).join('; ')}.`}
          {playing.bitrate ? ` ${t('{mbps} Mbps', { mbps: (playing.bitrate / 1_000_000).toFixed(1) })}` : ''}
        </p>
      ) : (
        <p className="text-xs text-neutral-500">{t('Nothing is converted.')}</p>
      )}
    </div>
  )
}

function MessageBox({ session, target, onClose, onError }: { session: Session; target: AdminSession; onClose: () => void; onError: (message: string | null) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const id = `msg-${target.id}`
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        setBusy(true)
        onError(null)
        sendSessionMessage(session, target.id, text)
          .then(() => {
            showToast({ message: t('Sent the message to {name}.', { name: target.deviceName }) })
            onClose()
          })
          .catch((err: unknown) => onError(adminErrorText(err)))
          .finally(() => setBusy(false))
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium text-neutral-100">
        {t('Message for {name}', { name: target.deviceName })}
      </label>
      <input id={id} className="field" maxLength={MESSAGE_LIMIT} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>
          {t('Send')}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  )
}

function Devices({ session }: { session: Session }) {
  const load = useCallback(() => getAdminDevices(session), [session])
  const { state, retry } = useAsync(load)
  const [removing, setRemoving] = useState<AdminDevice | null>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <Card title={t('Devices')} description={t('Every device that has signed in. Signing one out ends its access; it can sign in again with a password.')}>
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      {state.status === 'loading' && <p className="text-sm text-neutral-400">{t('Loading…')}</p>}
      {state.status === 'error' && <StateMessage kind="error" size="section" message={state.message}><button type="button" className="btn" onClick={retry}>{t('Try again')}</button></StateMessage>}
      {state.status === 'ready' && (
        <ul aria-label={t('Devices')} className="space-y-2">
          {state.data.map((d) => (
            <li key={d.id} className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">
                    {d.name} {d.isThisDevice && <span className="text-xs font-normal text-neutral-400">{t('(this device)')}</span>}
                  </p>
                  <p className="text-xs text-neutral-500">{[d.app && `${d.app} ${d.appVersion}`.trim(), d.lastUser, d.lastActivity ? when(d.lastActivity.getTime()) : ''].filter(Boolean).join(' · ')}</p>
                </div>
                {d.isThisDevice ? (
                  <span className="text-xs text-neutral-500">{t('Use “Sign out” in Settings for this one.')}</span>
                ) : (
                  <button type="button" className="btn" aria-label={t('Sign out {name}', { name: d.name })} onClick={() => setRemoving(removing?.id === d.id ? null : d)}>
                    {t('Sign out…')}
                  </button>
                )}
              </div>
              {removing?.id === d.id && (
                <div className="mt-3">
                  <ConfirmBox
                    danger
                    confirmLabel={t('Sign it out')}
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => {
                      setError(null)
                      removeDevice(session, d.id)
                        .then(() => {
                          showToast({ message: t('Signed out {name}.', { name: d.name }) })
                          setRemoving(null)
                          retry()
                        })
                        .catch((e: unknown) => setError(adminErrorText(e)))
                    }}
                  >
                    {t('Sign “{name}” out of the server? It stops working until someone signs in on it again.', { name: d.name })}
                  </ConfirmBox>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Keys({ session }: { session: Session }) {
  const load = useCallback(() => getApiKeys(session), [session])
  const { state, retry } = useAsync(load)
  const [revoking, setRevoking] = useState<AdminKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <Card title={t('API keys')} description={t('Keys that other programs (home automation, scripts) use to talk to this server. Only the last four characters are shown.')}>
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      {state.status === 'loading' && <p className="text-sm text-neutral-400">{t('Loading…')}</p>}
      {state.status === 'error' && <StateMessage kind="error" size="section" message={state.message}><button type="button" className="btn" onClick={retry}>{t('Try again')}</button></StateMessage>}
      {state.status === 'ready' && state.data.length === 0 && <p className="text-sm text-neutral-400">{t('No API keys.')}</p>}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul aria-label={t('API keys')} className="space-y-2">
          {state.data.map((k) => (
            <li key={k.hint + k.app} className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">
                    {k.app || t('Unnamed')} <span className="font-mono text-xs font-normal text-neutral-400">…{k.hint}</span>
                  </p>
                  <p className="text-xs text-neutral-500">
                    {[k.created ? t('Made {when}', { when: when(k.created.getTime()) }) : '', k.lastUsed ? t('Last used {when}', { when: when(k.lastUsed.getTime()) }) : ''].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {k.isThisSession ? (
                  <span className="text-xs text-neutral-500">{t('This is the key of this browser.')}</span>
                ) : (
                  <button type="button" className="btn" aria-label={t('Revoke the key of {app} ending {hint}', { app: k.app || t('Unnamed'), hint: k.hint })} onClick={() => setRevoking(revoking?.hint === k.hint && revoking.app === k.app ? null : k)}>
                    {t('Revoke…')}
                  </button>
                )}
              </div>
              {revoking?.hint === k.hint && revoking.app === k.app && (
                <div className="mt-3">
                  <ConfirmBox
                    danger
                    confirmLabel={t('Revoke it')}
                    onCancel={() => setRevoking(null)}
                    onConfirm={() => {
                      setError(null)
                      revokeApiKey(session, k)
                        .then(() => {
                          showToast({ message: t('Revoked the key of {app}.', { app: k.app || t('Unnamed') }) })
                          setRevoking(null)
                          retry()
                        })
                        .catch((e: unknown) => setError(adminErrorText(e)))
                    }}
                  >
                    {t('Revoke the key of “{app}” ending {hint}? The program that uses it stops working until it gets a new key.', { app: k.app || t('Unnamed'), hint: k.hint })}
                  </ConfirmBox>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
