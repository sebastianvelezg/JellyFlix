import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Program } from '../../../core/modules'
import { ChannelOsd } from './ChannelOsd'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const program = (start: number, title: string, subtitle?: string): Program => ({ start, end: start + 3000, itemId: title, title, type: 'Episode', runtime: 3000, ...(subtitle ? { subtitle } : {}) })

describe('ChannelOsd', () => {
  it('says what is on and what comes next, and leaves by itself', () => {
    vi.useFakeTimers()
    render(<ChannelOsd now={program(1_800_000_000, 'Volcano', 'South Park · S01E02')} next={program(1_800_003_000, 'Weight Gain 4000')} joinedMinute={null} onStartOver={() => undefined} />)
    expect(screen.getByRole('status')).toHaveTextContent('Volcano')
    expect(screen.getByRole('status')).toHaveTextContent('Weight Gain 4000')
    expect(screen.queryByRole('button', { name: 'Start from the beginning' })).not.toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(6100))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('when the viewer joined late it says the minute and offers to start over, which it does once', async () => {
    const onStartOver = vi.fn()
    render(<ChannelOsd now={program(1_800_000_000, 'Volcano')} next={undefined} joinedMinute={47} onStartOver={onStartOver} />)
    expect(screen.getByText('You tuned in at minute 47.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start from the beginning' }))
    expect(onStartOver).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays longer when there is a button to press', () => {
    vi.useFakeTimers()
    render(<ChannelOsd now={program(1_800_000_000, 'Volcano')} next={undefined} joinedMinute={12} onStartOver={() => undefined} />)
    act(() => void vi.advanceTimersByTime(7000))
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(3200))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
