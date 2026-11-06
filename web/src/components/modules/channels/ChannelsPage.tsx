import { useCallback, useEffect, useState } from 'react'
import type { Session } from '../../../core'
import { channelGuide, getChannel, listChannels, type Channel, type ChannelSummary, type Guide, type GuideChannel, type Program } from '../../../core/modules'
import { t } from '../../../i18n'
import { errorText, useAsync } from '../../useAsync'
import { StateMessage } from '../../StateMessage'
import type { Navigate } from '../../route'
import { useModulesClient } from '../ModulesProvider'
import { ChannelEditor } from './ChannelEditor'
import { ManageChannels } from './ManageChannels'
import { QuickChannels } from './QuickChannels'

const PX_PER_HOUR = 240
const GUIDE_BEFORE = 1800
const GUIDE_AFTER = 5 * 3600
const REFRESH_MS = 60_000

const timeOf = (seconds: number): string => new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

type Tab = 'now' | 'guide' | 'manage'

/**
 * The retro TV channels. Everybody sees what is on each channel (cards) or the whole evening (the guide) and tunes in; the
 * administrators also have a tab to set the channels up (make them, edit them, turn them on and off).
 */
export function ChannelsPage({ session, go }: { session: Session; go: Navigate }) {
  const { client, skew, isAdmin } = useModulesClient()
  const [tab, setTab] = useState<Tab>('now')
  const [screen, setScreen] = useState<{ kind: 'edit'; channel: Channel | null } | { kind: 'quick' } | null>(null)
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const serverNow = Math.floor(Date.now() / 1000 + skew)
    const [channels, guide] = await Promise.all([listChannels(client), channelGuide(client, serverNow - GUIDE_BEFORE, serverNow + GUIDE_AFTER)])
    return { channels, guide, now: serverNow, version }
  }, [client, skew, version])
  const { state, retry } = useAsync(load)

  // The cards and the guide are looked at again every minute while this page is open (nothing runs when it is closed).
  useEffect(() => {
    const timer = window.setInterval(() => setVersion((v) => v + 1), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  const changed = () => setVersion((v) => v + 1)
  const closeScreen = () => {
    setScreen(null)
    changed()
  }

  if (screen?.kind === 'edit') {
    return <ChannelEditor session={session} channel={screen.channel} onDone={closeScreen} onCancel={() => setScreen(null)} />
  }
  if (screen?.kind === 'quick') return <QuickChannels onDone={closeScreen} onCancel={() => setScreen(null)} />

  async function edit(id: string) {
    try {
      setScreen({ kind: 'edit', channel: await getChannel(client, id) })
    } catch (e) {
      setNotice(errorText(e))
    }
  }

  const tabs: Array<[Tab, string]> = [
    ['now', t('On now')],
    ['guide', t('Guide')],
    ...(isAdmin ? ([['manage', t('Set up')]] as Array<[Tab, string]>) : []),
  ]

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={t('View')} className="flex w-fit rounded-full border border-white/10 p-0.5">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full px-4 py-1.5 text-sm ${tab === id ? 'bg-white/15 text-white' : 'text-neutral-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      {notice && (
        <p role="status" className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-2 text-sm text-neutral-300">
          {notice}
        </p>
      )}

      {tab === 'manage' && isAdmin ? (
        <ManageChannels version={version} onQuick={() => setScreen({ kind: 'quick' })} onNew={() => setScreen({ kind: 'edit', channel: null })} onEdit={(id) => void edit(id)} onChanged={changed} />
      ) : (
        <>
          {state.status === 'loading' && <p role="status" className="py-16 text-center text-neutral-400">{t('Loading…')}</p>}
          {state.status === 'error' && (
            <StateMessage kind="error" message={state.message} size="section">
              <button type="button" className="btn" onClick={retry}>
                {t('Try again')}
              </button>
            </StateMessage>
          )}
          {state.status === 'ready' &&
            (state.data.channels.filter((c) => c.enabled).length === 0 ? (
              <StateMessage kind="empty" size="section" message={isAdmin ? t('There are no channels on yet. Set some up in the “Set up” tab.') : t('There are no channels yet. An administrator can make them.')}>
                {isAdmin && (
                  <button type="button" className="btn-primary" onClick={() => setTab('manage')}>
                    {t('Set up channels')}
                  </button>
                )}
              </StateMessage>
            ) : tab === 'now' ? (
              <NowList channels={state.data.channels.filter((c) => c.enabled)} now={state.data.now} onWatch={(id) => go({ page: 'channel', id })} />
            ) : (
              <GuideGrid guide={state.data.guide} onWatch={(id) => go({ page: 'channel', id })} />
            ))}
        </>
      )}
    </div>
  )
}

