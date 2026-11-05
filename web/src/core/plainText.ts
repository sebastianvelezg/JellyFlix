const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * A description as plain text. Some providers (the ones books come from, for one) send HTML, and the app shows text,
 * so `<p><b>Hello</b></p>` would be drawn with its tags. Paragraph and line breaks become a space, every other tag goes,
 * and the common entities are turned back into their characters. Text without any of that comes back as it was.
 */
export function plainText(description: string | null | undefined): string | undefined {
  if (!description) return undefined
  if (!/[<&]/.test(description)) return description
  const text = description
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(?:#(\d{1,6})|#x([0-9a-f]{1,5})|([a-z]+));/gi, (whole, dec: string, hex: string, name: string) => {
      if (name) return ENTITIES[name.toLowerCase()] ?? whole
      const code = dec ? Number(dec) : parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
    .replace(/\s+/g, ' ')
    .trim()
  return text || undefined
}
