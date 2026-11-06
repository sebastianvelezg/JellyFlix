import { useEffect, useRef, useState } from 'react'
import { channelWindow, liveTime, type ChannelWindow, type Program } from '../../../core/modules'
import { t } from '../../../i18n'
import { useModulesClient } from '../ModulesProvider'

const clock = (seconds: number): string => new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** How many programs the panel asks for beyond the live one (the viewer can look about three hours ahead on a channel of films). */
const AHEAD = 12
const BEHIND = 3

/**
 * The guide of the channel being watched, over the picture: what was on, what is on and what comes next, with the times. A program
 * can be picked (the live one takes the viewer back to live, another starts from its beginning). The guide of all the channels is
 * one step away, in "All channels", which leaves the player.
 */
export function ChannelGuidePanel({
  channelId,
  channel,
  programs,
  viewing,
  skew,
  onPick,
  onLoaded,
  onAllChannels,
  onClose,
}: {
  channelId: string
  channel: ChannelWindow['channel']
  programs: Program[]
  /** The start of the program the viewer is in. */
  viewing: number | undefined
  skew: number
  onPick: (program: Program) => void
  /** More programs arrived. */
  onLoaded: (window: ChannelWindow) => void
  onAllChannels: () => void
  onClose: () => void
}) {
  const { client } = useModulesClient()
  // The moment is looked at again every so often, so the "live" mark moves on while the panel is open.
  const [live, setLive] = useState(() => liveTime(skew, Date.now()))
  useEffect(() => {
    const timer = window.setInterval(() => setLive(liveTime(skew, Date.now())), 15_000)
    return () => window.clearInterval(timer)
  }, [skew])
  const list = useRef<HTMLOListElement>(null)

  // A longer look ahead than the player keeps, asked for when the panel opens.
  useEffect(() => {
    let cancelled = false
    channelWindow(client, channelId, { before: BEHIND, after: AHEAD })
      .then((win) => {
        if (!cancelled) onLoaded(win)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client, channelId, onLoaded])

  // The live program is brought into view.
  useEffect(() => {
    list.current?.querySelector('[data-live="true"]')?.scrollIntoView({ block: 'center' })
  }, [programs.length])

  const liveStart = programs.find((p) => p.start <= live && live < p.end)?.start
  const shown = programs.filter((p) => liveStart === undefined || p.start >= liveStart - 3 * 3600).slice(-(BEHIND + AHEAD + 2))

  return (
    <aside
      role="dialog"
      aria-label={t('Guide of {channel}', { channel: channel.name })}
      className="fixed inset-x-3 bottom-3 top-14 z-[60] flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-black/80 shadow-2xl backdrop-blur-md sm:inset-x-auto sm:bottom-[11rem] sm:right-6 sm:top-auto sm:max-h-[min(55vh,calc(100vh-12.5rem))] sm:w-96"
    >
      <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span aria-hidden="true" className="flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-sm font-black tabular-nums text-white" style={{ background: channel.color }}>
          {channel.number}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{channel.name}</h2>
        <button type="button" className="rounded-full px-2.5 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white" onClick={onAllChannels}>
          {t('All channels')}
        </button>
        <button type="button" className="rounded-full px-2 py-1 text-white/80 hover:bg-white/10 hover:text-white" aria-label={t('Close the guide')} onClick={onClose}>
          ✕
        </button>
      </header>
      <ol ref={list} className="min-h-0 flex-1 overflow-y-auto py-1">
        {shown.map((p) => {
          const isLive = p.start === liveStart
          const past = p.end <= live
          const isViewing = p.start === viewing
          return (
            <li key={p.start}>
              <button
                type="button"
                data-live={isLive}
                aria-current={isViewing ? 'true' : undefined}
                onClick={() => onPick(p)}
                className={`flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-white/8 focus-visible:bg-white/10 focus-visible:outline-none ${isViewing ? 'bg-white/10' : ''} ${past ? 'opacity-60' : ''}`}
              >
                <span className="w-[4.5rem] shrink-0 whitespace-nowrap pt-0.5 text-xs tabular-nums text-white/60">{clock(p.start)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{p.title}</span>
                  {p.subtitle && <span className="block truncate text-xs text-white/60">{p.subtitle}</span>}
                </span>
                {isLive && <span className="mt-0.5 shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{t('Live')}</span>}
                {isViewing && !isLive && <span className="mt-0.5 shrink-0 text-xs text-[var(--color-accent)]">{t('Watching')}</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
