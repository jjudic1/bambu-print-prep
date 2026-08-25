/** Write a three-plate, five-object container and hand it to Bambu Studio. */
import { readFileSync, writeFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) globalThis.crypto = webcrypto

const { makeProject3mf, writePng, plateOrigin } = await import('../web/src/make3mf.js')
const data = JSON.parse(readFileSync('web/src/data/printers.json', 'utf8'))
const printer = data.printers.find((p) => p.model === 'Bambu Lab A1 mini')

function box(X, Y, Z) {
  const [x, y, z] = [X / 2, Y / 2, Z / 2]
  return {
    vertices: [-x,-y,-z, x,-y,-z, x,y,-z, -x,y,-z, -x,-y,z, x,-y,z, x,y,z, -x,y,z],
    triangles: [0,3,2, 0,2,1, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7],
  }
}
const at = (bx, by, bz) => [[1,0,0,bx],[0,1,0,by],[0,0,1,bz],[0,0,0,1]]
const flat = (px, rgb) => {
  const a = new Uint8Array(px*px*4)
  for (let i = 0; i < a.length; i += 4) { a[i]=rgb[0]; a[i+1]=rgb[1]; a[i+2]=rgb[2]; a[i+3]=255 }
  return writePng(a, px, px)
}
const shots = (rgb) => ({
  plate: flat(512, rgb), plateSmall: flat(128, rgb),
  plateNoLight: flat(512, rgb), top: flat(512, rgb), pick: flat(512, [255,0,0]),
})

// Three plates: two parts, one part, two parts. Deliberately more than fits on
// one A1 mini bed, which is the case this feature exists for.
const plates = [
  { objects: [
      { ...box(40,30,20), matrix: at(60, 60, 10), name: 'a' },
      { ...box(30,30,30), matrix: at(120, 120, 15), name: 'b' } ],
    thumbnails: shots([34,164,93]) },
  { objects: [ { ...box(60,60,40), matrix: at(90, 90, 20), name: 'c' } ],
    thumbnails: shots([224,123,57]) },
  { objects: [
      { ...box(25,25,25), matrix: at(50, 50, 12.5), name: 'd' },
      { ...box(25,25,25), matrix: at(130, 130, 12.5), name: 'e' } ],
    thumbnails: shots([61,127,209]) },
]

const zip = makeProject3mf({ printer, material: 'PLA', title: 'multi.stl', plates })
writeFileSync(process.argv[2], zip)
console.log(`wrote ${zip.length} bytes`)
console.log('plate origins:', [0,1,2].map(i => plateOrigin(i, printer).map(Math.round)))
