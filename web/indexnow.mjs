/**
 * Tell Bing (and Yandex) that pages here have changed.
 *
 *   node indexnow.mjs               submit every URL in the sitemap
 *   node indexnow.mjs /a-slug ...   submit only these
 *   node indexnow.mjs --dry-run     print what would be sent, send nothing
 *
 * WHY THIS EXISTS. A sitemap is a thing a crawler comes and reads when it feels
 * like it, which for a site with almost no links pointing at it can be weeks.
 * IndexNow is the other direction: one POST saying "these addresses changed",
 * and Bing fetches them in hours. Google does not take part -- new pages there
 * still want Search Console's URL Inspection -- so this is half the job, not
 * all of it.
 *
 * RUN IT AFTER THE PRODUCTION DEPLOY, NOT BEFORE. The API fetches each URL to
 * check it is real. Submitting a page that has not shipped yet teaches Bing the
 * page is a 404, which is worse than never having asked.
 *
 * There is no CI in this repository, so nothing runs this automatically and
 * that is deliberate: a build hook would fire on every preview deployment and
 * announce URLs that do not exist yet. It is one command, run by hand, from a
 * machine with node.
 *
 * The endpoint answers 200 or 202 on success and says nothing more; 403 means
 * the key file did not match. It is fire-and-forget by design -- there is no
 * feedback on whether anything was actually crawled.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { INDEXNOW_KEY, SITE } from './guides.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENDPOINT = 'https://api.indexnow.org/indexnow'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const paths = args.filter((a) => !a.startsWith('--'))

/** Every URL in the committed sitemap -- the same list search engines read. */
function fromSitemap() {
  const xml = readFileSync(resolve(HERE, 'public', 'sitemap.xml'), 'utf8')
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])
}

/**
 * A path given on the command line, as a full URL. Accepts a bare slug, a
 * rooted path or a whole URL, because all three are things a person types, and
 * the API rejects anything that is not an absolute URL on this host.
 */
function asUrl(path) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return SITE + (path.startsWith('/') ? path : '/' + path)
}

const urlList = paths.length ? paths.map(asUrl) : fromSitemap()

const payload = {
  host: new URL(SITE).host,
  key: INDEXNOW_KEY,
  keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
  urlList,
}

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
})

const body = await response.text()
console.log(`${response.status} ${response.statusText}${body ? '\n' + body : ''}`)
console.log(`${urlList.length} URL(s) submitted:\n  ${urlList.join('\n  ')}`)

// 200 and 202 both mean accepted. Anything else is worth a non-zero exit so it
// is noticed rather than scrolled past -- 403 in particular means the key file
// at keyLocation did not match the key sent, which is the one way this silently
// does nothing at all.
if (response.status !== 200 && response.status !== 202) process.exit(1)
