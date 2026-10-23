const running = new WeakMap<object, Map<string, Promise<unknown>>>()

/**
 * Readers that ask for the same list at the same moment share one request (two rows of a page that both need the playlists).
 * Once it has answered, the next reader asks again, so nothing is ever older than the question that started it. `owner` is the
 * session, so two accounts never share. Only for reads.
 */
export function shareWhileRunning<T>(owner: object, key: string, run: () => Promise<T>): Promise<T> {
  let mine = running.get(owner)
  if (!mine) {
    mine = new Map()
    running.set(owner, mine)
  }
  const held = mine.get(key)
  if (held) return held as Promise<T>
  const promise = run().finally(() => mine.delete(key))
  mine.set(key, promise)
  return promise
}
