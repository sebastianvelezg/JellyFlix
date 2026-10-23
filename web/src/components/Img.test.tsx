import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../core'
import { Img } from './Img'

const session = { api: { authorizationHeader: 'MediaBrowser Token="t"' } } as unknown as Session
const SRC = 'http://jf.test/Items/1/Images/Backdrop?fillWidth=1600&quality=90&tag=x'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const image = () => document.querySelector('img') as HTMLImageElement

describe('Img', () => {
  it('shows the fallback when there is no source', () => {
    render(<Img session={session} src={null} fallback={<p>none</p>} />)
    expect(screen.getByText('none')).toBeInTheDocument()
  })

  it('retries as JPEG when the first request fails (servers that cannot encode WebP return an empty body)', () => {
    render(<Img session={session} src={SRC} fallback={<p>none</p>} />)
    expect(image().src).toBe(SRC)
    fireEvent.error(image())
    expect(image().src).toBe(`${SRC}&format=jpg`)
    fireEvent.load(image())
    expect(image().dataset.loaded).toBe('true')
  })

  it('then retries with the Authorization header, and gives up with the fallback and a single onFail', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve({ size: 0 }) })
    vi.stubGlobal('fetch', fetchMock)
    const onFail = vi.fn()
    render(<Img session={session} src={SRC} fallback={<p>none</p>} onFail={onFail} />)
    fireEvent.error(image())
    fireEvent.error(image())
    expect(await screen.findByText('none')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`${SRC}&format=jpg`, {
      headers: { Authorization: 'MediaBrowser Token="t"' },
    })
    await waitFor(() => expect(onFail).toHaveBeenCalledTimes(1))
  })

  it('does not add a second format parameter', () => {
    render(<Img session={session} src={`${SRC}&format=png`} fallback={null} />)
    fireEvent.error(image())
    expect(image().src).toBe(`${SRC}&format=png`)
  })
})
