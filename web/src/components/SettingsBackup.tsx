import { useRef, useState } from 'react'
import { loadSettingsFromServer, saveSettingsToServer, type Session } from '../core'
import { t } from '../i18n'
import { applySettings, exportSettings, parseSettings } from '../platform/web/settingsBackup'
import { Card } from './SettingsParts'

type Notice = { kind: 'info' | 'error'; text: string } | null

/** Settings → About: your settings as a file (export and import) and on the server (save and load), only when you press the button. */
export function SettingsBackup({ session }: { session: Session }) {
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  /** The new settings are in storage: start again so the whole app, and the look painted before it loads, follow them. */
  const restart = (count: number) => {
    setNotice({ kind: 'info', text: t('Loaded {count} settings. Restarting…', { count }) })
    window.setTimeout(() => window.location.reload(), 700)
  }

  const fail = (e: unknown) => setNotice({ kind: 'error', text: t(e instanceof Error ? e.message : 'Something went wrong.') })

  function download() {
    const blob = new Blob([JSON.stringify(exportSettings(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'jellyflix-settings.json'
    link.click()
    URL.revokeObjectURL(url)
    setNotice({ kind: 'info', text: t('Saved jellyflix-settings.json. It holds only your preferences, never your account.') })
  }

  async function importFile(chosen: File | undefined) {
    if (!chosen) return
    const parsed = parseSettings(await chosen.text())
    if (file.current) file.current.value = ''
    if (!parsed.ok) return setNotice({ kind: 'error', text: t(parsed.error) })
    restart(applySettings(parsed.settings))
  }

  async function saveToServer() {
    setBusy(true)
    setNotice(null)
    try {
      await saveSettingsToServer(session, JSON.stringify(exportSettings()))
      setNotice({ kind: 'info', text: t('Saved your settings on the server. Another browser can load them from here.') })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function loadFromServer() {
    setBusy(true)
    setNotice(null)
    try {
      const saved = await loadSettingsFromServer(session)
      if (!saved) return setNotice({ kind: 'error', text: t('There are no settings saved on the server yet.') })
      const parsed = parseSettings(saved)
      if (!parsed.ok) return setNotice({ kind: 'error', text: t(parsed.error) })
      restart(applySettings(parsed.settings))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title={t('Back up and move your settings')}
      description={t('Your look, interface, player and library choices. Never your account or password.')}
    >
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={download}>
          {t('Export to a file')}
        </button>
        <button type="button" className="btn" onClick={() => file.current?.click()}>
          {t('Import from a file')}
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('Settings file')}
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={busy} onClick={() => void saveToServer()}>
          {t('Save on the server')}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void loadFromServer()}>
          {t('Load from the server')}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-neutral-500">
        {t('On the server they go in your own display preferences, the place Jellyfin keeps them for you. Nothing is saved or loaded unless you press a button.')}
      </p>
      {notice && (
        <p role={notice.kind === 'error' ? 'alert' : 'status'} className={notice.kind === 'error' ? 'alert-error' : 'alert-info'}>
          {notice.text}
        </p>
      )}
    </Card>
  )
}
