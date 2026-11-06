import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModulesProvider, useModules } from './ModulesProvider'

function Status() {
  return <p>{useModules().state.status}</p>
}

const manifest = { api: 1, version: '0.1.0', serverTime: 1, user: { id: 'u', name: 'U', isAdmin: false }, modules: [{ id: 'match', state: 'ready' }], serviceKey: false }

beforeEach(() => {
  localStorage.clear()
  delete window.JELLYFLIX_CONFIG
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  delete window.JELLYFLIX_CONFIG
  window.history.replaceState(null, '', '/')
})

describe('ModulesProvider', () => {
  it('with no address configured it is "absent" at once and never contacts anything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(
      <ModulesProvider token="tok">
        <Status />
      </ModulesProvider>,
    )
    expect(screen.getByText('absent')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('with an address that does not answer it ends up "absent"', async () => {
    window.JELLYFLIX_CONFIG = { modulesUrl: 'http://nothing-here.test:8097' }
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'))
    render(
      <ModulesProvider token="tok">
        <Status />
      </ModulesProvider>,
    )
    expect(screen.getByText('checking')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('absent')).toBeInTheDocument())
  })

  it('with a container that answers it is "ready"', async () => {
    window.JELLYFLIX_CONFIG = { modulesUrl: 'http://modules.test:8097' }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 }))
    render(
      <ModulesProvider token="tok">
        <Status />
      </ModulesProvider>,
    )
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('remembers an address given as ?modules= and forgets it with ?modules=off', async () => {
    window.history.replaceState(null, '', '/?modules=http://192.168.1.20:8097')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifest), { status: 200 }))
    render(
      <ModulesProvider token="tok">
        <Status />
      </ModulesProvider>,
    )
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())
    expect(localStorage.getItem('jellyflix.modulesUrl')).toBe('http://192.168.1.20:8097')
    cleanup()
    window.history.replaceState(null, '', '/?modules=off')
    render(
      <ModulesProvider token="tok">
        <Status />
      </ModulesProvider>,
    )
    expect(screen.getByText('absent')).toBeInTheDocument()
    expect(localStorage.getItem('jellyflix.modulesUrl')).toBeNull()
  })

  it('ignores an address in a link that is not this site, the Jellyfin server or the local network, and never sends the token there', async () => {
    window.history.replaceState(null, '', '/?modules=https://evil.example')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(
      <ModulesProvider token="secret-token">
        <Status />
      </ModulesProvider>,
    )
    expect(screen.getByText('absent')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem('jellyflix.modulesUrl')).toBeNull()
  })
})
