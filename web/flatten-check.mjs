/**
 * The bottom cut, checked without a browser.
 *
 * Cutting the bottom off a model is the one thing `/local` does that changes
 * geometry rather than just moving it, and every way it can go wrong is quiet.
 * A cap that misses a loop leaves the bounding box perfect and the volume
 * plausible. A cap wound the wrong way leaves both of those *exactly* right and
 * prints the bottom inside out. Snapping low vertices up onto the plane instead
 * of clipping looks identical on a dense scan and is visibly wrong on a cone.
 *
 * So the results are checked four ways: the volume against arithmetic done by
 * hand, the area of the new face against the cross-section it should be, the
 * winding by signed volume, and -- the one that catches a missing cap -- whether
 * every edge is still shared by exactly two triangles pointing opposite ways.
 *
 * Lives in web/ rather than spikes/ so that `three` resolves. Run it directly,
 * or let tests/test_local_flatten.py run it:
 *
 *   node web/flatten-check.mjs
 */

import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { cutBottom, posedGeometry } from './src/local/flatten.js'

// --- measuring ---------------------------------------------------------------

/** Geometry the way readModel hands it on: positions only, welded, indexed. */
function solid(geometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position') flat.deleteAttribute(name)
  }
  const welded = mergeVertices(flat, 1e-5)
  welded.computeVertexNormals()
  return welded
}

const corners = (geometry) => {
  const pos = geometry.getAttribute('position')
  const idx = geometry.getIndex()
  const n = idx ? idx.count / 3 : pos.count / 3
  const at = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k)
  return { pos, n, at }
}

const signedVolume = (geometry) => {
  const { pos, n, at } = corners(geometry)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let v = 0
  for (let t = 0; t < n; t++) {
    a.fromBufferAttribute(pos, at(t, 0))
    b.fromBufferAttribute(pos, at(t, 1))
    c.fromBufferAttribute(pos, at(t, 2))
    v += a.dot(b.clone().cross(c)) / 6
  }
  return v
}

/**
 * Is every edge shared by exactly two triangles, wound opposite ways?
 *
 * The check a missing cap cannot survive. An opening left uncapped has edges
 * used once; a hole capped as though it were solid has edges used twice the
 * same way round.
 */
const isClosed = (geometry) => {
  const { n, at } = corners(geometry)
  const seen = new Map()
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const a = at(t, k)
      const b = at(t, (k + 1) % 3)
      const key = `${a}_${b}`
      seen.set(key, (seen.get(key) || 0) + 1)
    }
  }
  for (const [key, count] of seen) {
    if (count !== 1) return false
    const [a, b] = key.split('_')
    if ((seen.get(`${b}_${a}`) || 0) !== 1) return false
  }
  return true
}

/** Area of the faces lying in the plate's plane -- the new bottom. */
const faceArea = (geometry, z, tol = 1e-3) => {
  const { pos, n, at } = corners(geometry)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let area = 0
  for (let t = 0; t < n; t++) {
    a.fromBufferAttribute(pos, at(t, 0))
    b.fromBufferAttribute(pos, at(t, 1))
    c.fromBufferAttribute(pos, at(t, 2))
    if (Math.abs(a.z - z) > tol || Math.abs(b.z - z) > tol
        || Math.abs(c.z - z) > tol) continue
    area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2
  }
  return area
}

const box = (geometry) => {
  const g = geometry.clone()
  g.computeBoundingBox()
  return g.boundingBox
}
const round = (v, places = 2) => Math.round(v * 10 ** places) / 10 ** places
const near = (got, want, tol) => Math.abs(got - want) <= tol

// --- the harness -------------------------------------------------------------

