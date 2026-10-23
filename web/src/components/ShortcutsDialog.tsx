import { useEffect, useRef, type ReactNode } from 'react'
import { t } from '../i18n'

const OPEN_EVENT = 'jellyflix:shortcuts'

/** Opens the list of keyboard shortcuts (the "?" key does the same). */
export function openShortcuts(): void {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

/** Each entry: the keys, and what they do. */
const GROUPS: Array<{ title: string; items: Array<[string[], string]> }> = [
  {
    title: 'Anywhere',
    items: [
      [['/'], 'Search'],
      [['?'], 'Show this list'],
    ],
  },
  {
    title: 'While watching',
    items: [
      [['Space', 'K'], 'Play or pause'],
      [['←', 'J'], 'Back 10 seconds'],
      [['→', 'L'], 'Forward 10 seconds'],
      [['↑', '↓'], 'Volume'],
      [['0', '…', '9'], 'Jump to 0% … 90% of the video'],
      [['Home', 'End'], 'Start or end'],
      [['M'], 'Mute'],
      [['F'], 'Full screen'],
      [['C'], 'Subtitles on or off'],
      [['Z', 'X'], 'Show the subtitles earlier or later'],
      [['N'], 'Next episode'],
      [['S'], 'Skip intro, recap or credits'],
      [['P'], 'Picture in picture'],
      [['Esc'], 'Leave the player'],
    ],
  },
]

function Key({ children }: { children: ReactNode }) {
  return <kbd className="min-w-6 rounded-md border border-white/20 bg-white/[.06] px-1.5 py-0.5 text-center text-xs font-medium text-neutral-100">{children}</kbd>
}

/** The shortcuts dialog. Native `<dialog>`: it traps the focus, closes with Esc and gives the focus back. */
export function ShortcutsDialog() {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const open = () => {
      if (dialog.current && !dialog.current.open) dialog.current.showModal()
    }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      // Not while a video is playing: there "?" is not taken, but nothing should open over the picture.
      if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey && !document.querySelector('[data-testid=video]')) {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener(OPEN_EVENT, open)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(OPEN_EVENT, open)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      aria-label={t('Keyboard shortcuts')}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-white/10 bg-[var(--color-surface-2)] p-0 text-neutral-100 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close()
      }}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-white">{t('Keyboard shortcuts')}</h2>
          <button type="button" className="btn" onClick={() => dialog.current?.close()} autoFocus>
            {t('Close')}
          </button>
        </div>
        {GROUPS.map((group) => (
          <section key={group.title} aria-label={t(group.title)} className="mt-5">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">{t(group.title)}</h3>
            <dl className="space-y-2">
              {group.items.map(([keys, what]) => (
                <div key={what} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-neutral-200">{t(what)}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {keys.map((k, i) => (k === '…' ? <span key={i} aria-hidden="true">…</span> : <Key key={i}>{k}</Key>))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  )
}
