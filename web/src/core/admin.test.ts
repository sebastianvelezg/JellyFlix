import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_TEXTS,
  applyFields,
  canIdentify,
  checkPictureFile,
  describeProviderIds,
  diffFields,
  fieldsOf,
  isEditableType,
  MAX_PICTURE_BYTES,
  parseList,
  pictureShapeWarning,
  restoreFields,
  toCandidate,
  validateFields,
  type MetadataFields,
} from './admin'

const movie: BaseItemDto = {
  Id: 'm1',
  Name: 'Test Movie',
  OriginalTitle: 'Película',
  Overview: 'A story.',
  ProductionYear: 2005,
  OfficialRating: 'PG-13',
  CommunityRating: 7.5,
  Genres: ['Action', 'Drama'],
  Studios: [{ Name: 'Mock Studios', Id: 's1' }],
  Tags: ['Classic'],
  LockData: false,
  LockedFields: ['Name', 'Images' as never],
  Type: 'Movie',
  People: [{ Name: 'Ada Actor', Type: 'Actor' }],
}

describe('the details of a title as the editor shows them', () => {
  it('turns the server item into text fields', () => {
    const f = fieldsOf(movie)
    expect(f).toMatchObject({ name: 'Test Movie', originalTitle: 'Película', year: '2005', communityRating: '7.5', genres: ['Action', 'Drama'], studios: ['Mock Studios'], tags: ['Classic'], lockedAll: false })
    expect(f.lockedFields).toEqual(['Name']) // a field the editor does not list is not shown
  })

  it('copes with an item that has almost nothing', () => {
    expect(fieldsOf({ Id: 'x' })).toMatchObject({ name: '', year: '', communityRating: '', genres: [], lockedFields: [] })
  })
})

describe('lists typed by hand', () => {
  it('splits on commas, semicolons and new lines, trims, and drops repeats whatever the capitals', () => {
    expect(parseList(' Action,drama ;  Sci  Fi\nACTION,, ')).toEqual(['Action', 'drama', 'Sci Fi'])
    expect(parseList('')).toEqual([])
  })
})

describe('checking the fields before saving', () => {
  const ok = fieldsOf(movie)
  it('accepts a title that is fine, with or without the optional parts', () => {
    expect(validateFields(ok)).toEqual({})
    expect(validateFields({ ...ok, year: '', communityRating: '', officialRating: '' })).toEqual({})
  })

  it('wants a title', () => {
    expect(validateFields({ ...ok, name: '   ' }).name).toMatch(/title is needed/i)
    expect(validateFields({ ...ok, name: 'x'.repeat(251) }).name).toMatch(/too long/i)
  })

  it('wants a sensible year and a rating from 0 to 10 (a comma is a decimal point)', () => {
    const now = new Date('2026-10-22')
    expect(validateFields({ ...ok, year: '99' }, now).year).toBeDefined()
    expect(validateFields({ ...ok, year: '1799' }, now).year).toBeDefined()
    expect(validateFields({ ...ok, year: '2037' }, now).year).toBeDefined()
    expect(validateFields({ ...ok, year: '2036' }, now).year).toBeUndefined()
    expect(validateFields({ ...ok, communityRating: '11' }).communityRating).toBeDefined()
    expect(validateFields({ ...ok, communityRating: 'abc' }).communityRating).toBeDefined()
    expect(validateFields({ ...ok, communityRating: '7,5' }).communityRating).toBeUndefined()
  })

  it('stops absurd lists', () => {
    expect(validateFields({ ...ok, tags: Array.from({ length: 61 }, (_, i) => `t${i}`) }).tags).toBeDefined()
    expect(validateFields({ ...ok, genres: ['x'.repeat(81)] }).genres).toBeDefined()
  })
})

describe('what will change', () => {
  const before = fieldsOf(movie)

  it('lists only the fields that differ, in the order of the form, ignoring stray spaces', () => {
    expect(diffFields(before, { ...before, name: ' Test Movie ' })).toEqual([])
    const after: MetadataFields = { ...before, name: 'Better Title', year: '2006', genres: ['Drama'], lockedAll: true }
    expect(diffFields(before, after)).toEqual([
      { key: 'name', label: 'Title', before: 'Test Movie', after: 'Better Title' },
      { key: 'year', label: 'Year', before: '2005', after: '2006' },
      { key: 'genres', label: 'Genres', before: 'Action, Drama', after: 'Drama' },
      { key: 'lockedAll', label: 'Lock the whole title', before: 'no', after: 'yes' },
    ])
  })

  it('treats a different order of a list as a change', () => {
    expect(diffFields(before, { ...before, genres: ['Drama', 'Action'] })).toHaveLength(1)
  })
})

describe('building the item the server will hold', () => {
  it('replaces only the editor fields and leaves everything else (people, ids, the rest) as the server sent it', () => {
    const next = applyFields(movie, { ...fieldsOf(movie), name: ' New name ', year: '2010', communityRating: '8,2', overview: '', tags: ['A', 'B'] })
    expect(next).toMatchObject({ Id: 'm1', Type: 'Movie', Name: 'New name', ProductionYear: 2010, CommunityRating: 8.2, Tags: ['A', 'B'], People: movie.People })
    expect(next.Overview).toBeUndefined()
    expect(movie.Name).toBe('Test Movie') // the original object is not touched
  })

  it('keeps the studios the server already knows (with their ids) and adds new ones by name', () => {
    const next = applyFields(movie, { ...fieldsOf(movie), studios: ['Mock Studios', 'New Studio'] })
    expect(next.Studios).toEqual([{ Name: 'Mock Studios', Id: 's1' }, { Name: 'New Studio' }])
  })

  it('writes the locks, and keeps locks it does not list', () => {
    const next = applyFields(movie, { ...fieldsOf(movie), lockedAll: true, lockedFields: ['Overview', 'Genres'] })
    expect(next.LockData).toBe(true)
    expect(next.LockedFields).toEqual(['Images', 'Overview', 'Genres'])
  })

  it('sends nothing for an empty optional field, so the server clears it', () => {
    const next = applyFields(movie, { ...fieldsOf(movie), originalTitle: '', year: '', officialRating: '', communityRating: '' })
    expect(next.OriginalTitle).toBeUndefined()
    expect(next.ProductionYear).toBeUndefined()
    expect(next.OfficialRating).toBeUndefined()
    expect(next.CommunityRating).toBeUndefined()
  })
})

