import { useState, type CSSProperties, type ReactNode } from 'react'
import { formatTime, hasNext } from '../../core'
import {
  MuteIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleSongsIcon,
  SkipNextIcon,
  SkipPreviousIcon,
  VolumeIcon,
} from '../icons'
import { useMusic, useMusicPosition, useMusicState } from './MusicProvider'
import { t } from '../../i18n'

const round = 'inline-flex items-center justify-center rounded-full transition duration-150 active:scale-90'

function Button({
  label,
  onClick,
  pressed,
  disabled,
  className = '',
  children,
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`${round} ${className} disabled:cursor-not-allowed disabled:opacity-35`}
    >
      {children}
    </button>
  )
}

/** Shuffle, previous, play/pause, next, repeat. `size` picks the roomy layout of the full-screen player. */
export function Transport({ size = 'compact' }: { size?: 'compact' | 'large' }) {
  const music = useMusic()
  const { queue, status, buffering } = useMusicState()
  if (!queue) return null
  const large = size === 'large'
  const playing = status === 'playing'
  const small = `${large ? 'h-11 w-11' : 'h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11'} text-neutral-300 hover:bg-white/10 hover:text-white`
  const mode = (on: boolean) => `${large ? 'h-11 w-11' : 'h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11'} ${on ? 'text-[var(--color-accent)]' : 'text-neutral-400 hover:text-white'} hover:bg-white/10`
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <Button label={t('Shuffle')} pressed={queue.shuffle} onClick={() => music.toggleShuffle()} className={`${mode(queue.shuffle)} ${large ? '' : 'max-sm:hidden'}`}>
        <ShuffleSongsIcon />
      </Button>
      <Button label={t('Previous song')} onClick={() => music.previous()} className={small}>
        <SkipPreviousIcon />
      </Button>
      <Button
        label={playing ? t('Pause') : t('Play')}
        onClick={() => music.toggle()}
        className={`${large ? 'h-14 w-14' : 'h-10 w-10'} bg-white text-black hover:scale-105 ${buffering && status !== 'paused' ? 'animate-pulse' : ''}`}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <Button label={t('Next song')} onClick={() => music.next()} disabled={!hasNext(queue)} className={small}>
        <SkipNextIcon />
      </Button>
      <Button
        label={queue.repeat === 'off' ? t('Repeat: off') : queue.repeat === 'all' ? t('Repeat: all') : t('Repeat: one')}
        pressed={queue.repeat !== 'off'}
        onClick={() => music.cycleRepeat()}
        className={`${mode(queue.repeat !== 'off')} ${large ? '' : 'max-sm:hidden'}`}
      >
        {queue.repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
      </Button>
    </div>
  )
}

/** A thin range input whose filled part follows the value (see `.music-range` in the stylesheet). */
export function Range({
  label,
  value,
  max,
  step = 1,
  onChange,
  onCommit,
  valueText,
  className = '',
}: {
  label: string
  value: number
  max: number
  step?: number
  onChange: (value: number) => void
  onCommit?: () => void
  valueText?: string
  className?: string
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <input
      type="range"
      aria-label={label}
      aria-valuetext={valueText}
      className={`music-range ${className}`}
      style={{ '--pct': `${pct}%` } as CSSProperties}
      min={0}
      max={max > 0 ? max : 0}
      step={step}
      value={Math.min(value, max > 0 ? max : 0)}
      disabled={max <= 0}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      onBlur={onCommit}
    />
  )
}

/** A timeline: elapsed time, a draggable bar that seeks when let go, and the length. Used for songs and for the video in the mini bar. */
export function SeekBar({
  value: current,
  max,
  onSeek,
  showTimes = true,
  className = '',
}: {
  value: number
  max: number
  onSeek: (seconds: number) => void
  showTimes?: boolean
  className?: string
}) {
  const [scrub, setScrub] = useState<number | null>(null)
  const value = scrub ?? current
  const commit = () => {
    if (scrub !== null) {
      onSeek(scrub)
      setScrub(null)
    }
  }
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {showTimes && <span className="w-10 text-right text-xs tabular-nums text-neutral-400">{formatTime(value)}</span>}
      <Range
        label={t('Seek')}
        value={value}
        max={max}
        onChange={setScrub}
        onCommit={commit}
        valueText={t('{time} of {total}', { time: formatTime(value), total: formatTime(max) })}
        className="flex-1"
      />
      {showTimes && <span className="w-10 text-xs tabular-nums text-neutral-400">{formatTime(max)}</span>}
    </div>
  )
}

/** The song's timeline. */
export function Seeker({ showTimes = true, className = '' }: { showTimes?: boolean; className?: string }) {
  const music = useMusic()
  const { duration } = useMusicState()
  const position = useMusicPosition()
  return <SeekBar value={position} max={duration} onSeek={(seconds) => music.seek(seconds)} showTimes={showTimes} className={className} />
}

export function VolumeControl({ className = '' }: { className?: string }) {
  const music = useMusic()
  const { volume, muted } = useMusicState()
  const silent = muted || volume === 0
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <Button
        label={silent ? t('Unmute') : t('Mute')}
        onClick={() => music.toggleMute()}
        className="h-9 w-9 text-neutral-300 hover:bg-white/10 hover:text-white"
      >
        {silent ? <MuteIcon /> : <VolumeIcon />}
      </Button>
      <Range label={t('Volume')} value={silent ? 0 : volume} max={1} step={0.05} onChange={(v) => music.setVolume(v)} className="w-24" />
    </div>
  )
}
