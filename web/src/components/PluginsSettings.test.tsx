import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockJellyfin } from '../../test/mock/mockJellyfin'
import { connect } from '../core'
import { PluginsSettings } from './PluginsSettings'

afterEach(cleanup)

async function open(admin: boolean) {
  const mock = await startMockJellyfin({ admin })
  const session = await connect(mock.url, 'tester', 'secret')
  render(<PluginsSettings session={session} />)
  return mock
}

describe('PluginsSettings', () => {
  it('lists the supported plugins the server has, with their tasks, and the rest', async () => {
    const mock = await open(true)
    const intro = within(await screen.findByRole('region', { name: 'Intro Skipper' }))
    expect(intro.getByText('12.0.5.0 · Active')).toBeInTheDocument()
    expect(intro.getByText('Detect and Analyze Media Segments')).toBeInTheDocument()
    const lyrics = within(screen.getByRole('region', { name: 'Lyrics' }))
    expect(lyrics.getByText('Download and upgrade lyrics')).toBeInTheDocument()
    // Not installed on this server, and the library scan is not a plugin task.
    expect(within(screen.getByRole('region', { name: 'Open Subtitles' })).getByText('Not installed')).toBeInTheDocument()
    expect(screen.queryByText('Scan Media Library')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Other plugins' })).getByText('TMDb 12.2.0.0')).toBeInTheDocument()
    await mock.close()
  })

  it('knows the plugins for collections, artwork, anime and play history, and keeps the plain TMDb one apart', async () => {
    const mock = await open(true)
    const boxSets = within(await screen.findByRole('region', { name: 'TMDb Box Sets' }))
    expect(boxSets.getByText('15.0.0.0 · Active')).toBeInTheDocument()
    expect(boxSets.getByText('Scan library for new box sets')).toBeInTheDocument()
    // The episodes task of the TMDb provider is not a box-sets task.
    expect(boxSets.queryByText(/upcoming and missing episodes/)).not.toBeInTheDocument()
    const reporting = within(screen.getByRole('region', { name: 'Playback Reporting' }))
    expect(reporting.getByText('Playback Reporting Run Backup')).toBeInTheDocument()
    expect(reporting.getByText('Playback Reporting Trim Db')).toBeInTheDocument()
    // Plugins without tasks say so.
    const fanart = within(screen.getByRole('region', { name: 'Fanart.tv' }))
    expect(fanart.getByText('15.0.0.0 · Active')).toBeInTheDocument()
    expect(fanart.getByText('This plugin has no tasks on the server.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'AniList' })).getByText('15.0.0.0 · Active')).toBeInTheDocument()
    // The metadata plugin by itself stays under "Other plugins"; the four above are no longer listed there.
    const others = within(screen.getByRole('region', { name: 'Other plugins' }))
    expect(others.getByText('TMDb 12.2.0.0')).toBeInTheDocument()
    expect(others.queryByText(/Box Sets|Fanart|AniList|Playback Reporting/)).not.toBeInTheDocument()
    await mock.close()
  })

  it('warns in its own words before running a task of the play history plugin', async () => {
    const mock = await open(true)
    const reporting = within(await screen.findByRole('region', { name: 'Playback Reporting' }))
    await userEvent.click(reporting.getAllByRole('button', { name: 'Run' })[0] as HTMLElement)
    expect(reporting.getByText(/a backup saves a file, and trimming deletes old entries/)).toBeInTheDocument()
    expect(mock.taskLog).toEqual([])
    await mock.close()
  })

  it('asks before running a task, then follows it and can stop it', async () => {
    const mock = await open(true)
    const intro = within(await screen.findByRole('region', { name: 'Intro Skipper' }))
    await userEvent.click(intro.getByRole('button', { name: 'Run' }))
    // Nothing starts until it is confirmed.
    expect(mock.taskLog).toEqual([])
    expect(intro.getByText(/Analysing reads the video files/)).toBeInTheDocument()
    await userEvent.click(intro.getByRole('button', { name: 'Run now' }))
    expect(await intro.findByText('Running… 12%')).toBeInTheDocument()
    expect(mock.taskLog).toEqual(['start t-analyze'])
    await userEvent.click(intro.getByRole('button', { name: 'Stop' }))
    expect(await intro.findByText(/Last run: completed/)).toBeInTheDocument()
    expect(mock.taskLog).toEqual(['start t-analyze', 'stop t-analyze'])
    await mock.close()
  })

  it('tells an account that is not an administrator why there is nothing to show', async () => {
    const mock = await open(false)
    expect(await screen.findByText('Only a server administrator can see plugins and run their tasks.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Intro Skipper' })).not.toBeInTheDocument()
    await mock.close()
  })
})
