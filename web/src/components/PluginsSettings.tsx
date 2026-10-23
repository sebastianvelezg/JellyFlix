import { useCallback, useEffect, useRef, useState } from 'react'
import {
  findPlugin,
  getPlugins,
  getTasks,
  isAdministrator,
  startTask,
  stopTask,
  tasksOf,
  type ServerPlugin,
  type ServerTask,
  type Session,
  type SupportedPluginKind,
} from '../core'
import { t } from '../i18n'

/** What each supported plugin gives the apps, and what its tasks do to the server, in plain words. */
const KINDS: ReadonlyArray<{ kind: SupportedPluginKind; title: string; gives: string; warns: string }> = [
  {
    kind: 'intro-skipper',
    title: 'Intro Skipper',
    gives: 'Finds the intro, recap, credits and preview of episodes, so the players show Skip buttons.',
    warns: 'Analysing reads the video files for a long time; on a big library leave it for the night.',
  },
  {
    kind: 'lyrics',
    title: 'Lyrics',
    gives: 'Downloads song lyrics (timed ones follow the music) and saves them on your server.',
    warns: 'This saves lyrics files on your server (in its metadata folder, or next to the songs if the library is set that way) and contacts the lyrics service.',
  },
  {
    kind: 'subtitles',
    title: 'Open Subtitles',
    gives: 'Looks for subtitles of movies and episodes on the internet.',
    warns: 'This saves subtitle files on your server (next to the videos if the library is set that way) and contacts OpenSubtitles.',
  },
  {
    kind: 'box-sets',
    title: 'TMDb Box Sets',
    gives: 'Groups the movies of a saga into collections (all the films of a series together), from TMDb. They show in Collections.',
    warns: 'This creates and changes collections in your library, using TMDb.',
  },
  {
    kind: 'fanart',
    title: 'Fanart.tv',
    gives: 'Adds extra pictures (backdrops, logos, discs) from Fanart.tv when the details of a title are refreshed.',
    warns: 'This contacts Fanart.tv and saves pictures on your server.',
  },
  {
    kind: 'anilist',
    title: 'AniList',
    gives: 'Fills in the titles, descriptions and pictures of anime from AniList when the details are refreshed.',
    warns: 'This contacts AniList and can change the details of anime in your library.',
  },
  {
    kind: 'playback-reporting',
    title: 'Playback Reporting',
    gives: 'Keeps the play history of everyone on your server: what was watched, when and for how long. Your stats page uses it for the real time played, the hours you watch at and your devices.',
    warns: 'This works on the play history the plugin keeps on your server: a backup saves a file, and trimming deletes old entries.',
  },
]

type Loaded = { plugins: ServerPlugin[]; tasks: ServerTask[] }