function NowList({ channels, now, onWatch }: { channels: ChannelSummary[]; now: number; onWatch: (id: string) => void }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {channels.map((c) => {
        const progress = c.now ? Math.min(100, Math.max(0, ((now - c.now.start) / (c.now.end - c.now.start)) * 100)) : 0
        return (
          <li key={c.id} className="glass flex flex-col gap-3 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-black tabular-nums text-white" style={{ background: c.color }}>
                {c.number}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold text-white">{c.name}</h3>
              </div>
              <button type="button" className="btn-primary shrink-0" disabled={!c.now} onClick={() => onWatch(c.id)} aria-label={t('Watch channel {name}', { name: c.name })}>
                {t('Watch')}
              </button>
            </div>
            {c.now ? (
              <div>
                <p className="text-sm text-neutral-100">
                  <span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{t('On now')}</span>
                  {c.now.title}
                </p>
                {c.now.subtitle && <p className="text-xs text-neutral-400">{c.now.subtitle}</p>}
                <div aria-hidden="true" className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {timeOf(c.now.start)} – {timeOf(c.now.end)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">{t('Nothing on right now.')}</p>
            )}
            {c.next && (
              <p className="text-xs text-neutral-400">
                {t('Next at {time}: {title}', { time: timeOf(c.next.start), title: c.next.title })}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function GuideGrid({ guide, onWatch }: { guide: Guide; onWatch: (id: string) => void }) {
  // The guide is drawn from the half hour before its start, so the time ruler lines up with whole half hours.
  const from = Math.floor(guide.from / 1800) * 1800
  const to = guide.to
  const width = ((to - from) / 3600) * PX_PER_HOUR
  const x = (seconds: number) => ((seconds - from) / 3600) * PX_PER_HOUR
  const serverNow = guide.serverTime
  const marks: number[] = []
  for (let m = from; m < to; m += 1800) marks.push(m)

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10" role="region" aria-label={t('Channel guide')} tabIndex={0}>
      <div style={{ width: width + 144 }} className="relative">
        <div className="flex border-b border-white/10 text-xs text-neutral-400">
          <div className="sticky left-0 z-10 w-36 shrink-0 bg-[var(--color-bg)] px-3 py-2">{t('Channel')}</div>
          <div className="relative h-8" style={{ width }}>
            {marks.map((m) => (
              <span key={m} className="absolute top-2 border-l border-white/10 pl-1.5" style={{ left: x(m) }}>
                {timeOf(m)}
              </span>
            ))}
          </div>
        </div>
        {guide.channels.map((c) => (
          <GuideRow key={c.id} channel={c} from={from} width={width} x={x} serverNow={serverNow} onWatch={onWatch} />
        ))}
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-500/80" style={{ left: 144 + x(serverNow) }} />
      </div>
    </div>
  )
}

function GuideRow({ channel, from, width, x, serverNow, onWatch }: { channel: GuideChannel; from: number; width: number; x: (s: number) => number; serverNow: number; onWatch: (id: string) => void }) {
  return (
    <div className="flex border-b border-white/5 last:border-b-0">
      <button type="button" onClick={() => onWatch(channel.id)} className="sticky left-0 z-10 flex w-36 shrink-0 items-center gap-2 bg-[var(--color-bg)] px-3 py-2 text-left hover:bg-white/5" aria-label={t('Watch channel {name}', { name: channel.name })}>
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white" style={{ background: channel.color }}>
          {channel.number}
        </span>
        <span className="truncate text-sm text-neutral-100">{channel.name}</span>
      </button>
      <div className="relative h-14" style={{ width }}>
        {channel.programs.map((p: Program) => {
          const left = Math.max(0, x(Math.max(p.start, from)))
          const right = Math.min(width, x(p.end))
          const onNow = p.start <= serverNow && serverNow < p.end
          return (
            <button
              key={p.start}
              type="button"
              disabled={!onNow}
              onClick={() => onNow && onWatch(channel.id)}
              title={`${p.title}${p.subtitle ? ` · ${p.subtitle}` : ''} (${timeOf(p.start)} – ${timeOf(p.end)})`}
              className={`absolute top-1 h-12 overflow-hidden rounded-lg border px-2 py-1 text-left text-xs ${onNow ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white hover:bg-[var(--color-accent)]/30' : 'border-white/10 bg-white/[.04] text-neutral-300'}`}
              style={{ left: left + 2, width: Math.max(0, right - left - 4) }}
            >
              <span className="block truncate font-medium">{p.title}</span>
              <span className="block truncate text-neutral-400">{p.subtitle ?? `${timeOf(p.start)} – ${timeOf(p.end)}`}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
