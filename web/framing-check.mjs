/**
 * The camera framing, checked without a browser.
 *
 * Both viewers draw the same bed, and used to put the camera at a distance
 * fixed to the bed's size. That works for exactly one shape of viewport. A
 * perspective camera's vertical field of view does not change with the window:
 * a narrow one loses the sides of the plate, a short one the front and back
 * corners, and a phone -- which gets a short, wide strip above the controls --
 * loses them in both directions at once. It is the kind of failure nobody
 * writes a test for, because it is obvious the moment you look at it, and
 * nobody looks at it on fourteen printers times every screen there is.
 *
 * So the corners of the bed are projected through the camera `frameBed` gives,
 * for a spread of beds and viewport shapes, and checked to be on screen -- and
 * checked to fill it, since "fits" is trivially satisfied by standing far
 * enough away.
 *
 * Run it directly, or let tests/test_view_framing.py run it:
 *
 *   node web/framing-check.mjs
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { frameBed } from './src/framing.js'

// OrbitControls wants a DOM element to listen to. It only ever reaches for
// listeners and style here, so a stub is enough -- and cheaper than a headless
// browser for maths that has nothing to do with the DOM.
const stubElement = () => ({
  addEventListener() {}, removeEventListener() {},
  setPointerCapture() {}, releasePointerCapture() {},
  getRootNode() { return this },
  style: {}, clientWidth: 100, clientHeight: 100,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
})

const results = []
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push({ label, ok, got, want })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got ${JSON.stringify(got)}${ok ? '' : `\n        want ${JSON.stringify(want)}`}`)
}

// The beds this actually ships for: the smallest and largest Bambu machines,
// and the one in the middle everything was tuned on.
const BEDS = [
  { name: 'A1 mini', bed: [180, 180], height: 180 },
  { name: 'P1S', bed: [256, 256], height: 256 },
  { name: 'H2D', bed: [350, 320], height: 325 },
]

// Viewer shapes, as a width : height ratio. The phone ones are what the page
// leaves above the controls; the tall one is a narrow desktop window, where the
// bed used to run off the sides.
const SHAPES = [
  { name: 'phone, upright', aspect: 390 / 340 },
  { name: 'small phone, upright', aspect: 320 / 260 },
  { name: 'phone, on its side', aspect: 640 / 390 },
  { name: 'iPad, on its side', aspect: 828 / 820 },
  { name: 'iPad, upright', aspect: 768 / 500 },
  { name: 'narrow desktop window', aspect: 520 / 900 },
  { name: 'a strip', aspect: 900 / 260 },
]

/** Where the bed's four corners land, in screen coordinates of -1 .. 1. */
function project(camera, bed) {
  const [bx, by] = bed
  const corners = [[0, 0], [bx, 0], [bx, by], [0, by]]
    .map(([x, y]) => new THREE.Vector3(x, y, 0).project(camera))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  return {
    inside: Math.max(...xs.map(Math.abs), ...ys.map(Math.abs)) <= 1,
    fill: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2,
    // How far the bed's middle is from the middle of the frame, in halves of a
    // screen: 0 is centred, 1 is against an edge.
    off: Math.max(Math.abs(Math.max(...xs) + Math.min(...xs)) / 2,
                  Math.abs(Math.max(...ys) + Math.min(...ys)) / 2),
  }
}

const cameraFor = (aspect) => {
  const camera = new THREE.PerspectiveCamera(38, aspect, 1, 8000)
  camera.up.set(0, 0, 1)
  return camera
}

const framed = ({ bed, height }, aspect) => {
  const camera = cameraFor(aspect)
  const controls = new OrbitControls(camera, stubElement())
  frameBed(camera, controls, bed, height)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const measured = project(camera, bed)
  controls.dispose()
  return { camera, controls, ...measured }
}

console.log('\n--- the whole bed is on screen, whatever shape the viewer is ----')
{
  const cut = []
  const thin = []
  const adrift = []
  for (const printer of BEDS) {
    for (const shape of SHAPES) {
      const { inside, fill, off } = framed(printer, shape.aspect)
      const where = `${printer.name} / ${shape.name}`
      if (!inside) cut.push(where)
      // Fitting is easy from far enough away; the plate also has to be worth
      // looking at. Half the frame is the least that reads as a printer bed.
      if (fill < 0.5) thin.push(`${where}: ${fill.toFixed(2)}`)
      // And it has to be in the middle of the frame rather than hanging off a
      // corner of it, which is what the fixed camera did on a square viewer.
      // A little low is expected and wanted: what gets centred is the bed plus
      // the air above it that a model stands up into.
      if (off > 0.25) adrift.push(`${where}: ${off.toFixed(2)}`)
    }
  }
  check('no corner of the bed is off screen, on any bed or any viewer shape', cut, [])
  check('the bed still fills the frame it is in', thin, [])
  check('and sits in the middle of it', adrift, [])
}

console.log('\n--- the bug this fixes ------------------------------------------')
{
  // What both viewers did before: a distance fixed to the bed, ignoring the
  // viewport. Kept here because the fix is only interesting next to it.
  const cut = []
  for (const { name, bed, height } of BEDS) {
    for (const shape of SHAPES) {
      const [bx, by] = bed
      const camera = cameraFor(shape.aspect)
      camera.position.set(bx * 1.35, -by * 0.95, height * 0.95)
      camera.lookAt(bx / 2, by / 2, height * 0.18)
      camera.updateMatrixWorld()
      camera.updateProjectionMatrix()
      if (!project(camera, bed).inside) cut.push(`${name} / ${shape.name}`)
    }
  }
  check('the old fixed camera cut the bed off on most shapes',
    cut.length >= BEDS.length * 4, true)
}

console.log('\n--- the view itself ---------------------------------------------')
{
  const { camera, controls } = framed(BEDS[1], SHAPES[0].aspect)
  const [bx, by] = BEDS[1].bed
  // Not the exact centre: the camera is nudged to put the bed in the middle of
  // the frame, and perspective means that is a little short of aiming at the
  // middle of the bed. It should still be aimed well within it, and from above.
  check('the camera looks down at the middle of the bed',
    [controls.target.x > bx * 0.25 && controls.target.x < bx * 0.75,
     controls.target.y > by * 0.25 && controls.target.y < by * 0.75,
     camera.position.z > 0],
    [true, true, true])
  check('it is in front of the bed and to the right, as the plate pictures are',
    [camera.position.x > bx / 2, camera.position.y < 0], [true, true])

  // Two printers whose beds differ by a factor; the camera should back off by
  // about the same factor rather than by some constant.
  const near = framed(BEDS[0], SHAPES[0].aspect).camera.position.length()
  const far = framed(BEDS[1], SHAPES[0].aspect).camera.position.length()
  check('a bigger bed is seen from proportionally further away',
    Math.round((far / near) * 100) / 100, Math.round((256 / 180) * 100) / 100)
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
