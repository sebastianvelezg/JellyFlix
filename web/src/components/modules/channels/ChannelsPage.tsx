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

/** The channels on now, as cards: favourites first (with a heading of their own), then the rest. */
function NowList({ channels, now, favorites, onWatch }: { channels: ChannelSummary[]; now: number; favorites: Favorites; onWatch: (id: string) => void }) {
  const ordered = favouritesFirst(channels, (id) => favorites.is(id, channels.find((c) => c.id === id)?.favorite))
  const kept = ordered.filter((c) => favorites.is(c.id, c.favorite))
  const rest = ordered.filter((c) => !favorites.is(c.id, c.favorite))
  const section = (list: ChannelSummary[], heading: string | null) => (
    <section aria-label={heading ?? t('All channels')}>
      {heading && <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">{heading}</h2>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-4">
        {list.map((c) => (
          <NowCard key={c.id} channel={c} now={now} favorite={favorites.is(c.id, c.favorite)} onToggle={() => favorites.toggle(c.id, favorites.is(c.id, c.favorite))} onWatch={() => onWatch(c.id)} />
        ))}
      </ul>
    </section>
  )
  if (kept.length === 0) return section(rest, null)
  return (
    <div className="space-y-7">
      {section(kept, t('Favourite channels'))}
      {rest.length > 0 && section(rest, t('More channels'))}
    </div>
  )
}

/**
 * One channel: a banner in the colour of the channel with its picture big in the middle, its number and its star, then what is on
 * (with how far along it is) and what comes next. The whole card tunes in (the Watch button covers it); the star stays above that.
 */
function NowCard({ channel: c, now, favorite, onToggle, onWatch }: { channel: ChannelSummary; now: number; favorite: boolean; onToggle: () => void; onWatch: () => void }) {
  const progress = c.now ? Math.min(100, Math.max(0, ((now - c.now.start) / (c.now.end - c.now.start)) * 100)) : 0
  const minutesLeft = c.now ? Math.max(1, Math.ceil((c.now.end - now) / 60)) : 0
  return (
    <li className={`group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[.04] transition duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[.07] hover:shadow-[0_14px_34px_-18px_rgba(0,0,0,0.9)] focus-within:border-white/30 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${c.now ? '' : 'opacity-80'}`}>
      <div
        className="relative flex h-28 items-center justify-center overflow-hidden border-b sm:h-32 border-white/5"
        style={{ background: `radial-gradient(110% 100% at 50% 0%, color-mix(in srgb, ${c.color} 46%, transparent), transparent 72%), linear-gradient(180deg, rgba(255,255,255,.03), rgba(0,0,0,.18))` }}
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="absolute h-40 w-40 rounded-full border border-white/[.07]" />
          <span className="absolute h-60 w-60 rounded-full border border-white/[.04]" />
        </span>
        <span aria-hidden="true" className="absolute left-3 top-3 rounded-md bg-black/45 px-2 py-0.5 text-[11px] font-bold tabular-nums tracking-wide text-white ring-1 ring-white/10 backdrop-blur-sm">
          CH {c.number}
        </span>
        <div className="absolute right-2.5 top-2.5 z-10">
          <FavoriteStar name={c.name} on={favorite} onToggle={onToggle} className="bg-black/40 ring-1 ring-white/10 backdrop-blur-sm" />
        </div>
        <ChannelLogo channel={c} round="rounded-2xl" badge={false} className="h-20 w-20 text-3xl sm:h-[5.5rem] sm:w-[5.5rem] shadow-[0_10px_28px_-8px_rgba(0,0,0,0.8)] ring-1 ring-white/15 transition duration-200 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <h3 className="line-clamp-2 min-h-[2.5rem] break-words text-[15px] font-semibold leading-tight text-white">{c.name}</h3>
        {c.now ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-red-300">
              <span aria-hidden="true" className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              {t('On now')}
            </div>
            <p className="line-clamp-2 break-words text-sm font-medium leading-snug text-neutral-100">{programTitle(c.now)}</p>
            {c.now.subtitle && <p className="line-clamp-1 text-xs text-neutral-400">{c.now.subtitle}</p>}
            <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${progress}%` }} />
            </div>
            <p className="flex justify-between gap-2 text-xs tabular-nums text-neutral-500">
              <span>
                {timeOf(c.now.start)} – {timeOf(c.now.end)}
              </span>
              <span>{t('{minutes} min left', { minutes: minutesLeft })}</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t('Nothing on right now.')}</p>
        )}
        {c.next && (
          <p className="line-clamp-2 text-xs leading-snug text-neutral-400">
            {t('Next at {time}: {title}', { time: timeOf(c.next.start), title: programTitle(c.next) })}
          </p>
        )}
        <button
          type="button"
          disabled={!c.now}
          onClick={onWatch}
          aria-label={t('Watch channel {name}', { name: c.name })}
          className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[.06] px-4 py-2 text-sm font-semibold text-white transition after:absolute after:inset-0 after:content-[''] group-hover:border-transparent group-hover:bg-[var(--color-accent-strong)] group-focus-within:border-transparent group-focus-within:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50 disabled:group-hover:bg-white/[.06] motion-reduce:transition-none"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />
          </svg>
          {t('Watch')}
        </button>
      </div>
    </li>
  )
}
