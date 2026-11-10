import { useCallback, useEffect, useMemo, useState } from 'react'
import { channelPicture, setChannelFavorite } from '../../../core/modules'
import { t } from '../../../i18n'
import { errorText } from '../../useAsync'
import { useModulesClient } from '../ModulesProvider'

/**
 * The tile of a channel: its picture when it has one (with its number in a corner, so it is always known), else its colour with the
 * number. Decorative: the name of the channel is always written next to it.
 */
export function ChannelLogo({
  channel,
  className = 'h-11 w-11 text-lg',
  preview,
}: {
  channel: { id: string; number: number; color: string; imageVersion?: number }
  className?: string
  /** A picture that is not saved yet (an address of its own), shown instead of the saved one. */
  preview?: string | null
}) {
  const { client } = useModulesClient()
  const version = channel.imageVersion
  const key = version ? `${channel.id}|${version}` : ''
  const [loaded, setLoaded] = useState<{ key: string; src: string } | null>(null)

  useEffect(() => {
    if (!version || preview) return
    let cancelled = false
    channelPicture(client, channel.id, version)
      .then((src) => {
        if (!cancelled) setLoaded({ key: `${channel.id}|${version}`, src })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client, channel.id, version, preview])

  const src = preview ?? (loaded && loaded.key === key ? loaded.src : null)
  if (!src) {
    return (
      <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-xl font-black tabular-nums text-white ${className}`} style={{ background: channel.color }}>
        {channel.number}
      </span>
    )
  }
  return (
    <span aria-hidden="true" className={`relative shrink-0 ${className}`}>
      <img src={src} alt="" decoding="async" className="h-full w-full rounded-xl bg-white/5 object-cover" />
      <span aria-hidden="true" className="absolute -bottom-1 -right-1 min-w-[1.25rem] rounded-md px-1 text-center text-[10px] font-black leading-4 tabular-nums text-white ring-1 ring-black/60" style={{ background: channel.color }}>
        {channel.number}
      </span>
    </span>
  )
}

/** The star that keeps a channel first. */
export function FavoriteStar({ name, on, onToggle, className = '' }: { name: string; on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t('Remove {name} from favourites', { name }) : t('Add {name} to favourites', { name })}
      title={on ? t('Remove from favourites') : t('Keep first (favourite)')}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={`shrink-0 rounded-full p-1.5 transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white ${on ? 'text-amber-300' : 'text-neutral-500 hover:text-neutral-200'} ${className}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 2.8 2.8 5.9 6.4.9-4.6 4.5 1.1 6.4L12 17.4 6.3 20.5l1.1-6.4L2.8 9.6l6.4-.9z" />
      </svg>
    </button>
  )
}

export interface Favorites {
  /** Whether the channel is a favourite: what the person just did counts over what the container last said (`flag`). */
  is: (id: string, flag?: boolean) => boolean
  toggle: (id: string, current: boolean) => void
  /** Go back to what the container says (after it was asked again). */
  reset: () => void
}

/** The favourites of the person looking: a change shows at once and is sent to the container, and is taken back if it fails. */
export function useFavorites(onError: (message: string) => void): Favorites {
  const { client } = useModulesClient()
  const [changed, setChanged] = useState<Record<string, boolean>>({})
  const is = useCallback((id: string, flag?: boolean) => changed[id] ?? !!flag, [changed])
  const toggle = useCallback(
    (id: string, current: boolean) => {
      setChanged((c) => ({ ...c, [id]: !current }))
      setChannelFavorite(client, id, !current).catch((e: unknown) => {
        setChanged((c) => ({ ...c, [id]: current }))
        onError(errorText(e))
      })
    },
    [client, onError],
  )
  const reset = useCallback(() => setChanged({}), [])
  return useMemo(() => ({ is, toggle, reset }), [is, toggle, reset])
}
