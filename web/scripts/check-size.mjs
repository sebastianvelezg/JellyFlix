// Fails when what a visitor must download to see the first screen has grown past the budget in size-budget.json.
//   npm run build && npm run size
// "First screen" is what dist/index.html asks for at once: its script, the modules it preloads and its style sheet (compressed with
// gzip, which is what a browser downloads). Everything loaded later (the player, the readers, the settings, the admin, the Spanish
// texts, hls.js, pdf.js) is left out on purpose: those only cost something to the people who open them.
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const dist = new URL('../dist/', import.meta.url)
const budget = JSON.parse(readFileSync(new URL('./size-budget.json', import.meta.url), 'utf8'))
const html = readFileSync(new URL('index.html', dist), 'utf8')

const wanted = new Set()
for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="\.\/(assets\/[^"]+)"[^>]*>/g)) {
  const tag = m[0]
  if (/<link\b/.test(tag) && !/rel="(modulepreload|stylesheet)"/.test(tag)) continue
  wanted.add(m[1])
}

const gz = (path) => gzipSync(readFileSync(new URL(path, dist)), { level: 9 }).length
let js = 0
let css = 0
const rows = []
for (const path of wanted) {
  const size = gz(path)
  if (path.endsWith('.css')) css += size
  else if (path.endsWith('.js')) js += size
  rows.push([path, size])
}
rows.sort((a, b) => b[1] - a[1])
const kb = (n) => (n / 1024).toFixed(1)
for (const [path, size] of rows.slice(0, 6)) console.log(`${kb(size).padStart(7)} kB  ${path}`)
console.log(`first screen: ${kb(js)} kB of JavaScript (budget ${kb(budget.firstScreenJsGzip)}), ${kb(css)} kB of CSS (budget ${kb(budget.firstScreenCssGzip)})`)

// Nothing that is only needed later may sneak into the first download.
// extra-: the administration, Live TV, plugins and statistics part of the core (src/core/extra.ts).
const never = ['es-', 'pt-', 'fr-', 'de-', 'hls-', 'pdf-', 'pdf.worker', 'extra-']
const leaked = [...wanted].filter((p) => never.some((n) => p.split('/').pop().startsWith(n)))
const problems = []
if (leaked.length) problems.push(`these files are loaded at once but only some people need them: ${leaked.join(', ')}`)
if (js > budget.firstScreenJsGzip) problems.push(`the first screen's JavaScript is ${kb(js)} kB, over the budget of ${kb(budget.firstScreenJsGzip)} kB`)
if (css > budget.firstScreenCssGzip) problems.push(`the first screen's CSS is ${kb(css)} kB, over the budget of ${kb(budget.firstScreenCssGzip)} kB`)
// The wasm and the worker of the PDF reader are large and must stay lazy: look at everything else only to report a surprise.
const biggest = readdirSync(fileURLToPath(new URL('assets/', dist)))
  .filter((f) => f.endsWith('.js'))
  .map((f) => [f, gz(`assets/${f}`)])
  .sort((a, b) => b[1] - a[1])[0]
console.log(`biggest file of all (loaded when needed): ${biggest[0]} ${kb(biggest[1])} kB`)

if (problems.length) {
  console.error('\n' + problems.map((p) => '✗ ' + p).join('\n'))
  console.error('\nIf the growth is on purpose, raise the budget in web/scripts/size-budget.json in the same change and say why.')
  process.exit(1)
}
console.log('✓ within the budget')
