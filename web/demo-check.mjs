/**
 * The test model, checked the way a user's file never can be.
 *
 * The walk-through on the landing screen hands somebody a model and then tells
 * them to split it, spread it over plates, resize it, flatten a bottom and
 * write a file. Every one of those steps is a claim about the geometry in
 * `src/local/demo.js`, and every one of them fails *quietly* if the geometry is
 * wrong: a model that will not come apart makes step one look like a broken
 * button, a shape already sitting flat makes the flatten step look like a
 * slider with no effect, and a model wider than the smallest bed opens the
 * walk-through with a warning about the model rather than a first step.
 *
 * None of that raises anything. So the claims are checked here, against the
 * real splitter and the real printer list, and tests/test_local_demo.py hands
 * the results to pytest.
 *
 * Lives in web/ rather than spikes/ so that `three` resolves. Run it directly:
 *
 *   node web/demo-check.mjs
 */

import * as THREE from 'three'
import { readFileSync } from 'node:fs'

import { demoModel, DEMO_NAME, TOUR } from './src/local/demo.js'
import { arrange, footprint, splitParts } from './src/local/parts.js'
import { IDENTITY } from './src/orientation.js'

// The printer index, read as a file rather than imported: profiles.js imports
// it as a module, which Vite resolves and Node does not. printers-check.mjs
// reads it the same way, and for the same reason.
const printers = JSON.parse(readFileSync('src/data/printers.json', 'utf8')).printers

const results = []
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push({ label, ok, got, want })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got ${JSON.stringify(got)}${ok ? '' : `\n        want ${JSON.stringify(want)}`}`)
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

/**
 * How many edges are not shared by exactly two triangles.
 *
 * A shape with any is a shape with a hole in it, which is the one defect a
 * bounding box and a volume both look straight past -- the same check
 * flatten-check.mjs runs on the cap it stitches.
 */
const openEdges = (geometry) => {
  const idx = geometry.getIndex()
  const pos = geometry.getAttribute('position')
  const n = idx ? idx.count / 3 : pos.count / 3
  const at = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k)
  const seen = new Map()
  for (let t = 0; t < n; t++) {
    const v = [at(t, 0), at(t, 1), at(t, 2)]
    for (let k = 0; k < 3; k++) {
      const a = v[k]; const b = v[(k + 1) % 3]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      seen.set(key, (seen.get(key) || 0) + 1)
    }
  }
  return [...seen.values()].filter((count) => count !== 2).length
}

const sizeOf = (geometry) => {
  const g = geometry.clone(); g.computeBoundingBox()
  const s = g.boundingBox.getSize(new THREE.Vector3())
  return [s.x, s.y, s.z].map((v) => Math.round(v))
}

const model = demoModel()

console.log('\n--- the model as it arrives -------------------------------------')
{
  check('it is indexed, positions only, the way readModel hands geometry on',
    [!!model.getIndex(), Object.keys(model.attributes)], [true, ['position', 'normal']])
  check('it stands on the plate rather than through it',
    Math.round(model.boundingBox.min.z), 0)
  // 120-ish across is the number the walk-through depends on: it has to leave
  // room on an A1 mini, whose bed is the smallest here at 180 mm.
  check('about 120 mm across, 36 deep, 36 tall', sizeOf(model), [121, 36, 36])
  check('it is one closed surface -- no holes anywhere in it', openEdges(model), 0)
  check('it is wound outwards, so nothing prints inside out',
    signedVolume(model) > 0, true)
}

console.log('\n--- what the first step of the walk-through claims ---------------')
const parts = splitParts(model)
{
  check('it comes apart into three', parts?.length, 3)
  check('each piece is closed on its own', parts.map(openEdges), [0, 0, 0])
  check('none is mirrored by the split', parts.map((g) => signedVolume(g) > 0),
    [true, true, true])
  check('no volume lost or gained',
    Math.round(parts.reduce((n, g) => n + Math.abs(signedVolume(g)), 0)),
    Math.round(Math.abs(signedVolume(model))))
  // Biggest first is splitParts' contract, and it decides which of "Part 1,
  // Part 2, Part 3" the walk-through's flatten step is talking about.
  check('the ball, the ring and the gem, each about 34 mm across',
    parts.map(sizeOf), [[34, 34, 34], [34, 34, 10], [36, 36, 36]])
}

console.log('\n--- what the flatten step claims --------------------------------')
{
  // The point of the ball, and the point of naming it in the step. A shape
  // resting on one vertex loses almost nothing to the first millimetre of the
  // cut and gains a face to stand on, so the slider does something anyone can
  // see. The ring is flat already: cutting it takes a millimetre off for
  // nothing, which is why the step does not send anybody there first.
  // How wide the shape's contact with the plate is: the furthest any vertex
  // sitting on the floor is from the middle. A tenth of a millimetre of slack,
  // because a sphere's first ring of vertices is that far above its pole and
  // is still, to anyone looking at it, the same point.
  const contactMm = (geometry) => {
    const g = geometry.clone(); g.computeBoundingBox()
    const floor = g.boundingBox.min.z
    const centre = g.boundingBox.getCenter(new THREE.Vector3())
    const pos = g.getAttribute('position')
    let widest = 0
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) - floor > 0.2) continue
      widest = Math.max(widest,
        Math.hypot(pos.getX(i) - centre.x, pos.getY(i) - centre.y))
    }
    return Math.round(widest * 2)
  }
  const [ball, ring, gem] = parts
  check('the ball and the gem balance on a point, a couple of mm across at most',
    [contactMm(ball) <= 4, contactMm(gem) <= 4], [true, true])
  check('and the ring is already flat on the plate, 24 mm of it',
    contactMm(ring) >= 24, true)
}

console.log('\n--- what the plates step claims ---------------------------------')
{
  let id = 1
  const held = parts.map((geometry) => ({
    id: id++, geometry, name: `Part ${id - 1}`, plate: 0, x: 0, y: 0,
    spin: IDENTITY, yaw: 0, scale: 1, cutMm: 0,
  }))
  const matrixFor = () => new THREE.Matrix4()

  // Every printer, because the machine is remembered between visits: somebody
  // who set an A1 mini last week starts the walk-through on a 180 mm bed.
  const laid = printers.map((printer) => {
    const { plateCount, tooBig } = arrange(held, printer, matrixFor)
    const whole = footprint(model, new THREE.Matrix4())
    const [bedX, bedY] = printer.bed_mm
    return {
      fits: whole.width <= bedX - 16 && whole.depth <= bedY - 16,
      plateCount,
      tooBig: tooBig.length,
    }
  })
  check('the model fits every bed unsplit, so the tour never opens on a warning',
    laid.every((r) => r.fits), true)
  check('and the three parts land on one plate on every printer',
    laid.every((r) => r.plateCount === 1 && r.tooBig === 0), true)
}

console.log('\n--- the walk-through itself -------------------------------------')
{
  check('seven steps, each with a key, a title and a hint',
    TOUR.every((s) => s.key && s.title && s.hint) && TOUR.length, 7)
  check('the keys are unique', new Set(TOUR.map((s) => s.key)).size, TOUR.length)
  check('it ends at the file being made', TOUR[TOUR.length - 1].key, 'made')
  // The name becomes the saved file's stem, so it has to survive a file system.
  check('the name is something a file can be called',
    /^[A-Za-z0-9 ]+$/.test(DEMO_NAME), true)
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
