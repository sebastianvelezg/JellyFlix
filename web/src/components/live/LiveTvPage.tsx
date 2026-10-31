import { useEffect, useState } from 'react'
import {
  CHANNEL_CATEGORIES,
  channelLogoUrl,
  CHANNEL_PAGE_SIZE,
  CHANNEL_SEARCH_LIMIT,
  getChannels,
  getGuide,
  guideBlocks,
  guideStart,
  isOnNow,
  matchesChannel,
  programProgress,
  setFavorite,
  splitChannelName,
  type Channel,
  type ChannelCategory,
  type Program,
  type Session,
} from '../../core'
import { readUiPrefs, writeUiPrefs } from '../../platform/web/prefs'
import { HeartIcon, PlayIcon, SearchIcon } from '../icons'
import { Img } from '../Img'
import { ReadProgress } from '../reader/ReaderShell'
import { StateMessage } from '../StateMessage'
import { formatClock, formatDayAndClock } from './time'
import { t } from '../../i18n'

type View = 'channels' | 'guide'

/** How often what is on now is read again, and how long the guide's window is. */
const REFRESH_MS = 120_000
const GUIDE_HOURS = 4
const GUIDE_HOUR_WIDTH_REM = 12
const GUIDE_CHANNELS_AT_A_TIME = 20

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; channels: Channel[]; total: number; category: ChannelCategory }

const CATEGORY_LABELS: Record<ChannelCategory, string> = {
  all: 'All',
  favorites: 'Favorites',
  movies: 'Movies',
  series: 'Series',
  sports: 'Sports',
  news: 'News',
  kids: 'Kids',
}

/** The channels of the account, read a page at a time and read again now and then so that "on now" stays true. */
function useChannels(session: Session, category: ChannelCategory, wanted: number, all: boolean, paused: boolean): { state: Loaded; more: () => void; setFavoriteLocally: (id: string, favorite: boolean) => void } {
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const [pages, setPages] = useState(wanted)
  // Looking for a channel needs all of them, not just the first page.
  const count = all ? CHANNEL_SEARCH_LIMIT : pages
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      getChannels(session, { limit: count, category })
        .then((page) => !cancelled && setState({ status: 'ready', channels: page.channels, total: page.total, category }))
        .catch((e: unknown) => !cancelled && setState((now) => (now.status === 'ready' ? now : { status: 'error', message: e instanceof Error ? t(e.message) : t('The channels could not be read.') })))
    // While a channel is being watched the page stays behind it: it is not worth asking the server again until it is back.
    if (paused) return
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [session, category, count, version, paused])

  return {
    // What was read for another category is not shown under this one while this one loads.
    state: state.status === 'ready' && state.category !== category ? ({ status: 'loading' } as const) : state,
    more: () => setPages((n) => n + CHANNEL_PAGE_SIZE),
    setFavoriteLocally: (id, favorite) => {
      setState((now) => (now.status === 'ready' ? { ...now, channels: now.channels.map((c) => (c.id === id ? { ...c, favorite } : c)) } : now))
      // Favourites only: a channel taken out of the list leaves it.
      if (category === 'favorites' && !favorite) setVersion((v) => v + 1)
    },
  }
}

