import { useCallback, useRef, useState } from 'react'
import {
  checkPictureFile,
  deletePicture,
  downloadPicture,
  getPictureChoices,
  getPictures,
  PICTURE_KINDS,
  PICTURE_TYPES,
  pictureShapeWarning,
  uploadPicture,
  type EditableItem,
  type PictureChoice,
  type PictureSlot,
  type PictureType,
  type Session,
} from '../../core'
import { t } from '../../i18n'
import { recordActivity } from '../../platform/web/adminActivity'
import { showToast } from '../toast'
import { useAsync } from '../useAsync'
import { adminErrorText, ConfirmBox } from './parts'

interface Staged {
  type: PictureType
  fileName: string
  contentType: string
  bytes: number
  dataUrl: string
  width: number
  height: number
}

const kindLabel = (type: PictureType) => t(PICTURE_KINDS.find((k) => k.type === type)?.label ?? type)
const kilobytes = (bytes?: number) => (bytes ? `${Math.max(1, Math.round(bytes / 1024))} KB` : '')

/** Reads a chosen file in the browser (nothing is sent anywhere yet) and measures it. */
function stage(file: File, type: PictureType): Promise<Staged> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not a picture the browser can open.'))
      img.onload = () => resolve({ type, fileName: file.name, contentType: file.type, bytes: file.size, dataUrl, width: img.naturalWidth, height: img.naturalHeight })
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Posters, backdrops, logos and thumbnails: see what the title has, take a picture the metadata providers offer, or send one
 * of your own (checked and shown before it goes). Every change asks first.
 */
