import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '../../../core'
import {
  isUnchanged,
  joinRoom,
  leaveRoom,
  pickCard,
  playAgain,
  readRoom,
  startMatch,
  swipeCard,
  whatIsWaiting,
  type MatchCard,
  type MatchRoomView,
  type MatchVote,
} from '../../../core/modules'
import { t } from '../../../i18n'
import { errorText } from '../../useAsync'
import { PlayOnButton } from '../../remote/PlayOnButton'
import type { Navigate } from '../../route'
import { useModulesClient } from '../ModulesProvider'
import { InviteBox } from './InviteBox'
import { announce, filterWords, screenRooms, unmarkScreen } from './matchShared'
import { MatchSummaryCard } from './MatchSummaryCard'
import { Poster } from './Poster'
import { SwipeDeck } from './SwipeDeck'

const POLL_MS = 2500
/** With the page hidden it still looks now and then, so a notification can arrive. */
const HIDDEN_POLL_MS = 10_000

/** Says what changed in the room since the last time it was looked at (somebody joined or finished, a new round, a winner). */
function announceChanges(before: MatchRoomView, next: MatchRoomView): void {
  if (next.phase === 'done' && before.phase !== 'done') {
    announce(next.winner ? t('It is a match: {title}', { title: next.winner.name }) : t('It is a match.'))
    return
  }
  if (before.phase === 'lobby' && next.phase === 'swipe') {
    announce(t('The swiping has started.'))
    return
  }
  if (next.round !== before.round && next.phase === 'swipe') {
    announce(t('Round {round}: {count} films left.', { round: next.round, count: next.deck.length }))
    return
  }
  if (next.phase !== before.phase && next.phase === 'pick') {
    announce(t('Time to choose a favourite.'))
    return
  }
  for (const m of next.members) {
    if (m.id === next.me) continue
    const was = before.members.find((x) => x.id === m.id)
    if (!was) announce(t('{name} joined.', { name: m.name }))
    else if (!was.done && m.done && before.round === next.round && before.phase === next.phase) {
      announce(next.phase === 'pick' ? t('{name} chose a favourite.', { name: m.name }) : t('{name} finished the round.', { name: m.name }))
    }
  }
}

/**
 * A Match that was started. What it shows depends on who is looking:
 *  - On one device: the person swipes here.
 *  - On phones, the device that started it is the *screen*: the code to join, who is in, the cards of the round, who has finished and,
 *    at the end, the winner to play. The people swipe on their phones.
 *  - On phones, a *phone*: waits in the lobby, swipes, waits for the others, and sees the winner (the screen plays it).
 */
