import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockServer } from '../../../test/mock/mockJellyfin'
import { connect, type Session } from '../../core'
import { LyricsPanel } from './Lyrics'
import { MusicProvider } from './MusicProvider'

let mock: MockServer
let session: Session
beforeAll(async () => {
  mock = await startMockJellyfin()
  session = await connect(mock.url, 'tester', 'secret')
})
afterAll(() => mock.close())
afterEach(cleanup)

function show(trackId: string) {
  render(
    <MusicProvider session={session}>
      <LyricsPanel key={trackId} session={session} trackId={trackId} />
    </MusicProvider>,
  )
}

describe('LyricsPanel', () => {
  it('shows timed lyrics with the first line marked as the one being sung', async () => {
    show('track-1')
    const first = await screen.findByText('First line')
    expect(first).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('Second line')).not.toHaveAttribute('aria-current')
  })

  it('shows plain lyrics as text', async () => {
    show('track-2')
    expect(await screen.findByText('Plain one')).toBeInTheDocument()
    expect(screen.getByText('Plain two')).toBeInTheDocument()
  })

  it('says so when the song has no lyrics', async () => {
    show('track-3')
    expect(await screen.findByText('No lyrics for this song.')).toBeInTheDocument()
  })

  it('offers to find timed lyrics for plain ones and switches to them once saved', async () => {
    show('track-2')
    expect(await screen.findByText('Plain one')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Find timed lyrics' }))
    const first = await screen.findByText('First line')
    expect(first).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('button', { name: 'Find timed lyrics' })).not.toBeInTheDocument()
  })

  it('says so when no source has timed lyrics', async () => {
    show('track-4')
    await userEvent.click(await screen.findByRole('button', { name: 'Find timed lyrics' }))
    expect(await screen.findByText('No timed lyrics were found for this song.')).toBeInTheDocument()
    expect(screen.getByText('Plain one')).toBeInTheDocument()
  })
})
