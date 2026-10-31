import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { authorizeQuickConnect, CLIENT_VERSION, languageName, type Session } from '../core'
import {
  clearBrowsePrefs,
  clearSeriesPrefs,
  countSeriesPrefs,
  COUNTDOWN_CHOICES,
  CROSSFADE_CHOICES,
  CONVERTIBLE_AUDIO,
  QUALITY_CHOICES,
  readPlayerPrefs,
  readUiPrefs,
  writePlayerPrefs,
  writeUiPrefs,
  SKIP_ACTIONS,
  SKIP_KINDS,
  TIME_LABELS,
  type ConvertibleAudio,
  type SkipAction,
  type SkipKind,
  type SubtitleSize,
  type TimeLabel,
} from '../platform/web/prefs'
import { BackIcon } from './icons'
import { LANGUAGES, t, tr, type LanguageChoice } from '../i18n'
import { chooseLanguage } from './useLanguage'
import { useInstallState } from '../platform/web/pwa'
import { PluginsSettings } from './PluginsSettings'
import { useIsAdmin } from './admin/editorEvents'
import { AppearanceSettings } from './AppearanceSettings'
import { SettingsBackup } from './SettingsBackup'
import { openShortcuts } from './ShortcutsDialog'
import { Card, Toggle } from './SettingsParts'
import { KidsCard } from './KidsMode'
import { openSetup } from './SetupWizard'
import { SETTINGS_INDEX, searchSettings, type SettingEntry } from './settingsIndex'

/** Putting the app on a phone, tablet or computer so it opens like any other app (its own window and icon, no browser bars). */
function InstallApp() {
  const install = useInstallState()
  const [failed, setFailed] = useState(false)
  if (install.kind === 'installed') return <p className="text-sm text-neutral-300">{t('This is the installed app.')}</p>
  return (
    <div className="space-y-3">
      {install.kind === 'prompt' ? (
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFailed(false)
              install.install().catch(() => setFailed(true))
            }}
          >
            {t('Install the app')}
          </button>
          {failed && (
            <p role="alert" className="alert-error">
              {t('Could not install it. Try the browser menu instead.')}
            </p>
          )}
        </>
      ) : install.kind === 'ios' ? (
        <p className="text-sm text-neutral-300">{t('In Safari, tap the Share button, then “Add to Home Screen”.')}</p>
      ) : (
        <p className="text-sm text-neutral-300">{t('Open the browser menu and choose “Install app” (or “Add to Home screen”).')}</p>
      )}
      <p className="text-xs leading-relaxed text-neutral-500">
        {t('Chrome and Edge only offer the install button on a secure address (https:// or localhost); on plain http the menu entry just adds a shortcut.')}
      </p>
    </div>
  )
}

/** The other half of Quick Connect: types the code a TV is showing, so that TV signs in as this user. */
function ApproveCode({ session }: { session: Session }) {
  const [code, setCode] = useState('')
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  async function approve(event: React.FormEvent) {
    event.preventDefault()
    setState({ kind: 'busy' })
    try {
      await authorizeQuickConnect(session, code)
      setCode('')
      setState({ kind: 'done' })
    } catch (e) {
      setState({ kind: 'error', message: t(e instanceof Error ? e.message : 'Something went wrong.') })
    }
  }
  return (
    <form onSubmit={approve} className="space-y-2">
      <label htmlFor="approve-code" className="block text-sm font-medium text-neutral-100">
        {t('Code shown on the other screen')}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="approve-code"
          className="field w-40 text-center font-mono tracking-[0.3em]"
          inputMode="numeric"
          autoComplete="off"
          maxLength={7}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
        />
        <button type="submit" className="btn" disabled={state.kind === 'busy' || code.replace(/\s/g, '').length !== 6}>
          {t('Approve')}
        </button>
      </div>
      {state.kind === 'done' && (
        <p role="status" className="alert-info">
          {t('Done. The other device is signing in.')}
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="alert-error">
          {state.message}
        </p>
      )}
    </form>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="text-sm text-neutral-400">{label}</span>
      <span className="min-w-0 text-sm text-neutral-100">{children}</span>
    </div>
  )
}

