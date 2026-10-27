import { useEffect, useRef } from 'react'
import { parseHex, toHex, type Rgb } from '../../theme/colors'
import type { CoverPalette } from '../../theme/coverColors'
import { useMusic, useMusicState } from './MusicProvider'

const BARS = 40
const FALLBACK: Rgb = [77, 141, 255]

/** One step of a colour towards another. */
function ease(from: Rgb, to: Rgb): Rgb {
  return [0, 1, 2].map((c) => (from[c] as number) + ((to[c] as number) - (from[c] as number)) * 0.2) as Rgb
}
/** How fast a bar falls when the sound drops (a share of its height per frame); rising is immediate. */
const FALL = 0.12

/**
 * Bars that move with the sound of the song playing, drawn over its cover. They read the real sound when the browser may
 * (the song was loaded with CORS); otherwise they move to a made-up rhythm, and say so in `data-source`.
 * Nothing moves for people who asked their system for less motion, or while the music is paused.
 */
export function Visualizer({ className = '', colors }: { className?: string; colors?: CoverPalette | null }) {
  const music = useMusic()
  const { status } = useMusicState()
  const canvas = useRef<HTMLCanvasElement>(null)
  const playing = status === 'playing'
  // The colours of the cover, read each frame so that a new song changes them without restarting the drawing.
  const palette = useRef(colors)
  useEffect(() => {
    palette.current = colors
  }, [colors])
  // The colours the bars have now, on their way to the cover's, so a change of song fades them instead of jumping.
  const shown = useRef<[Rgb, Rgb] | null>(null)

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const heights = new Float32Array(BARS)
    const spectrum = new Uint8Array(music.spectrumSize)
    let frame = 0
    let last = 0

    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      const { width, height } = element.getBoundingClientRect()
      element.width = Math.max(1, Math.round(width * ratio))
      element.height = Math.max(1, Math.round(height * ratio))
    }
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(element)

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const live = playing && !reduced && music.readSpectrum(spectrum)
      element.dataset.source = live ? 'live' : 'simulated'
      const seconds = now / 1000
      let total = 0
      for (let i = 0; i < BARS; i += 1) {
        let target = 0
        if (playing && !reduced) {
          if (live) {
            const at = Math.floor((i * spectrum.length) / BARS)
            // Bass is louder than treble in most music: lift the high bands a little so the right side is not flat.
            target = Math.min(1, ((spectrum[at] ?? 0) / 255) * (1 + (i / BARS) * 0.6))
          } else {
            // No sound to read: a gentle made-up rhythm (the bars still follow the play and pause of the song).
            target = 0.22 + 0.5 * Math.abs(Math.sin(seconds * 2.1 + i * 0.55) * Math.cos(seconds * 1.3 + i * 0.21))
          }
        }
        const current = heights[i] ?? 0
        heights[i] = target > current ? target : Math.max(target, current - FALL)
        total += heights[i] ?? 0
      }
      // How high the bars are on average (0-1): what a test or a curious person can read to see that sound is really coming through.
      element.dataset.level = (total / BARS).toFixed(2)
      if (now - last < 16) return
      last = now
      const { width, height } = element
      context.clearRect(0, 0, width, height)
      // The cover's two colours, left to right; the page's accent when the cover has none (or has not been read yet).
      const style = getComputedStyle(element)
      const accent = style.getPropertyValue('--color-accent').trim() || '#4d8dff'
      const wanted: [Rgb, Rgb] = palette.current
        ? [parseHex(palette.current.primary) ?? FALLBACK, parseHex(palette.current.secondary) ?? FALLBACK]
        : [parseHex(accent) ?? FALLBACK, parseHex(style.getPropertyValue('--color-cyan').trim() || accent) ?? FALLBACK]
      const from = shown.current ?? wanted
      // A fifth of the way there each frame: a change of song fades the colours over about a third of a second.
      const mixed: [Rgb, Rgb] = [ease(from[0], wanted[0]), ease(from[1], wanted[1])]
      shown.current = mixed
      const left = toHex(mixed[0])
      const right = toHex(mixed[1])
      element.dataset.colors = `${left} ${right}`
      const slot = width / BARS
      const barWidth = Math.max(2, slot * 0.58)
      const fill = context.createLinearGradient(0, 0, width, 0)
      fill.addColorStop(0, left)
      fill.addColorStop(1, right)
      context.fillStyle = fill
      context.shadowColor = left
      context.shadowBlur = 14
      for (let i = 0; i < BARS; i += 1) {
        const h = Math.max(slot * 0.4, (heights[i] ?? 0) * height * 0.9)
        const x = i * slot + (slot - barWidth) / 2
        context.beginPath()
        context.roundRect(x, height - h, barWidth, h, barWidth / 2)
        context.fill()
      }
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [music, playing])

  return <canvas ref={canvas} aria-hidden="true" data-testid="visualizer" data-source="simulated" className={`pointer-events-none ${className}`} />
}
