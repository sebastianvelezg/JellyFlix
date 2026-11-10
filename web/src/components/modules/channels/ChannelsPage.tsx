import { useCallback, useEffect, useState } from 'react'
import type { Session } from '../../../core'
import { getChannel, listChannels, type Channel, type ChannelSummary } from '../../../core/modules'
import { t } from '../../../i18n'
import { errorText, useAsync } from '../../useAsync'
import { StateMessage } from '../../StateMessage'
import type { Navigate } from '../../route'
import { useModulesClient } from '../ModulesProvider'
import { ChannelLogo, FavoriteStar, useFavorites, type Favorites } from './ChannelBits'
import { ChannelGuide } from './ChannelGuide'
import { ChannelEditor } from './ChannelEditor'
import { ManageChannels } from './ManageChannels'
import { QuickChannels } from './QuickChannels'
import { favouritesFirst } from './guideLayout'
import { programTitle } from './programText'

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
    return { channels: await listChannels(client), now: serverNow, version }
  }, [client, skew, version])
  const { state, retry } = useAsync(load)
  const favorites = useFavorites(setNotice)
  const { reset: resetFavorites } = favorites
  // What the container says is looked at again, so the person's own changes are only kept until the next answer.
  const channelsNow = state.status === 'ready' ? state.data.channels : null
  useEffect(() => {
    if (channelsNow) resetFavorites()
  }, [channelsNow, resetFavorites])

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
              <NowList channels={state.data.channels.filter((c) => c.enabled)} now={state.data.now} favorites={favorites} onWatch={(id) => go({ page: 'channel', id })} />
            ) : (
              <ChannelGuide favorites={favorites} onWatch={(id) => go({ page: 'channel', id })} />
            ))}
        </>
      )}
    </div>
  )
}

function NowList({ channels, now, favorites, onWatch }: { channels: ChannelSummary[]; now: number; favorites: Favorites; onWatch: (id: string) => void }) {
  const ordered = favouritesFirst(channels, (id) => favorites.is(id, channels.find((c) => c.id === id)?.favorite))
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {ordered.map((c) => {
        const favorite = favorites.is(c.id, c.favorite)
        const progress = c.now ? Math.min(100, Math.max(0, ((now - c.now.start) / (c.now.end - c.now.start)) * 100)) : 0
        return (
          <li key={c.id} className="glass flex flex-col gap-3 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <ChannelLogo channel={c} />
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 break-words text-base font-semibold leading-snug text-white">{c.name}</h3>
              </div>
              <FavoriteStar name={c.name} on={favorite} onToggle={() => favorites.toggle(c.id, favorite)} />
              <button type="button" className="btn-primary shrink-0" disabled={!c.now} onClick={() => onWatch(c.id)} aria-label={t('Watch channel {name}', { name: c.name })}>
                {t('Watch')}
              </button>
            </div>
            {c.now ? (
              <div>
                <p className="text-sm text-neutral-100">
                  <span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{t('On now')}</span>
                  {programTitle(c.now)}
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
                {t('Next at {time}: {title}', { time: timeOf(c.next.start), title: programTitle(c.next) })}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
