import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { epubBytes, EPUB_CHAPTERS, cbzBytes } from '../../../test/mock/bookFiles'
import { openComic, unpack } from '../../core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chapterPage, openEpub, resolveLink, resolvePath, runsAsScript } from './epub'

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

/** A book with one chapter, written by an attacker: every way the page could run code or reach another address. */
const HOSTILE_CHAPTER = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title>
<meta http-equiv="refresh" content="0;url=http://evil.invalid/"/>
<base href="http://evil.invalid/"/>
<link rel="stylesheet" href="http://evil.invalid/a.css"/>
<link rel="prefetch" href="http://evil.invalid/b"/>
<style>@import "http://evil.invalid/c.css"; p { background: url(//evil.invalid/d.png) } @font-face { font-family: x; src: url(http://evil.invalid/f.woff) }</style>
</head><body ONLOAD="alert(1)">
<p ONCLICK="alert(1)" onmouseover=alert(1)>text</p>
<a href="jav&#9;ascript:alert(1)">tab</a>
<a href="&#x01;javascript:alert(1)">control</a>
<a href=" JavaScript:alert(1)">space</a>
<a href="java&#10;script:alert(1)">line break</a>
<a href="vbscript:msgbox(1)">vb</a>
<img src="//evil.invalid/x.png" srcset="http://evil.invalid/y.png 2x"/>
<img src="http://evil.invalid/z.png"/>
<div style="background: url(http://evil.invalid/e.png)">styled</div>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><script>alert(1)</script><image href="http://evil.invalid/i.png"/><use href="http://evil.invalid/u.svg#a"/><use href="#kept"/><feImage href="http://evil.invalid/fe.png"/><foreignObject><iframe src="http://evil.invalid/"></iframe></foreignObject><a xlink:href="javascript:alert(1)"><text>svg link</text></a></svg>
<iframe src="http://evil.invalid/"></iframe><object data="http://evil.invalid/o"></object><embed src="http://evil.invalid/e"/>
<form action="http://evil.invalid/"><input name="p"/><button>go</button></form>
<video src="http://evil.invalid/v.mp4"></video><audio src="http://evil.invalid/a.mp3"></audio>
<a href="https://example.invalid/fine">a normal link</a>
</body></html>`

function hostileBook() {
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 as const }],
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    'c.opf': strToU8(
      '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Hostile</dc:title><dc:identifier id="id">x</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
    ),
    'c1.xhtml': strToU8(HOSTILE_CHAPTER),
  }
  return openEpub(buffer(zipSync(files as never)))
}

describe('a hostile chapter', () => {
  const page = chapterPage(hostileBook(), 0, '')
  const doc = new DOMParser().parseFromString(page, 'text/html')

  it('reaches no other address', () => {
    expect(page).not.toContain('evil.invalid')
  })

  it('has nothing that runs or loads', () => {
    expect(doc.querySelectorAll('script, iframe, frame, object, embed, applet, form, input, button, video, audio, base, link, noscript, meta[http-equiv="refresh"]')).toHaveLength(0)
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase().startsWith('on'), `${el.tagName} ${attr.name}`).toBe(false)
        expect(runsAsScript(attr.value), `${el.tagName} ${attr.name}=${attr.value}`).toBe(false)
        expect(attr.name.toLowerCase(), el.tagName).not.toBe('srcset')
      }
    }
  })

  it('keeps the policy first, before any style of the book', () => {
    const policy = page.indexOf('Content-Security-Policy')
    expect(policy).toBeGreaterThan(-1)
    expect(policy).toBeLessThan(page.indexOf('<style>'))
    expect(page).toContain("default-src 'none'")
  })

  it('keeps what is harmless: the text, a link to the web and a reference to the page itself', () => {
    expect(page).toContain('a normal link')
    expect(page).toContain('href="https://example.invalid/fine"')
    expect(page).toContain('href="#kept"')
  })
})

describe('runsAsScript', () => {
  it.each(['javascript:alert(1)', ' JavaScript:alert(1)', 'jav\tascript:alert(1)', 'java\nscript:x', '\u0001javascript:x', 'vbscript:x'])('%j does', (value) => {
    expect(runsAsScript(value)).toBe(true)
  })
  it.each(['https://example.com/javascript:', 'mailto:a@b.c', '#top', 'chapter2.xhtml', 'data:image/png;base64,AAAA'])('%j does not', (value) => {
    expect(runsAsScript(value)).toBe(false)
  })
})

describe('the frame the chapters are shown in', () => {
  it('may not run scripts, open windows, submit forms or navigate the app', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../components/reader/EpubReader.tsx'), 'utf8')
    const sandbox = /sandbox="([^"]*)"/.exec(source)?.[1]
    expect(sandbox).toBe('allow-same-origin')
  })
})
