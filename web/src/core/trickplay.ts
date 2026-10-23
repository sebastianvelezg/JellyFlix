import type { TrickplayInfoDto } from '@jellyfin/sdk/lib/generated-client/models/trickplay-info-dto'
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api'
import type { Session } from './jellyfin'

/**
 * The small pictures that show where you are about to jump to when you point at the seek bar (Jellyfin calls them "trickplay").
 * The server makes them into sheets: each sheet is a grid of `tileWidth` x `tileHeight` pictures, one every `interval` milliseconds.
 * A server that has not made them for a title simply has none, and the seek bar just shows the time.
 */

export interface TrickplayInfo {
  /** Size of one picture, in pixels. */
  width: number
  height: number
  /** How many pictures a sheet holds across and down. */
  tileWidth: number
  tileHeight: number
  thumbnailCount: number
  /** Milliseconds between two pictures. */
  interval: number
}

/** The widths worth using in a small preview: the one nearest to this, without going far over. */
const PREFERRED_WIDTH = 320

function toInfo(dto: TrickplayInfoDto): TrickplayInfo | null {
  const { Width: width, Height: height, TileWidth: tileWidth, TileHeight: tileHeight, ThumbnailCount: thumbnailCount, Interval: interval } = dto
  if (!width || !height || !tileWidth || !tileHeight || !thumbnailCount || !interval) return null
  return { width, height, tileWidth, tileHeight, thumbnailCount, interval }
}

/** Pure: chooses what to use out of what a title offers (several sizes per version of the file); null if nothing is usable. */
export function pickTrickplay(
  offered: Record<string, Record<string, TrickplayInfoDto> | null> | null | undefined,
  mediaSourceId: string,
): TrickplayInfo | null {
  const sizes = Object.values(offered?.[mediaSourceId] ?? {})
    .map(toInfo)
    .filter((i): i is TrickplayInfo => i !== null)
  if (sizes.length === 0) return null
  return sizes.reduce((best, size) => (Math.abs(size.width - PREFERRED_WIDTH) < Math.abs(best.width - PREFERRED_WIDTH) ? size : best))
}

export async function getTrickplay(session: Session, itemId: string, mediaSourceId: string): Promise<TrickplayInfo | null> {
  const { data } = await getLibraryApi(session.api).getItem({ itemId, userId: session.userId })
  return pickTrickplay(data.Trickplay, mediaSourceId)
}

export interface TrickplayTile {
  /** Which sheet the picture is on (0 is the first). */
  sheet: number
  /** Where it is on the sheet, in pictures from the left and from the top. */
  column: number
  row: number
}

/** Pure: where the picture for `seconds` into the video is. */
export function trickplayTile(info: TrickplayInfo, seconds: number): TrickplayTile {
  const index = Math.min(info.thumbnailCount - 1, Math.max(0, Math.floor((seconds * 1000) / info.interval)))
  const perSheet = info.tileWidth * info.tileHeight
  const within = index % perSheet
  return { sheet: Math.floor(index / perSheet), column: within % info.tileWidth, row: Math.floor(within / info.tileWidth) }
}

/** The address of a sheet. It needs the access token like any other request: fetch it with the Authorization header. */
export function trickplaySheetUrl(serverUrl: string, itemId: string, width: number, sheet: number, mediaSourceId: string): string {
  return `${serverUrl}/Videos/${encodeURIComponent(itemId)}/Trickplay/${width}/${sheet}.jpg?MediaSourceId=${encodeURIComponent(mediaSourceId)}`
}
