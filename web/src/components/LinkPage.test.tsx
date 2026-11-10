import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../test/mock/mockJellyfin'
import { connect, isQuickConnectApproved, startQuickConnect } from '../core'
import { LinkPage } from './LinkPage'

let mock: MockServer
beforeAll(async () => {
  mock = await startMockJellyfin({})
})
afterAll(() => mock.close())
afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

describe('the page a TV QR code opens', () => {
  it('shows the code and approves it only when the person says so', async () => {
    const ui = userEvent.setup()
    const session = await connect(mock.url, 'tester', 'secret')
    const tv = await startQuickConnect(mock.url)
    const onDone = vi.fn()
    render(<LinkPage session={session} code={tv.code} onDone={onDone} />)

    // The code is in the sentence for screen readers and, large, for comparing with the TV.
    expect((await screen.findAllByText(new RegExp(`${tv.code.slice(0, 3)} ${tv.code.slice(3)}`))).length).toBeGreaterThanOrEqual(1)
    // Opening the page approved nothing.
    expect(await isQuickConnectApproved(tv)).toBe(false)

    await ui.click(screen.getByRole('button', { name: 'Let it sign in' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Your TV is signing in as tester/)
    expect(await isQuickConnectApproved(tv)).toBe(true)

    await ui.click(screen.getByRole('button', { name: 'Go to the home page' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('leaves the code alone when the person says not now', async () => {
    const ui = userEvent.setup()
    const session = await connect(mock.url, 'tester', 'secret')
    const tv = await startQuickConnect(mock.url)
    const onDone = vi.fn()
    render(<LinkPage session={session} code={tv.code} onDone={onDone} />)
    await ui.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(await isQuickConnectApproved(tv)).toBe(false)
  })

  it('explains a code the server does not know, and lets the person try again', async () => {
    const ui = userEvent.setup()
    const session = await connect(mock.url, 'tester', 'secret')
    render(<LinkPage session={session} code="999999" onDone={vi.fn()} />)
    await ui.click(await screen.findByRole('button', { name: 'Let it sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/code was not found/i)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Let it sign in' })).toBeEnabled())
  })

  it('asks for the code when the link has none', async () => {
    const session = await connect(mock.url, 'tester', 'secret')
    render(<LinkPage session={session} onDone={vi.fn()} />)
    expect(await screen.findByLabelText('Code shown on the other screen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Let it sign in' })).not.toBeInTheDocument()
  })
})
