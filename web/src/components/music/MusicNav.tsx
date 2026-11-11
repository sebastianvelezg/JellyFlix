import type { ReactNode } from 'react'
import type { MusicTab } from '../route'
import { t, tr } from '../../i18n'
import { HomeIcon } from '../icons'

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

const AlbumsIcon = () => (
  <Svg>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r=".6" fill="currentColor" />
  </Svg>
)
const ArtistsIcon = () => (
  <Svg>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.5 20c.9-3.6 3.8-5.6 7.5-5.6s6.6 2 7.5 5.6" />
  </Svg>
)
const SongsIcon = () => (
  <Svg>
    <path d="M4 7h11M4 12h11M4 17h6" />
    <path d="M19 15.5V6l-3 1" />
    <circle cx="17" cy="16.5" r="2" />
  </Svg>
)

const TABS: Array<[MusicTab, string, () => ReactNode]> = [
  ['home', tr('Home'), () => <HomeIcon />],
  ['albums', tr('Albums'), () => <AlbumsIcon />],
  ['artists', tr('Artists'), () => <ArtistsIcon />],
  ['songs', tr('Songs'), () => <SongsIcon />],
]

/**
 * The sections of the music page. On a wide screen they are the list of the side column (with a picture each); on a narrow one the
 * same buttons are a row of pills above the page.
 */
export function MusicNav({ tab, onTab }: { tab: MusicTab; onTab: (tab: MusicTab) => void }) {
  return (
    <nav aria-label={t('Music sections')} className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
      {TABS.map(([id, label, icon]) => {
        const current = id === tab
        return (
          <button
            key={id}
            type="button"
            aria-current={current ? 'page' : undefined}
            onClick={() => onTab(id)}
            className={`group flex shrink-0 items-center gap-3 rounded-full border px-4 py-1.5 text-sm font-medium transition pointer-coarse:py-3 lg:rounded-xl lg:border-transparent lg:px-3 lg:py-2.5 ${
              current
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white'
                : 'border-white/10 bg-white/[.04] text-neutral-300 hover:border-white/25 hover:text-white lg:bg-transparent lg:text-neutral-400 lg:hover:bg-white/[.06]'
            }`}
          >
            <span className={`hidden lg:block ${current ? 'text-[var(--color-accent)]' : 'text-neutral-500 group-hover:text-neutral-200'}`}>{icon()}</span>
            {t(label)}
          </button>
        )
      })}
    </nav>
  )
}
