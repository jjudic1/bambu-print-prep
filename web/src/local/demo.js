/**
 * The test model, and the walk-through that goes with it.
 *
 * Everything this app does needs a model in hand, and the landing screen asks
 * for one before it will show anything at all. That is the wrong way round for
 * somebody who has just been told this exists: they have no .stl, they do not
 * yet know what "split it across plates" means, and the only way to find out is
 * to go to MakerWorld, sign up, download something and come back. Most people
 * do not come back.
 *
 * So there is a model here, built in the browser out of three primitives, and a
 * list of the seven things to try with it. Nothing is fetched -- a demo that
 * needs a file from the network is a demo that is broken the day the network
 * is, and the whole argument for this page is that it needs nothing.
 *
 * The three shapes are chosen for what each one teaches, not for looks:
 *
 *   ball   balances on a point, so Flatten the bottom visibly does something
 *          -- on a flat-bottomed shape the slider is a control with no effect
 *   gem    stands on a corner, and is small enough to send to its own plate
 *   ring   already sits flat, so it is the one that shows the *difference*
 *
 * They are separate lumps of geometry -- no shared vertices, and a real gap
 * between them -- because Split into parts is connected-component union-find
 * over the mesh (parts.js). Two shapes merely touching would come out as one
 * part, and the first step of the walk-through would appear to do nothing.
 */

import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

/** What the file is called, and so what the saved 3mf is named after. */
export const DEMO_NAME = 'Practice shapes'

/**
 * The seven steps, in the order they make sense in.
 *
 * Held here rather than in LocalApp because they are content, and because the
 * app only supplies the answer to "has this one been done yet" -- the wording
 * and the order are this file's. `key` is what LocalApp matches on;
 * tests/test_local_demo.py checks the two lists have not drifted apart.
 */
export const TOUR = [
  {
    key: 'split',
    title: 'Split it into parts',
    hint: 'Tap Split into parts. The three shapes come apart and lay themselves out.',
  },
  {
    key: 'plates',
    title: 'Send a part to its own plate',
    hint: 'Tap + Add to make a second plate. Then tap Plate 1, tap a part, and tap Send to 2. That is how a model too big for your bed gets printed.',
  },
  {
    key: 'switch',
    title: 'Look at both plates',
    hint: 'Tap Plate 1 and Plate 2. The picture shows one plate at a time - the file carries all of them.',
  },
  {
    key: 'size',
    title: 'Make it bigger or smaller',
    hint: 'Drag How big. With a part tapped it resizes just that part, with Everything tapped it resizes the lot.',
  },
  {
    key: 'flatten',
    title: 'Flatten a bottom',
    hint: 'Tap the ball - the round one - and drag Flatten the bottom. It stops balancing on a point and sits flat.',
  },
  {
    key: 'colour',
    title: 'Change a colour',
    hint: 'Pick a swatch. This is for the picture only, so you can tell the parts apart - your printer prints whatever you load into it.',
  },
  {
    key: 'made',
    title: 'Make the file',
    hint: 'Tap Make the file. It is written here on your device, and it is a real one - save it and print it if you like.',
  },
]

/**
 * One shape, welded and moved into place.
 *
 * The weld is not optional. Three.js builds a polyhedron as a heap of loose
 * triangles, so without `mergeVertices` a single shape is already several
 * connected components and Split into parts would cut the gem into its eight
 * faces.
 *
 * And the normals and texture coordinates have to go *first*. `mergeVertices`
 * matches on every attribute a vertex carries, not on its position, so two
 * corners in the same place with different normals -- which is exactly what a
 * hard edge is, and what a sphere's seam is -- are left as two. Welding a
 * geometry with its normals still on it welds almost nothing: measured here,
 * the gem stayed eight loose triangles and the ball came out with 252 open
 * edges. readModel strips them for the same reason, on the user's own file.
 */
function shape(geometry, { x = 0, z = 0 } = {}) {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position') geometry.deleteAttribute(name)
  }
  const welded = mergeVertices(geometry, 1e-4)
  welded.translate(x, 0, z)
  return welded
}

/**
 * Glue the shapes into one geometry, keeping them unattached.
 *
 * Concatenated by hand rather than through mergeVertices on the whole thing:
 * a weld across the set is exactly what must not happen here, and doing it this
 * way means the file that arrives at the splitter has the connectivity this
 * file intended rather than whatever a tolerance decided.
 */
function join(pieces) {
  const positions = []
  const indices = []
  for (const piece of pieces) {
    const offset = positions.length / 3
    const position = piece.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i))
    }
    const index = piece.getIndex()
    for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

/**
 * The test model: three shapes standing on one plate, about 120 mm across.
 *
 * 120 mm because it has to fit the smallest bed here -- an A1 mini is 180 mm --
 * with room to spare, so that nothing on the walk-through opens with a warning
 * about the model being too big. Z runs upwards, as it does everywhere in this
 * app and in the container, so each shape is lifted to sit on the plate rather
 * than half-buried in it.
 */
export function demoModel() {
  return join([
    // The ball: 34 mm across, touching the plate at one point.
    shape(new THREE.SphereGeometry(17, 48, 32), { x: -43, z: 17 }),
    // The ring: 34 mm across and 10 mm thick. A torus is built lying in the
    // XY plane, which with Z upwards is already flat on the plate -- so this
    // is the shape the flatten slider should leave alone.
    shape(new THREE.TorusGeometry(12, 5, 20, 48), { x: 0, z: 5 }),
    // The gem: eight faces, standing on a corner.
    shape(new THREE.OctahedronGeometry(18), { x: 43, z: 18 }),
  ])
}
