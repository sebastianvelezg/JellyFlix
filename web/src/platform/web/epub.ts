import { textOf, unpack } from '../../core'

/**
 * Reading an EPUB: the file is a zip with a list of chapters (the "spine"), a table of contents and the pictures, fonts and style
 * sheets they use. This opens it and makes each chapter into a page that is safe to show: scripts and anything that would reach
 * the network are removed, and the pictures and fonts inside the book are handed over as local addresses.
 */

export interface TocEntry {
  label: string
  /** The chapter it leads to (an index of `chapters`). */
  chapter: number
  fragment?: string
  /** How deep it sits in the table of contents, from 0. */
  depth: number
}

export interface EpubBook {
  title: string
  /** The files of the chapters, in reading order. */
  chapters: string[]
  toc: TocEntry[]
  files: Map<string, Uint8Array>
}

const NOT_AN_EPUB = 'That file is not a valid EPUB.'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

const mimeOf = (path: string): string => MIME[(path.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream'

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** A file as a `data:` address. */
function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return `data:${mime};base64,${btoa(binary)}`
}

/** The path a link leads to, from the file that holds the link: "../images/a.png" from "OEBPS/text/ch1.xhtml" is "OEBPS/images/a.png". */
export function resolvePath(from: string, href: string): string {
  let target = href.split('#')[0]?.split('?')[0] ?? ''
  try {
    target = decodeURIComponent(target)
  } catch {
    // Keep it as it is.
  }
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

/** A file of the archive by its path; zips differ in capital letters now and then, so a case-insensitive match is the second try. */
function lookup(files: Map<string, Uint8Array>, path: string): Uint8Array | undefined {
  const exact = files.get(path)
  if (exact) return exact
  const lower = path.toLowerCase()
  for (const [name, bytes] of files) if (name.toLowerCase() === lower) return bytes
  return undefined
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(NOT_AN_EPUB)
  return doc
}

export function openEpub(data: ArrayBuffer): EpubBook {
  const files = unpack(data)
  const container = lookup(files, 'META-INF/container.xml')
  if (!container) throw new Error(NOT_AN_EPUB)
  const rootPath = parseXml(textOf(container)).getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  const rootBytes = rootPath ? lookup(files, rootPath) : undefined
  if (!rootPath || !rootBytes) throw new Error(NOT_AN_EPUB)
  const opf = parseXml(textOf(rootBytes))

  const manifest = new Map<string, { path: string; type: string; properties: string }>()
  for (const item of Array.from(opf.getElementsByTagName('item'))) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (id && href) manifest.set(id, { path: resolvePath(rootPath, href), type: item.getAttribute('media-type') ?? '', properties: item.getAttribute('properties') ?? '' })
  }

  const chapters: string[] = []
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    const entry = manifest.get(ref.getAttribute('idref') ?? '')
    if (entry && /x?html/i.test(entry.type) && lookup(files, entry.path) && !chapters.includes(entry.path)) chapters.push(entry.path)
  }
  if (chapters.length === 0) throw new Error('This book has no chapters that can be shown.')

  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() ?? ''
  const book: EpubBook = { title, chapters, toc: [], files }
  try {
    const nav = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('nav'))
    const ncxId = opf.getElementsByTagName('spine')[0]?.getAttribute('toc')
    const ncx = (ncxId ? manifest.get(ncxId) : undefined) ?? [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml')
    book.toc = (nav && tocFromNav(book, nav.path)) || (ncx && tocFromNcx(book, ncx.path)) || []
  } catch {
    // A table of contents that cannot be read is not a reason to refuse the book.
  }
  return book
}

function chapterAt(book: EpubBook, from: string, href: string): { chapter: number; fragment?: string } | null {
  const chapter = book.chapters.findIndex((path) => path.toLowerCase() === resolvePath(from, href).toLowerCase())
  if (chapter < 0) return null
  const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : undefined
  return { chapter, fragment: fragment || undefined }
}

function tocFromNav(book: EpubBook, navPath: string): TocEntry[] | null {
  const bytes = lookup(book.files, navPath)
  if (!bytes) return null
  const doc = new DOMParser().parseFromString(textOf(bytes), 'text/html')
  const navs = Array.from(doc.querySelectorAll('nav'))
  const nav = navs.find((n) => (n.getAttribute('epub:type') ?? '').split(/\s+/).includes('toc')) ?? navs[0]
  const root = nav ? Array.from(nav.children).find((c) => c.tagName === 'OL') : undefined
  if (!root) return null
  const out: TocEntry[] = []
  const walk = (list: Element, depth: number) => {
    for (const li of Array.from(list.children)) {
      const link = Array.from(li.children).find((c) => c.tagName === 'A' || c.tagName === 'SPAN')
      const href = link?.getAttribute('href')
      const label = link?.textContent?.replace(/\s+/g, ' ').trim()
      const target = href ? chapterAt(book, navPath, href) : null
      if (target && label) out.push({ label, depth, ...target })
      const children = Array.from(li.children).find((c) => c.tagName === 'OL')
      if (children) walk(children, depth + 1)
    }
  }
  walk(root, 0)
  return out.length ? out : null
}

