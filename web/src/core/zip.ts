import { unzipSync } from 'fflate'

/** What a book file may unpack to: a single picture or chapter over this, or all of it together, is not a book. */
const MAX_ENTRY_BYTES = 80 * 1024 * 1024
const MAX_TOTAL_BYTES = 600 * 1024 * 1024
const MAX_ENTRIES = 20_000

/**
 * Unpacks a zip file (an EPUB or a comic book archive) into its files by name. A file that is not a zip, or that would unpack to
 * something absurdly big (a "zip bomb"), is refused with a plain message instead of filling the memory of the browser tab.
 */
export function unpack(data: ArrayBuffer): Map<string, Uint8Array> {
  let total = 0
  let entries = 0
  let refused = false
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(data), {
      filter: (file) => {
        entries += 1
        total += file.originalSize
        if (entries > MAX_ENTRIES || file.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) refused = true
        return !refused
      },
    })
  } catch {
    throw new Error('That file could not be opened. It may be damaged, or not the kind of book it says it is.')
  }
  if (refused) throw new Error('That file is too big to open here. Download it to read it somewhere else.')
  return new Map(Object.entries(files))
}

/** The text of a file of a zip, read as UTF-8 (a byte order mark is dropped). */
export function textOf(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
