// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CSP } from '../../scripts/csp.mjs'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('the Content-Security-Policy', () => {
  it('refuses inline and eval scripts and every outside script source', () => {
    const script = CSP.split('; ').find((d) => d.startsWith('script-src ')) ?? ''
    expect(script).toBe("script-src 'self' 'wasm-unsafe-eval'")
    expect(CSP).toContain("base-uri 'self'")
    expect(CSP).toContain("frame-ancestors 'self'")
  })

  it('is the same text in nginx as in the Node server', () => {
    const snippet = read('docker/security-headers.conf')
    const headers = snippet.match(/^add_header Content-Security-Policy "([^"]+)" always;$/gm) ?? []
    expect(headers).toEqual([`add_header Content-Security-Policy "${CSP}" always;`])
  })

  it('is written in one place in nginx, and every block that sets a header of its own includes it', () => {
    const nginx = read('docker/nginx.conf')
    expect(nginx).not.toContain('Content-Security-Policy')
    const include = 'include /etc/nginx/snippets/security-headers.conf;'
    // nginx drops the headers of the outer block where a location adds its own, so the server block and each such location include it.
    const blocks = nginx.split(/^\s*location /m)
    expect(blocks[0]).toContain(include)
    for (const block of blocks.slice(1)) if (block.includes('add_header')) expect(block, block.slice(0, 40)).toContain(include)
  })

  it('serves a page, a service worker and an app that only read: GET alone, and no version number', () => {
    const nginx = read('docker/nginx.conf')
    expect(nginx).toContain('server_tokens off;')
    for (const block of nginx.split(/^\s*location /m).slice(1)) {
      if (block.startsWith('= /healthz')) continue
      expect(block, block.slice(0, 40)).toContain('limit_except GET { deny all; }')
    }
  })

  it('has no inline script in the page, so the policy can stay strict', () => {
    const html = read('index.html')
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\bsrc=/)
    expect(html).not.toMatch(/<script>[^<]/)
  })
})
