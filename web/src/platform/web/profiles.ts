import { EMPTY_PROFILES, sanitizeProfiles, type PinLock, type ProfileBook } from '../../core'

const KEY = 'jellyflix.profiles'

/** The accounts saved on this browser. Nothing (or storage blocked) is an empty book. */
export function readProfiles(): ProfileBook {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? sanitizeProfiles(JSON.parse(raw)) : EMPTY_PROFILES
  } catch {
    return EMPTY_PROFILES
  }
}

export function writeProfiles(book: ProfileBook): void {
  try {
    if (book.profiles.length === 0 && book.ask) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(book))
  } catch {
    // Without storage the accounts are simply not kept.
  }
}

/** A PIN needs the browser's crypto, which only exists on https and localhost. */
export const canLockWithPin = (): boolean => typeof crypto !== 'undefined' && !!crypto.subtle

const hex = (bytes: ArrayBuffer | Uint8Array): string => [...new Uint8Array(bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function derive(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 120_000 }, key, 256)
  return hex(bits)
}

/** A new lock for a PIN: a random salt and the salted hash. */
export async function lockFor(pin: string): Promise<PinLock> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return { salt, hash: await derive(pin, salt) }
}

export async function pinMatches(pin: string, lock: PinLock): Promise<boolean> {
  const hash = await derive(pin, lock.salt)
  // Same length always; compared in full so the time does not say how much was right.
  let diff = hash.length ^ lock.hash.length
  for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ (lock.hash.charCodeAt(i) || 0)
  return diff === 0
}
