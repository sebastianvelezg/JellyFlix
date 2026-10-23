import type { UserPolicy } from '@jellyfin/sdk/lib/generated-client/models/user-policy'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_SERVER_TEXTS,
  applyPolicyFields,
  batchProblem,
  BATCH_LIMIT,
  confirmsName,
  describeBatch,
  diffPolicy,
  isLastAdmin,
  newUserProblems,
  policyFieldsOf,
  policyProblems,
  POLICY_LABELS,
  runBatch,
  secretHint,
  toAdminSession,
  type AdminUser,
  type BatchAction,
} from './adminServer'

const policy: UserPolicy = {
  IsAdministrator: false,
  IsDisabled: false,
  EnableAllFolders: true,
  EnabledFolders: [],
  EnableMediaPlayback: true,
  EnableVideoPlaybackTranscoding: true,
  EnableAudioPlaybackTranscoding: true,
  EnablePlaybackRemuxing: true,
  MaxParentalRating: null,
  EnableRemoteAccess: true,
  EnableContentDeletion: false,
  EnableContentDownloading: true,
  MaxActiveSessions: 0,
  AuthenticationProviderId: 'auth',
  PasswordResetProviderId: 'reset',
  BlockedTags: ['kept'],
}
const names = { libraries: { a: 'Movies', b: 'Shows' }, ratings: { '5': 'PG', '9': 'R' } }

describe('the allowances of an account', () => {
  it('reads the server policy into the fields and back without touching what is not edited', () => {
    const fields = policyFieldsOf(policy)
    expect(fields).toMatchObject({ isAdmin: false, allFolders: true, maxRating: '', maxSessions: '0', contentDeletion: false })
    const back = applyPolicyFields(policy, fields)
    expect(back).toMatchObject({ AuthenticationProviderId: 'auth', BlockedTags: ['kept'], MaxParentalRating: null, MaxActiveSessions: 0 })
    expect(applyPolicyFields(policy, { ...fields, maxRating: '9', maxSessions: '2', contentDeletion: true })).toMatchObject({ MaxParentalRating: 9, MaxActiveSessions: 2, EnableContentDeletion: true })
    expect(applyPolicyFields(policy, { ...fields, allFolders: false, folders: ['a'] })).toMatchObject({ EnableAllFolders: false, EnabledFolders: ['a'] })
    expect(policy.EnabledFolders).toEqual([]) // the original is not changed
  })

  it('lists what changes in words, with library and rating names', () => {
    const before = policyFieldsOf(policy)
    const after = { ...before, allFolders: false, folders: ['b', 'a'], maxRating: '5', videoTranscoding: false, maxSessions: '3' }
    expect(diffPolicy(before, after, names)).toEqual([
      { key: 'allFolders', label: 'All libraries', before: 'yes', after: 'no' },
      { key: 'folders', label: 'Libraries', before: '', after: 'Movies, Shows' },
      { key: 'videoTranscoding', label: 'May have videos converted', before: 'yes', after: 'no' },
      { key: 'maxRating', label: 'Highest parental rating', before: 'No limit', after: 'PG' },
      { key: 'maxSessions', label: 'Sessions at once', before: 'No limit', after: '3' },
    ])
    expect(diffPolicy(before, before, names)).toEqual([])
    // While every library is allowed, the remembered list does not count.
    expect(diffPolicy(before, { ...before, folders: ['a'] }, names)).toEqual([])
  })

  it('refuses what would lock the administrator out', () => {
    const admin = { ...policyFieldsOf(policy), isAdmin: true }
    const self = { isSelf: true, isLastAdmin: true }
    expect(policyProblems(admin, admin, self)).toEqual([])
    expect(policyProblems({ ...admin, isAdmin: false }, admin, self).length).toBe(2) // yourself, and the last one
    expect(policyProblems({ ...admin, isDisabled: true }, admin, self).length).toBe(2)
    expect(policyProblems({ ...admin, isDisabled: true }, admin, { isSelf: false, isLastAdmin: true })).toEqual(['This is the only administrator: the server would be left without one.'])
    expect(policyProblems({ ...admin, isAdmin: false }, admin, { isSelf: false, isLastAdmin: false })).toEqual([]) // another administrator may demote it
    expect(policyProblems({ ...admin, allFolders: false, folders: [] }, admin, { isSelf: false, isLastAdmin: false })).toEqual(['Choose at least one library, or allow all of them.'])
    expect(policyProblems({ ...admin, maxSessions: 'many' }, admin, { isSelf: false, isLastAdmin: false })).toHaveLength(1)
  })

  it('finds the last administrator that can still sign in', () => {
    const u = (id: string, isAdmin: boolean, isDisabled = false): AdminUser => ({ id, name: id, isAdmin, isDisabled, hasPassword: true })
    const users = [u('a', true), u('b', false), u('c', true, true)]
    expect(isLastAdmin(users, users[0] as AdminUser)).toBe(true) // c is disabled, so it does not count
    expect(isLastAdmin([...users, u('d', true)], users[0] as AdminUser)).toBe(false)
    expect(isLastAdmin(users, users[1] as AdminUser)).toBe(false)
  })
})