const results = []
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push({ label, ok, got, want })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got ${JSON.stringify(got)}${ok ? '' : `\n        want ${JSON.stringify(want)}`}`)
}

console.log('\n--- a block: the arithmetic is exact ----------------------------')
{
  const block = solid(new THREE.BoxGeometry(100, 40, 20))
  const cut = cutBottom(block, 5)

  check('the block loses exactly the bottom 5 mm',
    round(Math.abs(signedVolume(cut))), round(100 * 40 * 15))
  check('and stands 15 mm tall, sitting on the cut',
    [round(box(cut).max.z - box(cut).min.z), round(box(cut).min.z)], [15, -5])
  check('the new bottom is the full 100 x 40 footprint',
    round(faceArea(cut, -5)), 4000)
  check('the cut model is still closed', isClosed(cut), true)
  check('and is not turned inside out', signedVolume(cut) > 0, true)
  check('nothing across or deep is touched',
    [round(box(cut).max.x - box(cut).min.x), round(box(cut).max.y - box(cut).min.y)],
    [100, 40])
}

console.log('\n--- a cone: clipped, not squashed -------------------------------')
{
  // Eight sides, so a vertex is a long way from where the plane actually
  // crosses. Pulling low vertices up onto the plane -- the four-line version of
  // this -- gives a bottom the size of the base instead of the size of the
  // cross-section, and on a shape this coarse the difference is 60%.
  const cone = solid(new THREE.ConeGeometry(20, 40, 8)
    .rotateX(Math.PI / 2))            // three builds cones up the Y axis
  const cut = cutBottom(cone, 10)

  // An 8-gon of circumradius 15 -- the cone is 20 wide at the base and tapers
  // to nothing over 40 mm, so a quarter of the way up it is three quarters wide.
  const want = 0.5 * 8 * 15 ** 2 * Math.sin((2 * Math.PI) / 8)
  check('the new bottom is the cross-section, not the base',
    near(faceArea(cut, -10), want, want * 0.001), true)
  check('a squashed bottom would have been the base -- it is not',
    near(faceArea(cut, -10), 0.5 * 8 * 20 ** 2 * Math.sin((2 * Math.PI) / 8), 1),
    false)
  check('the cut cone is closed', isClosed(cut), true)
  check('and not inside out', signedVolume(cut) > 0, true)
}

console.log('\n--- a ring: the cap has a hole in it ----------------------------')
{
  // A torus lying flat. Cut through it and the new face is an annulus: two
  // loops, one inside the other. Filling the middle in would leave a model that
  // still measures right and prints with a solid disc where the hole was.
  const ring = solid(new THREE.TorusGeometry(30, 10, 64, 160))
  const cut = cutBottom(ring, 5)

  // Pappus, exactly: the removed piece is a circular segment of the tube swept
  // round, and the segment's centroid sits on the tube's own centre circle.
  const segment = 10 ** 2 * Math.acos(0.5) - 5 * Math.sqrt(75)
  const want = 2 * Math.PI ** 2 * 30 * 10 ** 2 - 2 * Math.PI * 30 * segment

  check('the ring loses the swept segment and nothing else',
    near(Math.abs(signedVolume(cut)), want, want * 0.002), true)
  check('the cut ring is closed -- a filled-in hole would not be',
    isClosed(cut), true)
  check('the new bottom is an annulus, not a disc',
    near(faceArea(cut, -5),
      Math.PI * ((30 + Math.sqrt(75)) ** 2 - (30 - Math.sqrt(75)) ** 2), 20),
    true)
  check('and it is not inside out', signedVolume(cut) > 0, true)
}

console.log('\n--- a ball: a curved bottom is what this is for -----------------')
{
  // The case prep/base.py was written for: a model that touches the plate at a
  // point. Unlike the three above, these numbers are approximate on purpose --
  // an icosphere is a polyhedron inscribed in the sphere, so it measures a few
  // per cent under the arithmetic everywhere, and tightening these would be
  // measuring three.js's tessellation rather than the cut.
  const ball = solid(new THREE.IcosahedronGeometry(20, 5))
  const cut = cutBottom(ball, 5)
  const cap = Math.PI * 25 * (3 * 20 - 5) / 3          // spherical cap, h = 5
  const removed = Math.abs(signedVolume(ball)) - Math.abs(signedVolume(cut))

  check('the ball loses its bottom cap and no more',
    near(removed, cap, cap * 0.05), true)
  check('a point of contact becomes a 26 mm circle to stand on',
    near(faceArea(cut, -15), Math.PI * (20 ** 2 - 15 ** 2), 549.78 * 0.03), true)
  check('the cut ball is closed', isClosed(cut), true)
  check('and not inside out', signedVolume(cut) > 0, true)
}

console.log('\n--- what it refuses ---------------------------------------------')
{
  const block = solid(new THREE.BoxGeometry(20, 20, 20))
  check('a cut of nothing hands back the model untouched',
    cutBottom(block, 0) === block, true)
  check('a cut that would leave nothing standing is refused',
    cutBottom(block, 20), null)
  check('so is a cut past the top of the model', cutBottom(block, 40), null)
  check('a cut of very nearly everything still works',
    (() => { const c = cutBottom(block, 19); return c !== null && isClosed(c) })(),
    true)
}

console.log('\n--- posed, the way the viewer and the writer ask for it ----------')
{
  const part = {
    geometry: solid(new THREE.BoxGeometry(100, 40, 20)), cutMm: 4,
  }
  // Tipped onto its side and doubled: the cut has to happen in the frame the
  // part ends up in, not the one it arrived in, or "the bottom" means the wrong
  // face the moment anything is turned over.
  const matrix = new THREE.Matrix4()
    .makeRotationX(Math.PI / 2)
    .premultiply(new THREE.Matrix4().makeScale(2, 2, 2))

  const posed = posedGeometry(part, matrix)
  const size = box(posed).getSize(new THREE.Vector3())
  check('the tipped part is 200 x 40 x 80 before the cut, 76 tall after',
    [round(size.x), round(size.y), round(size.z)], [200, 40, 76])
  check('the cut took the bottom of the pose, not the bottom of the file',
    round(Math.abs(signedVolume(posed))), round(200 * 40 * 76))
  check('the posed and cut part is closed', isClosed(posed), true)
  check('and not mirrored by the pose', signedVolume(posed) > 0, true)

  check('asking twice hands back separate geometry, not one shared object',
    posedGeometry(part, matrix) !== posedGeometry(part, matrix), true)

  const uncut = posedGeometry({ ...part, cutMm: 0 }, matrix)
  check('with no cut asked for, the part comes through whole',
    round(Math.abs(signedVolume(uncut))), round(200 * 40 * 80))
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
