import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  createGroup,
  currentItemId,
  groupPause,
  groupSeek,
  groupUnpause,
  joinGroup,
  leaveGroup,
  listGroups,
  localToServerMs,
  measureClock,
  NO_GROUP,
  planCommand,
  reportBuffering,
  reportReady,
  sendPing,
  setGroupQueue,
  setIgnoreWait,
  SyncPlayDenied,
  syncReducer,
  type PlayerReport,
  type Session,
  type SyncGroup,
  type SyncMessage,
  type SyncQueue,
  type SyncState,
} from '../../core'
import { VideoSync } from '../../platform/web/syncVideo'
import { useRemote } from '../remote/RemoteProvider'
import type { Navigate, Route } from '../route'
import { t } from '../../i18n'

/** How often the server's clock is read again while in a group (the two clocks drift). */
const CLOCK_MS = 60_000
const NOTICE_MS = 6000
/** Starting the same title twice within this time is one start (every player asks for the next episode when it ends). */
const SAME_START_MS = 5000

export interface SyncPlayApi {
  group: SyncGroup | null
  queue: SyncQueue | null
  /** The groups that can be joined; null until asked. */
  groups: SyncGroup[] | null
  /** Asks the server for the groups. Rejects with a readable message. */
  refreshGroups: () => Promise<void>
  create: (name: string) => Promise<void>
  join: (groupId: string) => Promise<void>
  leave: () => Promise<void>
  /** In a group, a request to play a title asks the whole group instead. True when it did (and the page must not open the player). */
  interceptPlay: (route: Route) => boolean
  /** Joins a video to the group for as long as the player is open. Returns what to call when it goes. */
  bind: (video: HTMLVideoElement, itemId: string) => () => void
  /** Whether a video that is loaded now should start by itself (not while it waits for the others). */
  shouldAutoplay: () => boolean
}

const SyncPlayContext = createContext<SyncPlayApi | null>(null)

/** Null where there is no provider (tests, pages shown on their own): nothing about watching together then appears. */
export function useSyncPlay(): SyncPlayApi | null {
  return useContext(SyncPlayContext)
}

