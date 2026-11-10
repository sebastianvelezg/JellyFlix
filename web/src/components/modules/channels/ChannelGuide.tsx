import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { channelGuide, liveTime, type Guide, type GuideChannel, type Program } from '../../../core/modules'
import { t } from '../../../i18n'
import { errorText } from '../../useAsync'
import { useModulesClient } from '../ModulesProvider'
import { ChannelLogo, FavoriteStar, type Favorites } from './ChannelBits'
import {
  CHUNK_SECONDS,
  clampNameWidth,
  DEFAULT_ZOOM,
  favouritesFirst,
  joinGuide,
  markStep,
  MAX_SPAN_SECONDS,
  NAME_DEFAULT,
  NAME_MAX,
  NAME_MIN,
  NAME_STEP,
  readSetting,
  startsNewDay,
  stepZoom,
  writeSetting,
} from './guideLayout'
import { programTitle } from './programText'

const BEFORE_SECONDS = 1800
const REFRESH_MS = 5 * 60_000
const TICK_MS = 30_000
const ZOOM_KEY = 'jellyflix.guide.zoom'
const NAME_KEY = 'jellyflix.guide.nameWidth'
/** More of the guide is asked for when the person is this close (pixels) to the end of what is loaded. */
const NEAR_END_PX = 700

const clock = (seconds: number): string => new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayAndClock = (seconds: number): string => `${new Date(seconds * 1000).toLocaleDateString([], { weekday: 'short' })} ${clock(seconds)}`

/**
 * The guide of all the channels. It starts a little before now and goes on as far as the person scrolls (about two days; the
 * container shows that much), asking for it six hours at a time. The names column and the time ruler stay in view while the rest
 * scrolls; the names column can be dragged wider (long names), the time scale zoomed, and favourites are always first.
 */
