/**
 * The printer and nozzle pickers, checked against the real baked profiles.
 *
 * Two selects showing one choice is the kind of thing that looks obviously
 * right and is quietly wrong: changing the printer silently moves the nozzle,
 * a machine with no 0.6 profile hands back somebody else's bed, or a nozzle
 * remembered from one print follows the user into the next one months later.
 * None of that throws. It comes out as a file sliced for a tip that is not on
 * the machine -- a printer trying to push 0.8 mm of plastic through a 0.4 mm
 * hole, days later, in someone else's room.
 *
 * So the choice logic is pure and lives in src/local/printers.js, and this runs
 * it against web/src/data/printers.json rather than a fixture -- half these
 * checks are really about the data being complete.
 *
 * Lives in web/ next to the other check harnesses. Run it directly, or let
 * tests/test_local_printers.py run it:
 *
 *   node web/printers-check.mjs
 */

import { readFileSync } from 'node:fs'

import {
  DEFAULT_NOZZLE_MM, FALLBACK_MODEL, NOZZLES_MM,
  models, nozzlesFor, pick, startingPrinter,
} from './src/local/printers.js'

const results = []
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push({ label, ok, got, want })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got ${JSON.stringify(got)}${ok ? '' : `\n        want ${JSON.stringify(want)}`}`)
}

const index = JSON.parse(readFileSync('src/data/printers.json', 'utf8'))
const blobs = JSON.parse(readFileSync('src/data/printer-settings.json', 'utf8'))
const printers = index.printers

console.log('--- the data ----------------------------------------------------')
{
  const machines = models(printers)
  check('every machine carries all four nozzles',
    machines.filter((p) => nozzlesFor(printers, p.model).join() !== NOZZLES_MM.join())
      .map((p) => p.model), [])
  check('the printer picker lists each machine once',
    machines.length, new Set(printers.map((p) => p.model)).size)
  check('every entry has a settings blob for every material it offers',
    printers.filter((p) => !p.materials.every((m) => blobs[p.id]?.[m]?.settings))
      .map((p) => p.id), [])

  // The blob is what actually reaches the printer, and it is the one place the
  // nozzle can be wrong without anything looking wrong: the file opens, the
  // plate is right, and the extrusion is not.
  const wrong = []
  for (const p of printers) {
    for (const m of p.materials) {
      const s = blobs[p.id][m].settings
      if (Number(s.nozzle_diameter?.[0]) !== p.nozzle_mm) wrong.push([p.id, m, s.nozzle_diameter])
      if (s.printer_settings_id !== p.id) wrong.push([p.id, m, s.printer_settings_id])
      if (s.print_settings_id !== p.process) wrong.push([p.id, m, s.print_settings_id])
    }
  }
  check('every blob names the nozzle, machine and process of the entry holding it',
    wrong, [])

  // A 0.2 mm nozzle cannot lay a 0.2 mm layer, and an 0.8 laying one would take
  // a week. Bambu's own rule of thumb is a quarter to three quarters of the
  // tip; the vendored defaults all sit at half, which is worth pinning because
  // the process is chosen for the user and never shown to them.
  const layers = printers.filter((p) => {
    const h = Number(blobs[p.id][p.materials[0]].settings.layer_height)
    return !(h >= p.nozzle_mm * 0.25 && h <= p.nozzle_mm * 0.75)
  }).map((p) => p.id)
  check('every chosen layer height is printable by the nozzle it belongs to',
    layers, [])

  // Bed and height belong to the machine, not to what is screwed into it. If
  // this ever stops holding, the printer picker showing one bed per model is a
  // lie and the plate is drawn at the wrong size.
  const beds = models(printers).filter((p) => printers
    .filter((q) => q.model === p.model)
    .some((q) => q.bed_mm.join() !== p.bed_mm.join() || q.height_mm !== p.height_mm))
    .map((p) => p.model)
  check('a machine has one bed whatever nozzle is in it', beds, [])
}

console.log('\n--- picking -----------------------------------------------------')
{
  const p1s = 'Bambu Lab P1S'
  check('the nozzles offered are the four, smallest first',
    nozzlesFor(printers, p1s), NOZZLES_MM)
  check('picking a model and a nozzle gets that exact machine profile',
    NOZZLES_MM.map((n) => pick(printers, p1s, n).id),
    NOZZLES_MM.map((n) => `${p1s} ${n} nozzle`))

  // The two selects are halves of one value, so each has to leave the other
  // alone. This is the check that would have caught "change the printer, lose
  // the nozzle you just set".
  check('changing the machine keeps the nozzle',
    pick(printers, 'Bambu Lab A1 mini', pick(printers, p1s, 0.6).nozzle_mm).id,
    'Bambu Lab A1 mini 0.6 nozzle')
  check('changing the nozzle keeps the machine',
    pick(printers, pick(printers, 'Bambu Lab A1 mini', 0.6).model, 0.2).model,
    'Bambu Lab A1 mini')

  // Falling back within the model, never across it. A machine we have no 0.6
  // for must still be the machine the user owns -- answering with a different
  // printer is how someone gets a file laid out for a bed they do not have.
  const thin = printers.filter((p) => p.model !== p1s || p.nozzle_mm !== 0.6)
  check('a nozzle the machine has no profile for falls back to 0.4, same machine',
    pick(thin, p1s, 0.6).id, `${p1s} ${DEFAULT_NOZZLE_MM} nozzle`)
  check('a model nobody has heard of is null, not another printer',
    pick(printers, 'Creality Ender 3', 0.4), null)
}

console.log('\n--- where a session starts --------------------------------------')
{
  check('nothing remembered starts on the fallback machine at 0.4',
    startingPrinter(printers, null).id,
    `${FALLBACK_MODEL} ${DEFAULT_NOZZLE_MM} nozzle`)

  // The whole point of the asymmetry: the machine is yours, the nozzle is
  // whatever was fitted for one print. A remembered 0.8 is a wrong answer to a
  // question nobody asked again.
  check('a remembered machine comes back, and the nozzle does not',
    startingPrinter(printers, 'Bambu Lab A1 mini 0.8 nozzle').id,
    `Bambu Lab A1 mini ${DEFAULT_NOZZLE_MM} nozzle`)
  check('every printer, remembered, starts at 0.4',
    [...new Set(printers.map((p) => startingPrinter(printers, p.id).nozzle_mm))],
    [DEFAULT_NOZZLE_MM])
  check('a remembered printer that no longer exists is not fatal',
    startingPrinter(printers, 'Bambu Lab Z9 0.4 nozzle').id,
    `${FALLBACK_MODEL} ${DEFAULT_NOZZLE_MM} nozzle`)
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
