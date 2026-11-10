import { useState } from 'react'
import type { ActivationPreview } from '../platform/web/sync'
import { SYNC_SECTIONS, type Session, type SyncSectionName } from '../core'
import { getLanguage, t, tr } from '../i18n'
import { disableSync, enableSync, previewActivation, runSync, useSyncStatus } from '../platform/web/sync'
import { Card, Toggle } from './SettingsParts'

const SECTION_NAME: Record<SyncSectionName, string> = {
  appearance: tr('Look and menu'),
  playback: tr('Playback choices'),
}

const DEVICE_NAME: Record<string, string> = { web: tr('Jellyflix Web'), tv: tr('Jellyflix TV') }

/** Settings → General: the optional sync of a few preferences with this account's other devices, and its first-time choice. */
export function SyncSettings({ session }: { session: Session }) {
  const status = useSyncStatus()
  const [choice, setChoice] = useState<Extract<ActivationPreview, { kind: 'ask' }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  async function turnOn() {
    setError(null)
    setStarting(true)
    try {
      const preview = await previewActivation(session)
      if (preview.kind === 'ask') setChoice(preview)
      else await enableSync(session, 'upload')
    } catch (e) {
      setError(t(e instanceof Error ? e.message : 'Something went wrong.'))
    } finally {
      setStarting(false)
    }
  }

  async function start(use: 'use-account' | 'upload') {
    setChoice(null)
    setStarting(true)
    try {
      await enableSync(session, use)
    } catch (e) {
      setError(t(e instanceof Error ? e.message : 'Something went wrong.'))
    } finally {
      setStarting(false)
    }
  }

  const report = status.report
  const when = (ms: number) => new Date(ms).toLocaleString(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Card
      title={t('Sync settings with your account')}
      description={t(
        'Keeps your theme, menu, home rows and a few playback choices the same on every device you use with this account (the web app and the TV app). What depends on the screen or the connection, such as poster size, text size, a TV’s margin or the quality limit, is never synced. It is off until you turn it on.',
      )}
    >
      <Toggle
        label={t('Sync with my account')}
        hint={t('Each account on each device chooses for itself.')}
        checked={status.enabled || starting}
        onChange={(on) => {
          if (on) void turnOn()
          else disableSync()
        }}
      />

      {choice && (
        <div role="group" aria-label={t('Your account already has saved settings')} className="space-y-3 rounded-2xl border border-white/10 bg-white/[.04] p-4">
          <p className="text-sm font-medium text-white">{t('Your account already has saved settings')}</p>
          <p className="text-sm text-neutral-300">
            {choice.sections
              .map((s) => t('{sections} saved by {device} on {date}', { sections: t(SECTION_NAME[s.name]), device: t(DEVICE_NAME[s.by] ?? 'another device'), date: when(s.at) }))
              .join('. ')}
            . {t('Which should this device use?')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => void start('use-account')}>
              {t('Use the saved settings')}
            </button>
            <button type="button" className="btn" onClick={() => void start('upload')}>
              {t('Upload this device’s settings')}
            </button>
            <button type="button" className="btn" onClick={() => setChoice(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}

      {status.enabled && (
        <div className="space-y-2">
          <p role="status" className="text-sm text-neutral-400">
            {status.busy
              ? t('Syncing…')
              : report?.error
                ? t('Could not sync: {error}. Your changes are kept here and sent when it can.', { error: report.error })
                : report
                  ? t('Last synced {time}.', { time: when(report.at) })
                  : t('Not synced yet.')}
          </p>
          <button type="button" className="btn" disabled={status.busy} onClick={() => void runSync(session)}>
            {t('Sync now')}
          </button>
          <p className="text-xs text-neutral-500">{SYNC_SECTIONS.map((name) => t(SECTION_NAME[name])).join(' · ')}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
    </Card>
  )
}
