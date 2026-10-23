// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { chromeLikeCapabilities as capabilities } from '../../test/fixtures'
import { startMockJellyfin, type MockOptions } from '../../test/mock/mockJellyfin'
import { connect } from './auth'
import { getMovieDetails } from './details'
import { getLibrarySections } from './library'
import { negotiatePlayback } from './playback'

/** Signs in (before the hiccups start), runs `body`, and cleans up. */
async function withServer(options: MockOptions, body: (ctx: Awaited<ReturnType<typeof startMockJellyfin>>, session: Awaited<ReturnType<typeof connect>>) => Promise<void>) {
  const mock = await startMockJellyfin({ movieCount: 3, ...options })
  try {
    const session = await connect(mock.url, 'tester', 'secret')
    await body(mock, session)
  } finally {
    await mock.close()
  }
}

const attempts = (mock: { requests: Array<{ path: string }> }, path: string) => mock.requests.filter((r) => r.path === path).length

describe('retrying read requests', () => {
  it('rides out two server hiccups (503) on a read', async () => {
    await withServer({ flaky: { path: '/UserViews', status: 503, times: 2 } }, async (mock, session) => {
      const sections = await getLibrarySections(session)
      expect(sections.movies).toHaveLength(1)
      expect(mock.flakyHits()).toBe(2)
      expect(attempts(mock, '/UserViews')).toBe(3)
    })
  })

  it('rides out a dropped connection', async () => {
    await withServer({ flaky: { path: '/UserViews', status: 'drop', times: 1 } }, async (mock, session) => {
      expect((await getLibrarySections(session)).movies).toHaveLength(1)
      expect(mock.flakyHits()).toBe(1)
    })
  })

  it('gives up after a few tries and reports the failure', async () => {
    await withServer({ flaky: { path: '/UserViews', status: 503, times: 10 } }, async (mock, session) => {
      await expect(getLibrarySections(session)).rejects.toThrow()
      expect(attempts(mock, '/UserViews')).toBe(3) // the first try and two retries
    })
  })

  it('does not retry answers from the server itself (404), or writes (POST)', async () => {
    await withServer({ flaky: { path: '/Items/m0001/PlaybackInfo', status: 503, times: 1 } }, async (mock, session) => {
      await expect(getMovieDetails(session, 'm9999')).rejects.toThrow()
      expect(attempts(mock, '/Items/m9999')).toBe(1)

      await expect(negotiatePlayback(session, 'm0001', { capabilities })).rejects.toThrow()
      expect(attempts(mock, '/Items/m0001/PlaybackInfo')).toBe(1)
    })
  })
})
