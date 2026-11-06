import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '../../../core'
import {
  createRoom,
  joinRoom,
  MATCH_DECADES,
  matchOptions,
  myRooms,
  type MatchCreateRequest,
  type MatchLength,
  type MatchMode,
  type MatchRoomSummary,
} from '../../../core/modules'
import { t } from '../../../i18n'
import { PhoneIcon, TvIcon } from '../../icons'
import { errorText } from '../../useAsync'
import type { Navigate } from '../../route'
import { useModulesClient } from '../ModulesProvider'
import { lengthLabel, markScreen } from './matchShared'
import { MatchRoom } from './MatchRoom'

const ROOM_KEY = 'jellyflix.match.room'

const rememberRoom = (id: string | null): void => {
  try {
    if (id) sessionStorage.setItem(ROOM_KEY, id)
    else sessionStorage.removeItem(ROOM_KEY)
  } catch {
    // Remembering the room across a reload is a convenience.
  }
}
const rememberedRoom = (): string | null => {
  try {
    return sessionStorage.getItem(ROOM_KEY)
  } catch {
    return null
  }
}

/**
 * Match: decide what to watch by swiping films. It is played in one of two ways: **on one device** (a person, or everybody around one
 * screen, swipes here), or **on phones** (this screen shows a QR code; each person joins with their own phone and account and swipes
 * there; this screen shows who is in and plays the winner). The container only keeps the room; the votes of the others stay hidden
 * until a round ends.
 */
export function MatchPage({ session, go, join }: { session: Session; go: Navigate; join?: string }) {
  const [roomId, setRoomId] = useState<string | null>(() => rememberedRoom())
  const open = (id: string | null) => {
    rememberRoom(id)
    setRoomId(id)
  }
  if (join) {
    return (
      <Joining
        code={join}
        onJoined={(id) => {
          open(id)
          go({ page: 'modules', module: 'match' }, { replace: true })
        }}
        onCancel={() => go({ page: 'modules', module: 'match' }, { replace: true })}
      />
    )
  }
  return roomId ? <MatchRoom key={roomId} session={session} id={roomId} go={go} onLeave={() => open(null)} /> : <Start onOpen={open} />
}

/** An invitation link was opened: the room with that code is joined, and then it is the room that shows. */
function Joining({ code, onJoined, onCancel }: { code: string; onJoined: (id: string) => void; onCancel: () => void }) {
  const { client } = useModulesClient()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    joinRoom(client, code)
      .then((room) => {
        if (!cancelled) onJoined(room.id)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e))
      })
    return () => {
      cancelled = true
    }
    // Joining is done once for the link, whatever else changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, code])
  if (error) {
    return (
      <div className="mx-auto max-w-md space-y-3 text-center">
        <p role="alert" className="text-red-300">{error}</p>
        <button type="button" className="btn" onClick={onCancel}>
          {t('Back')}
        </button>
      </div>
    )
  }
  return <p role="status" className="py-16 text-center text-neutral-400">{t('Joining the Match…')}</p>
}

/** The first thing: how is it going to be played? Then (after choosing) what to watch. */
function Start({ onOpen }: { onOpen: (id: string) => void }) {
  const [mode, setMode] = useState<MatchMode | null>(null)
  return mode ? <Setup mode={mode} onBack={() => setMode(null)} onOpen={onOpen} /> : <Home onChoose={setMode} onOpen={onOpen} />
}

