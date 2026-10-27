import { useCallback, useEffect, useRef, useState } from 'react'
import {
  downloadRemoteSubtitle,
  searchRemoteSubtitles,
  SUBTITLE_SEARCH_LANGUAGES,
  subtitleSearchProblem,
  type RemoteSubtitle,
  type Session,
} from '../../core'
import { t, tr } from '../../i18n'
import { useAsync } from '../useAsync'

const LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(
  SUBTITLE_SEARCH_LANGUAGES.map(([code, name]) => [code, tr(name)]),
)

/**
 * Looks for subtitles on the internet (through the server's subtitle plugin) and saves the one you pick on the server, where
 * it becomes one more subtitle track of this video. Opens over the player; `onSaved` is called once the server has the file.
 */
export function SubtitleSearchDialog({
  session,
  itemId,
  title,
  initialLanguage,
  onSaved,
  onClose,
}: {
  session: Session
  itemId: string
  title: string
  initialLanguage: string
  onSaved: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [language, setLanguage] = useState(initialLanguage)
  const [exactOnly, setExactOnly] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const save = useCallback(
    async (subtitle: RemoteSubtitle) => {
      setSaving(subtitle.id)
      setProblem(null)
      try {
        await downloadRemoteSubtitle(session, itemId, subtitle.id)
        onSaved()
      } catch (e) {
        setProblem(subtitleSearchProblem(e))
        setSaving(null)
      }
    },
    [session, itemId, onSaved],
  )

  return (
    <dialog
      ref={dialog}
      aria-label={t('Find subtitles')}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-white/10 bg-[var(--color-surface-2)] p-0 text-neutral-100 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      onClose={onClose}
      // The player listens for keys (space, F, M, Escape...): while this is open they belong to it.
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close()
      }}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-white">{t('Find subtitles')}</h2>
            <p className="truncate text-sm text-neutral-400">{title}</p>
          </div>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>
            {t('Close')}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            {t('Language')}
            <select
              className="field w-auto py-1.5"
              value={language}
              disabled={saving !== null}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {SUBTITLE_SEARCH_LANGUAGES.map(([code]) => (
                <option key={code} value={code}>
                  {t(LANGUAGE_NAMES[code] ?? code)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={exactOnly}
              disabled={saving !== null}
              onChange={(e) => setExactOnly(e.target.checked)}
            />
            {t('Only matches for this exact file')}
          </label>
        </div>

        {problem && (
          <p role="alert" className="alert-error mt-4">
            {t(problem)}
          </p>
        )}

        <div className="mt-4" aria-live="polite">
          <Results
            key={`${language}|${exactOnly}`}
            session={session}
            itemId={itemId}
            language={language}
            exactOnly={exactOnly}
            saving={saving}
            onUse={(s) => void save(s)}
          />
        </div>

        <p className="mt-4 border-t border-white/10 pt-3 text-xs text-neutral-500">
          {t('The chosen subtitle is saved on your server next to this video, so it will be there next time too.')}
        </p>
      </div>
    </dialog>
  )
}

/** The subtitles found for one language (the parent gives it a new key when the language or the filter changes, which searches again). */
function Results({
  session,
  itemId,
  language,
  exactOnly,
  saving,
  onUse,
}: {
  session: Session
  itemId: string
  language: string
  exactOnly: boolean
  saving: string | null
  onUse: (subtitle: RemoteSubtitle) => void
}) {
  const load = useCallback(
    () =>
      searchRemoteSubtitles(session, itemId, language, { exactOnly }).catch((e: unknown) => {
        throw new Error(subtitleSearchProblem(e))
      }),
    [session, itemId, language, exactOnly],
  )
  const { state } = useAsync(load)

  if (state.status === 'loading') return <p className="text-sm text-neutral-400">{t('Searching…')}</p>
  if (state.status === 'error')
    return (
      <p role="alert" className="alert-error">
        {state.message}
      </p>
    )
  if (state.data.length === 0)
    return (
      <p className="text-sm text-neutral-400">
        {t('No subtitles found. Try another language, or check that the subtitle plugin is signed in on the server.')}
      </p>
    )
  return (
    <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
      {state.data.map((s) => (
        <li key={s.id}>
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{s.name || t('Untitled subtitle')}</p>
              <p className="truncate text-xs text-neutral-400">
                {[
                  s.provider,
                  s.format.toUpperCase(),
                  s.author,
                  s.downloads !== null ? t('{count} downloads', { count: s.downloads }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-1.5">
                {s.exactMatch && (
                  <span className="rounded-full bg-[var(--color-accent)]/20 px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent)]">
                    {t('Matches this file')}
                  </span>
                )}
                {s.hearingImpaired && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-neutral-300">
                    {t('For the hard of hearing')}
                  </span>
                )}
                {s.forced && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-neutral-300">
                    {t('Forced')}
                  </span>
                )}
                {s.machineTranslated && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-neutral-300">
                    {t('Machine translated')}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              className="btn-primary shrink-0 py-1.5"
              disabled={saving !== null}
              aria-label={t('Use {name}', { name: s.name || t('Untitled subtitle') })}
              onClick={() => onUse(s)}
            >
              {saving === s.id ? t('Saving…') : t('Use')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
