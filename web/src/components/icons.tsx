import type { ReactNode, SVGProps } from 'react'
import logo from '../assets/logo.png'
import wordmark from '../assets/wordmark.png'

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const PlayIcon = () => (
  <Icon fill="currentColor" stroke="none">
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
  </Icon>
)
export const PhoneIcon = () => (
  <Icon>
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </Icon>
)
export const ComputerIcon = () => (
  <Icon>
    <rect x="4" y="5" width="16" height="11" rx="1.5" />
    <path d="M2 20h20" />
  </Icon>
)
/** The icon of a device in the "Play on…" list: a TV, a phone or a computer. */
export const DeviceIcon = ({ kind }: { kind: 'tv' | 'phone' | 'computer' }) =>
  kind === 'phone' ? <PhoneIcon /> : kind === 'computer' ? <ComputerIcon /> : <TvIcon />
export const TvIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Icon>
)
export const PauseIcon = () => (
  <Icon fill="currentColor" stroke="none">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </Icon>
)
export const BackIcon = () => (
  <Icon>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
)
export const Rewind10Icon = () => (
  <Icon>
    <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
    <text x="8.5" y="15.5" fontSize="7" fill="currentColor" stroke="none" fontWeight="700">10</text>
  </Icon>
)
export const Forward10Icon = () => (
  <Icon>
    <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
    <text x="8.5" y="15.5" fontSize="7" fill="currentColor" stroke="none" fontWeight="700">10</text>
  </Icon>
)
export const VolumeIcon = () => (
  <Icon>
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </Icon>
)
export const MuteIcon = () => (
  <Icon>
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="m16 9 5 6M21 9l-5 6" />
  </Icon>
)
export const FullscreenIcon = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
)
export const ExitFullscreenIcon = () => (
  <Icon>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </Icon>
)

export const SearchIcon = () => (
  <Icon width={18} height={18}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
)
export const CloseIcon = () => (
  <Icon width={18} height={18}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
)
export const HeartIcon = ({ filled = false }: { filled?: boolean }) => (
  <Icon width={20} height={20} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20s-7-4.4-9.2-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.2 5c-2.2 4.6-9.2 9-9.2 9z" />
  </Icon>
)
export const CheckIcon = () => (
  <Icon width={20} height={20}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
)
export const InfoIcon = () => (
  <Icon width={18} height={18}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
)
export const StarIcon = () => (
  <Icon width={14} height={14} fill="currentColor" stroke="none">
    <path d="m12 2.8 2.8 5.9 6.4.9-4.6 4.5 1.1 6.4L12 17.4 6.3 20.5l1.1-6.4L2.8 9.6l6.4-.9z" />
  </Icon>
)
export const SettingsIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
)
export const ChevronLeftIcon = () => (
  <Icon width={20} height={20}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
)
export const ChevronRightIcon = () => (
  <Icon width={20} height={20}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
)
export const RestartIcon = () => (
  <Icon width={18} height={18}>
    <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
  </Icon>
)

export const ShuffleIcon = () => (
  <Icon width={18} height={18}>
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </Icon>
)

/** The app mark: the Jellyflix jellyfish, with its own glow. */
export const LogoMark = ({ size = 28 }: { size?: number }) => (
  <img src={logo} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
)

/** The word "Jellyflix". [height] is in pixels; the width follows. */
export const Wordmark = ({ height = 22 }: { height?: number }) => (
  <img src={wordmark} height={height} style={{ height, width: 'auto' }} alt="Jellyflix" draggable={false} />
)

export const PlusIcon = () => (
  <Icon width={20} height={20}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const NextEpisodeIcon = () => (
  <Icon fill="currentColor" stroke="none">
    <path d="M5 5.2v13.6a.9.9 0 0 0 1.4.75l9-6.8a.9.9 0 0 0 0-1.5l-9-6.8A.9.9 0 0 0 5 5.2z" />
    <rect x="17" y="5" width="2.4" height="14" rx="1.1" />
  </Icon>
)

export const PictureInPictureIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
  </Icon>
)