function Home({ onChoose, onOpen }: { onChoose: (mode: MatchMode) => void; onOpen: (id: string) => void }) {
  const { client } = useModulesClient()
  const [rooms, setRooms] = useState<MatchRoomSummary[]>([])
  const [code, setCode] = useState('')
  const [coding, setCoding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    myRooms(client)
      .then((list) => {
        if (!cancelled) setRooms(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client])

  async function joinWithCode() {
    setBusy(true)
    setError(null)
    try {
      onOpen((await joinRoom(client, code.trim())).id)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-white">{t('What are we watching tonight?')}</h2>
        <p className="mt-1 text-sm text-neutral-400">{t('Swipe films until you all like the same one. How do you want to play?')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <ModeCard
          icon={<TvIcon />}
          title={t('On this device')}
          text={t('One person, or everybody around this screen, swipes here and decides together.')}
          action={t('Play here')}
          onClick={() => onChoose('local')}
        />
        <ModeCard
          icon={<PhoneIcon />}
          title={t('Each on their phone')}
          text={t('This screen shows a QR code. Everybody joins with their own phone and account, swipes there, and this screen plays the winner.')}
          action={t('Show the QR code')}
          primary
          onClick={() => onChoose('phones')}
        />
      </div>

      <section aria-label={t('Join a Match')} className="text-center">
        {coding ? (
          <form
            className="mx-auto flex max-w-xs items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (code.trim()) void joinWithCode()
            }}
          >
            <label className="block flex-1 text-left text-sm text-neutral-300">
              {t('Code')}
              <input className="field mt-1 uppercase tracking-[.3em]" value={code} maxLength={8} autoFocus autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button type="submit" className="btn-primary" disabled={busy || !code.trim()}>
              {t('Join')}
            </button>
          </form>
        ) : (
          <button type="button" className="text-sm text-neutral-400 underline-offset-4 hover:text-white hover:underline" onClick={() => setCoding(true)}>
            {t('Do you have a code? Join a Match')}
          </button>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
      </section>

      {rooms.length > 0 && (
        <section aria-label={t('Your Matches')} className="space-y-2">
          <h2 className="text-base font-semibold text-white">{t('Your Matches')}</h2>
          <ul className="space-y-2">
            {rooms.map((r) => (
              <li key={r.id}>
                <button type="button" className="glass flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-white/[.06]" onClick={() => onOpen(r.id)}>
                  <span aria-hidden="true" className="text-neutral-400">{r.mode === 'phones' ? <PhoneIcon /> : <TvIcon />}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-100">{r.members.length > 0 ? r.members.join(', ') : t('Nobody has joined yet')}</span>
                  {r.mode === 'phones' && <span className="font-mono text-xs tracking-widest text-neutral-500">{r.code}</span>}
                  <span className="shrink-0 text-xs text-neutral-500">{r.phase === 'done' ? t('Finished') : r.phase === 'lobby' ? t('Waiting for people') : t('In progress')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ModeCard({ icon, title, text, action, primary, onClick }: { icon: ReactNode; title: string; text: string; action: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass group flex flex-col items-start gap-3 rounded-2xl p-5 text-left transition hover:bg-white/[.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${primary ? 'ring-1 ring-[var(--color-accent)]/50' : ''}`}
    >
      <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white [&_svg]:h-6 [&_svg]:w-6">
        {icon}
      </span>
      <span className="text-lg font-semibold text-white">{title}</span>
      <span className="flex-1 text-sm leading-relaxed text-neutral-400">{text}</span>
      <span className={primary ? 'btn-primary' : 'btn'}>{action}</span>
    </button>
  )
}

const SIZES = [6, 10, 16] as const

/** What to watch: a few choices that are chips to tap, and then the Match starts (on this device) or its lobby opens (on phones). */
function Setup({ mode, onBack, onOpen }: { mode: MatchMode; onBack: () => void; onOpen: (id: string) => void }) {
  const { client } = useModulesClient()
  const [genres, setGenres] = useState<string[]>([])
  const [genre, setGenre] = useState('')
  const [decade, setDecade] = useState(0)
  const [length, setLength] = useState<MatchLength | ''>('')
  const [series, setSeries] = useState(false)
  const [deckSize, setDeckSize] = useState<number>(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    matchOptions(client)
      .then((o) => {
        if (!cancelled) setGenres(o.genres)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [client])

  async function start() {
    setBusy(true)
    setError(null)
    const request: MatchCreateRequest = {
      mode,
      deckSize,
      ...(genre ? { genre } : {}),
      ...(decade ? { decade } : {}),
      ...(length ? { length } : {}),
      ...(series ? { series: true } : {}),
    }
    try {
      const room = await createRoom(client, request)
      if (mode === 'phones') markScreen(room.id)
      onOpen(room.id)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <button type="button" className="btn-ghost !px-3 text-sm" onClick={onBack}>
          ← {t('Back')}
        </button>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">{t('What do you feel like?')}</h2>
        <p className="mt-1 text-sm text-neutral-400">{mode === 'phones' ? t('Choose the kind of films. Next, everybody joins with their phone.') : t('Choose the kind of films, and start swiping.')}</p>
      </div>

      <Choice label={t('Genre')}>
        <Chip on={genre === ''} onClick={() => setGenre('')}>{t('Any genre')}</Chip>
        {genres.map((g) => (
          <Chip key={g} on={genre === g} onClick={() => setGenre(g)}>
            {g}
          </Chip>
        ))}
      </Choice>
      <Choice label={t('Decade')}>
        <Chip on={decade === 0} onClick={() => setDecade(0)}>{t('Any decade')}</Chip>
        {MATCH_DECADES.map((d) => (
          <Chip key={d} on={decade === d} onClick={() => setDecade(d)}>
            {t('{decade}s', { decade: d })}
          </Chip>
        ))}
      </Choice>
      <Choice label={t('Length')}>
        <Chip on={length === ''} onClick={() => setLength('')}>{t('Any length')}</Chip>
        {(['short', 'medium', 'long'] as const).map((l) => (
          <Chip key={l} on={length === l} onClick={() => setLength(l)}>
            {lengthLabel(l)}
          </Chip>
        ))}
      </Choice>
      <Choice label={t('Include')}>
        <Chip on={!series} onClick={() => setSeries(false)}>{t('Films only')}</Chip>
        <Chip on={series} onClick={() => setSeries(true)}>{t('Films and series')}</Chip>
      </Choice>
      <Choice label={t('Films in the first round')}>
        {SIZES.map((n) => (
          <Chip key={n} on={deckSize === n} onClick={() => setDeckSize(n)}>
            {n}
          </Chip>
        ))}
      </Choice>

      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy} onClick={() => void start()}>
        {busy ? t('Working…') : mode === 'phones' ? t('Open the lobby') : t('Start swiping')}
      </button>
    </div>
  )
}

function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-neutral-300">{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {children}
      </div>
    </fieldset>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${on ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white' : 'border-white/12 text-neutral-300 hover:border-white/30 hover:text-white'}`}
    >
      {children}
    </button>
  )
}

