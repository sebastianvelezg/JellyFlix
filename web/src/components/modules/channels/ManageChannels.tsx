import { useCallback, useState } from 'react'
import { listChannels, rebuildChannel, refreshChannel, setChannelEnabled, type ChannelSummary } from '../../../core/modules'
import { t } from '../../../i18n'
import { errorText, useAsync } from '../../useAsync'
import { StateMessage } from '../../StateMessage'
import { useModulesClient } from '../ModulesProvider'
import { ChannelLogo } from './ChannelBits'

const when = (seconds: number | null): string => (seconds ? new Date(seconds * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : t('never'))

/**
 * Where the administrator sets the channels up: make them (quick channels, a new one), and for each existing one turn it on or off,
 * edit it, read its titles again or make its schedule again. What everybody else sees is on the other tabs.
 */
export function ManageChannels({ version, onQuick, onNew, onEdit, onChanged }: { version: number; onQuick: () => void; onNew: () => void; onEdit: (id: string) => void; onChanged: () => void }) {
  const { client } = useModulesClient()
  const load = useCallback(async () => {
    void version
    return listChannels(client)
  }, [client, version])
  const { state, retry } = useAsync(load)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function run(id: string, work: () => Promise<unknown>, done: string) {
    setBusy(id)
    setNotice(null)
    try {
      await work()
      setNotice(done)
      onChanged()
    } catch (e) {
      setNotice(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[radial-gradient(120%_160%_at_0%_0%,color-mix(in_srgb,var(--color-accent)_16%,transparent),transparent_60%)] bg-white/[.04] p-5">
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="text-lg font-semibold text-white">{t('Set up the channels')}</h2>
          <p className="text-sm text-neutral-400">{t('Make channels, and change the ones you have. Everybody watches them from the other tabs.')}</p>
        </div>
        <button type="button" className="btn" onClick={onQuick}>
          {t('Quick channels')}
        </button>
        <button type="button" className="btn-primary" onClick={onNew}>
          {t('New channel')}
        </button>
      </div>
      {notice && (
        <p role="status" className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-2 text-sm text-neutral-300">
          {notice}
        </p>
      )}
      {state.status === 'loading' && <p role="status" className="py-10 text-center text-neutral-400">{t('Loading…')}</p>}
      {state.status === 'error' && (
        <StateMessage kind="error" message={state.message} size="section">
          <button type="button" className="btn" onClick={retry}>
            {t('Try again')}
          </button>
        </StateMessage>
      )}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <StateMessage kind="empty" size="section" message={t('There are no channels yet. Make one, or let the quick channels make one per genre.')} />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {state.data.map((c) => (
              <ChannelRow key={c.id} channel={c} busy={busy === c.id} onEdit={() => onEdit(c.id)} onToggle={(on) => void run(c.id, () => setChannelEnabled(client, c.id, on), on ? t('The channel is on.') : t('The channel is off.'))} onRefresh={() => void run(c.id, () => refreshChannel(client, c.id), t('The list of titles was read again from Jellyfin.'))} onRebuild={() => void run(c.id, () => rebuildChannel(client, c.id), t('The schedule was made again from now on.'))} />
            ))}
          </ul>
        ))}
    </div>
  )
}

function ChannelRow({ channel: c, busy, onEdit, onToggle, onRefresh, onRebuild }: { channel: ChannelSummary; busy: boolean; onEdit: () => void; onToggle: (on: boolean) => void; onRefresh: () => void; onRebuild: () => void }) {
  const chip = 'rounded-full border border-white/10 bg-white/[.05] px-2 py-0.5 text-[11px] text-neutral-300'
  return (
    <li className={`overflow-hidden rounded-2xl border border-white/10 bg-white/[.04] transition ${c.enabled ? '' : 'opacity-70'}`}>
      <div className="flex flex-wrap items-center gap-4 p-4" style={{ background: `linear-gradient(100deg, color-mix(in srgb, ${c.color} 22%, transparent), transparent 55%)` }}>
        <ChannelLogo channel={c} round="rounded-2xl" badge={false} className="h-16 w-16 text-2xl shadow-[0_8px_22px_-8px_rgba(0,0,0,0.8)] ring-1 ring-white/15" />
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-[11px] font-bold tabular-nums tracking-wide text-neutral-400">CH {c.number}</p>
          <h3 className="line-clamp-2 break-words text-base font-semibold leading-snug text-white">{c.name}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className={chip}>{c.mode === 'grid' ? t('Weekly grid') : t('Marathon')}</span>
            <span className={chip}>{t('{count} titles', { count: c.poolSize })}</span>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
          <span className="relative inline-flex h-6 w-10 shrink-0">
            <input
              type="checkbox"
              role="switch"
              checked={c.enabled}
              disabled={busy}
              onChange={(e) => onToggle(e.target.checked)}
              aria-label={t('Channel {name} is on', { name: c.name })}
              className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            />
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-white/20 transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-[0_1px_3px_rgba(0,0,0,0.5)] after:transition-transform after:duration-200 peer-checked:bg-[var(--color-accent-strong)] peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-white/80 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-black motion-reduce:transition-none motion-reduce:after:transition-none"
            />
          </span>
          {c.enabled ? t('On') : t('Off')}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
        <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={onEdit} aria-label={t('Edit channel {name}', { name: c.name })}>
          {t('Edit')}
        </button>
        <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={onRefresh} aria-label={`${t('Read titles again')}: ${c.name}`}>
          {t('Read titles again')}
        </button>
        <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={onRebuild} aria-label={`${t('Make the schedule again')}: ${c.name}`}>
          {t('Make the schedule again')}
        </button>
        <span className="ml-auto text-[11px] text-neutral-500">{t('read {when}', { when: when(c.poolRefreshedAt) })}</span>
      </div>
    </li>
  )
}
