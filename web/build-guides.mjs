/**
 * Write the search pages, robots.txt and sitemap.xml into web/public/.
 *
 *   node build-guides.mjs            write the files
 *   node build-guides.mjs --check    write nothing, report what has drifted
 *
 * The output is committed rather than generated during the Vercel build, for
 * the same reason the baked printer profiles are: what ships should be a thing
 * you can open and read in the repo, and a page whose only copy lives inside a
 * build step is a page nobody proof-reads. `--check` is what
 * tests/test_guides.py runs, so a committed page that no longer matches its
 * source fails the suite instead of going out quietly.
 *
 * The sitemap's lastmod would otherwise change on every run and make every
 * check a failure, so it is not taken from the clock: --check reuses the date
 * already in the committed sitemap, and a write uses today unless --date says
 * otherwise.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  INDEXNOW_KEY, PAGES, renderIndexNowKey, renderLlms, renderNotFound,
  renderPage, renderRobots, renderSitemap,
} from './guides.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(HERE, 'public')

const check = process.argv.includes('--check')
const dateArg = process.argv.find((a) => a.startsWith('--date='))

/** Today as an ISO date, in local time -- matching Python's date.today(). */
function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The date the sitemap should carry. Committed value under --check so the diff
 * is about the pages and not about what day it is; otherwise today, or whatever
 * --date was given.
 */
function sitemapDate() {
  if (dateArg) return dateArg.slice('--date='.length)
  if (check) {
    const path = resolve(PUBLIC, 'sitemap.xml')
    if (existsSync(path)) {
      const found = /<lastmod>([\d-]+)<\/lastmod>/.exec(readFileSync(path, 'utf8'))
      if (found) return found[1]
    }
  }
  return today()
}

const files = new Map()
for (const page of PAGES) files.set(page.slug + '.html', renderPage(page))
files.set('404.html', renderNotFound())
files.set(INDEXNOW_KEY + '.txt', renderIndexNowKey())
files.set('robots.txt', renderRobots())
files.set('llms.txt', renderLlms())
files.set('sitemap.xml', renderSitemap(sitemapDate()))

if (!existsSync(PUBLIC)) mkdirSync(PUBLIC, { recursive: true })

/**
 * Line endings are never the difference worth reporting.
 *
 * `.gitattributes` pins these files to LF so the working copy is the same
 * everywhere, and that is the real fix. This is the belt underneath it: a
 * checkout that arrives with CRLF anyway -- a different clone, an editor that
 * rewrote a file on save -- would otherwise fail every comparison at once and
 * name six pages as out of date without a word having changed, which is a
 * false alarm that teaches people to rerun the generator without reading it.
 */
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')

const drifted = []
for (const [name, text] of files) {
  const path = resolve(PUBLIC, name)
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (current !== null && sameText(current, text)) continue
  drifted.push(current === null ? name + ' (missing)' : name)
  if (!check) writeFileSync(path, text, 'utf8')
}

if (check) {
  console.log('RESULTS ' + JSON.stringify({ drifted, count: files.size }))
  if (drifted.length) {
    console.error('Out of date, re-run without --check:\n  '
      + drifted.join('\n  '))
    process.exit(1)
  }
  console.log(`${files.size} files up to date.`)
} else {
  console.log(drifted.length
    ? `Wrote ${drifted.length} of ${files.size}:\n  ${drifted.join('\n  ')}`
    : `${files.size} files already up to date.`)
}
