/**
 * Prove the JavaScript port writes the same container the Python does.
 *
 * The two are fed *identical* geometry -- dumped by the Python side rather than
 * rebuilt here -- because otherwise trimesh's vertex ordering differs from
 * anything written by hand and the diff fills with noise that says nothing
 * about the writer. Placement follows the server's convention too: vertices
 * stay in the model's own coordinates and the transform carries the position.
 *
 *   node spikes/web3mf_compare.mjs <mesh.json> <out.3mf>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto) globalThis.crypto = webcrypto

const { makeProject3mf, writePng } = await import('../web/src/make3mf.js')

const [meshPath, out] = process.argv.slice(2)
const mesh = JSON.parse(readFileSync(meshPath, 'utf8'))
const data = JSON.parse(readFileSync('web/src/data/printers.json', 'utf8'))

const printer = data.printers.find((p) => p.id === mesh.printer)
if (!printer) throw new Error(`printer not in printers.json: ${mesh.printer}`)

const flat = (px, rgb) => {
  const a = new Uint8Array(px * px * 4)
  for (let i = 0; i < a.length; i += 4) {
    a[i] = rgb[0]; a[i + 1] = rgb[1]; a[i + 2] = rgb[2]; a[i + 3] = 255
  }
  return writePng(a, px, px)
}

const zip = makeProject3mf({
  vertices: mesh.vertices,
  triangles: mesh.triangles,
  printer,
  material: mesh.material || 'PLA',
  matrix: mesh.matrix,
  title: mesh.title,
  thumbnails: {
    plate: flat(512, [34, 164, 93]),
    plateSmall: flat(128, [34, 164, 93]),
    plateNoLight: flat(512, [24, 120, 68]),
    top: flat(512, [34, 164, 93]),
    pick: flat(512, [255, 0, 0]),
  },
})

writeFileSync(out, zip)
console.log(`javascript wrote ${zip.length} bytes`)
