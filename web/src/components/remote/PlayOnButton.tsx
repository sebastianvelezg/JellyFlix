import { useEffect, useRef, useState } from 'react'
import type { RemoteDevice } from '../../core'
import { DeviceIcon, TvIcon } from '../icons'
import { useRemote } from './RemoteProvider'
import { t } from '../../i18n'

/**
 * "Play on…": a button with a short list of the devices that can be controlled (the TV app, this web app open on a phone or another
 * computer). It starts [itemId] on the one you pick, or, with [current], hands over whatever is playing here (same place, same song) and
 * stops it here. It does nothing at all (and shows nothing) where there is no remote-control provider.
 */
export function PlayOnButton({
  itemId,
  current = false,
  compact = false,
  up = false,
  className,
  onOpenChange,
}: {
  itemId?: string
  /** Send what is playing on this device, instead of starting [itemId]. */
  current?: boolean
  compact?: boolean
  up?: boolean
  className?: string
  /** Told when the list opens or closes (a player keeps its controls on screen while it is open). */
  onOpenChange?: (open: boolean) => void
}) {
  const remote = useRemote()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onOpenChange?.(open)
    return () => onOpenChange?.(false)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (!remote) return null
  const { devices, refresh, playOn, sendCurrent } = remote

  async function choose(device: RemoteDevice) {
    setBusy(true)
    setError(null)
    try {
      if (current) await sendCurrent(device)
      else if (itemId) await playOn(device, itemId)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Something went wrong.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        className={
          className ??
          (compact
            ? 'mt-1 flex h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 shrink-0 items-center justify-center self-start rounded-full border border-white/10 text-neutral-500 transition hover:border-white/30 hover:text-white'
            : 'btn py-3')
        }
        aria-label={compact || className ? t('Play on…') : undefined}
        title={compact || className ? t('Play on…') : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          setError(null)
          void refresh()
        }}
      >
        <TvIcon /> {!compact && !className && t('Play on…')}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('Play on')}
          className={`absolute z-30 w-72 max-w-[calc(100vw-2rem)] ${up ? 'bottom-full mb-2' : 'top-full mt-2'} ${compact || className ? 'right-0' : 'left-0'} rounded-2xl border border-white/10 bg-neutral-950 p-2 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]`}
        >
          {devices === null && <p className="px-3 py-2 text-sm text-neutral-400">{t('Looking for devices…')}</p>}
          {devices?.length === 0 && (
            <p className="px-3 py-2 text-sm text-neutral-400">
              {t('No other device found. Open Jellyflix (or another Jellyfin app) on the device you want to use and try again.')}
            </p>
          )}
          {devices?.map((device) => (
            <button
              key={device.id}
              type="button"
              role="menuitem"
              disabled={busy}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-neutral-100 hover:bg-white/10 focus-visible:bg-white/10 disabled:opacity-60"
              onClick={() => void choose(device)}
            >
              <DeviceIcon kind={device.kind} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{device.name}</span>
                <span className="block truncate text-xs text-neutral-400">{device.nowPlaying ? device.nowPlaying.title : device.client}</span>
              </span>
            </button>
          ))}
          {error && (
            <p role="alert" className="alert-error m-2">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
