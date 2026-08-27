import * as THREE from 'three'

/**
 * Where to put the camera so the whole bed is on screen.
 *
 * The viewer is not always the near-square box an iPad gives it. On a phone the
 * controls take the bottom of the screen and what is left above them is a
 * short, wide strip; a narrow desktop window is the opposite. A camera placed
 * at a fixed distance -- which is what both viewers used to do -- cannot serve
 * all three, because narrowing the viewport only ever narrows the horizontal
 * field of view: the plate ran off the sides of a tall window and off the front
 * and back of a short one, and on a phone it was cut both ways at once.
 *
 * So the direction the plate is seen from is fixed -- the same three-quarter
 * view the plate pictures use -- and the distance is solved for, from the shape
 * of the viewport.
 *
 * What has to fit is the bed and a little air above it, not the whole build
 * volume: a printer a quarter of a metre tall would frame almost nothing but
 * empty space, and anything taller than the headroom can still be reached by
 * pinching.
 */

const UP = new THREE.Vector3(0, 0, 1)
const HEADROOM = 0.25        // of the bed's longer side, kept clear above it
const PADDING = 1.06         // air around the lot, so no corner sits on the edge
const PASSES = 3             // solve, recentre, solve

/**
 * Aim `camera` (and its OrbitControls, if it has any) at a bed of `bed` mm and
 * `height` mm.
 *
 * `camera.aspect` must already be the one it will be drawn at, since that is
 * what decides the distance. Call it whenever the bed or the aspect changes.
 * `controls` may be null -- the plate pictures frame a camera of their own,
 * which nobody orbits.
 */
export function frameBed(camera, controls, bed, height) {
  const [bx, by] = bed
  const top = Math.min(Math.max(height, 1), Math.max(bx, by) * HEADROOM)

  const corners = []
  for (const x of [0, bx]) {
    for (const y of [0, by]) {
      for (const z of [0, top]) corners.push(new THREE.Vector3(x, y, z))
    }
  }

  // Unit vector from the target towards the camera. Its proportions are the
  // ones the old fixed placement used, so the plate is seen from the same angle
  // as before -- it is only the distance along it, and where it points, that
  // are worked out rather than assumed.
  const dir = new THREE.Vector3(bx * 0.85, -by * 1.45, Math.max(height, 1) * 0.77)
    .normalize()

  // The camera's own axes, to measure the corners against.
  const forward = dir.clone().negate()
  const right = new THREE.Vector3().crossVectors(forward, UP).normalize()
  const up = new THREE.Vector3().crossVectors(right, forward).normalize()

  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / PADDING
  const tanH = tanV * (camera.aspect || 1)

  const target = new THREE.Vector3(bx / 2, by / 2, top / 2)
  const q = new THREE.Vector3()
  let distance = 0

  // Two things that depend on each other: how far back the camera has to be to
  // hold every corner, and where it should point so they sit in the middle of
  // the frame rather than off one side. Solving one then the other twice over
  // settles both -- perspective means neither is a closed form.
  for (let pass = 0; pass < PASSES; pass++) {
    // A corner is inside the frustum when its offset across the frame is no
    // more than tan(half the field of view) times its depth. Depth is the
    // distance being solved for, less how far the corner lies towards the
    // camera, so every corner names a distance and the furthest one wins.
    distance = 0
    for (const p of corners) {
      q.copy(p).sub(target)
      distance = Math.max(distance, q.dot(dir) + Math.max(
        Math.abs(q.dot(up)) / tanV, Math.abs(q.dot(right)) / tanH))
    }
    if (pass === PASSES - 1) break

    // Where the corners sit in the frame now, in halves of a screen, and the
    // nudge that would centre them.
    let lowV = Infinity; let highV = -Infinity
    let lowH = Infinity; let highH = -Infinity
    for (const p of corners) {
      q.copy(p).sub(target)
      const depth = distance - q.dot(dir)
      const v = q.dot(up) / (depth * tanV)
      const h = q.dot(right) / (depth * tanH)
      lowV = Math.min(lowV, v); highV = Math.max(highV, v)
      lowH = Math.min(lowH, h); highH = Math.max(highH, h)
    }
    target.addScaledVector(up, ((highV + lowV) / 2) * distance * tanV)
    target.addScaledVector(right, ((highH + lowH) / 2) * distance * tanH)
  }

  camera.position.copy(target).addScaledVector(dir, distance)
  if (controls) {
    controls.target.copy(target)
    controls.update()
  } else {
    camera.lookAt(target)
  }
  camera.updateMatrixWorld()
}