export function MatchRoom({ session, id, go, onLeave }: { session: Session; id: string; go: Navigate; onLeave: () => void }) {
  const { client } = useModulesClient()
  const [view, setView] = useState<MatchRoomView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState(false)
  const [notifyAsk, setNotifyAsk] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'default')
  // The round whose cards were looked at first (rounds after the first begin with a look at what is left).
  const [introDone, setIntroDone] = useState(1)
  // This device was the screen but its person chose to swipe here too.
  const [swipeHere, setSwipeHere] = useState(false)
  const [flaggedScreen] = useState(() => screenRooms().includes(id))
  const version = useRef(0)
  const last = useRef<MatchRoomView | null>(null)
  // Votes sent but not answered yet: their cards stay gone even if an older answer still lists them.
  const pending = useRef(new Map<string, MatchVote>())

  const apply = useCallback((next: MatchRoomView) => {
    if (next.version < version.current) return
    version.current = next.version
    const before = last.current
    last.current = next
    if (before) announceChanges(before, next)
    setView({ ...next, remaining: next.remaining.filter((c) => !pending.current.has(c.id)) })
  }, [])

  // The room is asked about again while it is on the screen; an answer of "unchanged" costs nothing.
  useEffect(() => {
    let cancelled = false
    let timer = 0
    const look = async () => {
      try {
        const answer = await readRoom(client, id, version.current || undefined)
        if (cancelled) return
        if (!isUnchanged(answer)) apply(answer)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(errorText(e))
      }
      if (!cancelled) timer = window.setTimeout(() => void look(), document.visibilityState === 'visible' ? POLL_MS : HIDDEN_POLL_MS)
    }
    void look()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [client, id, apply])

  async function swipe(card: MatchCard, vote: MatchVote) {
    pending.current.set(card.id, vote)
    setView((v) => (v ? { ...v, remaining: v.remaining.filter((c) => c.id !== card.id), myVotes: { ...v.myVotes, [card.id]: vote } } : v))
    try {
      const next = await swipeCard(client, id, card.id, vote)
      pending.current.delete(card.id)
      apply(next)
    } catch (e) {
      pending.current.delete(card.id)
      setError(errorText(e))
      // The vote did not get through: the card comes back.
      setView((v) => (v ? { ...v, remaining: [card, ...v.remaining] } : v))
    }
  }

  async function act(work: () => Promise<MatchRoomView>) {
    try {
      apply(await work())
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function leave() {
    try {
      await leaveRoom(client, id)
    } catch {
      // If it did not work the room is simply still there.
    }
    unmarkScreen(id)
    onLeave()
  }

  async function voteFromHere() {
    if (!view) return
    await act(() => joinRoom(client, view.code))
    unmarkScreen(id)
    setSwipeHere(true)
  }

  async function askNotifications() {
    try {
      await Notification.requestPermission()
    } finally {
      setNotifyAsk(typeof Notification !== 'undefined' && Notification.permission === 'default')
    }
  }

  if (!view) {
    return error ? (
      <div className="space-y-3 text-center">
        <p role="alert" className="text-red-300">{error}</p>
        <button type="button" className="btn" onClick={onLeave}>
          {t('Back')}
        </button>
      </div>
    ) : (
      <p role="status" className="py-16 text-center text-neutral-400">{t('Loading…')}</p>
    )
  }

  const phones = view.mode === 'phones'
  const isHost = view.hostId === view.me
  const isMember = view.members.some((m) => m.id === view.me)
  // The device that opened a Match for phones is its screen, unless its person chose to swipe on it too.
  const screen = phones && !swipeHere && (flaggedScreen || (isHost && !isMember))
  const others = view.members.filter((m) => m.id !== view.me)
  const waiting = others.filter((m) => !m.done)
  const wait = whatIsWaiting(view)
  const words = filterWords(view.filters)
  const playsHere = !phones || screen
  const intro = view.phase === 'swipe' && view.round > 1 && view.round > introDone && view.remaining.length === view.deck.length && view.deck.length > 0

  return (
    <div className={`mx-auto space-y-5 ${screen ? 'max-w-4xl' : 'max-w-xl'}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="chip">{phones ? t('On phones') : t('On this device')}</span>
        {phones && (
          <span className="text-sm text-neutral-400">
            {t('Code')} <span className="ml-1 font-mono text-base tracking-[.25em] text-white">{view.code}</span>
          </span>
        )}
        <span className="flex-1" />
        {phones && view.phase !== 'done' && view.phase !== 'lobby' && !screen && (
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" aria-pressed={invite} onClick={() => setInvite((on) => !on)}>
            {t('Invite')}
          </button>
        )}
        {phones && notifyAsk && (
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => void askNotifications()}>
            {t('Notify me')}
          </button>
        )}
        <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => void leave()}>
          {screen || !phones ? t('Close the Match') : t('Leave')}
        </button>
      </header>

      {words.length > 0 && (
        <p className="flex flex-wrap gap-1.5" aria-label={t('What the cards are')}>
          {words.map((w) => (
            <span key={w} className="chip">
              {w}
            </span>
          ))}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {invite && phones && view.phase !== 'done' && <InviteBox code={view.code} />}

      {/* ---- the lobby of a Match for phones ---- */}
      {view.phase === 'lobby' &&
        (screen ? (
          <div className="grid gap-5 md:grid-cols-[auto_1fr]">
            <InviteBox code={view.code} large />
            <section aria-label={t('Who is in')} className="glass flex flex-col gap-4 rounded-2xl p-5">
              <h2 className="text-base font-semibold text-white">{t('Who is in')}</h2>
              {view.members.length === 0 ? (
                <p className="text-sm text-neutral-400">{t('Nobody yet. Scan the code with your phone.')}</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {view.members.map((m) => (
                    <li key={m.id} className="chip chip-accent">
                      {m.name}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto flex flex-col gap-2">
                <button type="button" className="btn-primary w-full" disabled={view.members.length === 0} onClick={() => void act(() => startMatch(client, id))}>
                  {view.members.length === 0 ? t('Waiting for people…') : t('Start swiping ({count} in)', { count: view.members.length })}
                </button>
                <button type="button" className="btn-ghost text-xs" onClick={() => void voteFromHere()}>
                  {t('I want to swipe on this device too')}
                </button>
              </div>
            </section>
          </div>
        ) : (
          <div role="status" className="glass space-y-4 rounded-2xl p-6 text-center">
            <p className="text-lg font-semibold text-white">{t('You are in!')}</p>
            <p className="text-neutral-300">{isHost ? t('Start the swiping when everybody has joined.') : t('Waiting for {name} to start the swiping…', { name: view.hostName })}</p>
            <ul className="flex flex-wrap justify-center gap-2">
              {view.members.map((m) => (
                <li key={m.id} className={`chip ${m.id === view.me ? 'chip-accent' : ''}`}>
                  {m.name}
                </li>
              ))}
            </ul>
            {isHost && (
              <button type="button" className="btn-primary" onClick={() => void act(() => startMatch(client, id))}>
                {t('Start swiping ({count} in)', { count: view.members.length })}
              </button>
            )}
          </div>
        ))}

      {/* ---- swiping ---- */}
      {view.phase === 'swipe' &&
        (screen ? (
          <ScreenRound session={session} view={view} title={t('Round {round}', { round: view.round })} text={t('Everybody swipes on their own phone.')} />
        ) : intro ? (
          <RoundIntro session={session} view={view} onGo={() => setIntroDone(view.round)} />
        ) : (
          <>
            <RoundHeader view={view} />
            {view.remaining.length > 0 ? (
              <SwipeDeck session={session} cards={view.remaining} total={view.deck.length} onVote={(card, vote) => void swipe(card, vote)} />
            ) : (
              <WaitingForOthers view={view} text={wait === 'others-to-finish' ? t('Waiting for {names} to finish…', { names: waiting.map((m) => m.name).join(', ') }) : t('Counting the votes…')} />
            )}
          </>
        ))}

      {/* ---- choosing a favourite ---- */}
      {view.phase === 'pick' &&
        (screen ? (
          <ScreenRound session={session} view={view} title={t('Choose your favourite')} text={t('Everybody chooses a favourite on their own phone.')} />
        ) : (
          <section aria-label={t('Choose your favourite')} className="space-y-3">
            <p className="text-center text-sm text-neutral-300">
              {view.lastLiked.length > 0
                ? t('You all liked these. Choose your favourite; if you choose different ones, chance decides.')
                : t('Nobody agreed and there are no more films. Choose your favourite of these; if you choose different ones, chance decides.')}
            </p>
            {view.myPick ? (
              <WaitingForOthers view={view} text={waiting.length > 0 ? t('Waiting for {names} to choose…', { names: waiting.map((m) => m.name).join(', ') }) : t('Counting the votes…')} />
            ) : (
              <ul className="grid grid-cols-2 gap-3">
                {view.deck.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="glass block w-full overflow-hidden rounded-xl text-left transition hover:ring-2 hover:ring-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" onClick={() => void act(() => pickCard(client, id, c.id))}>
                      <Poster session={session} card={c} className="aspect-[2/3] w-full" />
                      <span className="block truncate px-3 py-2 text-sm text-neutral-100">{c.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

      {/* ---- the winner ---- */}
      {view.phase === 'done' && view.winner && (
        <section aria-label={t('The winner')} className="space-y-5 text-center">
          <p className="text-sm font-semibold uppercase tracking-[.25em] text-[var(--color-accent)]">{view.winnerBy === 'coin' ? t('Chance decided') : t('It is a match')}</p>
          <div className="glass mx-auto max-w-xs overflow-hidden rounded-2xl shadow-[0_0_70px_var(--glow)]">
            <Poster session={session} card={view.winner} className="aspect-[2/3] w-full" />
            <div className="space-y-1 p-4">
              <h2 className="text-xl font-semibold text-white">{view.winner.name}</h2>
              <p className="text-sm text-neutral-400">
                {[view.winner.kind === 'Series' ? t('Series') : null, view.winner.year, view.winner.runtimeMinutes ? t('{minutes} min', { minutes: view.winner.runtimeMinutes }) : null].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          {view.winner.kind === 'Series' ? (
            <div className="flex justify-center">
              <button type="button" className="btn-primary" onClick={() => go({ page: 'show', id: view.winner!.id })}>
                {t('Open the series')}
              </button>
            </div>
          ) : playsHere ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" className="btn-primary !px-8 !py-3 text-base" onClick={() => go({ page: 'play', id: view.winner!.id, startOver: false })}>
                {t('Play here')}
              </button>
              <PlayOnButton itemId={view.winner.id} />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-neutral-300">{t('The screen where this Match started will play it.')}</p>
              <div className="flex justify-center">
                <PlayOnButton itemId={view.winner.id} />
              </div>
            </div>
          )}
          {view.summary && <MatchSummaryCard summary={view.summary} chance={view.winnerBy === 'coin'} />}
          <div className="flex justify-center">
            <button type="button" className="btn" onClick={() => void act(() => playAgain(client, id))}>
              {t('Another round')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

/** A line above the cards: which round, and how far along the person is, as a bar of one piece for each card. */
function RoundHeader({ view }: { view: MatchRoomView }) {
  const done = view.deck.length - view.remaining.length
  return (
    <div className="space-y-2">
      <p className="text-center text-sm font-medium text-neutral-200">
        {view.round === 1 ? t('Round 1: swipe right on what you would watch tonight.') : t('Round {round}: you all liked these. Swipe again.', { round: view.round })}
      </p>
      <div role="img" aria-label={t('{done} of {total}', { done, total: view.deck.length })} className="mx-auto flex max-w-sm gap-1">
        {view.deck.map((c, i) => (
          <span key={c.id} className={`h-1 flex-1 rounded-full ${i < done ? 'bg-[var(--color-accent)]' : 'bg-white/15'}`} />
        ))}
      </div>
    </div>
  )
}

/** Rounds after the first start with a look at what is left, so the change from the last round is clear. */
function RoundIntro({ session, view, onGo }: { session: Session; view: MatchRoomView; onGo: () => void }) {
  return (
    <section aria-label={t('Round {round}', { round: view.round })} className="glass space-y-4 rounded-2xl p-5 text-center">
      <h2 className="text-lg font-semibold text-white">{t('Round {round}', { round: view.round })}</h2>
      <p className="text-sm text-neutral-300">{t('You all liked these {count} films. Which one wins?', { count: view.deck.length })}</p>
      <ul className="flex flex-wrap justify-center gap-2">
        {view.deck.map((c) => (
          <li key={c.id} className="w-20">
            <Poster session={session} card={c} className="aspect-[2/3] w-full rounded-lg" />
          </li>
        ))}
      </ul>
      <button type="button" className="btn-primary" autoFocus onClick={onGo}>
        {t('Let’s go')}
      </button>
    </section>
  )
}

/** The screen of a Match for phones while the people swipe: the cards of the round, and who has finished. */
function ScreenRound({ session, view, title, text }: { session: Session; view: MatchRoomView; title: string; text: string }) {
  return (
    <section aria-label={title} className="glass space-y-5 rounded-2xl p-6 text-center">
      <div>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-neutral-400">{text}</p>
      </div>
      <ul className="flex flex-wrap justify-center gap-3" aria-label={t('The cards of this round')}>
        {view.deck.map((c) => (
          <li key={c.id} className="w-24 sm:w-28">
            <Poster session={session} card={c} className="aspect-[2/3] w-full rounded-lg" />
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap justify-center gap-2">
        {view.members.map((m) => (
          <li key={m.id} className={`chip ${m.done ? 'chip-accent' : ''}`}>
            {m.done ? '✓ ' : ''}
            {m.name}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** After the person finished their cards: who is yet to. */
function WaitingForOthers({ view, text }: { view: MatchRoomView; text: string }) {
  return (
    <div role="status" className="glass space-y-3 rounded-2xl p-6 text-center">
      <p className="text-neutral-100">{text}</p>
      {view.members.length > 1 && (
        <ul className="flex flex-wrap justify-center gap-2">
          {view.members.map((m) => (
            <li key={m.id} className={`chip ${m.done ? 'chip-accent' : ''}`}>
              {m.done ? '✓ ' : ''}
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

