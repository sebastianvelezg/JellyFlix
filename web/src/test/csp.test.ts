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

  it('is the same text in nginx as in the Node server, on every location', () => {
    const nginx = read('docker/nginx.conf')
    const headers = nginx.match(/add_header Content-Security-Policy "([^"]+)" always;/g) ?? []
    // The server block and the two locations that set their own headers.
    expect(headers).toHaveLength(3)
    for (const header of headers) expect(header).toContain(`"${CSP}"`)
  })

  it('has no inline script in the page, so the policy can stay strict', () => {
    const html = read('index.html')
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\bsrc=/)
    expect(html).not.toMatch(/<script>[^<]/)
  })
})