export function ChannelGuide({ onWatch, favorites }: { onWatch: (id: string) => void; favorites: Favorites }) {
  const { client, skew } = useModulesClient()
  const [guide, setGuide] = useState<Guide | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [zoom, setZoom] = useState(() => readSetting(ZOOM_KEY, DEFAULT_ZOOM))
  const [nameWidth, setNameWidth] = useState(() => clampNameWidth(readSetting(NAME_KEY, NAME_DEFAULT)))
  const [now, setNow] = useState(() => Math.floor(liveTime(skew, Date.now())))
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef<Guide | null>(null)
  const asking = useRef(false)
  const keepLeft = useRef<number | null>(null)
  const drag = useRef<{ x: number; width: number } | null>(null)

  useEffect(() => {
    latest.current = guide
  }, [guide])

  // The first look: from a little before now to six hours ahead.
  useEffect(() => {
    let cancelled = false
    const start = Math.floor(liveTime(skew, Date.now()))
    channelGuide(client, start - BEFORE_SECONDS, start + CHUNK_SECONDS)
      .then((g) => {
        if (!cancelled) setGuide(g)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e))
      })
    return () => {
      cancelled = true
    }
  }, [client, skew])

  // What is loaded is asked for again every few minutes (the schedule can change), and the "now" line moves on.
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Math.floor(liveTime(skew, Date.now()))), TICK_MS)
    const refresh = window.setInterval(() => {
      const g = latest.current
      if (!g) return
      channelGuide(client, g.from, g.to)
        .then((fresh) => setGuide(fresh))
        .catch(() => undefined)
    }, REFRESH_MS)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(refresh)
    }
  }, [client, skew])

  const loadMore = useCallback(async () => {
    const g = latest.current
    if (!g || asking.current || g.to >= g.from + MAX_SPAN_SECONDS - 60) return
    asking.current = true
    setMore(true)
    try {
      const piece = await channelGuide(client, g.to, Math.min(g.to + CHUNK_SECONDS, g.from + MAX_SPAN_SECONDS))
      setGuide((before) => (before ? joinGuide(before, piece) : piece))
    } catch (e) {
      setError(errorText(e))
    } finally {
      asking.current = false
      setMore(false)
    }
  }, [client])

  const nearEnd = useCallback(() => {
    const el = box.current
    return !!el && el.scrollLeft + el.clientWidth > el.scrollWidth - NEAR_END_PX
  }, [])

  // On a wide screen, or when zoomed out, what is loaded may not fill the view: more is asked for until it does.
  useEffect(() => {
    if (guide && nearEnd()) void loadMore()
  }, [guide, zoom, nameWidth, loadMore, nearEnd])

  // Zooming keeps the same moment at the left edge.
  useLayoutEffect(() => {
    if (keepLeft.current !== null && box.current) {
      box.current.scrollLeft = keepLeft.current
      keepLeft.current = null
    }
  }, [zoom])

  const from = guide ? Math.floor(guide.from / 1800) * 1800 : 0
  const to = guide?.to ?? 0
  const x = useCallback((seconds: number) => ((seconds - from) / 3600) * zoom, [from, zoom])
  const width = guide ? x(to) : 0

  function changeZoom(direction: 1 | -1) {
    const next = stepZoom(zoom, direction)
    if (next === zoom) return
    const el = box.current
    if (el) keepLeft.current = (el.scrollLeft / zoom) * next
    setZoom(next)
    writeSetting(ZOOM_KEY, next)
  }

  function goToNow() {
    const el = box.current
    if (el) el.scrollTo({ left: Math.max(0, x(now) - el.clientWidth * 0.2), behavior: 'smooth' })
  }

  const resizeTo = (px: number) => {
    const next = clampNameWidth(px)
    setNameWidth(next)
    return next
  }

  const channels = useMemo(() => (guide ? favouritesFirst(guide.channels, (id) => favorites.is(id, guide.channels.find((c) => c.id === id)?.favorite)) : []), [guide, favorites])
  const marks: number[] = []
  if (guide) for (let m = Math.ceil(from / markStep(zoom)) * markStep(zoom); m < to; m += markStep(zoom)) marks.push(m)

  if (error && !guide) return <p role="alert" className="py-10 text-center text-red-300">{error}</p>
  if (!guide) return <p role="status" className="py-16 text-center text-neutral-400">{t('Loading…')}</p>

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="btn !py-1.5" onClick={goToNow}>
          {t('Now')}
        </button>
        <div role="group" aria-label={t('Time scale')} className="flex items-center gap-1">
          <button type="button" className="btn !px-3 !py-1.5" aria-label={t('Zoom out')} onClick={() => changeZoom(-1)}>
            −
          </button>
          <button type="button" className="btn !px-3 !py-1.5" aria-label={t('Zoom in')} onClick={() => changeZoom(1)}>
            +
          </button>
        </div>
        <span role="status" className="text-xs text-neutral-500">
          {more ? t('Loading more of the guide…') : error ? error : t('Scroll right to see what comes later. Drag the edge of the Channel column to make it wider.')}
        </span>
      </div>

      <div ref={box} role="region" aria-label={t('Channel guide')} tabIndex={0} onScroll={() => nearEnd() && void loadMore()} className="relative max-h-[calc(100dvh-14rem)] min-h-64 overflow-auto rounded-2xl border border-white/10">
        <div style={{ width: nameWidth + width }} className="relative">
          <div className="sticky top-0 z-20 flex border-b border-white/10 bg-[var(--color-bg)] text-xs text-neutral-400">
            <div className="sticky left-0 z-30 shrink-0 bg-[var(--color-bg)] px-3 py-2" style={{ width: nameWidth }}>
              {t('Channel')}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('Resize the channel names')}
                aria-valuemin={NAME_MIN}
                aria-valuemax={NAME_MAX}
                aria-valuenow={nameWidth}
                tabIndex={0}
                title={t('Drag to change the width (double click for the usual one)')}
                className="absolute inset-y-0 right-0 w-2.5 cursor-col-resize touch-none border-r border-white/20 hover:border-white/60 hover:bg-white/10 focus-visible:border-white focus-visible:bg-white/20 focus-visible:outline-none"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  drag.current = { x: e.clientX, width: nameWidth }
                }}
                onPointerMove={(e) => {
                  if (drag.current) resizeTo(drag.current.width + e.clientX - drag.current.x)
                }}
                onPointerUp={(e) => {
                  if (drag.current) writeSetting(NAME_KEY, clampNameWidth(drag.current.width + e.clientX - drag.current.x))
                  drag.current = null
                }}
                onPointerCancel={() => {
                  drag.current = null
                }}
                onDoubleClick={() => writeSetting(NAME_KEY, resizeTo(NAME_DEFAULT))}
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowRight' ? NAME_STEP : e.key === 'ArrowLeft' ? -NAME_STEP : 0
                  if (step) {
                    e.preventDefault()
                    writeSetting(NAME_KEY, resizeTo(nameWidth + step))
                  }
                }}
              />
            </div>
            <div className="relative h-8" style={{ width }}>
              {marks.map((m, i) => {
                const first = i === 0 || startsNewDay((marks[i - 1] as number) ?? m, m)
                return (
                  <span key={m} className={`absolute top-2 whitespace-nowrap border-l pl-1.5 ${first ? 'border-white/40 font-semibold text-neutral-200' : 'border-white/10'}`} style={{ left: x(m) }}>
                    {first ? dayAndClock(m) : clock(m)}
                  </span>
                )
              })}
            </div>
          </div>

          {channels.map((c) => (
            <GuideRow key={c.id} channel={c} from={from} width={width} nameWidth={nameWidth} x={x} now={now} favorite={favorites.is(c.id, c.favorite)} onFavorite={() => favorites.toggle(c.id, favorites.is(c.id, c.favorite))} onWatch={onWatch} />
          ))}
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-8 z-[5] w-px bg-red-500/80" style={{ left: nameWidth + x(now) }} />
        </div>
      </div>
    </div>
  )
}

