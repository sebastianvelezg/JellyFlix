import { useEffect, useRef, useState } from 'react'
import { LANGUAGES, getLanguage, t, tr, type Language } from '../i18n'
import { applyAppearance, readAppearance, writeAppearance } from '../platform/web/appearance'
import { readPlayerPrefs, readUiPrefs, writePlayerPrefs } from '../platform/web/prefs'
import { ACCENTS, CANVASES, accentColor } from '../theme/themes'
import { chooseLanguage } from './useLanguage'

const OPEN_EVENT = 'jellyflix:setup'
const DONE_KEY = 'jellyflix.setup'
/** Everything a device that has been used before has saved: it does not get the questions again. */
const USED_KEYS = ['jellyflix.player', 'jellyflix.appearance', 'jellyflix.ui', 'jellyflix.browse']

/** Opens the setup (Settings → About → Run the setup again). */
export function openSetup(): void {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

/** True on a device that has never been set up and has never saved a preference: the first time the app is opened here. */
export function isFirstRun(): boolean {
  try {
    const saved = localStorage.getItem(DONE_KEY)
    // "pending": the questions were started and not finished (the answers themselves already count as preferences).
    if (saved === 'pending') return true
    if (saved) return false
    return !USED_KEYS.some((key) => localStorage.getItem(key) !== null)
  } catch {
    return false
  }
}

function mark(value: 'pending' | '1'): void {
  try {
    localStorage.setItem(DONE_KEY, value)
  } catch {
    // The questions come back next time: harmless.
  }
}

/** The languages of subtitles offered (the ones whose two codes in Jellyfin's list are the same). */
const SUBTITLE_LANGUAGES: Array<[string, string]> = [
  ['eng', tr('English')],
  ['spa', tr('Spanish')],
  ['por', tr('Portuguese')],
  ['ita', tr('Italian')],
  ['jpn', tr('Japanese')],
]

const STEPS = ['language', 'look', 'subtitles'] as const
type Step = (typeof STEPS)[number]

function Choice({ name, label, checked, onChange, children }: { name: string; label: string; checked: boolean; onChange: () => void; children?: React.ReactNode }) {
  return (
    <label className="relative flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[.05] px-4 py-2 text-sm text-neutral-100 transition has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-accent)]/15 has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-accent)]">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      {children}
      <span>{label}</span>
    </label>
  )
}

/**
 * Three short questions the first time the app is opened on a device: the language, the look and the language of subtitles. Each
 * answer is kept at once, so the page behind shows it; the last step says where everything can be changed. Skippable, and it can
 * be run again from Settings. Native `<dialog>`: it traps the focus and gives it back.
 */
export function SetupWizard({ suppressed = false }: { suppressed?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [step, setStep] = useState<Step>('language')
  const [, redraw] = useState(0)
  const [subtitle, setSubtitle] = useState<string | null>(() => readPlayerPrefs().subtitleLanguage)

  useEffect(() => {
    const open = () => {
      const el = dialog.current
      if (!el || el.open || typeof el.showModal !== 'function') return
      setStep('language')
      setSubtitle(readPlayerPrefs().subtitleLanguage)
      el.showModal()
    }
    if (!suppressed && isFirstRun()) {
      mark('pending')
      open()
    }
    window.addEventListener(OPEN_EVENT, open)
    return () => window.removeEventListener(OPEN_EVENT, open)
  }, [suppressed])

  const appearance = readAppearance()
  const language: Language = getLanguage()
  const index = STEPS.indexOf(step)
  const last = index === STEPS.length - 1
  const finish = () => {
    mark('1')
    dialog.current?.close()
  }

  return (
    <dialog
      ref={dialog}
      aria-label={t('Set up Jellyflix')}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-white/10 bg-[var(--color-surface-2)] p-0 text-neutral-100 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onCancel={() => mark('1')}
    >
      <div className="flex min-h-[23rem] flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{t('Step {step} of {total}', { step: index + 1, total: STEPS.length })}</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-white">
              {step === 'language' ? t('Which language?') : step === 'look' ? t('How should it look?') : t('Subtitles?')}
            </h2>
          </div>
          <button type="button" className="btn-ghost shrink-0" onClick={finish}>
            {t('Skip')}
          </button>
        </div>

        {step === 'language' && (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{t('Language')}</legend>
            <Choice
              name="setup-language"
              label={t('Automatic (your browser)')}
              checked={readUiPrefs().language === 'auto'}
              onChange={() => {
                chooseLanguage('auto')
                redraw((n) => n + 1)
              }}
            />
            {LANGUAGES.map(([code, name]) => (
              <Choice
                key={code}
                name="setup-language"
                label={name}
                checked={readUiPrefs().language === code}
                onChange={() => {
                  chooseLanguage(code)
                  redraw((n) => n + 1)
                }}
              />
            ))}
          </fieldset>
        )}

        {step === 'look' && (
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-neutral-100">{t('Background')}</legend>
              <div className="flex flex-wrap gap-2">
                {CANVASES.map((canvas) => (
                  <Choice
                    key={canvas.id}
                    name="setup-canvas"
                    label={t(canvas.label)}
                    checked={appearance.theme.canvas === canvas.id}
                    onChange={() => {
                      applyAppearance(writeAppearance({ theme: { ...readAppearance().theme, canvas: canvas.id } }))
                      redraw((n) => n + 1)
                    }}
                  >
                    <span aria-hidden="true" className="h-4 w-4 rounded-full border border-white/30" style={{ background: canvas.surface3 }} />
                  </Choice>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-neutral-100">{t('Accent colour')}</legend>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((accent) => (
                  <Choice
                    key={accent.id}
                    name="setup-accent"
                    label={t(accent.label)}
                    checked={appearance.theme.accent === accent.id}
                    onChange={() => {
                      applyAppearance(writeAppearance({ theme: { ...readAppearance().theme, accent: accent.id } }))
                      redraw((n) => n + 1)
                    }}
                  >
                    <span aria-hidden="true" className="h-4 w-4 rounded-full" style={{ background: accentColor(accent.id) }} />
                  </Choice>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        {step === 'subtitles' && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-400">{t('The language you pick is switched on by itself when a title has it. You can change it while you watch.')}</p>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">{t('Subtitles')}</legend>
              <Choice
                name="setup-subtitles"
                label={t('None')}
                checked={subtitle === null}
                onChange={() => {
                  setSubtitle(null)
                  writePlayerPrefs({ subtitleLanguage: null })
                }}
              />
              {SUBTITLE_LANGUAGES.map(([code, name]) => (
                <Choice
                  key={code}
                  name="setup-subtitles"
                  label={t(name)}
                  checked={subtitle === code}
                  onChange={() => {
                    setSubtitle(code)
                    writePlayerPrefs({ subtitleLanguage: code })
                  }}
                />
              ))}
            </fieldset>
            <p className="text-xs text-neutral-500">{t('Everything else is in Settings, and you can run this again from Settings → About.')}</p>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <button type="button" className="btn" disabled={index === 0} onClick={() => setStep(STEPS[index - 1] as Step)}>
            {t('Back')}
          </button>
          <button type="button" className="btn-primary" onClick={() => (last ? finish() : setStep(STEPS[index + 1] as Step))}>
            {last ? t('Done') : t('Next')}
          </button>
        </div>
      </div>
      {/* The language is read here so the dialog follows the choice made in its first step. */}
      <span hidden>{language}</span>
    </dialog>
  )
}