function tocFromNcx(book: EpubBook, ncxPath: string): TocEntry[] | null {
  const bytes = lookup(book.files, ncxPath)
  if (!bytes) return null
  const doc = parseXml(textOf(bytes))
  const map = doc.getElementsByTagName('navMap')[0]
  if (!map) return null
  const out: TocEntry[] = []
  const walk = (parent: Element, depth: number) => {
    for (const point of Array.from(parent.children).filter((c) => c.tagName === 'navPoint')) {
      const label = point.getElementsByTagName('text')[0]?.textContent?.replace(/\s+/g, ' ').trim()
      const src = Array.from(point.children).find((c) => c.tagName === 'content')?.getAttribute('src')
      const target = src ? chapterAt(book, ncxPath, src) : null
      if (target && label) out.push({ label, depth, ...target })
      walk(point, depth + 1)
    }
  }
  walk(map, 0)
  return out.length ? out : null
}

/** Where a link inside a chapter leads: another chapter (and a spot in it), a web address, or nowhere we can follow. */
export function resolveLink(book: EpubBook, fromChapter: number, href: string): { chapter: number; fragment?: string } | { external: string } | null {
  if (SCHEME.test(href)) return /^(https?|mailto):/i.test(href) ? { external: href } : null
  if (href.startsWith('#')) return { chapter: fromChapter, fragment: href.slice(1) || undefined }
  return chapterAt(book, book.chapters[fromChapter] ?? '', href)
}

/** `<a id="x"/>` and the like are fine in a book (XHTML) but make the rest of the page a link when read as HTML: write them out in full. */
const SELF_CLOSED = /<(a|span|div|p|b|i|u|em|strong|small|sup|sub|font|h[1-6]|li|ul|ol|td|th|tr|table|section|title|style|script|label|center|blockquote)(\s[^<>]*?)?\s*\/>/gi

const FORBIDDEN = 'script, iframe, frame, frameset, object, embed, applet, form, audio, video, base, meta, noscript, input, button, textarea, select'

/** What a page of the book may do: show its own style, pictures and fonts, and nothing else (no network, no scripts). */
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"

/**
 * The pictures and fonts of the chapter last drawn, already written as `data:` addresses: drawing the same chapter again (the reader
 * changed the text size or the colours) does not read and encode them all over. Only one chapter's worth is kept.
 */
const encoded = new WeakMap<EpubBook, { chapter: number; urls: Map<string, string> }>()

/**
 * The page for one chapter, ready for a sandboxed frame. The pictures and fonts of the book it uses are written into the page itself
 * (as `data:` addresses), so there is nothing to load from anywhere and nothing to clean up afterwards.
 * `extraCss` (the reader's own colours and text size) comes last so that it wins over the book's.
 */
export function chapterPage(book: EpubBook, index: number, extraCss: string): string {
  const path = book.chapters[index]
  const bytes = path ? lookup(book.files, path) : undefined
  if (!path || !bytes) throw new Error('That chapter is missing from the book.')
  const doc = new DOMParser().parseFromString(textOf(bytes).replace(SELF_CLOSED, (_m, tag: string, attrs: string | undefined) => `<${tag}${attrs ?? ''}></${tag}>`), 'text/html')

  let kept = encoded.get(book)
  if (kept?.chapter !== index) {
    kept = { chapter: index, urls: new Map() }
    encoded.set(book, kept)
  }
  const made = kept.urls
  /** The local address of a file the chapter refers to, or null for a web address or a file the book does not have. */
  const local = (ref: string): string | null => {
    const value = ref.trim()
    if (value === '' || (SCHEME.test(value) && !value.toLowerCase().startsWith('data:'))) return null
    if (value.toLowerCase().startsWith('data:')) return value
    const target = resolvePath(path, value)
    const known = made.get(target)
    if (known) return known
    const file = lookup(book.files, target)
    if (!file) return null
    const url = dataUrl(file, mimeOf(target))
    made.set(target, url)
    return url
  }
  const rewriteCss = (css: string): string =>
    css
      .replace(/@import[^;]*;/gi, '')
      .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, _q: string, ref: string) => {
        const url = local(ref)
        return url ? `url("${url}")` : 'url("about:blank")'
      })

  for (const el of Array.from(doc.querySelectorAll(FORBIDDEN))) el.remove()
  for (const link of Array.from(doc.querySelectorAll('link'))) {
    const href = link.getAttribute('href')
    const sheet = href && /stylesheet/i.test(link.getAttribute('rel') ?? '') && !SCHEME.test(href) ? lookup(book.files, resolvePath(path, href)) : undefined
    if (sheet) {
      const style = doc.createElement('style')
      style.textContent = rewriteCss(textOf(sheet))
      link.replaceWith(style)
    } else link.remove()
  }
  for (const style of Array.from(doc.querySelectorAll('style'))) style.textContent = rewriteCss(style.textContent ?? '')
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
      else if (name === 'style') el.setAttribute(attr.name, rewriteCss(attr.value))
      else if (name === 'srcset') el.removeAttribute(attr.name)
      else if (name === 'src' || name === 'href' || name === 'xlink:href') {
        // Links stay as they are (the reader follows them); what is drawn must be inside the book.
        const draws = name === 'src' || el.tagName.toLowerCase() === 'image'
        if (draws) {
          const url = local(attr.value)
          if (url) el.setAttribute(attr.name, url)
          else el.removeAttribute(attr.name)
        }
      }
    }
  }

  const styles = Array.from(doc.querySelectorAll('style')).map((s) => `<style>${s.textContent ?? ''}</style>`).join('')
  const body = doc.body
  const attributes = ['class', 'lang', 'dir'].map((name) => (body.getAttribute(name) ? ` ${name}="${body.getAttribute(name)?.replace(/"/g, '&quot;')}"` : '')).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">${styles}<style>${extraCss}</style></head><body${attributes}>${body.innerHTML}</body></html>`
}