export const SkipIcon = () => (
  <Icon width={18} height={18} fill="currentColor" stroke="none">
    <path d="M4 5.2v13.6a.9.9 0 0 0 1.4.75l8-6.8a.9.9 0 0 0 0-1.5l-8-6.8A.9.9 0 0 0 4 5.2z" />
    <path d="M13 5.2v13.6a.9.9 0 0 0 1.4.75l8-6.8a.9.9 0 0 0 0-1.5l-8-6.8A.9.9 0 0 0 13 5.2z" />
  </Icon>
)

export const MusicIcon = () => (
  <Icon>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" fill="currentColor" stroke="none" />
    <circle cx="17" cy="16" r="3" fill="currentColor" stroke="none" />
  </Icon>
)

export const SkipPreviousIcon = () => (
  <Icon fill="currentColor" stroke="none">
    <rect x="4.6" y="5" width="2.4" height="14" rx="1.1" />
    <path d="M19 5.2v13.6a.9.9 0 0 1-1.4.75l-9-6.8a.9.9 0 0 1 0-1.5l9-6.8A.9.9 0 0 1 19 5.2z" />
  </Icon>
)

export const SkipNextIcon = NextEpisodeIcon

export const RepeatIcon = () => (
  <Icon width={20} height={20}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </Icon>
)

export const RepeatOneIcon = () => (
  <Icon width={20} height={20}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <path d="M11 10h1v4" strokeWidth="1.8" />
  </Icon>
)

export const LyricsIcon = () => (
  <Icon width={20} height={20}>
    <path d="M4 6h16M4 11h10M4 16h16M4 21h7" />
  </Icon>
)
export const QueueIcon = () => (
  <Icon width={20} height={20}>
    <path d="M3 6h13M3 12h13M3 18h8" />
    <path d="m17 14 5 3-5 3z" fill="currentColor" stroke="none" />
  </Icon>
)

export const ChevronDownIcon = () => (
  <Icon width={20} height={20}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const ShuffleSongsIcon = () => (
  <Icon width={20} height={20}>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="M15 15l6 6" />
    <path d="M4 4l5 5" />
  </Icon>
)
export const RefreshIcon = () => (
  <Icon>
    <path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8" />
    <path d="M18.5 2v3.8h-3.8M5.5 22v-3.8h3.8" />
  </Icon>
)
export const HomeIcon = () => (
  <Icon>
    <path d="m3 11 9-7.5 9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M10 20v-5.5h4V20" />
  </Icon>
)

export const FilmIcon = () => (
  <Icon>
    <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
    <path d="M8 4v16M16 4v16M3.5 9h4.5M3.5 15h4.5M16 9h4.5M16 15h4.5" />
  </Icon>
)

export const AnimeIcon = () => (
  <Icon>
    <path d="M12 3.5 14 9l5.5 2-5.5 2-2 5.5L10 13l-5.5-2L10 9z" />
    <path d="M19 3.5v3M17.5 5h3" />
  </Icon>
)

/** A screen with a note on it: music videos. */
export const MusicVideoIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M11 15.2V9.4l4-.9v5.4" />
    <circle cx="9.6" cy="15.2" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="13.6" cy="14.3" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
)

/** An open book: books and audiobooks. */
export const BookIcon = () => (
  <Icon>
    <path d="M12 6.5C10.4 5.2 8.2 4.5 4.5 4.5v13c3.7 0 5.9.7 7.5 2 1.6-1.3 3.8-2 7.5-2v-13c-3.7 0-5.9.7-7.5 2z" />
    <path d="M12 6.5v13" />
  </Icon>
)
/** A television with an aerial: live TV. */
export const LiveTvIcon = () => (
  <Icon>
    <rect x="3" y="8" width="18" height="12" rx="2.5" />
    <path d="m8 3.5 4 4.5 4-4.5" />
  </Icon>
)

export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </Icon>
)

export const HeadphonesIcon = () => (
  <Icon>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="3.5" y="14" width="4" height="6" rx="1.5" fill="currentColor" stroke="none" />
    <rect x="16.5" y="14" width="4" height="6" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
)

export const PencilIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
    <path d="m14 8 3 3" />
  </Icon>
)
