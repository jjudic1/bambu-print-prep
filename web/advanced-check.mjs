/**
 * The advanced drawer, checked against the real baked profiles.
 *
 * Two things here fail silently if they are wrong, and neither shows up on
 * screen, in the container's bounding box, or in a file that opens fine:
 *
 * 1. **An override that is not declared in `different_settings_to_system` is
 *    reverted by Bambu Studio**, which reloads the named system profiles and
 *    re-applies only the declared keys. The file then says gyroid and the
 *    slicer prints grid. This is the same trap that ate `enable_support` once
 *    already (docs/transport-findings.md, `_override_manifest` in
 *    prep/profiles.py).
 * 2. **The settings blob is one shared object for the session**, fetched once.
 *    Patch it in place and the choice follows the user into every later file --
 *    including after they have put the drawer back to Standard.
 *
 * The rest is about the drawer telling the truth: "Standard" has to mean the
 * profile's own value, the supports toggle starts where the profiles actually
 * start, and every key we write has to be one the profiles already carry --
 * inventing a key name gets no error from anywhere, just a setting that does
 * nothing.
 *
 * Runs against web/src/data/printer-settings.json, all 202 blobs, not a
 * fixture. Run it directly, or let tests/test_local_advanced.py run it:
 *
 *   node web/advanced-check.mjs
 */

import { readFileSync } from 'node:fs'

import {
  DEFAULTS, DENSITIES, KEYS, PATTERNS, SUPPORT_TYPE, WALLS,
  applyAdvanced, changedKeys, declare, patchFor, profileValues, summarise,
} from './src/local/advanced.js'