const TIME_LABEL_TEXT: Record<TimeLabel, string> = {
  elapsed: tr('Time played'),
  remaining: tr('Time left'),
  total: tr('Total length'),
  endsAt: tr('Time it ends'),
  none: tr('Nothing'),
}
const SKIP_KIND_TEXT: Record<SkipKind, string> = {
  intro: tr('Skip intros'),
  recap: tr('Skip recaps'),
  outro: tr('Skip credits'),
  preview: tr('Skip previews'),
}
const SKIP_ACTION_TEXT: Record<SkipAction, string> = {
  ask: tr('Offer a button'),
  auto: tr('Skip by itself'),
  off: tr('Do nothing'),
}
const CONVERT_TEXT: Record<ConvertibleAudio, string> = {
  ac3: tr('AC-3 (Dolby Digital)'),
  eac3: tr('E-AC-3 (Dolby Digital Plus)'),
  flac: tr('FLAC'),
}

type PlayerPrefsValue = ReturnType<typeof readPlayerPrefs>

/** The bar of the video player, and what the player does on its own: skip buttons, scrubbing, converted sound. */
function PlayerCard({ player, update }: { player: PlayerPrefsValue; update: (patch: Partial<PlayerPrefsValue>) => void }) {
  const timeSelect = (id: string, label: string, value: TimeLabel, onChange: (value: TimeLabel) => void) => (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm font-medium text-neutral-100">
        {label}
      </label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as TimeLabel)}>
        {TIME_LABELS.map((kind) => (
          <option key={kind} value={kind}>
            {t(TIME_LABEL_TEXT[kind])}
          </option>
        ))}
      </select>
    </div>
  )
  return (
    <Card title={t('Player')} description={t('The seek bar, the skip buttons and the sound.')}>
      <Toggle
        label={t('Chapter marks on the seek bar')}
        hint={t('Draws where each chapter starts.')}
        checked={player.chapterMarks}
        onChange={(chapterMarks) => update({ chapterMarks })}
      />
      <Toggle
        label={t('Pause while dragging the seek bar')}
        hint={t('The picture waits until you let go.')}
        checked={player.pauseWhileScrubbing}
        onChange={(pauseWhileScrubbing) => update({ pauseWhileScrubbing })}
      />
      {timeSelect('time-left', t('Left of the seek bar'), player.timeLeft, (timeLeft) => update({ timeLeft }))}
      {timeSelect('time-right', t('Right of the seek bar'), player.timeRight, (timeRight) => update({ timeRight }))}
      {SKIP_KINDS.map((kind) => (
        <div key={kind} className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor={`skip-${kind}`} className="text-sm font-medium text-neutral-100">
            {t(SKIP_KIND_TEXT[kind])}
          </label>
          <select
            id={`skip-${kind}`}
            className="select"
            value={player.skipActions[kind]}
            onChange={(e) => update({ skipActions: { ...player.skipActions, [kind]: e.target.value as SkipAction } })}
          >
            {SKIP_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {t(SKIP_ACTION_TEXT[action])}
              </option>
            ))}
          </select>
        </div>
      ))}
      <p className="-mt-2 text-xs text-neutral-500">{t('Only titles whose server knows where the intro and the credits are get these buttons.')}</p>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-neutral-100">{t('Have the server convert this sound')}</legend>
        <p className="-mt-1 text-xs text-neutral-500">
          {t('For a receiver that stays silent, or a film whose sound plays with the wrong channels. The picture is not touched.')}
        </p>
        {CONVERTIBLE_AUDIO.map((codec) => (
          <Toggle
            key={codec}
            label={t(CONVERT_TEXT[codec])}
            checked={player.convertAudio.includes(codec)}
            onChange={(on) => update({ convertAudio: on ? [...player.convertAudio, codec] : player.convertAudio.filter((c) => c !== codec) })}
          />
        ))}
      </fieldset>
    </Card>
  )
}

/** The element of the open tab that carries a setting's name, and the control next to it. */
function findSetting(panel: HTMLElement, text: string): HTMLElement | null {
  const named = [...panel.querySelectorAll<HTMLElement>('h2, legend, label, span, p, button')].find((n) => n.textContent?.trim() === text)
  if (!named) return null
  const scope = named.closest('label, fieldset') ?? named.closest('section') ?? named.parentElement
  return scope?.querySelector<HTMLElement>('input, select, button, textarea') ?? named
}