/** The Settings tab for server plugins: which supported ones the server has, and buttons for the tasks they bring. */
export function PluginsSettings({ session }: { session: Session }) {
  const [admin, setAdmin] = useState<boolean | null>(null)
  const [data, setData] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [plugins, tasks] = await Promise.all([getPlugins(session), getTasks(session)])
      if (alive.current) {
        setData({ plugins, tasks })
        setFailed(false)
      }
    } catch {
      if (alive.current) setFailed(true)
    }
  }, [session])

  // Look once when the tab opens (the first read happens after the page is drawn).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      isAdministrator(session)
        .then((yes) => {
          if (!alive.current) return
          setAdmin(yes)
          if (yes) void refresh()
        })
        .catch(() => {
          if (alive.current) setAdmin(false)
        })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [session, refresh])

  // While a task runs, follow its progress.
  const anyRunning = data?.tasks.some((task) => task.running) ?? false
  useEffect(() => {
    if (!anyRunning) return
    const timer = window.setInterval(() => void refresh(), 4000)
    return () => window.clearInterval(timer)
  }, [anyRunning, refresh])

  if (admin === null) return <p className="text-sm text-neutral-400">{t('Loading…')}</p>
  if (!admin) {
    return <p className="alert-info">{t('Only a server administrator can see plugins and run their tasks.')}</p>
  }
  if (failed && !data) {
    return (
      <div className="space-y-3">
        <p role="alert" className="alert-error">
          {t('Could not read the plugins from the server.')}
        </p>
        <button type="button" className="btn" onClick={() => void refresh()}>
          {t('Try again')}
        </button>
      </div>
    )
  }
  if (!data) return <p className="text-sm text-neutral-400">{t('Loading…')}</p>

  const known = new Set<string>()
  const cards = KINDS.map((k) => {
    const plugin = findPlugin(k.kind, data.plugins)
    if (plugin) known.add(plugin.id)
    return { ...k, plugin, tasks: plugin ? tasksOf(k.kind, data.tasks) : [] }
  })
  const others = data.plugins.filter((p) => !known.has(p.id))

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-400">
        {t('These are plugins of your Jellyfin server that this app knows how to use. The plugins do the work on the server; the buttons here only start their tasks.')}
      </p>
      {cards.map((card) => (
        <section key={card.kind} aria-label={card.title} className="glass rounded-3xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-white">{card.title}</h2>
            {card.plugin ? (
              <span className="chip">
                {card.plugin.version} · {card.plugin.status === 'Active' ? t('Active') : card.plugin.status}
              </span>
            ) : (
              <span className="chip">{t('Not installed')}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-400">{t(card.gives)}</p>
          {card.plugin && (
            <div className="mt-4 space-y-4">
              {card.tasks.length === 0 && <p className="text-sm text-neutral-500">{t('This plugin has no tasks on the server.')}</p>}
              {card.tasks.map((task) => (
                <TaskRow key={task.id} session={session} task={task} warns={card.warns} onChanged={refresh} />
              ))}
            </div>
          )}
        </section>
      ))}
      {others.length > 0 && (
        <section aria-label={t('Other plugins')} className="glass rounded-3xl p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-tight text-white">{t('Other plugins')}</h2>
          <p className="mt-1 text-sm text-neutral-400">{t('Installed on your server; this app does not use them directly.')}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {others.map((p) => (
              <li key={p.id} className="chip">
                {p.name} {p.version}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function TaskRow({ session, task, warns, onChanged }: { session: Session; task: ServerTask; warns: string; onChanged: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function act(action: () => Promise<void>) {
    setBusy(true)
    setError(false)
    try {
      await action()
      setConfirming(false)
      await onChanged()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const last =
    task.lastResult && task.lastEnd
      ? t('Last run: {result}, {date}', { result: resultLabel(task.lastResult), date: task.lastEnd.toLocaleString() })
      : t('Never run')
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-neutral-100">{task.name}</p>
          {task.description && <p className="line-clamp-2 text-xs text-neutral-500">{task.description}</p>}
          <p className="mt-1 text-xs text-neutral-400" aria-live="polite">
            {task.running ? (task.cancelling ? t('Stopping…') : t('Running… {percent}%', { percent: Math.round(task.progress ?? 0) })) : last}
          </p>
        </div>
        {task.running ? (
          <button type="button" className="btn" disabled={busy || task.cancelling} onClick={() => void act(() => stopTask(session, task.id))}>
            {t('Stop')}
          </button>
        ) : confirming ? null : (
          <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(true)}>
            {t('Run')}
          </button>
        )}
      </div>
      {task.running && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label={task.name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(task.progress ?? 0)}
        >
          <div className="h-full bg-[var(--color-accent)] transition-all" style={{ width: `${Math.min(100, task.progress ?? 0)}%` }} />
        </div>
      )}
      {confirming && !task.running && (
        <div role="group" aria-label={t('Run {task}?', { task: task.name })} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-neutral-300">
          <p>{t(warns)}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => startTask(session, task.id))}>
              {t('Run now')}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="alert-error">
          {t('The server did not accept that.')}
        </p>
      )}
    </div>
  )
}

function resultLabel(result: string): string {
  return result === 'Completed' ? t('completed') : result === 'Failed' ? t('failed') : result === 'Cancelled' ? t('cancelled') : result.toLowerCase()
}
