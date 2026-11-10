/** The longest side of a channel picture, and the most the container takes (150 kB; a margin is left for the base64). */
export const PICTURE_SIDE = 256
export const PICTURE_MAX_BYTES = 140 * 1024

/** The size of a picture that fits in a square of `max` pixels, keeping its shape and never made bigger. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 }
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> => new Promise((done) => canvas.toBlob(done, type, quality))

export class PictureError extends Error {}

/**
 * Shrinks a picture the person chose to a small one the container takes: at most 256 pixels on a side, as WebP (or PNG or JPEG when
 * the browser cannot make that), and small enough in bytes. Returns it as base64 to send, and an address to show it from.
 */
export async function shrinkPicture(file: File): Promise<{ data: string; preview: string }> {
  if (!/^image\//.test(file.type)) throw new PictureError('That file is not a picture.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new PictureError('That file is not a picture this browser can read.')
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, PICTURE_SIDE)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  for (const [type, quality] of [['image/webp', 0.9], ['image/webp', 0.75], ['image/webp', 0.6], ['image/png', 1], ['image/jpeg', 0.7]] as const) {
    const blob = await canvasBlob(canvas, type, quality)
    // A browser that cannot make a WebP answers with a PNG: that is fine, as long as it is a kind the container takes.
    if (blob && /^image\/(webp|png|jpeg)$/.test(blob.type) && blob.size <= PICTURE_MAX_BYTES) {
      return { data: toBase64(new Uint8Array(await blob.arrayBuffer())), preview: URL.createObjectURL(blob) }
    }
  }
  throw new PictureError('The picture is still too big after shrinking it. Try a simpler one.')
}
