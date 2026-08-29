/**
 * Links that leave the app, and the two ways of getting them wrong.
 *
 * Added to the Home Screen this runs as a standalone web app, and a plain link
 * tapped in there opens a stripped browser sheet inside our own app rather
 * than the user's Safari. `src/local/outside.js` swaps the scheme for
 * `x-safari-https:` in that one case, which iOS hands to Safari itself.
 *
 * The failure modes are opposite and both silent:
 *
 * 1. The rewrite leaks out of the Home Screen case. `x-safari-https://` means
 *    nothing to a desktop browser or to Android, so every outward link on the
 *    landing screen would be dead for everybody who is not on an iPad. There
 *    is no error -- a tap does nothing.
 * 2. A new outward link is added later and written the plain way, so it goes
 *    back to the sheet for the one audience this app is for. Nothing fails;
 *    it is just the old behaviour, in one place, which is the sort of thing
 *    that is noticed months later or never.
 *
 * So this exercises outside.js in both modes against a fake `navigator`, and
 * then reads LocalApp.jsx for any http(s) `href` that has not gone through
 * `outward`. The second is a regex rather than a parser, for the reason
 * metrics-check.mjs gives: it over-reports rather than under-reports, which is
 * the right way round for a guard.
 *
 *   node web/outside-check.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOCAL = join(HERE, 'src', 'local')

const results = []
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push({ label, ok, got, want })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got ${JSON.stringify(got)}${ok ? '' : `\n        want ${JSON.stringify(want)}`}`)
}

// outside.js reads a global `navigator`. Node has one, and it is read-only, so
// the module is loaded against a stand-in rather than the real thing.
const setNavigator = (value) => {
  Object.defineProperty(globalThis, 'navigator', {
    value, configurable: true, writable: true,
  })
}

const load = async (standalone) => {
  setNavigator(standalone === undefined ? {} : { standalone })
  // A fresh copy each time: `standalone()` is called per link, but the module
  // is cached, and a stale one would make this agree with itself for free.
  return import(`./src/local/outside.js?mode=${String(standalone)}&n=${Math.random()}`)
}

const KOFI = 'https://ko-fi.com/meow_skulls'
const MW = 'https://makerworld.com'

console.log('\n--- outside a Home Screen app, nothing changes -------------------')
{
  for (const value of [undefined, false]) {
    const { outward, outwardHtml, standalone } = await load(value)
    check(`navigator.standalone ${String(value)} is not the Home Screen case`,
      standalone(), false)
    check(`  an outward link is left alone (${String(value)})`,
      [outward(KOFI), outward(MW)], [KOFI, MW])
    check(`  and so is the page in the frame (${String(value)})`,
      outwardHtml(`<a href="${MW}">go</a>`), `<a href="${MW}">go</a>`)
  }
}

console.log('\n--- inside one, https becomes Safari\'s own scheme ----------------')
{
  const { outward, outwardHtml, standalone } = await load(true)
  check('navigator.standalone true is the Home Screen case', standalone(), true)
  check('  the scheme is swapped, and nothing else about the address is',
    [outward(KOFI), outward(MW)],
    ['x-safari-https://ko-fi.com/meow_skulls', 'x-safari-https://makerworld.com'])
  check('  every href in the frame\'s page is swapped',
    outwardHtml(`<a href="${MW}">a</a> and <a href="${MW}/x">b</a>`),
    '<a href="x-safari-https://makerworld.com">a</a> and '
    + '<a href="x-safari-https://makerworld.com/x">b</a>')
  // The page is written asking for a new tab, which is right everywhere
  // else it is read. Here the scheme is itself the handoff to Safari, and
  // the request for a window on top of it is what leaves an empty one
  // behind inside our own app.
  check('  and the frame stops asking for a new tab as well',
    outwardHtml(`<a href="${MW}" target="_blank" rel="noopener">go</a>`),
    '<a href="x-safari-https://makerworld.com" rel="noopener">go</a>'),
  // The save links are blob: URLs and the plate picture is a data: URI. There
  // is no x-safari- form for either, and handing one to iOS would break the
  // one button that matters.
  check('  a blob or a data URI is not an address Safari can be handed',
    [outward('blob:http://localhost/abc'), outward('data:image/png;base64,AA'),
      outward(undefined), outward(null)],
    ['blob:http://localhost/abc', 'data:image/png;base64,AA', undefined, null])
  check('  an img src is not an href, and is left alone',
    outwardHtml('<img src="https://example.com/a.png">'),
    '<img src="https://example.com/a.png">')
}

console.log('\n--- no outward link in the app skips it ---------------------------')
{
  const text = readFileSync(join(LOCAL, 'LocalApp.jsx'), 'utf8')
  // An href whose value starts with a plain http(s) string or a bare
  // identifier that is not wrapped in outward(...).
  const raw = []
  for (const m of text.matchAll(/href=\{([^}]*)\}/g)) {
    const value = m[1].trim()
    if (value.includes('outward(')) continue
    // The three save buttons hand out blob: URLs made in this file. Those
    // are the app's own object URLs, not somewhere outside it.
    if (/^written\.(url|pictureUrl|pageUrl)$/.test(value)) continue
    raw.push(value)
  }
  check('every href in LocalApp.jsx is a save link or goes through outward()',
    raw, [])

  for (const m of text.matchAll(/href="([^"]*)"/g)) raw.push(m[1])
  check('and none of them is a literal address in the markup', raw, [])
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
