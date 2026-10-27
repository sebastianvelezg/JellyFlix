import { beforeEach, describe, expect, it } from 'vitest'
import { clearDayMix, readDayMix, writeDayMix } from './dayMix'

beforeEach(() => clearDayMix())

describe('the remembered mix of the day', () => {
  it('is returned for the same day and owner, and only then', () => {
    expect(readDayMix('2026-10-26', 'u1')).toBeNull()
    writeDayMix({ day: '2026-10-26', owner: 'u1', ids: ['a', 'b'] })
    expect(readDayMix('2026-10-26', 'u1')).toEqual(['a', 'b'])
    expect(readDayMix('2026-10-27', 'u1')).toBeNull() // a new day
    expect(readDayMix('2026-10-26', 'u2')).toBeNull() // another account
  })

  it('ignores anything that is not a list of ids', () => {
    localStorage.setItem('jellyflix.daymix', '{"day":"d","owner":"o","ids":"nope"}')
    expect(readDayMix('d', 'o')).toBeNull()
    localStorage.setItem('jellyflix.daymix', 'not json')
    expect(readDayMix('d', 'o')).toBeNull()
    writeDayMix({ day: 'd', owner: 'o', ids: [] })
    expect(readDayMix('d', 'o')).toBeNull()
  })
})
