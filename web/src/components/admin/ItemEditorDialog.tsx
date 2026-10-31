import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { canIdentify, diffFields, getEditableItem, type EditableItem, type MetadataFields, type Session } from '../../core'
import { t, tr } from '../../i18n'
import { DetailsTab } from './DetailsTab'
import { HistoryTab } from './HistoryTab'
import { IdentifyTab } from './IdentifyTab'
import { notifyItemEdited, onOpenItemEditor, type EditTarget } from './editorEvents'
import { adminErrorText, ConfirmBox } from './parts'
import { PicturesTab } from './PicturesTab'
import { RefreshTab } from './RefreshTab'

type Tab = 'details' | 'identify' | 'pictures' | 'refresh' | 'history'
const TAB_LABEL: Record<Tab, string> = { details: tr('Details'), identify: tr('Identify'), pictures: tr('Pictures'), refresh: tr('Refresh'), history: tr('History') }

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; item: EditableItem }

/**
 * The administrator's editor for one title, in a dialog: details, identify, pictures, refresh and the history of changes.
 * One of it lives in the app; `openItemEditor` opens it. It is only reachable from buttons that administrators see, and the
 * server still checks every request.
 */
export function ItemEditorDialog({ session }: { session: Session }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [target, setTarget] = useState<EditTarget | null>(null)
  const [tab, setTab] = useState<Tab>('details')
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [draft, setDraft] = useState<MetadataFields | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [asking, setAsking] = useState(false)
  const tabButtons = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  const adopt = useCallback((item: EditableItem) => {
    setLoaded({ status: 'ready', item })
    setDraft(item.fields)
    setResetKey((k) => k + 1)
  }, [])

  useEffect(
    () =>
      onOpenItemEditor((next) => {
        setTarget(next)
        setTab('details')
        setAsking(false)
        setLoaded({ status: 'loading' })
        setDraft(null)
        if (dialog.current && !dialog.current.open) dialog.current.showModal()
      }),
    [],
  )

  useEffect(() => {
    if (!target) return
    let current = true
    getEditableItem(session, target.id)
      .then((item) => {
        if (current) adopt(item)
      })
      .catch((e: unknown) => {
        if (current) setLoaded({ status: 'error', message: adminErrorText(e) })
      })
    return () => {
      current = false
    }
  }, [session, target, adopt])

  const item = loaded.status === 'ready' ? loaded.item : null
  const dirty = !!item && !!draft && diffFields(item.fields, draft).length > 0
  const tabs: Tab[] = item && !canIdentify(item.dto.Type) ? ['details', 'pictures', 'refresh', 'history'] : ['details', 'identify', 'pictures', 'refresh', 'history']

  /** The server holds something new: read it again, show it, and tell the pages behind the dialog. */
  const changed = useCallback(
    async (fresh?: EditableItem) => {
      if (!target) return
      adopt(fresh ?? (await getEditableItem(session, target.id)))
      notifyItemEdited()
    },
    [session, target, adopt],
  )

  function requestClose() {
    if (dirty && !asking) return setAsking(true)
    setAsking(false)
    dialog.current?.close()
  }

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const at = tabs.indexOf(tab)
    const next = tabs[e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (at + step + tabs.length) % tabs.length] as Tab
    setTab(next)
    tabButtons.current[next]?.focus()
  }

  return (
    <dialog
      ref={dialog}
      aria-label={t('Edit {name}', { name: target?.name ?? '' })}
      className="m-auto w-[min(46rem,calc(100vw-1rem))] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-3xl border border-white/10 bg-[var(--color-surface-2)] p-0 text-neutral-100 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      onCancel={(e) => {
        e.preventDefault()
        requestClose()
      }}
      onClose={() => setAsking(false)}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">{t('Administrator')}</p>
            <h2 className="truncate text-xl font-semibold tracking-tight text-white">{t('Edit {name}', { name: target?.name ?? '' })}</h2>
          </div>
          <button type="button" className="btn shrink-0" onClick={requestClose}>
            {t('Close')}
          </button>
        </div>

        {asking && (
          <div className="mt-4">
            <ConfirmBox
              danger
              confirmLabel={t('Close and lose them')}
              onConfirm={() => {
                setAsking(false)
                dialog.current?.close()
              }}
              onCancel={() => setAsking(false)}
            >
              {t('You typed changes that are not saved. Close anyway?')}
            </ConfirmBox>
          </div>
        )}

        <div role="tablist" aria-label={t('Edit {name}', { name: target?.name ?? '' })} className="no-scrollbar -mx-1 mt-4 flex gap-1 overflow-x-auto px-1 pb-1">
          {tabs.map((id) => (
            <button
              key={id}
              ref={(el) => {
                tabButtons.current[id] = el
              }}
              type="button"
              role="tab"
              id={`edit-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="edit-panel"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={onTabKey}
              className={`tab shrink-0`}
            >
              {t(TAB_LABEL[id])}
            </button>
          ))}
        </div>

        <div id="edit-panel" role="tabpanel" aria-labelledby={`edit-tab-${tab}`} className="mt-4">
          {loaded.status === 'loading' && (
            <p role="status" className="text-sm text-neutral-400">
              {t('Loading…')}
            </p>
          )}
          {loaded.status === 'error' && (
            <p role="alert" className="alert-error">
              {loaded.message}
            </p>
          )}
          {item && draft && target && (
            <>
              {tab === 'details' && <DetailsTab session={session} itemId={target.id} item={item} draft={draft} setDraft={setDraft} resetKey={resetKey} onSaved={() => changed()} />}
              {tab === 'identify' && <IdentifyTab session={session} item={item} dirty={dirty} onChanged={changed} />}
              {tab === 'pictures' && <PicturesTab session={session} item={item} onChanged={() => changed()} />}
              {tab === 'refresh' && <RefreshTab session={session} item={item} />}
              {tab === 'history' && (
                <HistoryTab
                  itemId={target.id}
                  current={draft}
                  onRestore={(next) => {
                    setDraft(next)
                    setResetKey((k) => k + 1)
                    setTab('details')
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </dialog>
  )
}
