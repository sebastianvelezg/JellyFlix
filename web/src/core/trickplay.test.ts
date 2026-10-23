import { describe, expect, it } from 'vitest'
import { pickTrickplay, trickplaySheetUrl, trickplayTile, type TrickplayInfo } from './trickplay'

const info: TrickplayInfo = { width: 320, height: 180, tileWidth: 10, tileHeight: 10, thumbnailCount: 250, interval: 10_000 }

describe('trickplay', () => {
  it('picks the size nearest to a small preview, for the version of the file being played', () => {
    const offered = {
      ms1: {
        '160': { Width: 160, Height: 90, TileWidth: 10, TileHeight: 10, ThumbnailCount: 100, Interval: 10000 },
        '320': { Width: 320, Height: 180, TileWidth: 10, TileHeight: 10, ThumbnailCount: 100, Interval: 10000 },
        '640': { Width: 640, Height: 360, TileWidth: 5, TileHeight: 5, ThumbnailCount: 100, Interval: 10000 },
      },
      ms2: { '480': { Width: 480, Height: 270, TileWidth: 8, TileHeight: 8, ThumbnailCount: 50, Interval: 5000 } },
    }
    expect(pickTrickplay(offered, 'ms1')?.width).toBe(320)
    expect(pickTrickplay(offered, 'ms2')?.width).toBe(480)
    expect(pickTrickplay(offered, 'other')).toBeNull()
    expect(pickTrickplay(undefined, 'ms1')).toBeNull()
    // An entry with a missing number is no use.
    expect(pickTrickplay({ ms1: { '320': { Width: 320, Height: 180, TileWidth: 10 } } }, 'ms1')).toBeNull()
  })

  it('finds the picture for a moment: the sheet, then the place on it', () => {
    expect(trickplayTile(info, 0)).toEqual({ sheet: 0, column: 0, row: 0 })
    expect(trickplayTile(info, 25)).toEqual({ sheet: 0, column: 2, row: 0 }) // picture 2
    expect(trickplayTile(info, 130)).toEqual({ sheet: 0, column: 3, row: 1 }) // picture 13
    expect(trickplayTile(info, 1000)).toEqual({ sheet: 1, column: 0, row: 0 }) // picture 100: the second sheet starts
    expect(trickplayTile(info, 1234)).toEqual({ sheet: 1, column: 3, row: 2 }) // picture 123
  })

  it('never goes before the first picture or past the last one', () => {
    expect(trickplayTile(info, -5)).toEqual({ sheet: 0, column: 0, row: 0 })
    expect(trickplayTile(info, 1_000_000)).toEqual({ sheet: 2, column: 9, row: 4 }) // picture 249
  })

  it('builds the address of a sheet', () => {
    expect(trickplaySheetUrl('http://jellyfin.local', 'item 1', 320, 2, 'ms-1')).toBe(
      'http://jellyfin.local/Videos/item%201/Trickplay/320/2.jpg?MediaSourceId=ms-1',
    )
  })
})
