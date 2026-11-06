import { randomBytes, randomUUID } from 'node:crypto'

/** A 32-bit number from a text (FNV-1a), to seed a random sequence. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A random sequence that is always the same for the same seed (mulberry32). Returns numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A copy of the list in a random order (Fisher-Yates) that depends only on `random`. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

export const newId = (): string => randomUUID().replace(/-/g, '')

// No 0/O/1/I/L, so a code read aloud or typed on a phone is not mistaken.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** A short code to join a room. */
export function newRoomCode(length = 5): string {
  // Bytes above the largest multiple of the alphabet size are thrown away, so every letter is equally likely.
  const limit = 256 - (256 % CODE_ALPHABET.length)
  let out = ''
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit && out.length < length) out += CODE_ALPHABET[byte % CODE_ALPHABET.length]
    }
  }
  return out
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000)
