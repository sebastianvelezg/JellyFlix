import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import {
  authorizeQuickConnect,
  completeQuickConnect,
  connect,
  controlDevice,
  getRemoteDevices,
  getTitlePage,
  isQuickConnectApproved,
  playOnDevice,
  seekDevice,
  startQuickConnect,
  type Session,
} from '../core'
import { ConnectForm } from './ConnectForm'
import { LetterBar } from './LetterBar'
import { PlayOnButton } from './remote/PlayOnButton'
import type { PlaybackController } from './remote/controller'
import { RemoteProvider, useRegisterPlayback } from './remote/RemoteProvider'

let mock: MockServer
beforeAll(async () => {
  mock = await startMockJellyfin({ movieCount: 30 })
})
afterAll(() => mock.close())
afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

describe('sign in with a code', () => {
  it('shows the code, waits for another device to approve it, then signs in without a password', async () => {
    const ui = userEvent.setup()
    const onConnected = vi.fn()
    render(
      <ConnectForm
        onConnect={() => Promise.reject(new Error('the password path must not be used'))}
        onConnected={onConnected}
        quickConnect={{
          start: (url) => startQuickConnect(url),
          approved: (request) => isQuickConnectApproved(request),
          complete: (request) => completeQuickConnect(request),
        }}
      />,
    )
    const server = await screen.findByLabelText('Server URL')
    await ui.clear(server)
    await ui.type(server, mock.url)
    await ui.click(screen.getByRole('button', { name: 'Sign in with a code' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Enter this code in Jellyfin')
    const code = /\d{6}/.exec(status.textContent ?? '')?.[0] ?? ''
    expect(code).toHaveLength(6)
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(onConnected).not.toHaveBeenCalled()

    // Somebody who is already signed in types the code.
    await authorizeQuickConnect(await connect(mock.url, 'tester', 'secret'), code)

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1), { timeout: 8000 })
    const session = onConnected.mock.calls[0]?.[0] as Session
    expect(session.userName).toBe('tester')
  }, 15_000)

  it('can be cancelled, and says when the server has Quick Connect off', async () => {
    const off = await startMockJellyfin({ quickConnect: false })
    try {
      const ui = userEvent.setup()
      render(
        <ConnectForm
          onConnect={() => Promise.reject(new Error('unused'))}
          onConnected={() => undefined}
          quickConnect={{ start: startQuickConnect, approved: isQuickConnectApproved, complete: completeQuickConnect }}
        />,
      )
      const server = await screen.findByLabelText('Server URL')
      await ui.clear(server)
      await ui.type(server, off.url)
      await ui.click(screen.getByRole('button', { name: 'Sign in with a code' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/Quick Connect is off/)

      await ui.clear(server)
      await ui.type(server, mock.url)
      await ui.click(screen.getByRole('button', { name: 'Sign in with a code' }))
      await screen.findByText('Enter this code in Jellyfin')
      await ui.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByLabelText('Password')).toBeInTheDocument()
    } finally {
      await off.close()
    }
  })

  it('does not offer the code button where it is not provided', async () => {
    render(<ConnectForm onConnect={() => Promise.reject(new Error('unused'))} onConnected={() => undefined} />)
    await screen.findByLabelText('Server URL')
    expect(screen.queryByRole('button', { name: 'Sign in with a code' })).not.toBeInTheDocument()
  })
})

describe('Play on…', () => {
  it('lists the TV, starts a title on it and shows a remote that can pause and stop it', async () => {
    const ui = userEvent.setup()
    const session = await connect(mock.url, 'tester', 'secret')
    mock.remoteLog.length = 0
    render(
      <RemoteProvider session={session} go={vi.fn()}>
        <PlayOnButton itemId="m0003" />
      </RemoteProvider>,
    )
    await ui.click(screen.getByRole('button', { name: /Play on…/ }))
    const device = await screen.findByRole('menuitem', { name: /Living room TV/ })
    await ui.click(device)

    const remote = await screen.findByRole('region', { name: 'Playing on Living room TV' })
    expect(mock.remoteLog).toEqual(['tv-session play m0003 from 0'])
    await waitFor(() => expect(remote).toHaveTextContent('Now playing m0003'))

    await ui.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument())
    await ui.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(mock.remoteLog.at(-1)).toBe('tv-session Stop'))
  })

  it('offers a TV that is already playing, and its remote can seek and skip', async () => {
    const ui = userEvent.setup()
    const session = await connect(mock.url, 'tester', 'secret')
    await playOnDevice(session, 'tv-session', 'm0007')
    mock.remoteLog.length = 0
    render(
      <RemoteProvider session={session} go={vi.fn()}>
        <p>page</p>
      </RemoteProvider>,
    )
    await ui.click(await screen.findByRole('button', { name: /On Living room TV: Now playing m0007/ }))
    const remote = await screen.findByRole('region', { name: 'Playing on Living room TV' })
    expect(remote).toHaveTextContent('Now playing m0007')

    const slider = screen.getByRole('slider', { name: 'Position' })
    fireEvent.change(slider, { target: { value: '120' } })
    fireEvent.pointerUp(slider)
    await waitFor(() => expect(mock.remoteLog.at(-1)).toMatch(/^tv-session Seek /))

    await ui.click(screen.getByRole('button', { name: 'Next episode' }))
    await waitFor(() => expect(mock.remoteLog.at(-1)).toBe('tv-session NextTrack'))
    await ui.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(mock.remoteLog.at(-1)).toBe('tv-session Stop'))
  })

  it('has a compact button for one episode that asks the same question', async () => {
    const ui = userEvent.setup()
    const session = await connect(mock.url, 'tester', 'secret')
    mock.remoteLog.length = 0
    render(
      <RemoteProvider session={session} go={vi.fn()}>
        <PlayOnButton itemId="e0001" compact />
      </RemoteProvider>,
    )
    await ui.click(screen.getByRole('button', { name: 'Play on…' }))
    await ui.click(await screen.findByRole('menuitem', { name: /Living room TV/ }))
    await waitFor(() => expect(mock.remoteLog).toEqual(['tv-session play e0001 from 0']))
  })

  it('says so when there is no device', async () => {
    const empty = await startMockJellyfin({ remoteDevices: [] })
    try {
      const ui = userEvent.setup()
      const session = await connect(empty.url, 'tester', 'secret')
      render(
        <RemoteProvider session={session} go={vi.fn()}>
          <PlayOnButton itemId="m0001" />
        </RemoteProvider>,
      )
      await ui.click(screen.getByRole('button', { name: /Play on…/ }))
      expect(await screen.findByText(/No other device found/)).toBeInTheDocument()
    } finally {
      await empty.close()
    }
  })

  it('shows nothing without a provider', () => {
    render(<PlayOnButton itemId="m0001" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('A-Z jump', () => {
  it('asks the server for titles from the chosen letter on', async () => {
    const session = await connect(mock.url, 'tester', 'secret')
    await getTitlePage(session, 'movie', { startIndex: 0, sort: 'title', fromLetter: 'M' })
    const sent = mock.requests.filter((r) => r.path === '/Items').at(-1)
    expect(sent?.query.nameStartsWithOrGreater).toBe('M')
    await getTitlePage(session, 'movie', { startIndex: 0, sort: 'title' })
    expect(mock.requests.filter((r) => r.path === '/Items').at(-1)?.query.nameStartsWithOrGreater).toBeUndefined()
  })

  it('marks the chosen letter and reports a click ("#" means from the beginning)', async () => {
    const ui = userEvent.setup()
    const onChange = vi.fn()
    render(<LetterBar value="M" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'K' })).toHaveAttribute('aria-pressed', 'false')
    await ui.click(screen.getByRole('button', { name: 'Q' }))
    expect(onChange).toHaveBeenLastCalledWith('Q')
    await ui.click(screen.getByRole('button', { name: 'From the beginning' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })
})

/** A player that does nothing but record what other devices asked of it. */
function fakePlayer(overrides: Partial<PlaybackController> = {}): PlaybackController & { calls: string[] } {
  const calls: string[] = []
  const record = (name: string) => () => void calls.push(name)
  return {
    calls,
    pause: record('pause'),
    resume: record('resume'),
    toggle: record('toggle'),
    stop: () => void calls.push('stop'),
    seek: (seconds) => void calls.push(`seek ${seconds}`),
    skip: (delta) => void calls.push(`skip ${delta}`),
    next: record('next'),
    previous: record('previous'),
    setVolume: (level) => void calls.push(`volume ${level}`),
    setMuted: (muted) => void calls.push(`muted ${muted}`),
    snapshot: () => ({ itemIds: ['m0005'], startIndex: 0, positionSeconds: 42 }),
    ...overrides,
  }
}

function PlayerThatCanBeDriven({ player }: { player: PlaybackController }) {
  useRegisterPlayback('video', player)
  return <p>playing here</p>
}

describe('this browser as a device that other devices can control', () => {
  /** Signs in as a second device ("the phone"), shows its remote-control layer, and waits until the server lists it as controllable. */
  async function phone(player?: PlaybackController) {
    const session = await connect(mock.url, 'tester', 'secret')
    const go = vi.fn()
    render(
      <RemoteProvider session={session} go={go}>
        {player ? <PlayerThatCanBeDriven player={player} /> : <p>idle</p>}
      </RemoteProvider>,
    )
    await waitFor(() => expect(mock.connectedDevices()).toContain(session.deviceId))
    return { session, go }
  }

  it('is listed for the account\'s other devices once it listens, and not before', async () => {
    const computer = await connect(mock.url, 'tester', 'secret')
    const quiet = await connect(mock.url, 'tester', 'secret')
    const { session: listening } = await phone()
    const devices = await getRemoteDevices(computer)
    expect(devices.map((d) => d.id)).toContain(`web-${listening.deviceId}`)
    expect(devices.map((d) => d.id)).not.toContain(`web-${quiet.deviceId}`)
    // A device never offers itself.
    expect((await getRemoteDevices(listening)).map((d) => d.id)).not.toContain(`web-${listening.deviceId}`)
  })

  it('opens the player for a movie another device sends, at the place it was left', async () => {
    const computer = await connect(mock.url, 'tester', 'secret')
    const { session, go } = await phone()
    await playOnDevice(computer, `web-${session.deviceId}`, 'm0003', 125)
    await waitFor(() => expect(go).toHaveBeenCalledWith({ page: 'play', id: 'm0003', startOver: false, startAt: 125 }))
    // Without a position the player resumes where the title was left.
    await playOnDevice(computer, `web-${session.deviceId}`, 'm0004')
    await waitFor(() => expect(go).toHaveBeenLastCalledWith({ page: 'play', id: 'm0004', startOver: false }))
  })

  it('does what another device asks of the player that is open: pause, resume, seek, stop', async () => {
    const computer = await connect(mock.url, 'tester', 'secret')
    const player = fakePlayer()
    const { session } = await phone(player)
    const id = `web-${session.deviceId}`
    await controlDevice(computer, id, 'pause')
    await controlDevice(computer, id, 'resume')
    await seekDevice(computer, id, 90)
    await controlDevice(computer, id, 'next')
    await controlDevice(computer, id, 'stop')
    await waitFor(() => expect(player.calls).toEqual(['pause', 'resume', 'seek 90', 'next', 'stop']))
  })

  it('shows what another device is playing, as it would a TV', async () => {
    const own = await startMockJellyfin({ remoteDevices: [] })
    try {
      const ui = userEvent.setup()
      const computer = await connect(own.url, 'tester', 'secret')
      const phone = await connect(own.url, 'tester', 'secret')
      render(
        <>
          <RemoteProvider session={computer} go={vi.fn()}>
            <p>computer</p>
          </RemoteProvider>
          <RemoteProvider session={phone} go={vi.fn()}>
            <p>phone</p>
          </RemoteProvider>
        </>,
      )
      await waitFor(() => expect(own.connectedDevices()).toHaveLength(2))
      // The computer reports a movie as it plays one (the mock keeps what each session reports); the phone looks again when it comes back to the front.
      await fetch(`${own.url}/Sessions/Playing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: computer.api.authorizationHeader },
        body: JSON.stringify({ ItemId: 'm0009', PositionTicks: 150_000_000, IsPaused: false }),
      })
      document.dispatchEvent(new Event('visibilitychange'))
      await ui.click(await screen.findByRole('button', { name: /On Web browser: Test Movie 009/ }))
      const bar = await screen.findByRole('region', { name: 'Playing on Web browser' })
      expect(bar).toHaveTextContent('0:15 / 0:30')
    } finally {
      await own.close()
    }
  })

  it('hands what is playing here to another device, at the same place, and stops it here', async () => {
    const ui = userEvent.setup()
    const player = fakePlayer()
    const session = await connect(mock.url, 'tester', 'secret')
    mock.remoteLog.length = 0
    render(
      <RemoteProvider session={session} go={vi.fn()}>
        <PlayerThatCanBeDriven player={player} />
        <PlayOnButton current />
      </RemoteProvider>,
    )
    await ui.click(screen.getByRole('button', { name: /Play on…/ }))
    await ui.click(await screen.findByRole('menuitem', { name: /Living room TV/ }))
    await waitFor(() => expect(mock.remoteLog).toEqual(['tv-session play m0005 from 420000000']))
    expect(player.calls).toEqual(['stop'])
    await screen.findByRole('region', { name: 'Playing on Living room TV' })
  })

  it('says so when there is nothing playing to hand over', async () => {
    const ui = userEvent.setup()
    const session = await connect(mock.url, 'tester', 'secret')
    render(
      <RemoteProvider session={session} go={vi.fn()}>
        <PlayOnButton current />
      </RemoteProvider>,
    )
    await ui.click(screen.getByRole('button', { name: /Play on…/ }))
    await ui.click(await screen.findByRole('menuitem', { name: /Living room TV/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing is playing here.')
  })

  it('brings what another device is playing over to this one ("Play here") and stops it there', async () => {
    const ui = userEvent.setup()
    const session = await connect(mock.url, 'tester', 'secret')
    await playOnDevice(session, 'tv-session', 'm0007', 60)
    mock.remoteLog.length = 0
    const go = vi.fn()
    render(
      <RemoteProvider session={session} go={go}>
        <p>page</p>
      </RemoteProvider>,
    )
    await ui.click(await screen.findByRole('button', { name: /On Living room TV: / }))
    await screen.findByRole('region', { name: 'Playing on Living room TV' })
    await ui.click(screen.getByRole('button', { name: 'Play here' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith({ page: 'play', id: 'm0007', startOver: false, startAt: 60 }))
    await waitFor(() => expect(mock.remoteLog.at(-1)).toBe('tv-session Stop'))
  })
})
