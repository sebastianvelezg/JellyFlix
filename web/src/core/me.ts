import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto'
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api'
import type { Session } from './jellyfin'

const known = new WeakMap<Session, Promise<UserDto>>()

/**
 * The signed-in account's own record (its name and allowances). Asked once per sign-in and shared by everyone who needs it:
 * checking the saved session, deciding whether the administrator tools show, the plugins page. A question that failed is asked
 * again next time. `fresh` asks the server anyway (to check that the session still works) and the answer replaces the old one.
 */
export function currentUser(session: Session, { fresh = false }: { fresh?: boolean } = {}): Promise<UserDto> {
  const held = known.get(session)
  if (held && !fresh) return held
  const asked = getUserApi(session.api)
    .getCurrentUser()
    .then(({ data }) => data)
  known.set(session, asked)
  asked.catch(() => {
    if (known.get(session) === asked) known.delete(session)
  })
  return asked
}

/** Keeps what signing in already found out, so nobody asks again. */
export function rememberUser(session: Session, me: UserDto): void {
  known.set(session, Promise.resolve(me))
}
