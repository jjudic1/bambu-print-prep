/**
 * The splitter, the per-part pose, and the layout -- checked without a browser.
 *
 * `/local` cuts an assembly into parts, lets each be turned onto its own face,
 * and lays them across as many plates as it takes. Every one of those steps can
 * fail quietly: a split that loses a piece, a pose that mirrors it, a layout
 * measured on the shape a part used to be. None of that raises an error -- it
 * shows up as a model that prints wrong, days later, on someone else's printer.
 *
 * So the maths LocalApp does is repeated here against geometry whose answers
 * are known, and checked by signed volume as well as by size, because a mirror
 * preserves the bounding box.
 *
 * Lives in web/ rather than spikes/ so that `three` resolves. Run it directly,
 * or let tests/test_local_parts.py run it:
 *
 *   node web/parts-check.mjs
 */

import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  arrange, clash, footprint, keepOuts, keepScale, modelSize, splitParts,
  withPartBack, withoutPart, withoutPlate,
} from './src/local/parts.js'
import { IDENTITY, sameOrientation, turn } from './src/orientation.js'
import { PLATE_STRIDE, plateColumns, plateOrigin } from './src/make3mf.js'

// --- the same maths LocalApp does, lifted out of React -----------------------

const baseSizeOf = (parts, base) => {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...base))
  const box = new THREE.Box3()
  for (const p of parts) box.union(footprint(p.geometry, m).box)
  const s = box.getSize(new THREE.Vector3())
  return [s.x, s.y, s.z]
}
const factorsOf = (baseSize, uniform, sizeMm, longestMm) => {
  if (!uniform && sizeMm) return sizeMm.map((v, i) => v / (baseSize[i] || 1))
  return Array(3).fill(longestMm / (Math.max(...baseSize) || 1))
}
const modelMatrixOf = (base, factors) =>
  new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...base))
    .premultiply(new THREE.Matrix4().makeScale(...factors))
const matrixForOf = (modelMatrix) => (part) => {
  const m = modelMatrix.clone()
  if (part.scale && part.scale !== 1) {
    m.premultiply(new THREE.Matrix4().makeScale(part.scale, part.scale, part.scale))
  }
  if (!sameOrientation(part.spin, IDENTITY)) {
    m.premultiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...part.spin)))
  }
  if (part.yaw) m.premultiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(part.yaw)))
  return m
}
const extents = (geometry, m) => {
  const c = geometry.clone(); c.applyMatrix4(m); c.computeBoundingBox()
  const v = c.boundingBox.getSize(new THREE.Vector3())
  return [v.x, v.y, v.z].map((n) => Math.round(n * 100) / 100)
}
const signedVolume = (geometry) => {
  const pos = geometry.getAttribute('position'); const idx = geometry.getIndex()
  const n = idx ? idx.count / 3 : pos.count / 3
  const at = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k)
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3()
  let v = 0
  for (let t = 0; t < n; t++) {
    a.fromBufferAttribute(pos, at(t, 0))
    b.fromBufferAttribute(pos, at(t, 1))
    c.fromBufferAttribute(pos, at(t, 2))
    v += a.dot(b.clone().cross(c)) / 6
  }
  return v
}