/** A box above the tabs that finds a setting by what it is called, and takes you to it. */
function SettingsSearch({ isAdmin, tabName, onPick }: { isAdmin: boolean; tabName: (tab: SettingEntry['tab']) => string; onPick: (entry: SettingEntry) => void }) {
  const [query, setQuery] = useState('')
  const listId = useId()
  const entries = SETTINGS_INDEX.filter((e) => isAdmin || !e.admin)
  const found = searchSettings(query, entries, (e) => t(e.label), tabName)
  const pick = (entry: SettingEntry) => {
    setQuery('')
    onPick(entry)
  }
  return (
    <div className="relative mb-4">
      <label htmlFor={`${listId}-input`} className="sr-only">
        {t('Search settings')}
      </label>
      <input
        id={`${listId}-input`}
        type="search"
        className="field rounded-full"
        placeholder={t('Search settings')}
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQuery('')
          if (e.key === 'Enter' && found[0]) pick(found[0])
        }}
      />
      {query.trim() !== '' && (
        <ul id={listId} aria-label={t('Matching settings')} className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-surface-2)]">
          {found.length === 0 ? (
            <li className="px-4 py-3 text-sm text-neutral-400" role="status">
              {t('No setting has that name.')}
            </li>
          ) : (
            found.map((entry) => (
              <li key={`${entry.tab}:${entry.label}`}>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-neutral-100 transition hover:bg-white/[.08] focus-visible:bg-white/[.08] focus-visible:outline-none" onClick={() => pick(entry)}>
                  <span>{t(entry.label)}</span>
                  <span className="shrink-0 text-xs text-neutral-500">{tabName(entry.tab)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

const TABS = ['general', 'appearance', 'playback', 'devices', 'plugins', 'about'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = { general: 'General', appearance: 'Appearance', playback: 'Playback', devices: 'Devices', plugins: 'Plugins', about: 'About' }

/** Account, playback and interface preferences, and the server's plugins. Everything but the plugins is stored on this device only. */

export function SettingsPage({
  session,
  onBack,
  onSignOut,
  onStats,
  onAdmin,
}: {
  session: Session
  onBack: () => void
  onSignOut: () => void
  onStats: () => void
  /** Opens the administration page (only offered to administrators). */
  onAdmin: () => void
}) {
  const [player, setPlayer] = useState(readPlayerPrefs)
  const [ui, setUi] = useState(readUiPrefs)
  const [remembered, setRemembered] = useState(countSeriesPrefs)
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('general')
  const isAdmin = useIsAdmin(session)
  const tabButtons = useRef<Record<string, HTMLButtonElement | null>>({})
  // A setting found by the search: the tab it is in opens, and then the page goes to it.
  const jump = useRef<SettingEntry | null>(null)
  const [jumpCount, setJumpCount] = useState(0)
  useEffect(() => {
    const entry = jump.current
    if (!entry) return
    jump.current = null
    const panel = document.getElementById('settings-panel')
    const target = panel ? findSetting(panel, t(entry.label)) : null
    target?.scrollIntoView({ block: 'center' })
    target?.focus({ preventScroll: true })
  }, [jumpCount])
  // Left and Right move between the tabs, as in any tab list.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const at = TABS.indexOf(tab)
    const next = TABS[e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (at + step + TABS.length) % TABS.length] as Tab
    setTab(next)
    tabButtons.current[next]?.focus()
  }

  const updatePlayer = (patch: Partial<typeof player>) => {
    writePlayerPrefs(patch)
    setPlayer(readPlayerPrefs())
  }
  const subtitleLanguage = player.subtitleLanguage ? (languageName(player.subtitleLanguage) ?? player.subtitleLanguage) : t('Off')

  return (
    <div className="mx-auto max-w-3xl pt-8">
      <button type="button" className="btn mb-5" onClick={onBack}>
        <BackIcon /> {t('Back')}
      </button>
      <h1 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">{t('Settings')}</h1>

      <SettingsSearch
        isAdmin={isAdmin}
        tabName={(id) => t(TAB_LABEL[id])}
        onPick={(entry) => {
          setTab(entry.tab)
          jump.current = entry
          setJumpCount((n) => n + 1)
        }}
      />

      <div role="tablist" aria-label={t('Settings')} className="no-scrollbar -mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((id) => (
          <button
            key={id}
            ref={(el) => {
              tabButtons.current[id] = el
            }}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="settings-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={onTabKey}
            className={`tab shrink-0`}
          >
            {t(TAB_LABEL[id])}
          </button>
        ))}
      </div>

      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="space-y-5">
        {tab === 'general' && (<>
        <Card title={t('Account')}>
          <Row label={t('Signed in as')}>{session.userName}</Row>
          <Row label={t('Server')}>
            {session.serverName}
            {session.serverVersion ? <span className="text-neutral-500"> Jellyfin {session.serverVersion}</span> : null}
          </Row>
          <Row label={t('Address')}>
            <span className="break-all">{session.serverUrl}</span>
          </Row>
          <button type="button" className="btn" onClick={onSignOut}>
            {t('Sign out')}
          </button>
        </Card>

        <Card title={t('Interface')}>
          <Toggle
            label={t('Rotate the featured banner')}
            hint={t('Moves to the next title every 10 seconds on the home pages. It always stays still if your system asks for reduced motion.')}
            checked={ui.autoRotateBanner}
            onChange={(autoRotateBanner) => {
              writeUiPrefs({ autoRotateBanner })
              setUi(readUiPrefs())
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-neutral-100">{t('Your stats')}</span>
            <button type="button" className="btn" onClick={onStats}>
              {t('Show my stats')}
            </button>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium text-neutral-100">{t('Administration')}</span>
                <span className="block text-xs text-neutral-500">{t('Libraries, accounts, devices and the server.')}</span>
              </span>
              <button type="button" className="btn" onClick={onAdmin}>
                {t('Open administration')}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-neutral-100">{t('Keyboard shortcuts')}</span>
            <button type="button" className="btn" onClick={openShortcuts}>
              {t('Show the list')}
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="language" className="text-sm font-medium text-neutral-100">
              {t('Language')}
            </label>
            <select
              id="language"
              className="select"
              value={ui.language}
              onChange={(e) => {
                chooseLanguage(e.target.value as LanguageChoice)
                setUi(readUiPrefs())
              }}
            >
              <option value="auto">{t('Automatic (your browser)')}</option>
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </Card>

        <KidsCard session={session} />

        <Card title={t('Install')} description={t('Add Jellyflix to the home screen or desktop of this device.')}>
          <InstallApp />
        </Card>
        </>)}
        {tab === 'appearance' && <AppearanceSettings />}
        {tab === 'playback' && (<>
        <Card title={t('Playback')} description={t('Applies to everything you watch on this device.')}>
          <Toggle
            label={t('Play the next episode automatically')}
            hint={t('When an episode, or a title of a playlist or collection, ends, the next one starts after a short countdown.')}
            checked={player.autoplayNext}
            onChange={(autoplayNext) => updatePlayer({ autoplayNext })}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="autoplay-countdown" className="text-sm font-medium text-neutral-100">
              {t('Countdown before the next title')}
            </label>
            <select
              id="autoplay-countdown"
              className="select"
              value={player.autoplayCountdown}
              disabled={!player.autoplayNext}
              onChange={(e) => updatePlayer({ autoplayCountdown: Number(e.target.value) })}
            >
              {COUNTDOWN_CHOICES.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {t('{seconds} seconds', { seconds })}
                </option>
              ))}
            </select>
          </div>
          <Toggle
            label={t('Cinema mode')}
            hint={t('The picture fades in from black and the controls get out of the way sooner, even while paused. You can also switch it in the player.')}
            checked={player.cinemaMode}
            onChange={(cinemaMode) => updatePlayer({ cinemaMode })}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="subtitle-size" className="text-sm font-medium text-neutral-100">
              {t('Subtitle size')}
            </label>
            <select
              id="subtitle-size"
              className="select"
              value={player.subtitleSize}
              onChange={(e) => updatePlayer({ subtitleSize: e.target.value as SubtitleSize })}
            >
              <option value="small">{t('Small')}</option>
              <option value="medium">{t('Medium')}</option>
              <option value="large">{t('Large')}</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="max-quality" className="text-sm font-medium text-neutral-100">
              {t('Maximum quality')}
            </label>
            <select
              id="max-quality"
              className="select"
              value={player.maxBitrateMbps}
              onChange={(e) => updatePlayer({ maxBitrateMbps: Number(e.target.value) })}
            >
              {QUALITY_CHOICES.map((mbps) => (
                <option key={mbps} value={mbps}>
                  {mbps === 0 ? t('Original quality') : t('Up to {mbps} Mbps', { mbps })}
                </option>
              ))}
            </select>
          </div>
          <p className="-mt-2 text-xs text-neutral-500">
            {t('Above the limit the server sends a smaller picture. Useful on a slow connection. You can also change it while you watch.')}
          </p>
          <Row label={t('Subtitles in the next movie')}>
            {subtitleLanguage}{' '}
            {player.subtitleLanguage && (
              <button type="button" className="ml-2 text-[var(--color-accent)] hover:underline" onClick={() => updatePlayer({ subtitleLanguage: null })}>
                {t('Turn off')}
              </button>
            )}
          </Row>
          <p className="-mt-2 text-xs text-neutral-500">
            {t('The language you pick in the player is switched on automatically next time.')}
          </p>
        </Card>

        <PlayerCard player={player} update={updatePlayer} />

        <Card title={t('Music')} description={t('How songs follow each other.')}>
          <Toggle
            label={t('Gapless playback')}
            hint={t('The next song is made ready before this one ends, so there is no pause between songs.')}
            checked={player.gapless}
            onChange={(gapless) => updatePlayer({ gapless })}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="crossfade" className="text-sm font-medium text-neutral-100">
              {t('Crossfade between songs')}
            </label>
            <select
              id="crossfade"
              className="select"
              value={player.crossfadeSeconds}
              onChange={(e) => updatePlayer({ crossfadeSeconds: Number(e.target.value) })}
            >
              {CROSSFADE_CHOICES.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds === 0 ? t('Off') : t('{seconds} seconds', { seconds })}
                </option>
              ))}
            </select>
          </div>
          <p className="-mt-2 text-xs text-neutral-500">
            {t('The end of a song fades into the start of the next one. Songs shorter than twice the fade just follow each other.')}
          </p>
        </Card>

        </>)}
        {tab === 'devices' && (<>
        <Card title={t('Devices')} description={t('Sign in a TV or another device without typing a password.')}>
          <ApproveCode session={session} />
          <p className="text-xs leading-relaxed text-neutral-500">
            {t('Your other devices with Jellyflix open (a TV, a phone, another computer) show up under “Play on…”. Start something on one, or hand over what is playing here, and control it from any of them.')}
          </p>
        </Card>

        </>)}
        {tab === 'plugins' && <PluginsSettings session={session} />}
        {tab === 'about' && (<>
        <Card title={t('Set up again')} description={t('The first questions once more: the language, the look and the subtitles.')}>
          <button type="button" className="btn" onClick={openSetup}>
            {t('Run the setup again')}
          </button>
        </Card>

        <Card title={t('Saved on this device')} description={t('Small preferences that make the app feel familiar. Clearing them never touches your server.')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-neutral-100">
              {t('Audio and subtitle choices remembered for {count} series', { count: remembered })}
            </span>
            <button
              type="button"
              className="btn"
              disabled={remembered === 0}
              onClick={() => {
                clearSeriesPrefs()
                setRemembered(0)
                setNotice(t('Forgot the audio and subtitle choices for every series.'))
              }}
            >
              {t('Forget them')}
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-neutral-100">{t('Sort, filter and library choices')}</span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                clearBrowsePrefs()
                setNotice(t('Sort and filter choices are back to their defaults the next time you open a library.'))
              }}
            >
              {t('Reset')}
            </button>
          </div>
          {notice && (
            <p role="status" className="alert-info">
              {notice}
            </p>
          )}
        </Card>

        <SettingsBackup session={session} />

        <Card title={t('About')}>
          <Row label={t('Version')}>{t('Jellyflix Web')} {CLIENT_VERSION}</Row>
          <p className="text-xs leading-relaxed text-neutral-500">
            {t('An independent, open-source Jellyfin web client. It talks only to the server you signed in to: no analytics, no cloud services, no fonts or scripts from anywhere else.')}
          </p>
        </Card>
        </>)}
      </div>
    </div>
  )
}