describe('undoing an edit', () => {
  it('puts back only the fields that edit changed', () => {
    const earlier = fieldsOf(movie)
    const current = { ...earlier, name: 'Edited', overview: 'Changed later', genres: ['Comedy'] }
    const restored = restoreFields(current, earlier, ['name', 'genres'])
    expect(restored).toMatchObject({ name: 'Test Movie', genres: ['Action', 'Drama'], overview: 'Changed later' })
    restored.genres.push('x')
    expect(earlier.genres).toEqual(['Action', 'Drama']) // a copy, not the same list
  })
})

describe('identifying', () => {
  it('knows which titles can be looked up and which can be edited', () => {
    expect(canIdentify('Movie')).toBe(true)
    expect(canIdentify('Episode')).toBe(false)
    expect(isEditableType('Episode')).toBe(true)
    expect(isEditableType('Playlist')).toBe(false)
    expect(isEditableType(undefined)).toBe(false)
  })

  it('turns a provider answer into a candidate, ignoring pictures that are not web addresses', () => {
    expect(toCandidate({ Name: 'The Matrix', ProductionYear: 1999, ImageUrl: 'https://image.example/poster.jpg', ProviderIds: { Tmdb: '603' }, SearchProviderName: 'TheMovieDb' })).toMatchObject({
      name: 'The Matrix',
      year: 1999,
      provider: 'TheMovieDb',
      imageUrl: 'https://image.example/poster.jpg',
    })
    expect(toCandidate({ Name: 'X', ImageUrl: 'javascript:alert(1)' })?.imageUrl).toBeUndefined()
    expect(toCandidate({ Name: 'X', ImageUrl: 'data:image/png;base64,AAAA' })?.imageUrl).toBeUndefined()
    expect(toCandidate({ ProductionYear: 2000 })).toBeNull()
  })

  it('writes the provider ids in a line', () => {
    expect(describeProviderIds({ Tmdb: '603', Imdb: 'tt0133093', Empty: '' })).toBe('Tmdb 603 · Imdb tt0133093')
  })
})

describe('the sentences the screen has to translate', () => {
  it('lists every message the checks can give, and every label', async () => {
    const { FIELD_LABELS, PICTURE_KINDS } = await import('./admin')
    const bad: MetadataFields = { ...fieldsOf(movie), name: '', year: '12', communityRating: '99', officialRating: 'x'.repeat(40), overview: 'x'.repeat(9000), originalTitle: 'x'.repeat(300), sortName: 'x'.repeat(300), genres: ['x'.repeat(90)] }
    const given = [
      ...Object.values(validateFields(bad)),
      checkPictureFile({ type: 'image/gif', size: 5 }),
      checkPictureFile({ type: 'image/png', size: 0 }),
      checkPictureFile({ type: 'image/png', size: MAX_PICTURE_BYTES + 1 }),
      pictureShapeWarning('Primary', 2, 1),
      pictureShapeWarning('Backdrop', 1, 1),
      pictureShapeWarning('Backdrop', 1000, 500),
    ].filter((x): x is string => !!x)
    expect(given.length).toBeGreaterThan(8)
    expect(given.filter((m) => !ADMIN_TEXTS.includes(m))).toEqual([])
    expect([...Object.values(FIELD_LABELS), ...PICTURE_KINDS.map((k) => k.label)].filter((m) => !ADMIN_TEXTS.includes(m) && !Object.values(FIELD_LABELS).includes(m))).toEqual([])
  })
})

describe('pictures', () => {
  it('accepts JPEG, PNG and WebP up to 10 MB and says why not otherwise', () => {
    expect(checkPictureFile({ type: 'image/jpeg', size: 1000 })).toBeNull()
    expect(checkPictureFile({ type: 'image/png', size: MAX_PICTURE_BYTES })).toBeNull()
    expect(checkPictureFile({ type: 'image/webp', size: 5 })).toBeNull()
    expect(checkPictureFile({ type: 'image/gif', size: 5 })).toMatch(/JPEG, PNG or WebP/)
    expect(checkPictureFile({ type: 'image/svg+xml', size: 5 })).not.toBeNull() // an SVG can carry script
    expect(checkPictureFile({ type: 'application/pdf', size: 5 })).not.toBeNull()
    expect(checkPictureFile({ type: 'image/jpeg', size: 0 })).toMatch(/empty/)
    expect(checkPictureFile({ type: 'image/jpeg', size: MAX_PICTURE_BYTES + 1 })).toMatch(/10 MB/)
  })

  it('warns about a shape that looks wrong, without forbidding it', () => {
    expect(pictureShapeWarning('Primary', 1000, 1500)).toBeNull()
    expect(pictureShapeWarning('Primary', 1500, 1000)).toMatch(/taller/)
    expect(pictureShapeWarning('Backdrop', 1920, 1080)).toBeNull()
    expect(pictureShapeWarning('Backdrop', 800, 1000)).toMatch(/wide/)
    expect(pictureShapeWarning('Backdrop', 1000, 500)).toMatch(/small/)
    expect(pictureShapeWarning('Logo', 500, 200)).toBeNull()
  })
})
