import { itemImageUrl, type Session } from '../../../core'
import type { MatchCard } from '../../../core/modules'
import { Img } from '../../Img'

/** The poster of a film, or its name on a plain tile when it has none. */
export function Poster({ session, card, className }: { session: Session; card: MatchCard; className: string }) {
  return (
    <Img
      session={session}
      src={itemImageUrl(session.serverUrl, card.id, 'Primary', { width: 600 })}
      className={`${className} object-cover`}
      fallback={<div className={`${className} flex items-center justify-center bg-white/[.06] p-4 text-center text-lg font-semibold text-neutral-300`}>{card.name}</div>}
    />
  )
}
