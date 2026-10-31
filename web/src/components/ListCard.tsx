import { posterUrl, type Session, type VideoPlaylist } from '../core'
import { t } from '../i18n'
import { Img } from './Img'
import { countText, shownName } from './listText'
import { frame } from './MovieCard'
import { Subtext } from './Subtext'

/** A poster for a playlist (the server makes one from its first titles), or its name on a plain tile. */
export function ListCard({ session, list, onOpen }: { session: Session; list: VideoPlaylist; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(list.id)}
      className="group block w-full text-left outline-none"
      aria-label={t('Open playlist {name}', { name: shownName(list) })}
    >
      <div className={`aspect-[2/3] ${frame}`}>
        <Img
          session={session}
          src={posterUrl(session.serverUrl, list)}
          className="h-full w-full object-cover"
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--color-surface-3)] to-[var(--color-surface)] p-3 text-center text-sm font-medium text-neutral-500">
              {shownName(list)}
            </div>
          }
        />
      </div>
      <p className="mt-2.5 truncate text-sm font-medium text-neutral-100 transition group-hover:text-white">{shownName(list)}</p>
      <Subtext as="p" className="block min-h-4 text-xs text-neutral-500" text={countText(list.itemCount)} />
    </button>
  )
}