const results = []
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push({ label, ok, got, want })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got ${JSON.stringify(got)}${ok ? '' : `\n        want ${JSON.stringify(want)}`}`)
}

// --- an assembly: three loose blocks of different sizes, one geometry --------

// Built the way readModel hands geometry on: a flat triangle soup with nothing
// but positions, welded and indexed. Keeping the loaders' normals would stop
// mergeVertices welding across a hard edge, and every face would come apart as
// its own "part" -- which is exactly why readModel strips them first.
function soup(...blocks) {
  const flat = blocks.map((g) => {
    const n = g.toNonIndexed()
    for (const name of Object.keys(n.attributes)) {
      if (name !== 'position') n.deleteAttribute(name)
    }
    return n
  })
  const total = flat.reduce((n, g) => n + g.getAttribute('position').count, 0)
  const positions = new Float32Array(total * 3)
  let at = 0
  for (const g of flat) {
    positions.set(g.getAttribute('position').array, at)
    at += g.getAttribute('position').array.length
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const welded = mergeVertices(merged, 1e-5)
  welded.computeVertexNormals()
  return welded
}

const assembly = () => soup(
  new THREE.BoxGeometry(100, 40, 20),
  new THREE.BoxGeometry(60, 30, 30).translate(200, 0, 0),
  new THREE.BoxGeometry(30, 30, 90).translate(-200, 0, 0),
)

const whole = assembly()

console.log('\n--- split -------------------------------------------------------')
const split = splitParts(whole)
check('an assembly of three blocks comes apart into three', split.length, 3)
check('one solid piece has nothing to split',
  splitParts(soup(new THREE.BoxGeometry(10, 10, 10))), null)
check('the pieces are the three blocks, whole',
  split.map((g) => Math.round(Math.abs(signedVolume(g)))).sort((a, b) => b - a),
  [81000, 80000, 54000])
check('no volume lost or gained by splitting',
  Math.round(split.reduce((n, g) => n + Math.abs(signedVolume(g)), 0)),
  Math.round(Math.abs(signedVolume(whole))))
check('every piece keeps its winding -- a flipped one would print inside out',
  split.map((g) => signedVolume(g) > 0), [true, true, true])

// --- parts, as LocalApp holds them ------------------------------------------

let id = 1
const parts = split.map((geometry) => ({
  id: id++, geometry, name: `Part ${id - 1}`, plate: 0, x: 90, y: 90,
  spin: IDENTITY, yaw: 0, scale: 1,
}))

console.log('\n--- size frame: the bug this fixes ------------------------------')
{
  const base = turn(IDENTITY, [1, 0, 0], 90)        // Tip forward
  const one = [parts[0]]                            // the 100 x 40 x 20 block
  const bs = baseSizeOf(one, base)
  check('base size is measured after the tip', bs.map(Math.round), [100, 20, 40])

  const ask = [100, 40, 20]
  const f = factorsOf(bs, false, ask, 0)
  const m = modelMatrixOf(base, f)
  check('sliders ask 100 x 40 x 20 on a tipped model, and get it',
    extents(one[0].geometry, m), [100, 40, 20])
  check('the readout agrees with the sliders exactly',
    bs.map((v, i) => Math.round(v * f[i])), ask)
}

console.log('\n--- per-part turning --------------------------------------------')
{
  const bs = baseSizeOf(parts, IDENTITY)
  const f = factorsOf(bs, true, null, Math.max(...bs))   // original size
  const model = modelMatrixOf(IDENTITY, f)

  const tall = parts.find((p) => extents(p.geometry, model)[2] === 90)
  check('one part is 90 mm tall to start', extents(tall.geometry, model), [30, 30, 90])

  const laid = { ...tall, spin: turn(IDENTITY, [1, 0, 0], 90) }
  check('tipping that part alone lays it down',
    extents(laid.geometry, matrixForOf(model)(laid)), [30, 90, 30])

  const others = parts.filter((p) => p.id !== tall.id)
  check('and leaves every other part exactly where it was',
    others.map((p) => extents(p.geometry, matrixForOf(model)(p))),
    others.map((p) => extents(p.geometry, model)))

  const spun = { ...laid, yaw: 90 }
  check('yaw on that part spins its footprint, not the others',
    extents(spun.geometry, matrixForOf(model)(spun)), [90, 30, 30])
}

console.log('\n--- per-part resize ---------------------------------------------')
{
  const bs = baseSizeOf(parts, IDENTITY)
  const f = factorsOf(bs, true, null, Math.max(...bs))
  const model = modelMatrixOf(IDENTITY, f)
  const matrixFor = matrixForOf(model)

  const one = parts.find((p) => extents(p.geometry, model)[0] === 100)
  check('the part is 100 x 40 x 20 to start',
    extents(one.geometry, matrixFor(one)), [100, 40, 20])

  const half = { ...one, scale: 0.5 }
  check('halving that part halves every axis of it',
    extents(half.geometry, matrixFor(half)), [50, 20, 10])

  const others = parts.filter((p) => p.id !== one.id)
  check('and leaves every other part the size it was',
    others.map((p) => extents(p.geometry, matrixFor(p))),
    others.map((p) => extents(p.geometry, model)))

  // A uniform scale commutes with rotation, which is the whole reason it can
  // live outside the model's frame. If it did not, a tipped part would come out
  // a different size from the same part upright.
  const tipped = { ...half, spin: turn(IDENTITY, [1, 0, 0], 90) }
  check('a resized part is the same size whichever face it is on',
    extents(tipped.geometry, matrixFor(tipped)).slice().sort((a, b) => a - b),
    extents(half.geometry, matrixFor(half)).slice().sort((a, b) => a - b))

  const g = half.geometry.clone(); g.applyMatrix4(matrixFor(half))
  check('resizing never mirrors a part', signedVolume(g) > 0, true)
}

console.log("\n--- arrange uses each part's own footprint -----------------------")
{
  const printer = { bed_mm: [180, 180] }          // A1 mini: the case this is for
  const bs = baseSizeOf(parts, IDENTITY)
  const f = factorsOf(bs, true, null, Math.max(...bs))
  const model = modelMatrixOf(IDENTITY, f)
  const matrixFor = matrixForOf(model)

  const flat = arrange(parts, printer, matrixFor)
  check('three parts, none too big, land on plates', flat.tooBig.length, 0)
  check('every part gets a placement', flat.placements.length, parts.length)

  // Stand the long block on end and its footprint changes completely. Laying
  // out on the shared pose -- the shape it used to be -- would miss that.
  const onEnd = parts.map((p) => (p.id === parts[0].id
    ? { ...p, spin: turn(IDENTITY, [0, 1, 0], 90) } : p))
  const after = arrange(onEnd, printer, matrixFor)
  const before = flat.placements.find((p) => p.id === parts[0].id)
  const now = after.placements.find((p) => p.id === parts[0].id)
  check('turning a part changes where arrange puts it',
    before.x !== now.x || before.y !== now.y || before.plate !== now.plate, true)

  // A part genuinely bigger than the bed is still placed, and still reported.
  const huge = [{ ...parts[0], geometry: soup(new THREE.BoxGeometry(400, 400, 20)) }]
  const big = arrange(huge, printer, matrixFor)
  check('a part bigger than the bed is placed anyway and reported',
    [big.placements.length, big.tooBig.length], [1, 1])
}

console.log('\n--- the bed a printer will not print on --------------------------')
{
  // What the baked profile for a P1S, a P1P or any X1 actually carries: the
  // 18 x 28 mm corner at the front left that the machine purges and wipes on.
  // Rows used to start at (8, 8), which is inside it -- the file opened, the
  // plate looked right, and MakerWorld refused to slice it.
  const p1s = { bed_mm: [256, 256], exclude_areas: [[[0, 0], [18, 0], [18, 28], [0, 28]]] }
  const a1 = { bed_mm: [256, 256], exclude_areas: [] }

  check('a machine with no keep-out has none', keepOuts(a1), [])
  check('a keep-out polygon becomes the box around it',
    keepOuts(p1s), [{ x0: 0, y0: 0, x1: 18, y1: 28 }])
  check('a printer from before this existed is not a crash', keepOuts({ bed_mm: [180, 180] }), [])
  check('touching a keep-out along its edge is not standing on it',
    [clash(keepOuts(p1s), 18, 0, 40, 40), clash(keepOuts(p1s), 17.9, 0, 40, 40)].map(Boolean),
    [false, true])

  const bs = baseSizeOf(parts, IDENTITY)
  const f = factorsOf(bs, true, null, Math.max(...bs))
  const model = modelMatrixOf(IDENTITY, f)
  const matrixFor = matrixForOf(model)

  const standsOn = (printer, placements) => placements.filter((place) => {
    const item = parts.find((p) => p.id === place.id)
    const { width, depth } = footprint(item.geometry, matrixFor(item))
    return clash(keepOuts(printer), place.x - width / 2, place.y - depth / 2, width, depth)
  }).map((p) => p.id)

  const clear = arrange(parts, p1s, matrixFor)
  check('no part is laid out on the keep-out', standsOn(p1s, clear.placements), [])
  check('and every part is still placed, on one plate',
    [clear.placements.length, clear.plateCount, clear.tooBig.length], [3, 1, 0])

  // Rows start at the back left: the same row the layout always made (x 58,
  // 144, 195), now against the back edge instead of the front. Each part's
  // back is 8 mm from the back of the 256 mm bed.
  const before = arrange(parts, a1, matrixFor).placements
  check('a machine with no keep-out lays out from the back left',
    before.map((p) => [p.plate, Math.round(p.x), Math.round(p.y)]),
    [[0, 58, 228], [0, 144, 233], [0, 195, 233]])
  check('every part of the first row has its back on the back margin',
    before.map((p) => {
      const item = parts.find((q) => q.id === p.id)
      const { depth } = footprint(item.geometry, matrixFor(item))
      return Math.round((p.y + depth / 2) * 1000) / 1000
    }),
    [248, 248, 248])

  // The keep-out is at the front, so a row at the back never meets it: the
  // same three parts land in the same places on a P1S as on an A1.
  check('a keep-out at the front leaves a row at the back alone',
    clear.placements.map((p) => [p.plate, Math.round(p.x), Math.round(p.y)]),
    before.map((p) => [p.plate, Math.round(p.x), Math.round(p.y)]))

  // A plate full enough to reach the front still steps past the corner. 20 mm
  // cubes 6 mm apart: nine to a row and nine rows from the back. The ninth
  // row's front edge is 20 mm from the front, inside the 28 mm deep corner, so
  // that row starts right of it and holds eight. 80 cubes fill the plate.
  const cube = soup(new THREE.BoxGeometry(20, 20, 10))
  const many = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, geometry: cube, spin: IDENTITY }))
  const flatFor = () => new THREE.Matrix4()
  const full = arrange(many, p1s, flatFor)
  const onCorner = full.placements.filter((p) =>
    clash(keepOuts(p1s), p.x - 10, p.y - 10, 20, 20))
  check('a full plate keeps clear of the front corner', onCorner.length, 0)
  check('and the plate fills from the back: the first cube is at the back left',
    [Math.round(full.placements[0].x), Math.round(full.placements[0].y)], [18, 238])
  const front = Math.min(...full.placements.map((p) => p.y))
  const frontRow = full.placements.filter((p) => p.y === front)
  check('the front row starts right of the corner, not on it',
    [Math.round(front), frontRow.length, Math.round(Math.min(...frontRow.map((p) => p.x)))], [30, 8, 34])
  check('and every cube is still on one plate',
    [full.placements.length, full.plateCount, full.tooBig.length], [80, 1, 0])

  // A part with nowhere to stand clear is reported rather than shuffled about
  // forever: a bed that is nearly all keep-out is not a bed.
  const walled = { bed_mm: [256, 256], exclude_areas: [[[0, 0], [250, 0], [250, 250], [0, 250]]] }
  const stuck = arrange(parts, walled, matrixFor)
  check('a part with no clear spot is reported, not lost',
    [stuck.placements.length, stuck.tooBig.length], [3, 3])
}

console.log('\n--- what the writer would receive -------------------------------')
{
  const bs = baseSizeOf(parts, IDENTITY)
  const f = factorsOf(bs, true, null, 120)
  const model = modelMatrixOf(IDENTITY, f)
  const matrixFor = matrixForOf(model)
  const posed = parts.map((p, i) => (i === 0
    ? { ...p, spin: turn(IDENTITY, [1, 0, 0], 90), yaw: 45 } : p))

  // Exactly what build() does before handing geometry to make3mf.
  const sat = posed.map((part) => {
    const g = part.geometry.clone()
    g.applyMatrix4(matrixFor(part))
    g.computeBoundingBox()
    const box = g.boundingBox
    const centre = box.getCenter(new THREE.Vector3())
    g.translate(-centre.x, -centre.y, -box.min.z)
    g.computeBoundingBox()
    return { minZ: Math.round(g.boundingBox.min.z * 1000) / 1000, volume: signedVolume(g) }
  })
  check('every part sits on the plate, none through it', sat.map((s) => s.minZ), [0, 0, 0])
  check('no part is mirrored by its pose -- signed volume stays positive',
    sat.map((s) => s.volume > 0), [true, true, true])
}

console.log('\n--- taking a part or a plate away --------------------------------')
{
  // Three boxes of different sizes, the biggest first. The size controls
  // measure all of them together, so removing the biggest shrinks the ruler --
  // and the other two must not grow to fill it.
  const box = (x, y, z) => new THREE.BoxGeometry(x, y, z)
  const trio = [
    { id: 1, name: 'Big', geometry: box(100, 40, 30), plate: 0, spin: IDENTITY, yaw: 0 },
    { id: 2, name: 'Mid', geometry: box(40, 30, 20), plate: 0, spin: IDENTITY, yaw: 0 },
    { id: 3, name: 'Small', geometry: box(20, 20, 60), plate: 1, spin: IDENTITY, yaw: 0 },
  ]
  const base = turn(IDENTITY, [0, 0, 1], 90)

  for (const [label, uniform, sizeMm] of [
    ['one size for everything', true, null],
    ['Across, Deep and Tall set apart', false, [30, 60, 45]],
  ]) {
    const before = modelSize(trio, base)
    const longestMm = 150
    const matrixBefore = matrixForOf(modelMatrixOf(base, factorsOf(before, uniform, sizeMm, longestMm)))

    const out = withoutPart(trio, 1)
    const after = modelSize(out.parts, base)
    const kept = keepScale(before, after, { longestMm, sizeMm })
    const matrixAfter = matrixForOf(modelMatrixOf(base, factorsOf(after, uniform, kept.sizeMm, kept.longestMm)))

    check(`${label}: the parts left keep their size exactly`,
      out.parts.map((p) => extents(p.geometry, matrixAfter(p))),
      out.parts.map((p) => extents(p.geometry, matrixBefore(p))))
    check(`${label}: and are not mirrored on the way`,
      out.parts.map((p) => {
        const g = p.geometry.clone(); g.applyMatrix4(matrixAfter(p)); return signedVolume(g) > 0
      }), [true, true])

    // And back again: the same scale, not a slightly different one.
    const back = withPartBack(out.parts, out.removed, 2)
    const again = keepScale(after, modelSize(back, base), kept)
    check(`${label}: putting it back restores the size setting`,
      [Math.round(again.longestMm * 1e6) / 1e6,
       again.sizeMm && again.sizeMm.map((v) => Math.round(v * 1e6) / 1e6)],
      [longestMm, sizeMm])
  }

  const out = withoutPart(trio, 2)
  check('a removed part is gone and the rest keep their order',
    out.parts.map((p) => p.id), [1, 3])
  check('a removed part goes back where it was in the list',
    withPartBack(out.parts, out.removed, 2).map((p) => p.id), [1, 2, 3])
  check('a part goes back onto the last plate if its own is gone',
    withPartBack(out.parts, { ...out.removed, part: { ...out.removed.part, plate: 4 } }, 2)
      .find((p) => p.id === 2).plate, 1)
  check('a part already there is not put back twice',
    withPartBack(trio, out.removed, 2), null)
  check('the last part cannot be removed', withoutPart([trio[0]], 1), null)
  check('a part that is not there cannot be removed', withoutPart(trio, 99), null)

  // Plates: [0, 0, 2] across three plates, plate 1 empty.
  const spread = trio.map((p, i) => ({ ...p, plate: [0, 0, 2][i] }))
  const gone = withoutPlate(spread, 1, 3)
  check('removing an empty plate moves the later ones down',
    [gone.parts.map((p) => p.plate), gone.plateCount], [[0, 0, 1], 2])
  check('a plate with something on it is not removed', withoutPlate(spread, 0, 3), null)
  check('the only plate is not removed', withoutPlate([], 0, 1), null)
  check('an empty last plate goes without moving anything',
    withoutPlate(spread, 3, 4)?.parts.map((p) => p.plate), [0, 0, 2])
}

console.log('\n--- where each plate sits in the file ----------------------------')
{
  // Bambu Studio decides which plate an object is on by where it stands, in a
  // grid that widens as plates are added. Wrapping every file at two -- what
  // this did until 2026-09-30 -- put plate 3 of a nine-plate job where Bambu
  // expects the start of row two, and MakerWorld refused it as empty.
  // A square grid that grows a size at a time -- 2x2 up to 4 plates, 3x3 up
  // to 9, 4x4 up to 16, 5x5 up to 25 -- filled a row at a time, left to
  // right. Seen that way in Bambu Studio by the user, 2026-09-30.
  check('plates per row, for 1 to 25 plates',
    Array.from({ length: 25 }, (_, i) => plateColumns(i + 1)),
    [1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5])

  const printer = { bed_mm: [256, 256] }
  const cell = (index, count) => {
    const [x, y] = plateOrigin(index, printer, count)
    return [Math.round(x / (256 * PLATE_STRIDE)), Math.round(-y / (256 * PLATE_STRIDE))]
  }
  // The one layout measured against Bambu Studio directly: three plates, two
  // across, the third starting row two.
  check('three plates: two across, the third on row two',
    [0, 1, 2].map((i) => cell(i, 3)), [[0, 0], [1, 0], [0, 1]])
  check('nine plates: three across, three rows -- plate 3 ends row one',
    Array.from({ length: 9 }, (_, i) => cell(i, 9)),
    [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]])
  check('eight plates: the same grid, the last cell left open',
    Array.from({ length: 8 }, (_, i) => cell(i, 8)).at(-1), [1, 2])
  check('ten plates: four across', cell(3, 10), [3, 0])
  check('twenty-five plates: five across, the last in the fifth row',
    [cell(4, 25), cell(5, 25), cell(24, 25)], [[4, 0], [0, 1], [4, 4]])

  let threw = false
  try { plateOrigin(0, printer) } catch (e) { threw = e instanceof Error }
  check('the plate count cannot be left out', threw, true)
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