describe('a new account', () => {
  it('asks for a name the server accepts and a password typed twice', () => {
    expect(newUserProblems('Ana', 'longenough', 'longenough', ['tester'])).toEqual([])
    expect(newUserProblems(' ', 'longenough', 'longenough', [])).toEqual(['A name is needed.'])
    expect(newUserProblems('a/b', 'longenough', 'longenough', [])).toHaveLength(1)
    expect(newUserProblems('x'.repeat(61), 'longenough', 'longenough', [])).toHaveLength(1)
    expect(newUserProblems('TESTER', 'longenough', 'longenough', ['tester'])).toEqual(['There is already an account with that name.'])
    expect(newUserProblems('Ana', 'short', 'short', [])).toEqual(['The password needs at least 8 characters.'])
    expect(newUserProblems('Ana', 'longenough', 'different1', [])).toEqual(['The two passwords are not the same.'])
    expect(newUserProblems("María-José O'Neil", 'longenough', 'longenough', [])).toEqual([])
  })
})

describe('deleting a title', () => {
  it('needs the name typed (capitals and spaces around do not matter), never an empty one', () => {
    expect(confirmsName('  test movie 001 ', 'Test Movie 001')).toBe(true)
    expect(confirmsName('Test Movie', 'Test Movie 001')).toBe(false)
    expect(confirmsName('', '')).toBe(false)
  })
})

describe('batch actions', () => {
  const tag: BatchAction = { kind: 'tag', tag: ' Weekend  film ', add: true }

  it('say what they will do, and refuse a slip', () => {
    expect(describeBatch({ kind: 'watched', value: true })).toBe('Mark as watched (for you)')
    expect(describeBatch(tag)).toBe('Add the tag “{tag}”')
    expect(batchProblem(tag, 3)).toBeNull()
    expect(batchProblem(tag, 0)).toBe('Choose at least one title.')
    expect(batchProblem(tag, BATCH_LIMIT + 1)).toBe('Choose at most 100 titles at a time.')
    expect(batchProblem({ kind: 'tag', tag: '  ', add: true }, 2)).toBe('Type the tag first.')
    expect(batchProblem({ kind: 'tag', tag: 'a, b', add: true }, 2)).toBe('A tag is short and has no commas.')
    expect(batchProblem({ kind: 'refresh', mode: 'all' }, 2)).toBeNull()
  })

  const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: `Title ${id}` }))

  it('runs every title, a few at a time, and reports each one', async () => {
    const seen: number[] = []
    let running = 0
    let peak = 0
    const results = await runBatch(
      rows,
      async (row) => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise((r) => setTimeout(r, 5))
        running -= 1
        return row.id === 'c' ? 'skipped' : 'done'
      },
      { concurrency: 2, onProgress: (p) => seen.push(p.done) },
    )
    expect(results.map((r) => r.outcome).sort()).toEqual(['done', 'done', 'done', 'done', 'skipped'])
    expect(peak).toBeLessThanOrEqual(2)
    expect(seen.at(-1)).toBe(5)
  })

  it('goes on after one failure, and says which one failed', async () => {
    const results = await runBatch(rows, async (row) => {
      if (row.id === 'b') throw new Error('boom')
      return 'done'
    })
    expect(results.filter((r) => r.outcome === 'failed').map((r) => r.id)).toEqual(['b'])
    expect(results.filter((r) => r.outcome === 'done')).toHaveLength(4)
  })

  it('stops starting new ones when the server refuses, and says so for the rest', async () => {
    const refusal = Object.assign(new Error('403'), { response: { status: 403 } })
    const results = await runBatch(
      rows,
      async () => {
        throw refusal
      },
      { concurrency: 1 },
    )
    expect(results.map((r) => r.outcome)).toEqual(['failed', 'skipped', 'skipped', 'skipped', 'skipped'])
    expect(results[0]?.reason).toMatch(/refused/)
    expect(results[1]?.reason).toMatch(/Not started/)
  })

  it('stops when asked to', async () => {
    const stop = new AbortController()
    const results = await runBatch(
      rows,
      async (row) => {
        if (row.id === 'a') stop.abort()
        return 'done'
      },
      { concurrency: 1, signal: stop.signal },
    )
    expect(results.filter((r) => r.outcome === 'done')).toHaveLength(1)
    expect(results.filter((r) => r.outcome === 'skipped')).toHaveLength(4)
  })
})

describe('sessions and keys', () => {
  it('shows what plays and whether the server converts it', () => {
    const s = toAdminSession(
      { Id: 's1', UserName: 'guest', Client: 'Android', DeviceName: 'Tablet', DeviceId: 'd1', SupportsRemoteControl: true, NowPlayingItem: { Name: 'Pilot', SeriesName: 'Show' }, PlayState: { IsPaused: true }, TranscodingInfo: { IsVideoDirect: false, IsAudioDirect: true, TranscodeReasons: ['ContainerBitrateExceedsLimit'], Bitrate: 4_000_000 } },
      'mine',
    )
    expect(s).toMatchObject({ id: 's1', userName: 'guest', controllable: true, isThisDevice: false, playing: { title: 'Show · Pilot', paused: true, method: 'converted', reasons: ['ContainerBitrateExceedsLimit'] } })
    expect(toAdminSession({ Id: 's2', DeviceId: 'mine' }, 'mine')).toMatchObject({ isThisDevice: true, playing: undefined })
    expect(toAdminSession({ NowPlayingItem: { Name: 'x' } }, 'mine')).toBeNull()
    expect(toAdminSession({ Id: 's3', NowPlayingItem: { Name: 'Direct' } }, 'mine')?.playing?.method).toBe('direct')
  })

  it('shows only the last four characters of a secret', () => {
    expect(secretHint('apikey-0123456789-ab12')).toBe('ab12')
    expect(secretHint('abc')).toBe('••••')
  })
})

describe('the sentences the screen has to translate', () => {
  it('lists every label of the allowances', () => {
    for (const label of Object.values(POLICY_LABELS)) expect(ADMIN_SERVER_TEXTS).toContain(label)
  })
})
