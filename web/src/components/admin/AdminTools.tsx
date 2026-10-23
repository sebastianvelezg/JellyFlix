import { lazy, Suspense } from 'react'
import type { Session } from '../../core'
import { useIsAdmin } from './editorEvents'

const ItemEditorDialog = lazy(() => import('./ItemEditorDialog').then((m) => ({ default: m.ItemEditorDialog })))

/** The administrator tools that live once in the app. Nothing is loaded for an account that is not an administrator. */
export function AdminTools({ session }: { session: Session }) {
  const admin = useIsAdmin(session)
  if (!admin) return null
  return (
    <Suspense fallback={null}>
      <ItemEditorDialog session={session} />
    </Suspense>
  )
}