/** Live TV: the channels with what is on each, and the guide of the next hours. */
export function LiveTvPage({ session, onPlay, paused = false }: { session: Session; onPlay: (channel: Channel) => void; paused?: boolean }) {
  const [view, setView] = useState<View>('channels')
  // The category is kept: the arrows of the player change channel inside it, and the page opens on it next time.
  const [category, setCategoryNow] = useState<ChannelCategory>(() => readUiPrefs().liveCategory)
  const setCategory = (next: ChannelCategory) => {
    writeUiPrefs({ liveCategory: next })
    setCategoryNow(next)
  }
  const [filter, setFilter] = useState('')
  const looking = filter.trim() !== ''
  const { state, more, setFavoriteLocally } = useChannels(session, category, CHANNEL_PAGE_SIZE, looking, paused)
  const matching = state.status === 'ready' ? state.channels.filter((c) => matchesChannel(c, filter)) : []
  // The channel watched last (read each time: the player writes it while this page waits behind it).
  const last = readUiPrefs().lastChannel
  const lastChannel = last ? matching.find((c) => c.id === last.id) : undefined
  // In the guide the last channel comes first, so the guide opens where the viewer was.
  const shown = view === 'guide' && lastChannel ? [lastChannel, ...matching.filter((c) => c.id !== lastChannel.id)] : matching

  const toggleFavorite = (channel: Channel) => {
    const next = !channel.favorite
    setFavoriteLocally(channel.id, next)
    setFavorite(session, channel.id, next).catch(() => setFavoriteLocally(channel.id, !next))
  }

  return (
    <div className="pt-6">
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight sm:mr-auto sm:text-2xl">
          <span aria-hidden="true" className="h-6 w-1 rounded-full bg-[var(--color-accent)]" />
          {t('Live TV')}
        </h1>
        <div role="search" className="relative w-full sm:w-56">
          <label htmlFor="channel-filter" className="sr-only">
            {t('Find a channel')}
          </label>
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">
            <SearchIcon />
          </span>
          <input
            id="channel-filter"
            type="search"
            className="field rounded-full py-2 pl-9 pr-3 pointer-coarse:py-3"
            placeholder={t('Find a channel')}
            autoComplete="off"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div role="group" aria-label={t('View')} className="flex gap-2">
          {(['channels', 'guide'] as const).map((v) => (
            <button key={v} type="button" className="btn" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'channels' ? t('Channels') : t('Guide')}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('Category')} className="flex min-w-0 flex-wrap gap-2">
          {CHANNEL_CATEGORIES.map((c) => (
            <button key={c} type="button" className="btn" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c === 'favorites' && <HeartIcon filled={category === 'favorites'} />}
              {t(CATEGORY_LABELS[c])}
            </button>
          ))}
        </div>
        {last && (
          <button type="button" className="btn ml-auto" onClick={() => onPlay({ id: last.id, name: last.name, favorite: false })}>
            <PlayIcon /> {t('Last watched: {channel}', { channel: splitChannelName(last.name).title })}
          </button>
        )}
      </div>

      {state.status === 'loading' && (
        <p role="status" className="py-24 text-center text-neutral-400">
          {t('Loading the channels…')}
        </p>
      )}
      {state.status === 'error' && <StateMessage kind="error" message={t('Could not load the channels: {message}', { message: state.message })} />}
      {state.status === 'ready' && state.channels.length === 0 && (
        <StateMessage
          kind="empty"
          message={
            category === 'favorites'
              ? t('You have no favorite channels yet. Use the heart on a channel to add one.')
              : category === 'all'
                ? t('This account has no channels. Add a tuner or a channel list in Jellyfin and they will appear here.')
                : t('No channels in this category.')
          }
        />
      )}
      {state.status === 'ready' && state.channels.length > 0 && shown.length === 0 && (
        <StateMessage kind="empty" message={t('No channel matches "{text}".', { text: filter.trim() })} />
      )}
      {state.status === 'ready' && shown.length > 0 && (
        <>
          {view === 'channels' && state.channels.every((c) => !c.now) && (
            <p className="mb-4 max-w-2xl text-sm text-neutral-400">{t('The server has no programme guide for these channels, so only their names are shown.')}</p>
          )}
          {view === 'channels' ? (
            <ChannelGrid session={session} channels={shown} onPlay={onPlay} onFavorite={toggleFavorite} />
          ) : (
            <Guide session={session} channels={shown} lastId={lastChannel?.id} onPlay={onPlay} />
          )}
          {!looking && state.channels.length < state.total && (
            <div className="mt-8 flex justify-center">
              <button type="button" className="btn" onClick={more}>
                {t('Show more channels')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ChannelGrid({ session, channels, onPlay, onFavorite }: { session: Session; channels: Channel[]; onPlay: (channel: Channel) => void; onFavorite: (channel: Channel) => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {channels.map((channel) => {
        const program = channel.now && isOnNow(channel.now, now) ? channel.now : undefined
        const { title, tags } = splitChannelName(channel.name)
        const label = [channel.number, title].filter(Boolean).join(' · ')
        return (
          <li key={channel.id} className="group/channel relative">
            <button
              type="button"
              className="flex h-full w-full flex-col gap-3 rounded-2xl bg-[var(--color-surface-2)] p-3.5 text-left ring-1 ring-white/[.08] transition hover:ring-[var(--color-accent)]/70 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
              aria-label={t('Watch {channel}', { channel: label })}
              onClick={() => onPlay(channel)}
            >
              <span className="flex items-center gap-3">
                <span className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/20">
                  <Img
                    session={session}
                    src={channelLogoUrl(session.serverUrl, channel)}
                    className="h-full w-full object-contain p-1"
                    fallback={<span className="px-1 text-center text-[11px] font-medium text-neutral-400">{channel.name}</span>}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-neutral-100" title={channel.name}>{title}</span>
                  {(channel.number || tags.length > 0) && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-neutral-500">
                      {channel.number && <span>{channel.number}</span>}
                      {tags.map((tag) => (
                        <span key={tag} className="rounded border border-white/10 px-1.5 text-[11px] leading-5 text-neutral-400">
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent-strong)] pl-0.5 text-[var(--color-accent-ink)] opacity-0 transition group-hover/channel:opacity-100 group-focus-within/channel:opacity-100">
                  <PlayIcon />
                </span>
              </span>
              {program ? (
                <span className="block space-y-1.5">
                  <span className="block truncate text-sm text-neutral-200">{program.name}</span>
                  <span className="block text-xs text-neutral-500">
                    {formatClock(program.startMs)} – {formatClock(program.endMs)}
                  </span>
                  <ReadProgress percent={programProgress(program, now) * 100} />
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`absolute right-2.5 top-2.5 rounded-full p-1.5 transition pointer-coarse:p-2.5 ${channel.favorite ? 'text-rose-400' : 'text-neutral-500 opacity-0 hover:text-white focus-visible:opacity-100 group-hover/channel:opacity-100 pointer-coarse:opacity-100'}`}
              aria-pressed={channel.favorite}
              aria-label={channel.favorite ? t('Remove {channel} from favorites', { channel: label }) : t('Add {channel} to favorites', { channel: label })}
              onClick={() => onFavorite(channel)}
            >
              <HeartIcon filled={channel.favorite} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** The guide: a row for each channel and a block for each programme, over the next hours. Choosing a programme shows it; Watch plays its channel. */
function Guide({ session, channels, lastId, onPlay }: { session: Session; channels: Channel[]; lastId?: string; onPlay: (channel: Channel) => void }) {
  const [visible, setVisible] = useState(GUIDE_CHANNELS_AT_A_TIME)
  const [now, setNow] = useState(() => Date.now())
  const [programs, setPrograms] = useState<Map<string, Program[]> | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<{ program: Program; channel: Channel } | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const from = guideStart(now)
  const to = from + GUIDE_HOURS * 3_600_000
  const shown = channels.slice(0, visible)
  const shownIds = shown.map((c) => c.id).join(',')
  useEffect(() => {
    let cancelled = false
    getGuide(session, shownIds ? shownIds.split(',') : [], from, to)
      .then((guide) => {
        if (cancelled) return
        setPrograms(guide)
        setFailed(false)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [session, shownIds, from, to])

  const hours = Array.from({ length: GUIDE_HOURS * 2 }, (_, i) => from + i * 1_800_000)
  const width = `${GUIDE_HOURS * GUIDE_HOUR_WIDTH_REM}rem`
  const nowAt = (now - from) / (to - from)

  return (
    <section aria-label={t('Guide')} className="space-y-4">
      {selected && (
        <div role="region" aria-label={t('Programme')} className="glass max-w-3xl space-y-2 rounded-2xl p-4">
          <p className="text-base font-semibold text-neutral-100">
            {selected.program.name}
            {selected.program.episodeTitle ? <span className="font-normal text-neutral-400"> · {selected.program.episodeTitle}</span> : null}
          </p>
          <p className="text-sm text-neutral-400">
            {selected.channel.name} · {formatDayAndClock(selected.program.startMs, now)} – {formatClock(selected.program.endMs)}
          </p>
          {selected.program.overview && <p className="text-sm text-neutral-300">{selected.program.overview}</p>}
          <button type="button" className="btn-primary" onClick={() => onPlay(selected.channel)}>
            <PlayIcon /> {isOnNow(selected.program, now) ? t('Watch now') : t('Watch the channel')}
          </button>
        </div>
      )}
      {failed && <p role="alert" className="alert-error max-w-xl">{t('The guide could not be read. Try again in a moment.')}</p>}
      {programs && !failed && [...programs.values()].every((list) => list.length === 0) && (
        <p className="max-w-2xl text-sm text-neutral-400">{t('The server has no programme guide for these channels, so only their names are shown.')}</p>
      )}
      <div className="overflow-x-auto rounded-2xl ring-1 ring-white/[.08]">
        <div style={{ minWidth: `calc(${width} + 9rem)` }}>
          <div className="flex border-b border-white/10 text-xs text-neutral-400">
            <div className="sticky left-0 z-10 w-36 shrink-0 bg-[var(--color-bg)] px-3 py-2">{t('Channel')}</div>
            <div className="relative flex" style={{ width }}>
              {hours.map((at) => (
                <div key={at} className="shrink-0 border-l border-white/10 px-2 py-2" style={{ width: `${GUIDE_HOUR_WIDTH_REM / 2}rem` }}>
                  {formatClock(at)}
                </div>
              ))}
            </div>
          </div>
          {shown.map((channel) => {
            const blocks = guideBlocks(programs?.get(channel.id) ?? [], from, to)
            return (
              <div key={channel.id} className="flex border-b border-white/[.06] last:border-b-0">
                <button
                  type="button"
                  className="sticky left-0 z-10 flex w-36 shrink-0 items-center gap-2 bg-[var(--color-bg)] px-3 py-2 text-left text-sm font-medium text-neutral-100 hover:text-[var(--color-accent)]"
                  aria-label={t('Watch {channel}', { channel: channel.name })}
                  onClick={() => onPlay(channel)}
                >
                  {channel.number && <span className="text-xs text-neutral-500">{channel.number}</span>}
                  <span className="truncate" title={channel.name}>{splitChannelName(channel.name).title}</span>
                  {channel.id === lastId && <span className="rounded bg-white/10 px-1.5 text-[10px] uppercase leading-5 tracking-wide text-neutral-300">{t('Last')}</span>}
                </button>
                <div className="relative h-14 shrink-0" style={{ width }} role="list" aria-label={channel.name}>
                  {blocks.map((block) => {
                    const live = isOnNow(block.program, now)
                    return (
                      <button
                        key={block.program.id}
                        type="button"
                        role="listitem"
                        className={`absolute inset-y-1 overflow-hidden rounded-lg px-2 text-left text-xs transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${live ? 'bg-[var(--color-accent)]/25 text-white' : 'bg-white/[.07] text-neutral-300'}`}
                        style={{ left: `calc(${block.left * 100}% + 1px)`, width: `calc(${block.width * 100}% - 2px)` }}
                        aria-label={t('{name}, {start} to {end}', { name: block.program.name, start: formatClock(block.program.startMs), end: formatClock(block.program.endMs) })}
                        onClick={() => setSelected({ program: block.program, channel })}
                      >
                        <span className="block truncate font-medium">{block.cutBefore ? '◂ ' : ''}{block.program.name}</span>
                        <span className="block truncate text-neutral-400">{formatClock(block.program.startMs)}</span>
                      </button>
                    )
                  })}
                  {nowAt >= 0 && nowAt <= 1 && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-500/80" style={{ left: `${nowAt * 100}%` }} />}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {visible < channels.length && (
        <div className="flex justify-center">
          <button type="button" className="btn" onClick={() => setVisible((n) => n + GUIDE_CHANNELS_AT_A_TIME)}>
            {t('Show more channels')}
          </button>
        </div>
      )}
    </section>
  )
}