export function PicturesTab({ session, item, onChanged }: { session: Session; item: EditableItem; onChanged: () => Promise<void> }) {
  const id = item.dto.Id ?? ''
  const loadSlots = useCallback(() => getPictures(session, id), [session, id])
  const { state: slotState, retry: reload } = useAsync(loadSlots)
  const slots: PictureSlot[] | null = slotState.status === 'ready' ? slotState.data : null
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState<PictureType | null>(null)
  const [choices, setChoices] = useState<PictureChoice[] | null>(null)
  const [previews, setPreviews] = useState(false)
  const [chosen, setChosen] = useState<PictureChoice | null>(null)
  const [staged, setStaged] = useState<Staged | null>(null)
  const [removing, setRemoving] = useState<PictureSlot | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadFor = useRef<PictureType>('Primary')

  async function done(summary: string) {
    recordActivity({ itemId: id, itemName: item.fields.name, kind: 'picture', summary })
    setChosen(null)
    setStaged(null)
    setRemoving(null)
    setPicking(null)
    setChoices(null)
    reload()
    await onChanged()
    showToast({ message: summary })
  }

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(adminErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  function choose(type: PictureType) {
    setPicking(type)
    setChoices(null)
    setChosen(null)
    setStaged(null)
    setRemoving(null)
    setError(null)
    void attempt(async () => setChoices(await getPictureChoices(session, id, type)))
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    const type = uploadFor.current
    setError(null)
    setPicking(null)
    setChosen(null)
    setRemoving(null)
    const problem = checkPictureFile(file)
    if (problem) return setError(t(problem))
    try {
      setStaged(await stage(file, type))
    } catch (e) {
      setError(t(e instanceof Error ? e.message : 'Something went wrong.'))
    }
  }

  const countOf = (type: PictureType) => (slots ?? []).filter((s) => s.type === type).length
  const warning = staged ? pictureShapeWarning(staged.type, staged.width, staged.height) : null

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-400">{t('Change the pictures of this title. Each change asks first, and the server keeps the new picture for everyone.')}</p>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept={PICTURE_TYPES.join(',')}
        aria-label={t('Choose a picture from your computer')}
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {(error ?? (slotState.status === 'error' ? slotState.message : null)) && (
        <p role="alert" className="alert-error">
          {error ?? (slotState.status === 'error' ? slotState.message : null)}
        </p>
      )}

      {PICTURE_KINDS.map(({ type }) => {
        const mine = (slots ?? []).filter((s) => s.type === type)
        const label = kindLabel(type)
        return (
          <section key={type} aria-label={label} className="rounded-2xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">{label}</h3>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn" disabled={busy} onClick={() => choose(type)}>
                  {t('Choose from the providers')}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    uploadFor.current = type
                    fileInput.current?.click()
                  }}
                >
                  {t('Upload yours…')}
                </button>
              </div>
            </div>

            {slots && mine.length === 0 && <p className="mt-2 text-sm text-neutral-500">{t('None yet.')}</p>}
            {mine.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-3">
                {mine.map((slot) => (
                  <li key={`${slot.type}-${slot.index}-${slot.tag}`} className="w-40">
                    <img src={slot.url} alt={t('Current {kind}', { kind: label.toLowerCase() })} className="aspect-[3/4] w-full rounded-lg bg-[var(--color-surface-3)] object-contain ring-1 ring-white/10" style={type === 'Primary' ? undefined : { aspectRatio: '16 / 9' }} />
                    <p className="mt-1 text-xs text-neutral-400">{[slot.width && slot.height ? `${slot.width} × ${slot.height}` : '', kilobytes(slot.bytes)].filter(Boolean).join(' · ')}</p>
                    <button type="button" className="btn-ghost -ml-3 text-red-300" disabled={busy} aria-label={t('Remove this {kind}', { kind: label.toLowerCase() })} onClick={() => { setRemoving(slot); setPicking(null); setStaged(null); setChosen(null) }}>
                      {t('Remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {removing?.type === type && (
              <div className="mt-3">
                <ConfirmBox
                  danger
                  busy={busy}
                  confirmLabel={t('Remove it')}
                  onCancel={() => setRemoving(null)}
                  onConfirm={() => void attempt(async () => {
                    await deletePicture(session, id, removing.type, removing.index)
                    await done(t('Removed a {kind} of {title}.', { kind: label.toLowerCase(), title: item.fields.name }))
                  })}
                >
                  {t('Remove this {kind} from the server? It cannot be put back from here; you can choose or upload another one afterwards.', { kind: label.toLowerCase() })}
                </ConfirmBox>
              </div>
            )}

            {picking === type && (
              <div className="mt-3 space-y-3">
                {choices === null && !error && <p className="text-sm text-neutral-400">{t('Asking the providers…')}</p>}
                {choices && choices.length === 0 && <p className="text-sm text-neutral-400">{t('The providers have no pictures for this.')}</p>}
                {choices && choices.length > 0 && (
                  <>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-300">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" checked={previews} onChange={(e) => setPreviews(e.target.checked)} />
                      <span>
                        {t('Show their pictures')}
                        <span className="block text-xs text-neutral-500">{t('Your browser will then load them from the web sites of those providers.')}</span>
                      </span>
                    </label>
                    <ul aria-label={t('Pictures offered')} className="grid gap-2 sm:grid-cols-2">
                      {choices.map((c) => (
                        <li key={c.url} className="flex gap-3 rounded-xl border border-white/10 bg-white/[.03] p-2">
                          {previews && (
                            <img
                              src={c.thumbnail}
                              alt=""
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              className={`shrink-0 rounded-md bg-[var(--color-surface-3)] ${type === 'Primary' ? 'h-20 w-14 object-cover' : type === 'Logo' ? 'h-12 w-24 object-contain' : 'h-16 w-28 object-cover'}`}
                            />
                          )}
                          <div className="min-w-0 flex-1 text-xs text-neutral-300">
                            <p className="font-medium text-white">{c.provider}</p>
                            <p>{[c.width && c.height ? `${c.width} × ${c.height}` : '', c.language ?? t('No language')].filter(Boolean).join(' · ')}</p>
                            {c.rating != null && <p className="text-neutral-500">{t('Rated {rating} by {votes} people', { rating: c.rating.toFixed(1), votes: c.votes ?? 0 })}</p>}
                          </div>
                          <button type="button" className="btn shrink-0 self-start" disabled={busy} aria-label={t('Use this picture from {provider}, {size}', { provider: c.provider, size: c.width && c.height ? `${c.width} × ${c.height}` : '' })} onClick={() => setChosen(c)}>
                            {t('Use this')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {chosen && (
                  <ConfirmBox
                    busy={busy}
                    confirmLabel={t('Use this picture')}
                    onCancel={() => setChosen(null)}
                    onConfirm={() => void attempt(async () => {
                      await downloadPicture(session, id, type, chosen)
                      await done(t('Changed the {kind} of {title}.', { kind: label.toLowerCase(), title: item.fields.name }))
                    })}
                  >
                    {type === 'Backdrop'
                      ? t('Add this picture from {provider} as a backdrop? The server downloads it.', { provider: chosen.provider })
                      : t('Replace the current {kind} with this picture from {provider}? The server downloads it.', { kind: label.toLowerCase(), provider: chosen.provider })}
                  </ConfirmBox>
                )}
                <button type="button" className="btn-ghost" onClick={() => { setPicking(null); setChoices(null); setChosen(null) }}>
                  {t('Close the list')}
                </button>
              </div>
            )}

            {staged?.type === type && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3">
                  <img src={staged.dataUrl} alt={t('Preview of {name}', { name: staged.fileName })} className="max-h-40 max-w-[10rem] rounded-lg object-contain ring-1 ring-white/10" />
                  <div className="min-w-0 text-sm text-neutral-300">
                    <p className="break-all font-medium text-white">{staged.fileName}</p>
                    <p>{`${staged.width} × ${staged.height} · ${kilobytes(staged.bytes)}`}</p>
                    {warning && <p className="mt-1 text-amber-200">{t(warning)}</p>}
                  </div>
                </div>
                <ConfirmBox
                  busy={busy}
                  confirmLabel={t('Send it to the server')}
                  onCancel={() => setStaged(null)}
                  onConfirm={() => void attempt(async () => {
                    await uploadPicture(session, id, staged.type, { base64: staged.dataUrl.slice(staged.dataUrl.indexOf(',') + 1), contentType: staged.contentType })
                    await done(t('Changed the {kind} of {title}.', { kind: label.toLowerCase(), title: item.fields.name }))
                  })}
                >
                  {type === 'Backdrop'
                    ? t('Add this picture as a backdrop of this title?')
                    : countOf(type) > 0
                      ? t('Replace the current {kind} with this picture?', { kind: label.toLowerCase() })
                      : t('Use this picture as the {kind} of this title?', { kind: label.toLowerCase() })}
                </ConfirmBox>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
