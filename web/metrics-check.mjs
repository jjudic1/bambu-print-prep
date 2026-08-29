/**
 * The counting, and the one way it broke without anything failing.
 *
 * `web/src/metrics.js` exported a function called `note`. `LocalApp.jsx` also
 * calls its plain-language status line `note` -- `const [note, setNote] =
 * useState('')` -- so the local binding shadowed the import and every call
 * tried to invoke a string. Nothing failed at build time. Vite renamed one of
 * them and the app threw `note2 is not a function`; minified in production that
 * became `R is not a function`, under the colour swatches, *after* the file had
 * already been written. Two things were wrong at once: no step was ever
 * counted, and the user was shown an error about work that had actually
 * succeeded.
 *
 * So there are two checks here, and the second is the one that matters:
 *
 * 1. metrics.js exports what the apps import, and the funnel is in order.
 * 2. **No file that imports from metrics.js redeclares any of those names.**
 *    That is the shadowing bug as a rule, and it is worth having as a rule
 *    because the failure mode is silence -- a counter that stops counting
 *    reports nothing, which is indistinguishable from nobody turning up.
 *
 * Parsed with a regex rather than a real parser on purpose: adding a JS parser
 * to a project whose web build has four dependencies would cost more than the
 * bug did. It over-reports rather than under-reports -- a name in a comment
 * counts -- which is the right way round for a guard.
 *
 *   node web/metrics-check.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as metrics from './src/metrics.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'src')

const results = []
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push({ label, ok, got, want })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got ${JSON.stringify(got)}${ok ? '' : `\n        want ${JSON.stringify(want)}`}`)
}

/** Every .js/.jsx file under web/src. */
function sources(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sources(path))
    else if (/\.jsx?$/.test(entry)) found.push(path)
  }
  return found
}

console.log('\n--- what metrics.js offers --------------------------------------')
{
  check('the funnel is the four steps, in the order people take them',
    metrics.FUNNEL,
    [metrics.OPENED, metrics.MADE, metrics.SAVED, metrics.STEPS])
  check('every step has a name and they are all different',
    new Set(metrics.FUNNEL).size, 4)
  check('counting a step is a function, and starting is another',
    [typeof metrics.countStep, typeof metrics.startCounting],
    ['function', 'function'])
  check('the two products are told apart',
    [metrics.ON_DEVICE, metrics.HOSTED].every((s) => typeof s === 'string'
      && metrics.ON_DEVICE !== metrics.HOSTED), true)
}

console.log('\n--- nothing shadows what it imports -----------------------------')
{
  const exported = new Set(Object.keys(metrics))
  const clashes = []

  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8')
    const importing = [...text.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*metrics\.js['"]/g)]
    if (!importing.length) continue

    const names = importing.flatMap((match) => match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/).pop().trim())
      .filter(Boolean))

    for (const name of names) {
      if (!exported.has(name)) {
        clashes.push(`${relative(SRC, file)} imports ${name}, which metrics.js does not export`)
        continue
      }
      // A local binding of the same name, anywhere in the file: a plain
      // declaration, a destructured one (const [note, setNote] = ...), a
      // function, or a parameter list is close enough to catch the real case.
      const shadow = new RegExp(
        `(?:const|let|var)\\s+(?:\\[[^\\]]*\\b${name}\\b|\\{[^}]*\\b${name}\\b|${name}\\b)`
        + `|function\\s+${name}\\b`)
      if (shadow.test(text)) {
        clashes.push(`${relative(SRC, file)} redeclares ${name}, which it also imports from metrics.js`)
      }
    }
  }

  check('no file redeclares a name it imports from metrics.js', clashes, [])
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
