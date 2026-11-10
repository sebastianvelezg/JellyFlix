import { HttpError } from '../../http/router.ts'

/**
 * The picture of a channel. Only raster pictures that a browser or a TV draws safely are accepted (never SVG, which can carry
 * scripts), they are checked by what is inside them and not by what they say they are, and they are kept small: the apps draw them
 * as small tiles.
 */
export const MAX_IMAGE_BYTES = 150 * 1024
export const MAX_IMAGE_SIDE = 1024

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

const u16be = (b: Buffer, at: number): number => (b[at] as number) * 256 + (b[at + 1] as number)
const u16le = (b: Buffer, at: number): number => (b[at] as number) + (b[at + 1] as number) * 256

/** The size of a picture read from its header, and what it really is; null when it is none of the three. */
export function inspectImage(bytes: Buffer): { mime: ImageMime; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && bytes.subarray(12, 16).toString('latin1') === 'IHDR') {
    return { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null
      const marker = bytes[at + 1] as number
      if (marker === 0xff) {
        at += 1
        continue
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) return { mime: 'image/jpeg', height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        at += 2
        continue
      }
      at += 2 + u16be(bytes, at + 2)
    }
    return null
  }
  if (bytes.length >= 30 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    const kind = bytes.subarray(12, 16).toString('latin1')
    if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { mime: 'image/webp', width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff }
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21)
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8X') return { mime: 'image/webp', width: (bytes[24] as number) + (bytes[25] as number) * 256 + (bytes[26] as number) * 65536 + 1, height: (bytes[27] as number) + (bytes[28] as number) * 256 + (bytes[29] as number) * 65536 + 1 }
  }
  return null
}

/** What an administrator's app sent ({ data: base64 }) turned into a picture the container keeps; anything odd is refused. */
export function parseImage(body: unknown): { mime: ImageMime; bytes: Buffer } {
  const data = (body as { data?: unknown } | undefined)?.data
  if (typeof data !== 'string' || data.length === 0) throw new HttpError(400, 'The picture is missing.')
  if (data.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(413, `The picture is too big (up to ${MAX_IMAGE_BYTES / 1024} kB) or is not valid.`)
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, `The picture is too big (up to ${MAX_IMAGE_BYTES / 1024} kB).`)
  const found = inspectImage(bytes)
  if (!found) throw new HttpError(415, 'The picture must be a PNG, a JPEG or a WebP.')
  if (found.width < 1 || found.height < 1 || found.width > MAX_IMAGE_SIDE || found.height > MAX_IMAGE_SIDE) throw new HttpError(400, `The picture can be up to ${MAX_IMAGE_SIDE} pixels on a side.`)
  return { mime: found.mime, bytes }
}
