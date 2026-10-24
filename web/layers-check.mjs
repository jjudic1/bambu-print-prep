/**
 * Variable layer height (web/src/local/variableLayers.js), checked on a dome.
 *
 * A half sphere 50 mm across is the case it exists for: straight-up sides at the bottom,
 * where thick layers do no harm, and an almost-flat top, where the steps show. The table
 * must start with the first layer, stay inside the printer's limits, and be thicker low on
 * the dome than near its top.
 *
 * With a path argument it also writes the container, so Bambu Studio can slice it:
 *
 *   node web/layers-check.mjs out\dome-variable.3mf
 *   bambu-studio.exe --slice 0 --outputdir out out\dome-variable.3mf
 *
 * and the G-code's layer heights should vary (they are all one height without the table).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) globalThis.crypto = webcrypto

const { adaptiveProfile, layerHeightsFile, slicingParams, QUALITY } = await import('./src/local/variableLayers.js')
const { makeProject3mf } = await import('./src/make3mf.js')

const results = []
const check = (label, ok, got) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${got === undefined ? '' : `\n        got ${JSON.stringify(got)}`}`)
}

/** A half sphere of radius r standing on z = 0, `n` bands from the rim to the pole. */
function dome(r, n = 48, around = 96) {
  const vertices = []
  const triangles = []
  for (let i = 0; i <= n; i++) {
    const lat = (Math.PI / 2) * (i / n)
    for (let j = 0; j < around; j++) {
      const lon = (2 * Math.PI * j) / around
      vertices.push(r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat))
    }
  }
  const at = (i, j) => i * around + (j % around)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < around; j++) {
      triangles.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j))
    }
  }
  // The flat bottom, a fan from its centre.
  const centre = vertices.length / 3
  vertices.push(0, 0, 0)
  for (let j = 0; j < around; j++) triangles.push(centre, at(0, j + 1), at(0, j))
  return { vertices, triangles }
}

const data = JSON.parse(readFileSync(new URL('./src/data/printers.json', import.meta.url), 'utf8'))
const blobs = JSON.parse(readFileSync(new URL('./src/data/printer-settings.json', import.meta.url), 'utf8'))
const entry = data.printers.find((p) => p.model === 'Bambu Lab A1 mini' && Number(p.nozzle_mm) === 0.4)
  || data.printers.find((p) => p.model === 'Bambu Lab A1 mini')
const printer = { ...entry, materials: blobs[entry.id] }
const settings = printer.materials.PLA.settings
const params = slicingParams(settings)
console.log(`        ${entry.id}: layer ${params.layer}, min ${params.minLayer}, max ${params.maxLayer}, first ${params.firstLayer}`)

const { vertices, triangles } = dome(25)
const profile = adaptiveProfile(vertices, triangles, params, QUALITY)
const heights = []
for (let i = 4; i < profile.length; i += 2) heights.push({ z: profile[i], h: profile[i + 1] })

check('the table starts at 0 with the first layer, twice', profile.slice(0, 4).join(',') ===
  [0, params.firstLayer, params.firstLayer, params.firstLayer].join(','), profile.slice(0, 4))
check('every layer is within the printer\'s limits',
  heights.every((l) => l.h >= params.minLayer - 1e-9 && l.h <= params.maxLayer + 1e-9))
const low = heights.filter((l) => l.z < 10)
const high = heights.filter((l) => l.z > 22)
const mean = (xs) => xs.reduce((s, l) => s + l.h, 0) / xs.length
check('thicker low on the dome than near its top', mean(low) > mean(high) * 1.5,
  { low: mean(low).toFixed(3), high: mean(high).toFixed(3) })
check('reaches the top (25 mm)', Math.abs(profile[profile.length - 2] + profile[profile.length - 1] - 25) < 0.2 ||
  Math.abs(profile[profile.length - 2] - 25) < 1e-6, profile.slice(-4))
check('fewer layers than at the finest height, more than at the coarsest',
  heights.length < 25 / params.minLayer && heights.length > 25 / params.maxLayer, heights.length)
const text = layerHeightsFile([profile, null])
check('the file names object 1 only', text.startsWith('object_id=1|0.000000;') && !text.includes('object_id=2'))

const out = process.argv[2]
if (out) {
  const plates = [{
    objects: [{ vertices, triangles, name: 'dome', matrix: [[1, 0, 0, 90], [0, 1, 0, 90], [0, 0, 1, 0], [0, 0, 0, 1]],
                layerProfile: profile }],
    thumbnails: null,
  }]
  writeFileSync(out, makeProject3mf({ printer, material: 'PLA', title: 'dome.stl', plates }))
  console.log(`        wrote ${out}, ${heights.length + 1} layers in the table`)
}

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length} checks, ${failed ? `${failed} FAILED` : 'all ok'}`)
process.exit(failed ? 1 : 0)
