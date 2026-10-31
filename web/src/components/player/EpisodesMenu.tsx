import { useEffect, useRef, useState } from 'react'
import { episodeCode, formatRuntime, getEpisodes, getSeasons, ticksToSeconds, type Episode, type Season, type Session } from '../../core'
import { CheckIcon, QueueIcon } from '../icons'
import { t } from '../../i18n'

/** What the button needs to know: who is on, and what to do when another episode is picked. */
export interface EpisodesControl {
  session: Session
  current: Episode
  /** Plays this episode instead of the one on. */
  onPick: (episode: Episode) => void
}

const ROW =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-neutral-100 transition-colors duration-150 hover:bg-white/[.08] focus-visible:bg-white/[.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)] pointer-coarse:py-3.5'

/** The seasons of the series on a row of tabs, and the episodes of the chosen one: change episode without leaving the player. */
export function EpisodesMenu({
  control,
  iconButton,
  onOpenChange,
}: {
  control: EpisodesControl
  iconButton: string
  /** The menu opened or closed; the controls stay on screen while it is open. */
  onOpenChange: (open: boolean) => void
}) {
  const { session, current, onPick } = control
  const [open, setOpen] = useState(false)
  const [seasons, setSeasons] = useState<Season[] | null>(null)
  const [seasonId, setSeasonId] = useState<string | undefined>(current.seasonId)
  const [episodes, setEpisodes] = useState<{ seasonId: string | undefined; list: Episode[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onOpenChange(open)
    return () => onOpenChange(false)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // The seasons are asked for the first time the menu opens.
  useEffect(() => {
    if (!open || seasons) return
    let cancelled = false
    getSeasons(session, current.seriesId)
      .then((found) => {
        if (cancelled) return
        setSeasons(found)
        setSeasonId((now) => now ?? found.find((s) => s.number === current.seasonNumber)?.id ?? found[0]?.id)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, seasons, session, current.seriesId, current.seasonNumber])

  useEffect(() => {
    if (!open || !seasons) return
    let cancelled = false
    getEpisodes(session, current.seriesId, { seasonId })
      .then((list) => {
        if (!cancelled) setEpisodes({ seasonId, list })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, seasons, seasonId, session, current.seriesId])

  // The episode on is in view when the list shows, and it has the focus (so Escape closes the list, not the player).
  const focused = useRef(false)
  useEffect(() => {
    if (!open) {
      focused.current = false
      return
    }
    if (!episodes || focused.current) return
    focused.current = true
    const current = menu.current?.querySelector<HTMLElement>('[aria-current="true"]')
    current?.scrollIntoView({ block: 'nearest' })
    ;(current ?? menu.current?.querySelector<HTMLElement>('[role="tab"], button'))?.focus({ preventScroll: true })
  }, [open, episodes])

  const toggle = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    toggle.current?.focus({ preventScroll: true })
  }

  const shown = episodes && episodes.seasonId === seasonId ? episodes.list : null
  const showTabs = (seasons?.length ?? 0) > 1

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        ref={toggle}
        className={iconButton}
        aria-label={t('Episodes')}
        title={t('Episodes')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <QueueIcon />
      </button>
      {open && (
        <div
          ref={menu}
          role="dialog"
          aria-label={t('Episodes')}
          className="absolute bottom-14 right-0 flex max-h-[min(34rem,70vh)] w-[21rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-surface)]/95 p-1.5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
          }}
        >
          <h3 className="truncate px-3 pb-1 pt-2 text-sm font-semibold text-white">{current.seriesName}</h3>
          {showTabs && (
            <div role="tablist" aria-label={t('Seasons')} className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto px-1.5 pb-2">
              {(seasons ?? []).map((season) => (
                <button
                  key={season.id}
                  type="button"
                  role="tab"
                  aria-selected={season.id === seasonId}
                  onClick={() => setSeasonId(season.id)}
                  className="shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white aria-selected:bg-white aria-selected:text-black"
                >
                  {season.number === 0 ? t('Specials') : (season.number ?? season.name)}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label={t('Episodes')}>
            {failed ? (
              <p role="alert" className="px-3 py-4 text-sm text-neutral-300">
                {t('Could not load the episodes.')}
              </p>
            ) : !shown ? (
              <p role="status" className="px-3 py-4 text-sm text-neutral-400">
                {t('Loading…')}
              </p>
            ) : (
              shown.map((episode) => {
                const isCurrent = episode.id === current.id
                const length = episode.runtimeTicks ? formatRuntime(ticksToSeconds(episode.runtimeTicks)) : ''
                return (
                  <div key={episode.id} role="listitem">
                    <button
                      type="button"
                      aria-current={isCurrent ? 'true' : undefined}
                      className={`${ROW} aria-[current=true]:bg-[var(--color-accent)]/15 aria-[current=true]:text-white`}
                      onClick={() => {
                        if (!isCurrent) onPick(episode)
                        setOpen(false)
                      }}
                    >
                      <span className="w-12 shrink-0 text-xs tabular-nums text-neutral-400">{episodeCode(episode)}</span>
                      <span className="min-w-0 flex-1 break-words">
                        {episode.name}
                        {isCurrent && <span className="sr-only"> ({t('Playing now')})</span>}
                      </span>
                      {length && <span className="shrink-0 text-xs tabular-nums text-neutral-500">{length}</span>}
                      <span className={`shrink-0 text-[var(--color-accent)] ${episode.played ? '' : 'invisible'}`} title={episode.played ? t('Watched') : undefined}>
                        <CheckIcon />
                      </span>
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
