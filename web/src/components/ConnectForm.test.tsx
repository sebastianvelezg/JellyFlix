import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../core'
import { ConnectForm } from './ConnectForm'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function typeAddress(value: string) {
  render(<ConnectForm onConnect={() => Promise.reject(new Error('not used'))} onConnected={() => {}} />)
  fireEvent.change(screen.getByLabelText('Server URL'), { target: { value } })
}

describe('ConnectForm address warning', () => {
  it('warns about an unencrypted address that is not on the home network', () => {
    typeAddress('http://media.example.com:8096')
    expect(screen.getByRole('note')).toHaveTextContent('would travel in clear text')
    expect(screen.getByLabelText('Server URL')).toHaveAttribute('aria-describedby', 'server-url-warning')
  })

  it.each(['http://192.168.0.10:8096', 'jellyfin.local:8096', 'nas:8096', 'https://media.example.com', 'media.example.com', '', 'http://'])(
    'says nothing for %j',
    (value) => {
      typeAddress(value)
      expect(screen.queryByRole('note')).toBeNull()
    },
  )
})

describe('ConnectForm with a code', () => {
  const request = { code: '123456', serverUrl: 'http://jellyfin.local:8096' } as never

  function open(overrides: { approved?: () => Promise<boolean> } = {}) {
    vi.useFakeTimers()
    const session = { serverUrl: 'http://jellyfin.local:8096' } as Session
    const calls = { approved: 0, completed: 0 }
    const onConnected = vi.fn()
    const quickConnect = {
      start: vi.fn(() => Promise.resolve(request)),
      approved: vi.fn(() => {
        calls.approved += 1
        return overrides.approved ? overrides.approved() : Promise.resolve(calls.approved >= 2)
      }),
      complete: vi.fn(() => {
        calls.completed += 1
        return Promise.resolve(session)
      }),
    }
    render(<ConnectForm onConnect={() => Promise.reject(new Error('not used'))} onConnected={onConnected} quickConnect={quickConnect} />)
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'http://jellyfin.local:8096' } })
    return { quickConnect, onConnected, session, calls }
  }

  it('shows the code, asks every two seconds, and signs in once it is approved', async () => {
    const { quickConnect, onConnected, session } = open()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with a code' }))
    })
    expect(screen.getByText('123456')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(onConnected).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(quickConnect.complete).toHaveBeenCalledTimes(1)
    expect(onConnected).toHaveBeenCalledWith(session, false)
    // It stops asking once it is in.
    const asked = quickConnect.approved.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(quickConnect.approved.mock.calls.length).toBe(asked)
  })

  it('gives up after ten minutes with a message, and goes back to the form', async () => {
    open({ approved: () => Promise.resolve(false) })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with a code' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 100)
    })
    expect(screen.getByText('The code expired. Ask for a new one.')).toBeInTheDocument()
    expect(screen.queryByText('123456')).toBeNull()
  })
})