function GuideRow({
  channel,
  from,
  width,
  nameWidth,
  x,
  now,
  favorite,
  onFavorite,
  onWatch,
}: {
  channel: GuideChannel
  from: number
  width: number
  nameWidth: number
  x: (seconds: number) => number
  now: number
  favorite: boolean
  onFavorite: () => void
  onWatch: (id: string) => void
}) {
  return (
    <div className="flex border-b border-white/5 last:border-b-0">
      <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-[var(--color-bg)] pl-2 pr-1" style={{ width: nameWidth }}>
        <button type="button" onClick={() => onWatch(channel.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 text-left hover:bg-white/5">
          <ChannelLogo channel={channel} className="h-8 w-8 text-sm" />
          <span className="sr-only">{t('Watch channel {name}', { name: channel.name })}</span>
          <span aria-hidden="true" className="line-clamp-2 min-w-0 break-words text-sm leading-tight text-neutral-100">
            {channel.name}
          </span>
        </button>
        <FavoriteStar name={channel.name} on={favorite} onToggle={onFavorite} />
      </div>
      <div className="relative h-14" style={{ width }}>
        {channel.programs.map((p: Program) => {
          const left = Math.max(0, x(Math.max(p.start, from)))
          const right = Math.min(width, x(p.end))
          const onNow = p.start <= now && now < p.end
          return (
            <button
              key={p.start}
              type="button"
              disabled={!onNow}
              onClick={() => onNow && onWatch(channel.id)}
              title={`${programTitle(p)}${p.subtitle ? ` · ${p.subtitle}` : ''} (${clock(p.start)} – ${clock(p.end)})`}
              className={`absolute top-1 h-12 overflow-hidden rounded-lg border px-2 py-1 text-left text-xs ${onNow ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white hover:bg-[var(--color-accent)]/30' : 'border-white/10 bg-white/[.04] text-neutral-300'}`}
              style={{ left: left + 2, width: Math.max(0, right - left - 4) }}
            >
              <span className="block truncate font-medium">{programTitle(p)}</span>
              <span className="block truncate text-neutral-400">{p.subtitle ?? `${clock(p.start)} – ${clock(p.end)}`}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
