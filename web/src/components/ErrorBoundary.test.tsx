import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

let broken = true
function Page() {
  if (broken) throw new Error('boom')
  return <p>fine</p>
}

describe('ErrorBoundary', () => {
  it('keeps the rest of the layout and lets a page try again or be left', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    broken = true
    const { rerender } = render(
      <div>
        <p>menu</p>
        <ErrorBoundary scope="page" resetKey="a">
          <Page />
        </ErrorBoundary>
      </div>,
    )
    expect(screen.getByText('menu')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    // Going to another page tries again.
    broken = false
    rerender(
      <div>
        <p>menu</p>
        <ErrorBoundary scope="page" resetKey="b">
          <Page />
        </ErrorBoundary>
      </div>,
    )
    expect(screen.getByText('fine')).toBeTruthy()
    // And "Try again" does too.
    broken = true
    rerender(
      <div>
        <ErrorBoundary scope="page" resetKey="c">
          <Page />
        </ErrorBoundary>
      </div>,
    )
    broken = false
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByText('fine')).toBeTruthy()
  })
})
