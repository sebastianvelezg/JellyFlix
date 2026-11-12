import type { TimeBlock } from '../../../core/modules'

/**
 * Helpers for the weekly grid of a Retro TV channel ("cartoons in the morning, films at night"): ready-made stretches of the day, a
 * name for a set of days, and a picture of which hours of the week are covered. The channel's engine decides what plays; this only
 * helps whoever sets it up to see what they have set (it reads blocks the same way the engine does).
 */

/** Days as the engine counts them: 0 is Sunday. */
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5]
export const WEEKEND: readonly number[] = [6, 0]
export const EVERY_DAY: readonly number[] = [1, 2, 3, 4, 5, 6, 0]

export type SlotKey = 'morning' | 'afternoon' | 'evening' | 'night'

/** The stretches of the day that can be added with one press. An overnight one ends the next morning. */
export const SLOTS: ReadonlyArray<{ key: SlotKey; start: string; end: string }> = [
  { key: 'morning', start: '06:00', end: '12:00' },
  { key: 'afternoon', start: '12:00', end: '18:00' },
  { key: 'evening', start: '18:00', end: '23:00' },
  { key: 'night', start: '23:00', end: '06:00' },
]

export function slotBlock(key: SlotKey, days: readonly number[] = EVERY_DAY): TimeBlock {
  const slot = SLOTS.find((s) => s.key === key) as (typeof SLOTS)[number]
  return { days: [...days], start: slot.start, end: slot.end, sources: [] }
}

/** Which set of days this is: every day, weekdays, the weekend, or none of those (then the days are listed). */
export function daysKind(days: readonly number[]): 'every' | 'weekdays' | 'weekend' | 'other' {
  const set = new Set(days)
  const same = (wanted: readonly number[]) => set.size === wanted.length && wanted.every((d) => set.has(d))
  return same(EVERY_DAY) ? 'every' : same(WEEKDAYS) ? 'weekdays' : same(WEEKEND) ? 'weekend' : 'other'
}

const minutesOf = (hhmm: string): number => {
  const [h = '0', m = '0'] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * For each day of the week (0 = Sunday) and each hour of the day, the index of the first block that covers the start of that hour, or -1.
 * (The engine uses the first block that covers a moment, so the first one wins here too.)
 */
export function coverage(blocks: readonly TimeBlock[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => -1))
  blocks.forEach((block, index) => {
    const start = minutesOf(block.start)
    const end = minutesOf(block.end)
    for (let day = 0; day < 7; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const minute = hour * 60
        const yesterday = (day + 6) % 7
        let covered: boolean
        if (start === end) covered = block.days.includes(day)
        else if (start < end) covered = block.days.includes(day) && minute >= start && minute < end
        else covered = (block.days.includes(day) && minute >= start) || (block.days.includes(yesterday) && minute < end)
        const row = grid[day] as number[]
        if (covered && row[hour] === -1) row[hour] = index
      }
    }
  })
  return grid
}

/** Whether a block is hidden completely behind the blocks before it (it would never be used). */
export function shadowed(blocks: readonly TimeBlock[]): boolean[] {
  const grid = coverage(blocks)
  return blocks.map((block, index) => {
    const alone = coverage([block])
    let any = false
    let used = false
    for (let day = 0; day < 7; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        if ((alone[day] as number[])[hour] === 0) {
          any = true
          if ((grid[day] as number[])[hour] === index) used = true
        }
      }
    }
    return any && !used
  })
}
