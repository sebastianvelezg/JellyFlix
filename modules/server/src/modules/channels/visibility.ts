import type { Program } from '../../../../contract/index.ts'
import { UNAVAILABLE_PROGRAM } from '../../../../contract/index.ts'
import type { AuthUser } from '../../http/router.ts'
import type { JellyfinClient } from '../../jellyfin/client.ts'

/**
 * Which titles of a guide a person's own Jellyfin account may see. A channel is made by an administrator from what that administrator
 * sees, and everybody signed in reads its guide: without this, the name of a title from a library hidden from a child account, or over
 * its age limit, would show in the guide. Jellyfin is asked as the person (their own token), and answers only with what they may see.
 */
const BATCH = 50
const KEEP_MS = 5 * 60_000
const MAX_ANSWERS = 20_000
const ID = /^[A-Za-z0-9-]{1,64}$/

export interface Visibility {
  /** The ids of `ids` that this person may see. An id Jellyfin could not be asked about is not in it (and is asked again next time). */
  visibleTo(user: AuthUser, ids: readonly string[]): Promise<Set<string>>
  /** The programs with the ones this person may not see replaced by a generic note. */
  restrict(user: AuthUser, programs: readonly Program[]): Promise<Program[]>
}

export function createVisibility(jellyfin: JellyfinClient, now: () => number = Date.now): Visibility {
  // "<person>|<title>" -> whether, and until when that is known. A change of rights shows up within a few minutes.
  const known = new Map<string, { visible: boolean; until: number }>()
  const remember = (key: string, visible: boolean) => {
    known.delete(key)
    while (known.size >= MAX_ANSWERS) known.delete(known.keys().next().value as string)
    known.set(key, { visible, until: now() + KEEP_MS })
  }

  async function visibleTo(user: AuthUser, ids: readonly string[]): Promise<Set<string>> {
    const out = new Set<string>()
    const ask: string[] = []
    for (const id of new Set(ids)) {
      if (!ID.test(id)) continue
      const hit = known.get(`${user.id}|${id}`)
      if (hit && hit.until > now()) {
        if (hit.visible) out.add(id)
      } else {
        ask.push(id)
      }
    }
    for (let i = 0; i < ask.length; i += BATCH) {
      const batch = ask.slice(i, i + BATCH)
      try {
        const answer = await jellyfin.get<{ Items?: Array<{ Id?: string }> }>('/Items', user.token, { userId: user.id, ids: batch, limit: batch.length, enableTotalRecordCount: false })
        const seen = new Set((answer.Items ?? []).map((item) => item.Id))
        for (const id of batch) {
          const visible = seen.has(id)
          remember(`${user.id}|${id}`, visible)
          if (visible) out.add(id)
        }
      } catch {
        // Jellyfin could not say: these stay hidden for now, and are not remembered.
      }
    }
    return out
  }

  return {
    visibleTo,
    async restrict(user, programs) {
      if (programs.length === 0) return []
      const visible = await visibleTo(user, programs.map((p) => p.itemId))
      return programs.map((p) => (visible.has(p.itemId) ? p : { start: p.start, end: p.end, itemId: '', title: UNAVAILABLE_PROGRAM, type: p.type, runtime: p.runtime, unavailable: true }))
    },
  }
}
