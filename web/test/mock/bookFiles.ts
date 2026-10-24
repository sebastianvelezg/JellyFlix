import { strToU8, zipSync } from 'fflate'

/** The files of the mock's books, made in memory: a small EPUB, a PDF and a comic archive (no files on disk are needed). */

/** A 1 x 1 PNG. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

const paragraphs = (n: number, chapter: number) =>
  Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1} of chapter ${chapter}. The quick brown fox jumps over the lazy dog, again and again, to make this page long enough to scroll.</p>`).join('\n')

export const EPUB_CHAPTERS = 3

/** An EPUB with three chapters, a style sheet that uses a picture, a table of contents, a link between chapters, and things a book must not be able to do. */
export function epubBytes(title: string): Uint8Array {
  const chapter = (n: number, extra = '') =>
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title><link rel="stylesheet" href="style.css" type="text/css"/>
<script>document.title = 'hacked'</script></head>
<body><h1 id="top">Chapter ${n} heading</h1>
${extra}
${paragraphs(40, n)}
<p id="second">Second spot of chapter ${n}.<a id="anchor"/> After the anchor.</p>
</body></html>`
  const first = chapter(
    1,
    `<p><a href="ch2.xhtml#second">Go to chapter two</a> <a href="https://example.invalid/outside">An outside link</a></p>
<p><img src="img/dot.png" alt="A dot"/> <img src="https://example.invalid/tracker.png" alt="A tracker"/></p>
<p onclick="alert(1)">Clicking does nothing.</p>`,
  )
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 as const }],
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    'OEBPS/content.opf': strToU8(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:identifier id="id">mock</dc:identifier></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="dot" href="img/dot.png" media-type="image/png"/></manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>`,
    ),
    'OEBPS/nav.xhtml': strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">Chapter One</a></li><li><a href="ch2.xhtml">Chapter Two</a><ol><li><a href="ch2.xhtml#second">A spot in two</a></li></ol></li><li><a href="ch3.xhtml">Chapter Three</a></li></ol></nav></body></html>',
    ),
    'OEBPS/style.css': strToU8('h1 { color: red; background: url(img/dot.png); } p { text-indent: 1em; } @import url("https://example.invalid/more.css");'),
    'OEBPS/img/dot.png': PNG,
    'OEBPS/ch1.xhtml': strToU8(first),
    'OEBPS/ch2.xhtml': strToU8(chapter(2)),
    'OEBPS/ch3.xhtml': strToU8(chapter(3)),
  }
  return zipSync(files as never)
}

export const COMIC_PAGES = 4

/** A comic archive of four pages whose names must be put in order as numbers ("page2" before "page10" style). */
export function cbzBytes(): Uint8Array {
  return zipSync({
    'page1.png': PNG,
    'page10.png': PNG,
    'page2.png': PNG,
    'page3.png': PNG,
    '__MACOSX/page1.png': PNG,
    'notes.txt': strToU8('not a page'),
  })
}

/** A small PDF that opens: three empty pages (no tables of offsets: readers rebuild them). */
export function pdfBytes(): Uint8Array {
  const page = (n: number) => `${n} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 300]>>endobj
`
  return strToU8(
    `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R 5 0 R]/Count 3>>endobj
${page(3)}${page(4)}${page(5)}trailer<</Root 1 0 R/Size 6>>
%%EOF
`,
  )
}