/** Joins the player's `<video>` to the group while the group is watching this title. Does nothing outside a group. */
export function useSyncPlayVideo(videoRef: RefObject<HTMLVideoElement | null>, itemId: string): void {
  const sync = useSyncPlay()
  const bind = sync?.bind
  const together = !!sync?.group && currentItemId(sync.queue) === itemId
  useEffect(() => {
    const video = videoRef.current
    if (!bind || !together || !video) return
    return bind(video, itemId)
  }, [bind, together, itemId, videoRef])
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function readable(e: unknown): string {
  if (e instanceof SyncPlayDenied) return t(e.message)
  return t('Could not reach the group. Try again.')
}

/**
 * Watching together (the server's SyncPlay). It keeps the group this device is in, listens to the server's socket through the
 * remote-control layer, opens the title the group chose, and gives the player what it needs to start with the others, wait for them and
 * pause, play and seek in step.
 */
export function SyncPlayProvider({ session, go, children }: { session: Session; go: Navigate; children: ReactNode }) {
  const remote = useRemote()
  const subscribe = remote?.subscribeSync
  const [state, setState] = useState<SyncState>(NO_GROUP)
  const stateRef = useRef(state)
  const [groups, setGroups] = useState<SyncGroup[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const goRef = useRef(go)
  useEffect(() => {
    goRef.current = go
  })

  const apply = useCallback((message: SyncMessage) => {
    const next = syncReducer(stateRef.current, message)
    stateRef.current = next
    setState(next)
  }, [])

  // The distance between this clock and the server's, and whether the group is playing (set by the commands it sends).
  const offsetMs = useRef(0)
  const playing = useRef(false)
  const bound = useRef<{ itemId: string; video: VideoSync } | null>(null)
  const lastStart = useRef<{ id: string; at: number } | null>(null)

  const groupId = state.group?.id ?? null
  useEffect(() => {
    if (!groupId) return
    let cancelled = false
    const sync = async () => {
      const clock = await measureClock(session)
      if (cancelled || !clock) return
      offsetMs.current = clock.offsetMs
      void sendPing(session, clock.roundTripMs).catch(() => undefined)
    }
    void sync()
    const timer = setInterval(() => void sync(), CLOCK_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      playing.current = false
    }
  }, [groupId, session])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const report = useCallback((positionSeconds: number, isPlaying: boolean): PlayerReport => {
    const queue = stateRef.current.queue
    return {
      serverNowMs: localToServerMs(Date.now(), offsetMs.current),
      positionSeconds,
      playing: isPlaying,
      playlistItemId: queue?.playlistItemIds[queue.index] ?? '',
    }
  }, [])

  const bind = useCallback(
    (video: HTMLVideoElement, itemId: string) => {
      const fail = (e: unknown) => setNotice(readable(e))
      const sync = new VideoSync(video, {
        groupPlaying: () => playing.current,
        requestPlay: () => void groupUnpause(session).catch(fail),
        requestPause: () => void groupPause(session).catch(fail),
        requestSeek: (seconds) => void groupSeek(session, seconds).catch(fail),
        buffering: (seconds) => void reportBuffering(session, report(seconds, true)).catch(fail),
        ready: (seconds, isPlaying) => void reportReady(session, report(seconds, isPlaying)).catch(fail),
        blocked: () => setNotice(t('Your browser would not start the video by itself. Press play to join the others.')),
      })
      const mine = { itemId, video: sync }
      bound.current = mine
      // A player on screen is waited for; one that is gone is not.
      void setIgnoreWait(session, false).catch(() => undefined)
      return () => {
        sync.dispose()
        if (bound.current === mine) bound.current = null
        if (stateRef.current.group) void setIgnoreWait(session, true).catch(() => undefined)
      }
    },
    [session, report],
  )

  const handle = useCallback(
    (message: SyncMessage) => {
      if (message.kind === 'command') {
        const group = stateRef.current.group
        if (!group || message.groupId !== group.id) return
        playing.current = message.command === 'Unpause'
        if (message.command === 'Stop') setNotice(t('The group stopped the video.'))
        bound.current?.video.apply(planCommand(message, Date.now(), offsetMs.current))
        return
      }
      apply(message)
      switch (message.kind) {
        case 'userJoined':
          setNotice(t('{name} joined the group.', { name: message.name }))
          return
        case 'userLeft':
          setNotice(t('{name} left the group.', { name: message.name }))
          return
        case 'problem':
          setNotice(message.problem === 'libraryDenied' ? t('This account cannot watch that title, so it is not in the group.') : t('You are not in the group any more.'))
          return
        case 'queue': {
          // The group chose a title: it opens here, held at the start until everyone is ready.
          playing.current = false
          const id = currentItemId(message.queue)
          if (!id) return
          if (bound.current?.itemId === id) bound.current.video.apply({ type: 'seek', positionSeconds: message.queue.startSeconds })
          else goRef.current({ page: 'play', id, startOver: false, ...(message.queue.startSeconds > 0 ? { startAt: message.queue.startSeconds } : {}) })
          return
        }
        default:
          return
      }
    },
    [apply],
  )
  useEffect(() => subscribe?.(handle), [subscribe, handle])

  const refreshGroups = useCallback(async () => {
    try {
      setGroups(await listGroups(session))
    } catch (e) {
      setGroups(null)
      throw new Error(readable(e), { cause: e })
    }
  }, [session])

  const create = useCallback(
    async (name: string) => {
      try {
        const made = await createGroup(session, name)
        // The server tells it by the socket; where that is not listening the answer itself is enough.
        if (!stateRef.current.group && made) apply({ kind: 'joined', group: made })
      } catch (e) {
        throw new Error(readable(e), { cause: e })
      }
    },
    [session, apply],
  )

  const join = useCallback(
    async (id: string) => {
      try {
        await joinGroup(session, id)
        await delay(300)
        if (!stateRef.current.group) {
          const found = (await listGroups(session)).find((g) => g.id === id)
          if (found && !stateRef.current.group) apply({ kind: 'joined', group: found })
        }
      } catch (e) {
        throw new Error(readable(e), { cause: e })
      }
    },
    [session, apply],
  )

  const leave = useCallback(async () => {
    try {
      await leaveGroup(session)
    } finally {
      apply({ kind: 'left', groupId: stateRef.current.group?.id ?? '' })
    }
  }, [session, apply])

  const interceptPlay = useCallback(
    (route: Route) => {
      if (route.page !== 'play' || !stateRef.current.group) return false
      // The player that is already open is being brought back from the bar: nothing new to ask the group.
      if (bound.current?.itemId === route.id) return false
      const now = Date.now()
      const last = lastStart.current
      lastStart.current = { id: route.id, at: now }
      if (last && last.id === route.id && now - last.at < SAME_START_MS) return true
      void setGroupQueue(session, [route.id], 0, route.startAt ?? 0).catch((e) => setNotice(readable(e)))
      return true
    },
    [session],
  )

  const shouldAutoplay = useCallback(() => !stateRef.current.group || playing.current, [])

  const value = useMemo<SyncPlayApi>(
    () => ({ group: state.group, queue: state.queue, groups, refreshGroups, create, join, leave, interceptPlay, bind, shouldAutoplay }),
    [state, groups, refreshGroups, create, join, leave, interceptPlay, bind, shouldAutoplay],
  )

  return (
    <SyncPlayContext.Provider value={value}>
      {children}
      {notice && (
        <p role="status" className="alert-info fixed bottom-[calc(1rem+var(--nav-h)+var(--bottom-inset))] left-[max(1rem,var(--safe-x))] z-[60] max-w-xs sm:bottom-4">
          {notice}
        </p>
      )}
    </SyncPlayContext.Provider>
  )
}
