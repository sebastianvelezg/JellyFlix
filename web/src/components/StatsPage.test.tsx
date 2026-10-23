import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockJellyfin, type MockOptions } from '../../test/mock/mockJellyfin'
import { connect } from '../core'
import { StatsPage } from './StatsPage'

afterEach(cleanup)

async function open(options: MockOptions) {
  const mock = await startMockJellyfin(options)
  const session = await connect(mock.url, 'tester', 'secret')
  render(<StatsPage session={session} onBack={() => undefined} />)
  return mock
}

describe('StatsPage and Playback Reporting', () => {
  it('shows what the plugin recorded: real time, hours of the day, devices and what was converted', async () => {
    const mock = await open({ reporting: 'data' })
    const recorded = within(await screen.findByRole('region', { name: 'Recorded by Playback Reporting' }))
    // 14,400 s is four hours; five plays; a quarter of the time was converted.
    expect(await recorded.findByText('4 h')).toBeInTheDocument()
    expect(recorded.getByText('5')).toBeInTheDocument()
    expect(recorded.getByText('75')).toBeInTheDocument()
    const devices = within(recorded.getByRole('region', { name: 'Devices' }))
    expect(devices.getByText('Living room TV')).toBeInTheDocument()
    expect(devices.getByText('Phone')).toBeInTheDocument()
    expect(devices.getByText(/converted 25% of the time played/)).toBeInTheDocument()
    expect(recorded.getByLabelText('20:00: 2.5 h')).toBeInTheDocument()
    expect(recorded.getByText(/since/)).toBeInTheDocument()
    // Only read-only questions about the signed-in user were asked.
    expect(mock.reportingQueries.length).toBe(7)
    expect(mock.reportingQueries.every((sql) => sql.startsWith('SELECT ') && /UserId = '[0-9a-f]{32}'/.test(sql))).toBe(true)
    await mock.close()
  })

  it('says the plugin has only just started when nothing is recorded yet', async () => {
    const mock = await open({ reporting: 'empty' })
    const note = within(await screen.findByRole('region', { name: 'Recorded by Playback Reporting' }))
    expect(note.getByText(/has only just started recording/)).toBeInTheDocument()
    expect(note.queryByRole('region', { name: 'Devices' })).not.toBeInTheDocument()
    await mock.close()
  })

  it('shows nothing of it without the plugin, and nothing is held back', async () => {
    const mock = await open({})
    expect(await screen.findByText(/You have not watched anything yet|Time watched/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recorded by Playback Reporting' })).not.toBeInTheDocument()
    await mock.close()
  })

  it('shows nothing of it to an account that is not an administrator', async () => {
    const mock = await open({ reporting: 'data', admin: false })
    expect(await screen.findByText(/You have not watched anything yet|Time watched/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recorded by Playback Reporting' })).not.toBeInTheDocument()
    expect(mock.reportingQueries).toEqual([])
    await mock.close()
  })
})
