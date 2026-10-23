import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { epubBytes, EPUB_CHAPTERS, cbzBytes } from '../../../test/mock/bookFiles'
import { openComic, unpack } from '../../core'
import { chapterPage, openEpub, resolveLink, resolvePath } from './epub'

const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

describe('resolvePath', () => {
  it('follows relative links from the file that holds them', () => {
    expect(resolvePath('OEBPS/text/ch1.xhtml', '../images/a.png')).toBe('OEBPS/images/a.png')
    expect(resolvePath('OEBPS/ch1.xhtml', 'ch2.xhtml#second')).toBe('OEBPS/ch2.xhtml')
    expect(resolvePath('OEBPS/ch1.xhtml', 'img/My%20Dot.png?x=1')).toBe('OEBPS/img/My Dot.png')
    expect(resolvePath('OEBPS/ch1.xhtml', '/cover.jpg')).toBe('cover.jpg')
  })
})

describe('openEpub', () => {
  const book = openEpub(buffer(epubBytes('A Book')))

  it('reads the title, the chapters in order and the table of contents with its levels', () => {
    expect(book.title).toBe('A Book')
    expect(book.chapters).toEqual(['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml', 'OEBPS/ch3.xhtml'])
    expect(book.chapters).toHaveLength(EPUB_CHAPTERS)
    expect(book.toc.map((e) => [e.label, e.chapter, e.fragment, e.depth])).toEqual([
      ['Chapter One', 0, undefined, 0],
      ['Chapter Two', 1, undefined, 0],
      ['A spot in two', 1, 'second', 1],
      ['Chapter Three', 2, undefined, 0],
    ])
  })

  it('refuses what is not an EPUB, with a plain message', () => {
    expect(() => openEpub(buffer(new TextEncoder().encode('just text')))).toThrow(/could not be opened/)
    expect(() => openEpub(buffer(cbzBytes()))).toThrow('That file is not a valid EPUB.')
  })

  it('follows links: to another chapter, within the chapter, to the web, and nowhere for anything else', () => {
    expect(resolveLink(book, 0, 'ch2.xhtml#second')).toEqual({ chapter: 1, fragment: 'second' })
    expect(resolveLink(book, 1, '#top')).toEqual({ chapter: 1, fragment: 'top' })
    expect(resolveLink(book, 0, 'https://example.invalid/outside')).toEqual({ external: 'https://example.invalid/outside' })
    expect(resolveLink(book, 0, 'javascript:alert(1)')).toBeNull()
    expect(resolveLink(book, 0, 'missing.xhtml')).toBeNull()
  })
})

describe('chapterPage', () => {
  const book = openEpub(buffer(epubBytes('A Book')))
  const page = chapterPage(book, 0, 'body { color: pink }')

  it('keeps the text and the reader\'s own style last', () => {
    expect(page).toContain('Chapter 1 heading')
    expect(page.indexOf('color: pink')).toBeGreaterThan(page.indexOf('text-indent'))
  })

  it('takes out scripts and event handlers, and whatever would reach the network', () => {
    expect(page).not.toContain('<script')
    expect(page).not.toContain('hacked')
    expect(page).not.toContain('onclick')
    expect(page).not.toContain('tracker.png')
    expect(page).not.toContain('@import')
    expect(page).toContain("default-src 'none'")
  })

  it('puts the pictures of the book into the page, in the text and in the style sheet', () => {
    expect(page).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="A dot">/)
    expect(page).toMatch(/background: url\("data:image\/png;base64,/)
  })

  it('writes a self-closed anchor out in full, so the text after it is not turned into a link', () => {
    expect(page).toContain('<a id="anchor"></a> After the anchor.')
  })

  it('refuses a chapter the book does not have', () => {
    expect(() => chapterPage(book, 9, '')).toThrow('That chapter is missing from the book.')
  })
})

describe('openComic / unpack', () => {
  it('lists the pictures in reading order (numbers as numbers) and leaves the rest out', () => {
    expect(openComic(buffer(cbzBytes())).map((p) => p.name)).toEqual(['page1.png', 'page2.png', 'page3.png', 'page10.png'])
  })

  it('says so when the archive holds no pictures, or is not an archive', () => {
    expect(() => openComic(buffer(zipSync({ 'readme.txt': strToU8('no pictures here') })))).toThrow('This comic has no pages that can be shown.')
    expect(() => unpack(buffer(new TextEncoder().encode('nope')))).toThrow(/could not be opened/)
  })
})
