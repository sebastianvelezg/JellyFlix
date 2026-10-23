/**
 * Lets only a few reads be on their way to the server at once, most important first.
 *
 * A page can ask for a dozen lists in the same moment. The browser lets six requests per server through, and the pictures
 * share those six: a few slow lists then keep the posters waiting, and the server (often a small box at home) works on all of them at the
 * same time, so every one of them takes longer. Holding a few back makes the whole page come in sooner: what you look at
 * first goes first, the slow random picks go last, and two connections stay free for pictures.
 */

/** 0 = what the page is built from, 1 = the rest, 2 = slow extras that nothing waits for. */
export type Priority = 0 | 1 | 2

export interface Gate {
  /** Resolves when a place is free. Every acquire must be matched by one `release`, unless it rejects (aborted while waiting). */
  acquire(priority: Priority, signal?: AbortSignal): Promise<void>
  release(): void
  /** For tests and the diagnostics: how many are on their way, and how many are waiting. */
  counts(): { active: number; waiting: number }
}

interface Waiter {
  priority: Priority
  seq: number
  grant: () => void
}

export function createGate(limit: number): Gate {
  let active = 0
  let seq = 0
  const queue: Waiter[] = []

  const pump = () => {
    while (active < limit && queue.length > 0) {
      let best = 0
      for (let i = 1; i < queue.length; i += 1) {
        const a = queue[i] as Waiter
        const b = queue[best] as Waiter
        if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i
      }
      const [next] = queue.splice(best, 1)
      active += 1
      next?.grant()
    }
  }

  return {
    acquire(priority, signal) {
      if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      if (active < limit && queue.length === 0) {
        active += 1
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          priority,
          seq: (seq += 1),
          grant: () => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          },
        }
        const onAbort = () => {
          const at = queue.indexOf(waiter)
          if (at >= 0) queue.splice(at, 1)
          reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        queue.push(waiter)
      })
    },
    release() {
      active = Math.max(0, active - 1)
      pump()
    },
    counts: () => ({ active, waiting: queue.length }),
  }
}

/**
 * How soon a read should go, from its address. Pure.
 * - 0: the lists a page is made of and what you just asked for (resume, next up, latest, one title, its episodes, search).
 * - 2: random picks, the whole-library filter scan, similar titles, people: slow, and the page is complete without waiting for them.
 */
export function priorityOf(url: string): Priority {
  let path = url
  let query = ''
  try {
    const parsed = new URL(url, 'http://placeholder.invalid')
    path = parsed.pathname
    query = parsed.search.toLowerCase()
  } catch {
    // keep the raw text
  }
  if (/\/items\/filters2?$/i.test(path) || /\/similar$/i.test(path) || /\/persons$/i.test(path)) return 2
  if (/sortby=[^&]*random/.test(query)) return 2
  if (/\/(resume|latest|nextup|episodes|seasons|playbackinfo)$/i.test(path) || /\/items\/[^/]+$/i.test(path)) return 0
  if (/[?&]ids=/.test(query) || /[?&]searchterm=/.test(query)) return 0
  return 1
}
