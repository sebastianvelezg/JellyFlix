import { describe, expect, it } from 'vitest'
import { describeDevice } from './device'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const WINDOWS_EDGE = `${WINDOWS_CHROME} Edg/130.0.0.0`
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const MAC_SAFARI = IPAD

describe('describeDevice', () => {
  it('names the installed app by the device alone', () => {
    expect(describeDevice({ userAgent: IPHONE }, true)).toBe('iPhone (app)')
    expect(describeDevice({ userAgent: ANDROID }, true)).toBe('Android phone (app)')
  })

  it('names a tab by device and browser', () => {
    expect(describeDevice({ userAgent: WINDOWS_CHROME }, false)).toBe('Windows · Chrome')
    expect(describeDevice({ userAgent: WINDOWS_EDGE }, false)).toBe('Windows · Edge')
    expect(describeDevice({ userAgent: IPHONE }, false)).toBe('iPhone · Safari')
    expect(describeDevice({ userAgent: FIREFOX }, false)).toBe('Linux · Firefox')
    expect(describeDevice({ userAgent: ANDROID }, false)).toBe('Android phone · Chrome')
  })

  it('tells an iPad (which says it is a Mac) from a Mac by its touch screen', () => {
    expect(describeDevice({ userAgent: IPAD, maxTouchPoints: 5 }, false)).toBe('iPad · Safari')
    expect(describeDevice({ userAgent: MAC_SAFARI, maxTouchPoints: 0 }, false)).toBe('Mac · Safari')
  })

  it('falls back to something readable', () => {
    expect(describeDevice({ userAgent: 'curl/8.0' }, false)).toBe('Web')
  })
})