const results = []
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push({ label, ok, got, want })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got ${JSON.stringify(got)}${ok ? '' : `\n        want ${JSON.stringify(want)}`}`)
}

const index = JSON.parse(readFileSync('src/data/printers.json', 'utf8'))
const blobs = JSON.parse(readFileSync('src/data/printer-settings.json', 'utf8'))
const printers = index.printers

/** Every (printer id, material) pair the app can reach. */
const every = []
for (const [id, materials] of Object.entries(blobs)) {
  for (const material of Object.keys(materials)) every.push([id, material])
}

/** The profile object withSettings() hands the writer. */
const profileFor = (id) => ({ ...printers.find((p) => p.id === id), materials: blobs[id] })

console.log('--- the data the drawer rests on --------------------------------')
{
  check('every printer and material has a settings blob', every.length, 202)

  const missing = []
  for (const [id, material] of every) {
    for (const key of KEYS) {
      if (blobs[id][material].settings[key] === undefined) missing.push(`${id} ${material} ${key}`)
    }
  }
  check('every key the drawer writes already exists in every blob', missing, [])

  // The supports toggle is the one control with a definite default rather than
  // a "Standard" that defers, and this is the fact it rests on. If a profile
  // export ever lands with supports off, the toggle starts as a lie.
  const odd = every.filter(([id, m]) => blobs[id][m].settings.enable_support !== '1')
  check('every profile already turns supports on', odd, [])

  const notTree = every.filter(([id, m]) => blobs[id][m].settings.support_type !== SUPPORT_TYPE)
  check('every profile already asks for tree supports', notTree, [])

  // The pattern is uniform across the whole export, unlike density and wall
  // count -- which is why those two defer to the profile and this one can be
  // named: Grid is the profile's own answer everywhere, and Gyroid, our
  // default, is a declared override everywhere.
  const notGrid = [...new Set(every.map(([id, m]) => blobs[id][m].settings.sparse_infill_pattern))]
  check('every profile says grid', notGrid, ['grid'])

  // And the two that are *not* uniform, which is the whole argument for null
  // meaning "leave it alone" rather than a blanket default of ours.
  const densities = [...new Set(every.map(([id, m]) => blobs[id][m].settings.sparse_infill_density))].sort()
  const walls = [...new Set(every.map(([id, m]) => blobs[id][m].settings.wall_loops))].sort()
  check('profiles disagree about how much goes inside', densities, ['15%', '25%'])
  check('profiles disagree about how many walls', walls, ['2', '4'])
}

console.log('\n--- the defaults change the pattern and nothing else --------------')
{
  // Gyroid is the one deliberate override of ours. Everything else has to be
  // the profile's own answer, or the drawer overrules a figure somebody tuned
  // for that nozzle for a user who never opened it.
  const wrong = []
  for (const [id, material] of every) {
    const settings = applyAdvanced(profileFor(id), material, DEFAULTS).materials[material].settings
    const moved = Object.keys(settings)
      .filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(blobs[id][material].settings[k]))
      .sort()
    const declared = settings.different_settings_to_system[0].split(';')
    if (JSON.stringify(moved) !== '["different_settings_to_system","sparse_infill_pattern"]'
        || settings.sparse_infill_pattern !== 'gyroid'
        || !declared.includes('sparse_infill_pattern')) wrong.push(`${id} ${material}`)
  }
  check('the defaults write gyroid, declared, and touch nothing else', wrong, [])

  // And Grid with the rest left alone is the file from before gyroid was the
  // default -- the same object, not an equal copy.
  const changed = []
  for (const [id, material] of every) {
    const profile = profileFor(id)
    if (applyAdvanced(profile, material, { ...DEFAULTS, pattern: 'grid' }) !== profile) {
      changed.push(`${id} ${material}`)
    }
  }
  check('grid leaves every profile untouched, object and all', changed, [])

  check('undefined choices are the defaults', patchFor(undefined), patchFor(DEFAULTS))
  check('the defaults say nothing in the summary line', summarise(DEFAULTS), [])
}

console.log('\n--- an override is written twice --------------------------------')
{
  const id = 'Bambu Lab P1S 0.4 nozzle'
  const choice = { pattern: 'gyroid', density: 30, walls: 3, supports: false }
  const before = JSON.stringify(blobs[id].PLA.settings)
  const after = applyAdvanced(profileFor(id), 'PLA', choice)
  const settings = after.materials.PLA.settings

  check('the values are in the blob', {
    pattern: settings.sparse_infill_pattern,
    density: settings.sparse_infill_density,
    walls: settings.wall_loops,
    supports: settings.enable_support,
  }, {
    pattern: 'gyroid', density: '30%', walls: '3', supports: '0',
  })

  // The half that has no symptom: undeclared keys are reverted on load.
  check('every changed key is declared where Bambu Studio reads declarations',
    settings.different_settings_to_system[0].split(';').sort(),
    ['enable_support', 'sparse_infill_density', 'sparse_infill_pattern', 'wall_loops'])

  check('the declaration keeps its positional shape',
    settings.different_settings_to_system.length,
    blobs[id].PLA.settings.different_settings_to_system.length)

  // Compared as a yes/no: the blob is 4.8 KB of JSON per material and a diff
  // of it in the output would bury every other check on the page.
  check('the shared blob was not edited in place',
    JSON.stringify(blobs[id].PLA.settings) === before, true)

  const others = Object.keys(blobs[id]).filter((m) => m !== 'PLA')
  check('only the chosen material moved',
    others.filter((m) => after.materials[m] !== blobs[id][m]), [])

  // Nothing else in 487 settings may shift on the way through.
  const untouched = Object.keys(settings).filter((k) => {
    const was = JSON.stringify(blobs[id].PLA.settings[k])
    return JSON.stringify(settings[k]) !== was
  }).sort()
  check('nothing else in the blob moved', untouched,
    ['different_settings_to_system', 'enable_support', 'sparse_infill_density',
     'sparse_infill_pattern', 'wall_loops'])
}

console.log('\n--- supports ----------------------------------------------------')
{
  const id = 'Bambu Lab A1 mini 0.4 nozzle'
  const on = applyAdvanced(profileFor(id), 'PLA', { ...DEFAULTS, walls: 3 })
  check('supports left on are still tree supports',
    [on.materials.PLA.settings.enable_support, on.materials.PLA.settings.support_type],
    ['1', SUPPORT_TYPE])

  check('there is only one kind of support to ask for', patchFor(DEFAULTS).support_type,
    SUPPORT_TYPE)

  // Off is an override too: the profiles say on, so silence would mean on.
  const off = patchFor({ ...DEFAULTS, supports: false })
  check('turning them off writes the key rather than omitting it',
    off.enable_support, '0')
  check('turning them off does not argue about the style',
    off.support_type, undefined)

  // enable_support is the one key the baked blobs already declare. It has to
  // stay declared whichever way the toggle goes -- a dropped declaration hands
  // the decision back to the system profile.
  for (const supports of [true, false]) {
    const settings = applyAdvanced(profileFor(id), 'PLA', { ...DEFAULTS, supports, walls: 3 })
      .materials.PLA.settings
    check(`supports ${supports ? 'on' : 'off'} stays declared`,
      settings.different_settings_to_system[0].split(';').includes('enable_support'), true)
  }
}

console.log('\n--- the choices the drawer offers -------------------------------')
{
  check('the pattern choices are gyroid then grid',
    PATTERNS.map((p) => p.key), ['gyroid', 'grid'])
  check('the drawer opens on gyroid', DEFAULTS.pattern, 'gyroid')
  check('the first density and wall count defer to the profile',
    [DENSITIES[0].value, WALLS[0].value], [null, null])
  // Both ends are deliberately short of the ones the slicer allows. 100% is
  // hours and a spool for a part no stronger than 40%, and anything under 5%
  // leaves the top surface nothing to bridge onto. Asserted rather than
  // commented because "while I am in here" is exactly how a 0 or a 100 gets
  // added back.
  check('every density is a whole percentage inside the offered range',
    DENSITIES.slice(1).every((d) => Number.isInteger(d.value) && d.value >= 5 && d.value <= 90),
    true)
  check('the densities offered, in order',
    DENSITIES.map((d) => d.value), [null, 5, 10, 15, 25, 50, 90])
  check('every wall count is a whole number of loops',
    WALLS.slice(1).every((w) => Number.isInteger(w.value) && w.value >= 1), true)

  check('the summary names what was changed',
    summarise({ pattern: 'grid', density: 50, walls: 4, supports: false }),
    ['Grid', '50% inside', '4 walls', 'no supports'])

  check('what the profile says is readable for the Standard labels',
    profileValues(blobs['Bambu Lab P1S 0.4 nozzle'].PLA.settings),
    { pattern: 'grid', density: '15%', walls: '2', supports: true })

  check('a key already declared is never dropped',
    declare(['enable_support', '', ''], ['wall_loops']),
    ['enable_support;wall_loops', '', ''])
  check('changedKeys ignores a value that matches the profile',
    changedKeys({ wall_loops: '2' }, { wall_loops: '2' }), [])
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
