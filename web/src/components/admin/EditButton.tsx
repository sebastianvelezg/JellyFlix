import { isEditableType, type Session } from '../../core'
import { t } from '../../i18n'
import { PencilIcon } from '../icons'
import { openItemEditor, useIsAdmin, type EditTarget } from './editorEvents'

/** "Edit" for a title: shown only to administrators (and only for titles the editor can change). `compact` is a round icon. */
export function EditButton({ session, target, compact = false, className }: { session: Session; target: EditTarget; compact?: boolean; className?: string }) {
  const admin = useIsAdmin(session)
  if (!admin || !isEditableType(target.type)) return null
  if (compact) {
    return (
      <button
        type="button"
        className={className ?? 'btn-icon h-9 w-9 shrink-0 self-start pointer-coarse:h-11 pointer-coarse:w-11'}
        aria-label={t('Edit {name}', { name: target.name })}
        title={t('Edit the details and pictures of this title')}
        onClick={() => openItemEditor(target)}
      >
        <PencilIcon />
      </button>
    )
  }
  return (
    <button type="button" className={className ?? 'btn py-3'} aria-label={t('Edit {name}', { name: target.name })} onClick={() => openItemEditor(target)} title={t('Edit the details and pictures of this title')}>
      <PencilIcon /> {t('Edit')}
    </button>
  )
}
